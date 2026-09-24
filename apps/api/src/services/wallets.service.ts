/**
 * BANK PARS — wallets.
 *
 * Balances are always read from `prs.wallet_balances` (a view over the ledger) or
 * from the cache that the DATABASE maintains. No service writes a balance column:
 * there is no such column to write.
 */
import type { WalletSummary } from '@parsbank/types';
import { DomainError, referenceUsdMinor } from '@parsbank/domain';
import type { Database, TransactionContext } from '../db/types.ts';
import { latestReferenceRate } from './monetary.service.ts';

export interface WalletRow {
  wallet_id: string;
  public_ref: string;
  profile_id: string;
  label_fa: string;
  status: string;
  kind: string;
  is_primary: boolean;
  account_id: string;
  balance_minor: string;
  opened_at: string;
}

export async function listWalletsForProfile(db: Database, profileId: string): Promise<WalletRow[]> {
  return db.query<WalletRow>(
    `SELECT w.id AS wallet_id, w.public_ref, w.profile_id, w.label_fa, w.status, w.kind, w.is_primary,
            a.id AS account_id, COALESCE(b.balance_minor, 0)::text AS balance_minor, w.opened_at
       FROM prs.wallets w
       JOIN prs.accounts a ON a.wallet_id = w.id
       LEFT JOIN prs.wallet_balances b ON b.wallet_id = w.id
      WHERE w.profile_id = $1 AND w.kind = 'STANDARD'
      ORDER BY w.is_primary DESC, w.opened_at ASC`,
    [profileId],
  );
}

export async function getWalletForProfile(
  db: Database,
  walletId: string,
  profileId: string,
): Promise<WalletRow> {
  const row = await db.one<WalletRow>(
    `SELECT w.id AS wallet_id, w.public_ref, w.profile_id, w.label_fa, w.status, w.kind, w.is_primary,
            a.id AS account_id, COALESCE(b.balance_minor, 0)::text AS balance_minor, w.opened_at
       FROM prs.wallets w
       JOIN prs.accounts a ON a.wallet_id = w.id
       LEFT JOIN prs.wallet_balances b ON b.wallet_id = w.id
      WHERE w.id = $1`,
    [walletId],
  );
  if (!row) throw new DomainError('WALLET_NOT_FOUND');
  // Server-side ownership check — the client cannot ask for someone else's wallet.
  if (row.profile_id !== profileId) {
    throw new DomainError('WALLET_NOT_OWNED', { context: { walletId, profileId } });
  }
  return row;
}

export function toWalletSummary(row: WalletRow, rate: number | null): WalletSummary {
  const balanceMinor = Number(row.balance_minor);
  return {
    walletId: row.wallet_id,
    publicRef: row.public_ref,
    labelFa: row.label_fa,
    status: row.status as WalletSummary['status'],
    isPrimary: row.is_primary,
    balanceMinor,
    referenceUsdMinor: referenceUsdMinor(balanceMinor, rate) ?? 0,
    openedAt: new Date(row.opened_at).toISOString(),
  };
}

export async function walletSummaries(db: Database, profileId: string): Promise<WalletSummary[]> {
  const [rows, rate] = await Promise.all([listWalletsForProfile(db, profileId), latestReferenceRate(db)]);
  return rows.map((row) => toWalletSummary(row, rate));
}

/** Creates a wallet together with its ledger account, atomically. */
export async function createWallet(
  tx: TransactionContext,
  input: { profileId: string; labelFa: string; isPrimary?: boolean; publicRef: string },
): Promise<{ walletId: string; accountId: string }> {
  const wallet = await tx.one<{ id: string }>(
    `INSERT INTO prs.wallets (public_ref, profile_id, label_fa, is_primary)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.publicRef, input.profileId, input.labelFa, input.isPrimary ?? false],
  );
  if (!wallet) throw new DomainError('INTERNAL_ERROR', { messageEn: 'wallet insert failed' });
  const account = await tx.one<{ id: string }>(
    `INSERT INTO prs.accounts (code, name_fa, name_en, class, kind, normal_balance, is_circulating, wallet_id)
     VALUES ($1, 'کیف پول', 'Wallet', 'LIABILITY', 'WALLET', 'CREDIT', true, $2)
     RETURNING id`,
    [`WALLET:${wallet.id}`, wallet.id],
  );
  await tx.execute(
    `INSERT INTO prs.wallet_events (wallet_id, event, detail) VALUES ($1, 'CREATED', $2)`,
    [wallet.id, JSON.stringify({ labelFa: input.labelFa })],
  );
  await tx.execute('SELECT prs.refresh_wallet_balance($1)', [wallet.id]);
  return { walletId: wallet.id, accountId: account!.id };
}

export async function setWalletStatus(
  tx: TransactionContext,
  input: { walletId: string; status: 'ACTIVE' | 'FROZEN' | 'CLOSED'; actorProfileId: string; reason: string | null },
): Promise<void> {
  if (input.status === 'CLOSED') {
    const balance = await tx.one<{ balance_minor: string }>(
      'SELECT COALESCE(balance_minor,0)::text AS balance_minor FROM prs.wallet_balances WHERE wallet_id = $1',
      [input.walletId],
    );
    if (Number(balance?.balance_minor ?? 0) !== 0) {
      throw new DomainError('VALIDATION_FAILED', {
        messageEn: 'a wallet can only be closed when its balance is zero',
        context: { walletId: input.walletId },
      });
    }
  }
  await tx.execute(
    `UPDATE prs.wallets
        SET status = $2,
            freeze_reason = CASE WHEN $2 = 'FROZEN' THEN $3 ELSE NULL END,
            closed_at = CASE WHEN $2 = 'CLOSED' THEN now() ELSE NULL END
      WHERE id = $1`,
    [input.walletId, input.status, input.reason],
  );
  const event = input.status === 'FROZEN' ? 'FROZEN' : input.status === 'CLOSED' ? 'CLOSED' : 'UNFROZEN';
  await tx.execute(
    `INSERT INTO prs.wallet_events (wallet_id, event, detail, actor_id) VALUES ($1,$2,$3,$4)`,
    [input.walletId, event, JSON.stringify({ reason: input.reason }), input.actorProfileId],
  );
}

export async function assertWalletOperable(
  db: Database | TransactionContext,
  walletId: string,
): Promise<{ profileId: string; status: string }> {
  const row = await db.one<{ profile_id: string; status: string }>(
    'SELECT profile_id, status FROM prs.wallets WHERE id = $1',
    [walletId],
  );
  if (!row) throw new DomainError('WALLET_NOT_FOUND');
  if (row.status === 'FROZEN') throw new DomainError('ACCOUNT_FROZEN');
  if (row.status === 'CLOSED') throw new DomainError('ACCOUNT_CLOSED');
  if (row.status !== 'ACTIVE') {
    throw new DomainError('ACCOUNT_FROZEN', { messageEn: `wallet status ${row.status} does not allow operations` });
  }
  return { profileId: row.profile_id, status: row.status };
}

export async function dailyTransferred(db: Database | TransactionContext, walletId: string): Promise<number> {
  const row = await db.one<{ total: string }>(
    `SELECT COALESCE(SUM(amount_minor + fee_minor), 0)::text AS total
       FROM prs.transactions
      WHERE sender_wallet_id = $1
        AND status IN ('COMPLETED','PENDING')
        AND created_at > now() - interval '24 hours'`,
    [walletId],
  );
  return Number(row?.total ?? 0);
}
