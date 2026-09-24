/**
 * BANK PARS — ledger service: THE only module that writes to the ledger.
 *
 * Everything that changes a balance goes through `postPostingSet`. The function is
 * deliberately strict:
 *
 *   1. the posting set is validated in the domain layer (balanced, positive, no
 *      duplicate account+direction);
 *   2. accounts are locked in a deterministic order (deadlock-hardened);
 *   3. balances are read from the ledger, not from a cache, and checked;
 *   4. entries are written inside the caller's transaction;
 *   5. the database re-verifies at COMMIT with deferred constraint triggers
 *      (balanced, no overdraft, supply cap) — a bug here cannot corrupt money.
 *
 * The monetary snapshot is refreshed whenever a posting set touches the currency
 * in existence account, so the published reference rate always matches the books.
 */
import {
  ACCOUNT_CODES,
  type TransactionType,
} from '@parsbank/config/constants';
import {
  DomainError,
  assertPostingSetAffordable,
  assertValidPostingSet,
  buildReversal,
  type AccountRef,
  type PostingSet,
} from '@parsbank/domain';
import type { Database, TransactionContext } from '../db/types.ts';
import type { ActorContext, RequestMeta } from './context.ts';

type Runner = Database | TransactionContext;

export interface PostingOptions {
  set: PostingSet;
  actor: ActorContext | null;
  memo?: string | null;
  reason?: string | null;
  idempotencyKey?: string | null;
  requestFingerprint?: string | null;
  reversesLedgerTransactionId?: string | null;
  metadata?: Record<string, unknown>;
  /** refresh the monetary snapshot inside this transaction (supply changed) */
  refreshMonetaryState?: boolean;
  refreshReasons?: string[];
}

export interface PostingResult {
  ledgerTransactionId: string;
  sequenceNo: number;
  debits: number;
  credits: number;
  supplyDelta: number;
  circulatingDelta: number;
  monetaryStateVersion: number | null;
  referenceRate: number | null;
  coverageRatio: number | null;
  totalIssuedMinor: number;
  circulatingSupplyMinor: number;
}

/** Resolves chart accounts by code or wallet into ledger account refs. */
export async function resolveAccount(runner: Runner, accountId: string): Promise<AccountRef> {
  const row = await runner.one<{
    id: string;
    code: string;
    is_circulating: boolean;
    allow_negative: boolean;
    normal_balance: 'DEBIT' | 'CREDIT';
  }>(
    'SELECT id, code, is_circulating, allow_negative, normal_balance FROM prs.accounts WHERE id = $1',
    [accountId],
  );
  if (!row) throw new DomainError('INTERNAL_ERROR', { messageEn: `account ${accountId} not found` });
  return {
    accountId: row.id,
    code: row.code,
    isCirculating: row.is_circulating,
    allowNegative: row.allow_negative,
    normalBalance: row.normal_balance,
  };
}

export async function accountByCode(runner: Runner, code: string): Promise<AccountRef> {
  const row = await runner.one<{
    id: string;
    code: string;
    is_circulating: boolean;
    allow_negative: boolean;
    normal_balance: 'DEBIT' | 'CREDIT';
  }>(
    'SELECT id, code, is_circulating, allow_negative, normal_balance FROM prs.accounts WHERE code = $1',
    [code],
  );
  if (!row) throw new DomainError('INTERNAL_ERROR', { messageEn: `chart account ${code} not found` });
  return {
    accountId: row.id,
    code: row.code,
    isCirculating: row.is_circulating,
    allowNegative: row.allow_negative,
    normalBalance: row.normal_balance,
  };
}

export async function walletAccount(runner: Runner, walletId: string): Promise<AccountRef> {
  const row = await runner.one<{
    id: string;
    code: string;
    is_circulating: boolean;
    allow_negative: boolean;
    normal_balance: 'DEBIT' | 'CREDIT';
  }>(
    'SELECT id, code, is_circulating, allow_negative, normal_balance FROM prs.accounts WHERE wallet_id = $1',
    [walletId],
  );
  if (!row) throw new DomainError('WALLET_NOT_FOUND', { context: { walletId } });
  return {
    accountId: row.id,
    code: row.code,
    isCirculating: row.is_circulating,
    allowNegative: row.allow_negative,
    normalBalance: row.normal_balance,
  };
}

export const chart = {
  currencyInExistence: (runner: Runner) => accountByCode(runner, ACCOUNT_CODES.CURRENCY_IN_EXISTENCE),
  escrow: (runner: Runner) => accountByCode(runner, ACCOUNT_CODES.ESCROW_IN_FLIGHT),
  physicalNotes: (runner: Runner) => accountByCode(runner, ACCOUNT_CODES.PHYSICAL_NOTES_OUTSTANDING),
  feeRevenue: (runner: Runner) => accountByCode(runner, ACCOUNT_CODES.FEE_REVENUE),
  treasuryOperating: (runner: Runner) => accountByCode(runner, ACCOUNT_CODES.TREASURY_OPERATING),
  suspense: (runner: Runner) => accountByCode(runner, ACCOUNT_CODES.SUSPENSE_CLEARING),
};

async function lockAccounts(tx: TransactionContext, accountIds: string[]): Promise<void> {
  // Deterministic order: the classic deadlock-avoidance rule for multi-account postings.
  await tx.query(
    'SELECT id FROM prs.accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [[...new Set(accountIds)].sort()],
  );
}

async function readBalances(
  tx: TransactionContext,
  accountIds: string[],
): Promise<{ balances: Record<string, number>; circulatingByAccount: Map<string, boolean> }> {
  const rows = await tx.query<{ id: string; balance: string; is_circulating: boolean; normal_balance: 'DEBIT' | 'CREDIT' }>(
    `SELECT a.id, prs.account_balance(a.id)::text AS balance, a.is_circulating, a.normal_balance
       FROM prs.accounts a WHERE a.id = ANY($1::uuid[])`,
    [[...new Set(accountIds)]],
  );
  const balances: Record<string, number> = {};
  const circulatingByAccount = new Map<string, boolean>();
  for (const row of rows) {
    balances[row.id] = Number(row.balance);
    circulatingByAccount.set(row.id, row.is_circulating);
  }
  return { balances, circulatingByAccount };
}

export async function postPostingSet(tx: TransactionContext, options: PostingOptions): Promise<PostingResult> {
  const { set } = options;
  assertValidPostingSet(set);

  const accountIds = set.lines.map((line) => line.account.accountId);
  await lockAccounts(tx, accountIds);

  const supply = await tx.one<{ total_issued_minor: string }>(
    'SELECT total_issued_minor::text FROM prs.supply_summary',
  );
  const maxSupply = await tx.one<{ value: unknown }>(
    `SELECT value FROM prs.system_settings WHERE key = 'max_supply_minor'`,
  );
  const maxSupplyMinor = Number((maxSupply?.value as string) ?? 10_000);

  const { balances } = await readBalances(tx, accountIds);
  const totals = assertPostingSetAffordable(set, {
    balances,
    maxSupplyMinor,
    currentTotalIssuedMinor: Number(supply?.total_issued_minor ?? 0),
  });

  const ledgerTx = await tx.one<{ id: string; sequence_no: string }>(
    `INSERT INTO prs.ledger_transactions
       (type, idempotency_key, request_fingerprint, initiated_by_profile_id, memo, reason,
        reverses_ledger_transaction_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, sequence_no`,
    [
      set.type,
      options.idempotencyKey ?? null,
      options.requestFingerprint ?? null,
      options.actor?.profileId ?? null,
      options.memo ?? null,
      options.reason ?? null,
      options.reversesLedgerTransactionId ?? null,
      JSON.stringify(options.metadata ?? {}),
    ],
  );
  if (!ledgerTx) throw new DomainError('INTERNAL_ERROR', { messageEn: 'ledger transaction insert failed' });

  let line = 1;
  for (const entry of set.lines) {
    await tx.execute(
      `INSERT INTO prs.ledger_entries (ledger_transaction_id, account_id, direction, amount_minor, line_no, memo)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [ledgerTx.id, entry.account.accountId, entry.direction, entry.amountMinor, line++, entry.memo ?? null],
    );
  }

  const touchesSupply = set.lines.some(
    (entry) => entry.account.code === ACCOUNT_CODES.CURRENCY_IN_EXISTENCE,
  );

  let version: number | null = null;
  let rate: number | null = null;
  let coverage: number | null = null;
  let totalIssuedMinor = Number(supply?.total_issued_minor ?? 0) + totals.supplyDelta;
  let circulatingSupplyMinor = 0;

  if (options.refreshMonetaryState ?? touchesSupply) {
    const refreshed = await tx.one<{
      version: string;
      reference_rate_prs_per_usd: string;
      reserve_coverage_ratio: string;
      total_issued_minor: string;
      circulating_supply_minor: string;
    }>(
      `SELECT version, reference_rate_prs_per_usd, reserve_coverage_ratio, total_issued_minor, circulating_supply_minor
         FROM prs.refresh_monetary_state($1, $2)`,
      [options.actor?.profileId ?? null, options.refreshReasons ?? [set.type]],
    );
    version = Number(refreshed?.version ?? 0);
    rate = Number(refreshed?.reference_rate_prs_per_usd ?? 0);
    coverage = Number(refreshed?.reserve_coverage_ratio ?? 0);
    totalIssuedMinor = Number(refreshed?.total_issued_minor ?? totalIssuedMinor);
    circulatingSupplyMinor = Number(refreshed?.circulating_supply_minor ?? 0);
  } else {
    const current = await tx.one<{ circulating_supply_minor: string }>(
      'SELECT circulating_supply_minor::text FROM prs.supply_summary',
    );
    circulatingSupplyMinor = Number(current?.circulating_supply_minor ?? 0);
  }

  return {
    ledgerTransactionId: ledgerTx.id,
    sequenceNo: Number(ledgerTx.sequence_no),
    debits: totals.debits,
    credits: totals.credits,
    supplyDelta: totals.supplyDelta,
    circulatingDelta: totals.circulatingDelta,
    monetaryStateVersion: version,
    referenceRate: rate,
    coverageRatio: coverage,
    totalIssuedMinor,
    circulatingSupplyMinor,
  };
}

/**
 * Reverses a posted ledger transaction by writing its mirror image. The original
 * rows are never touched — corrections are new history, not rewritten history.
 */
export async function reverseLedgerTransaction(
  tx: TransactionContext,
  input: { ledgerTransactionId: string; actor: ActorContext; reason: string; meta: RequestMeta },
): Promise<PostingResult> {
  const original = await tx.one<{ id: string; type: string; status: string }>(
    'SELECT id, type, status FROM prs.ledger_transactions WHERE id = $1',
    [input.ledgerTransactionId],
  );
  if (!original) throw new DomainError('INTERNAL_ERROR', { messageEn: 'ledger transaction not found' });
  if (original.status === 'REVERSED') {
    throw new DomainError('IMMUTABLE_RECORD', { messageEn: 'ledger transaction already reversed' });
  }

  const entries = await tx.query<{ account_id: string; direction: 'DEBIT' | 'CREDIT'; amount_minor: string }>(
    'SELECT account_id, direction, amount_minor FROM prs.ledger_entries WHERE ledger_transaction_id = $1 ORDER BY line_no',
    [input.ledgerTransactionId],
  );

  const accounts = await Promise.all(
    [...new Set(entries.map((entry) => entry.account_id))].map((id) => resolveAccount(tx, id)),
  );
  const byId = new Map(accounts.map((account) => [account.accountId, account]));

  const originalSet: PostingSet = {
    type: 'TRANSFER',
    lines: entries.map((entry) => ({
      account: byId.get(entry.account_id)!,
      direction: entry.direction,
      amountMinor: Number(entry.amount_minor),
    })),
  };
  const mirrored = buildReversal(originalSet, input.reason);

  return postPostingSet(tx, {
    set: mirrored,
    actor: input.actor,
    reason: input.reason,
    reversesLedgerTransactionId: input.ledgerTransactionId,
    refreshMonetaryState: true,
    refreshReasons: ['REVERSAL'],
  });
}

export interface LedgerAccountSummary {
  accountId: string;
  code: string;
  nameFa: string;
  className: string;
  kind: string;
  normalBalance: string;
  balanceMinor: number;
  debitsMinor: number;
  creditsMinor: number;
  isSystem: boolean;
  isCirculating: boolean;
}

export async function listChartOfAccounts(db: Database): Promise<LedgerAccountSummary[]> {
  const rows = await db.query<{
    account_id: string;
    code: string;
    name_fa: string;
    class: string;
    kind: string;
    normal_balance: string;
    debits: string;
    credits: string;
    debit_balance: string;
    credit_balance: string;
    is_system: boolean;
    is_circulating: boolean;
  }>(`SELECT account_id, code, name_fa, class, kind, normal_balance, debits_minor::text AS debits,
              credits_minor::text AS credits, debit_balance_minor::text AS debit_balance,
              credit_balance_minor::text AS credit_balance, is_system, is_circulating
         FROM prs.account_balances
        WHERE wallet_id IS NULL
        ORDER BY code`);

  return rows.map((row) => ({
    accountId: row.account_id,
    code: row.code,
    nameFa: row.name_fa,
    className: row.class,
    kind: row.kind,
    normalBalance: row.normal_balance,
    balanceMinor: Number(row.normal_balance === 'DEBIT' ? row.debit_balance : row.credit_balance),
    debitsMinor: Number(row.debits),
    creditsMinor: Number(row.credits),
    isSystem: row.is_system,
    isCirculating: row.is_circulating,
  }));
}

/** Ledger entries of one transaction, for receipts and admin drill-downs. */
export async function ledgerEntriesFor(
  runner: Runner,
  ledgerTransactionId: string,
): Promise<Array<{ code: string; direction: 'DEBIT' | 'CREDIT'; amountMinor: number; lineNo: number }>> {
  const rows = await runner.query<{ code: string; direction: 'DEBIT' | 'CREDIT'; amount_minor: string; line_no: number }>(
    `SELECT a.code, e.direction, e.amount_minor::text AS amount_minor, e.line_no
       FROM prs.ledger_entries e
       JOIN prs.accounts a ON a.id = e.account_id
      WHERE e.ledger_transaction_id = $1
      ORDER BY e.line_no`,
    [ledgerTransactionId],
  );
  return rows.map((row) => ({
    code: row.code,
    direction: row.direction,
    amountMinor: Number(row.amount_minor),
    lineNo: row.line_no,
  }));
}

export function isSupplyChanging(type: TransactionType): boolean {
  return type === 'ISSUANCE' || type === 'BURN' || type === 'REDEMPTION' || type === 'FEE';
}
