/**
 * BANK PARS — transaction history and receipts (read side).
 *
 * The business `transactions` row is what a member sees; the ledger entries behind
 * it are the accounting truth. Both are readable here so a receipt can be checked
 * against the books.
 */
import type { ReceiptDto, TransactionDto } from '@parsbank/types';
import { DomainError, referenceUsdMinor } from '@parsbank/domain';
import { hmacReceiptCode } from '../lib/receipt.ts';
import type { Database } from '../db/types.ts';
import { latestReferenceRate } from './monetary.service.ts';

interface TransactionRow {
  id: string;
  reference: string;
  type: string;
  status: string;
  amount_minor: string;
  fee_minor: string;
  sender_wallet_id: string | null;
  receiver_wallet_id: string | null;
  sender_wallet_ref: string | null;
  receiver_wallet_ref: string | null;
  sender_name: string | null;
  receiver_name: string | null;
  receiver_card_number: string | null;
  initiated_by_profile_id: string | null;
  memo: string | null;
  created_at: string;
  completed_at: string | null;
  ledger_transaction_id: string | null;
}

const SELECT_TRANSACTION = `
  SELECT t.id, t.reference, t.type, t.status, t.amount_minor::text AS amount_minor,
         t.fee_minor::text AS fee_minor, t.sender_wallet_id, t.receiver_wallet_id,
         t.initiated_by_profile_id,
         sw.public_ref AS sender_wallet_ref, rw.public_ref AS receiver_wallet_ref,
         sp.full_name_fa AS sender_name, rp.full_name_fa AS receiver_name,
         rc.card_number AS receiver_card_number,
         t.memo, t.created_at, t.completed_at, t.ledger_transaction_id
    FROM prs.transactions t
    LEFT JOIN prs.wallets sw ON sw.id = t.sender_wallet_id
    LEFT JOIN prs.wallets rw ON rw.id = t.receiver_wallet_id
    LEFT JOIN prs.profiles sp ON sp.id = sw.profile_id
    LEFT JOIN prs.profiles rp ON rp.id = rw.profile_id
    LEFT JOIN prs.cards rc ON rc.id = t.receiver_card_id
`;

export interface TransactionQuery {
  profileId: string;
  walletId?: string | null;
  type?: string | null;
  status?: string | null;
  from?: Date | null;
  to?: Date | null;
  search?: string | null;
  page?: number;
  pageSize?: number;
}

export async function listTransactions(
  db: Database,
  query: TransactionQuery,
): Promise<{ rows: TransactionDto[]; total: number }> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const params: unknown[] = [query.profileId];
  const conditions = [
    `(t.initiated_by_profile_id = $1
       OR t.sender_wallet_id IN (SELECT id FROM prs.wallets WHERE profile_id = $1)
       OR t.receiver_wallet_id IN (SELECT id FROM prs.wallets WHERE profile_id = $1))`,
  ];

  if (query.walletId) {
    params.push(query.walletId);
    conditions.push(`(t.sender_wallet_id = $${params.length} OR t.receiver_wallet_id = $${params.length})`);
  }
  if (query.type) {
    params.push(query.type);
    conditions.push(`t.type = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    conditions.push(`t.status = $${params.length}`);
  }
  if (query.from) {
    params.push(query.from);
    conditions.push(`t.created_at >= $${params.length}`);
  }
  if (query.to) {
    params.push(query.to);
    conditions.push(`t.created_at <= $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search.replace(/[%_]/g, '')}%`);
    conditions.push(`(t.reference ILIKE $${params.length} OR t.memo ILIKE $${params.length})`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const total = await db.one<{ count: string }>(`SELECT count(*)::text AS count FROM prs.transactions t ${where}`, params);

  params.push(pageSize, (page - 1) * pageSize);
  const rows = await db.query<TransactionRow>(
    `${SELECT_TRANSACTION} ${where} ORDER BY t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const walletIds = await db.query<{ id: string }>('SELECT id FROM prs.wallets WHERE profile_id = $1', [query.profileId]);
  const ownWallets = new Set(walletIds.map((row) => row.id));

  return {
    rows: rows.map((row) => toTransactionDto(row, ownWallets)),
    total: Number(total?.count ?? 0),
  };
}

export function toTransactionDto(row: TransactionRow, ownWalletIds: Set<string>): TransactionDto {
  const isOutgoing = row.sender_wallet_id ? ownWalletIds.has(row.sender_wallet_id) : false;
  const isIncoming = row.receiver_wallet_id ? ownWalletIds.has(row.receiver_wallet_id) : false;
  const direction: TransactionDto['direction'] = isOutgoing && isIncoming ? 'INTERNAL' : isOutgoing ? 'OUT' : 'IN';

  const counterpartyName = isOutgoing ? row.receiver_name : row.sender_name;

  return {
    id: row.id,
    reference: row.reference,
    type: row.type as TransactionDto['type'],
    status: row.status as TransactionDto['status'],
    direction,
    amountMinor: Number(row.amount_minor),
    feeMinor: Number(row.fee_minor),
    currency: 'PRS',
    senderWalletRef: row.sender_wallet_ref,
    receiverWalletRef: row.receiver_wallet_ref,
    counterpartyNameFa: direction === 'INTERNAL' ? null : counterpartyName,
    counterpartyCardMasked: row.receiver_card_number
      ? `${row.receiver_card_number.slice(0, 4)}••••${row.receiver_card_number.slice(-4)}`
      : null,
    memo: row.memo,
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
  };
}

export async function getTransactionByReference(db: Database, reference: string): Promise<TransactionRow | null> {
  return db.one<TransactionRow>(`${SELECT_TRANSACTION} WHERE t.reference = $1`, [reference]);
}

/**
 * Builds the printable receipt. The verification code is an HMAC over the
 * reference: anyone inside the institution can re-derive it, and it cannot be
 * forged without the server key.
 */
export async function buildReceipt(db: Database, reference: string): Promise<ReceiptDto> {
  const row = await getTransactionByReference(db, reference);
  if (!row) throw new DomainError('WALLET_NOT_FOUND', { messageEn: 'transaction not found' });

  const rate = await latestReferenceRate(db);
  const ledgerTx = row.ledger_transaction_id
    ? await db.one<{ sequence_no: string }>('SELECT sequence_no::text FROM prs.ledger_transactions WHERE id = $1', [
        row.ledger_transaction_id,
      ])
    : null;

  return {
    reference: row.reference,
    issuedAt: new Date(row.completed_at ?? row.created_at).toISOString(),
    type: row.type as ReceiptDto['type'],
    status: row.status as ReceiptDto['status'],
    amountMinor: Number(row.amount_minor),
    feeMinor: Number(row.fee_minor),
    totalMinor: Number(row.amount_minor) + Number(row.fee_minor),
    currency: 'PRS',
    referenceUsdMinor: referenceUsdMinor(Number(row.amount_minor), rate),
    referenceRate: rate,
    senderNameFa: row.sender_name ?? '—',
    senderCardMasked: null,
    receiverNameFa: row.receiver_name,
    receiverCardMasked: row.receiver_card_number
      ? `${row.receiver_card_number.slice(0, 4)}••••${row.receiver_card_number.slice(-4)}`
      : null,
    memo: row.memo,
    verificationCode: hmacReceiptCode(row.reference),
    ledgerSequence: ledgerTx ? Number(ledgerTx.sequence_no) : null,
  };
}
