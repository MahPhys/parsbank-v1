/**
 * BANK PARS — administrative overview.
 *
 * The numbers an administrator needs on one screen: the monetary state, the size
 * of the institution, what is waiting for a second signature, and what happened
 * recently. Every figure is derived from the ledger, not from counters.
 */
import type { Database } from '../db/types.ts';
import { getMonetarySnapshot } from './monetary.service.ts';

export interface AdminOverview {
  monetary: Awaited<ReturnType<typeof getMonetarySnapshot>>;
  counts: {
    profiles: number;
    activeProfiles: number;
    wallets: number;
    frozenWallets: number;
    activeCards: number;
    transactions: number;
    transactionsToday: number;
    banknotes: number;
    outstandingNotes: number;
    pendingApprovals: number;
    criticalEvents: number;
  };
  volume: {
    transferredTodayMinor: number;
    transferredTotalMinor: number;
    issuedTotalMinor: number;
    burnedTotalMinor: number;
    feeRevenueMinor: number;
  };
  approvals: Record<string, unknown>[];
  recentTransactions: Record<string, unknown>[];
  recentAudit: Record<string, unknown>[];
}

export async function adminOverview(db: Database): Promise<AdminOverview> {
  const monetary = await getMonetarySnapshot(db);

  const counts = await db.one<Record<string, string>>(`
    SELECT
      (SELECT count(*)::text FROM prs.profiles) AS profiles,
      (SELECT count(*)::text FROM prs.profiles WHERE status = 'ACTIVE') AS active_profiles,
      (SELECT count(*)::text FROM prs.wallets WHERE status <> 'CLOSED') AS wallets,
      (SELECT count(*)::text FROM prs.wallets WHERE status = 'FROZEN') AS frozen_wallets,
      (SELECT count(*)::text FROM prs.cards WHERE status = 'ACTIVE') AS active_cards,
      (SELECT count(*)::text FROM prs.transactions) AS transactions,
      (SELECT count(*)::text FROM prs.transactions WHERE created_at > now() - interval '24 hours') AS transactions_today,
      (SELECT count(*)::text FROM prs.banknotes) AS banknotes,
      (SELECT count(*)::text FROM prs.banknotes WHERE carries_outstanding_value) AS outstanding_notes,
      (SELECT count(*)::text FROM prs.admin_actions WHERE status = 'PENDING') AS pending_approvals,
      (SELECT count(*)::text FROM prs.audit_logs WHERE severity IN ('WARNING','CRITICAL') AND occurred_at > now() - interval '7 days') AS critical_events
  `);

  const volume = await db.one<Record<string, string>>(`
    SELECT
      (SELECT COALESCE(SUM(amount_minor),0)::text FROM prs.transactions
        WHERE type IN ('TRANSFER','QR_PAYMENT') AND status = 'COMPLETED'
          AND created_at > now() - interval '24 hours') AS transferred_today,
      (SELECT COALESCE(SUM(amount_minor),0)::text FROM prs.transactions
        WHERE type IN ('TRANSFER','QR_PAYMENT') AND status = 'COMPLETED') AS transferred_total,
      (SELECT COALESCE(SUM(amount_minor),0)::text FROM prs.issuances) AS issued_total,
      (SELECT COALESCE(SUM(amount_minor),0)::text FROM prs.burns) AS burned_total,
      (SELECT prs.account_balance_by_code('2500')::text) AS fee_revenue
  `);

  const [approvals, recentTransactions, recentAudit] = await Promise.all([
    db.query(
      `SELECT a.id, a.action_ref, a.action_type, p.label_fa AS label_fa, pr.full_name_fa AS requested_by_name,
              a.requested_at, a.expires_at, a.reason
         FROM prs.admin_actions a
         JOIN prs.approval_policies p ON p.action_type = a.action_type
         JOIN prs.profiles pr ON pr.id = a.requested_by
        WHERE a.status = 'PENDING'
        ORDER BY a.requested_at ASC LIMIT 10`,
    ),
    db.query(
      `SELECT t.reference, t.type, t.status, t.amount_minor::text AS amount_minor, t.created_at,
              sp.full_name_fa AS sender_name, rp.full_name_fa AS receiver_name
         FROM prs.transactions t
         LEFT JOIN prs.wallets sw ON sw.id = t.sender_wallet_id
         LEFT JOIN prs.wallets rw ON rw.id = t.receiver_wallet_id
         LEFT JOIN prs.profiles sp ON sp.id = sw.profile_id
         LEFT JOIN prs.profiles rp ON rp.id = rw.profile_id
        ORDER BY t.created_at DESC LIMIT 12`,
    ),
    db.query(
      `SELECT id, occurred_at, actor_label, action, category, severity, outcome, entity_ref
         FROM prs.audit_logs ORDER BY occurred_at DESC LIMIT 15`,
    ),
  ]);

  return {
    monetary,
    counts: {
      profiles: Number(counts?.profiles ?? 0),
      activeProfiles: Number(counts?.active_profiles ?? 0),
      wallets: Number(counts?.wallets ?? 0),
      frozenWallets: Number(counts?.frozen_wallets ?? 0),
      activeCards: Number(counts?.active_cards ?? 0),
      transactions: Number(counts?.transactions ?? 0),
      transactionsToday: Number(counts?.transactions_today ?? 0),
      banknotes: Number(counts?.banknotes ?? 0),
      outstandingNotes: Number(counts?.outstanding_notes ?? 0),
      pendingApprovals: Number(counts?.pending_approvals ?? 0),
      criticalEvents: Number(counts?.critical_events ?? 0),
    },
    volume: {
      transferredTodayMinor: Number(volume?.transferred_today ?? 0),
      transferredTotalMinor: Number(volume?.transferred_total ?? 0),
      issuedTotalMinor: Number(volume?.issued_total ?? 0),
      burnedTotalMinor: Number(volume?.burned_total ?? 0),
      feeRevenueMinor: Number(volume?.fee_revenue ?? 0),
    },
    approvals,
    recentTransactions,
    recentAudit,
  };
}

export async function listWalletsForAdmin(
  db: Database,
  query: { search?: string; status?: string; page?: number; pageSize?: number },
): Promise<{ items: Record<string, unknown>[]; total: number }> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 25));
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (query.status) {
    params.push(query.status);
    conditions.push(`w.status = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search.replace(/[%_]/g, '')}%`);
    conditions.push(`(w.public_ref ILIKE $${params.length} OR p.full_name_fa ILIKE $${params.length} OR p.public_ref ILIKE $${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = await db.one<{ count: string }>(
    `SELECT count(*)::text AS count FROM prs.wallets w JOIN prs.profiles p ON p.id = w.profile_id ${where}`,
    params,
  );
  params.push(pageSize, (page - 1) * pageSize);
  const items = await db.query(
    `SELECT w.id, w.public_ref, w.label_fa, w.status, w.is_primary, w.created_at,
            p.public_ref AS profile_ref, p.full_name_fa AS holder_name, p.id AS profile_id,
            COALESCE(b.balance_minor, 0)::text AS balance_minor
       FROM prs.wallets w
       JOIN prs.profiles p ON p.id = w.profile_id
       LEFT JOIN prs.wallet_balances b ON b.wallet_id = w.id
       ${where}
      ORDER BY w.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items, total: Number(total?.count ?? 0) };
}

export async function listTransactionsForAdmin(
  db: Database,
  query: { search?: string; type?: string; status?: string; page?: number; pageSize?: number },
): Promise<{ items: Record<string, unknown>[]; total: number }> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 25));
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (query.type) {
    params.push(query.type);
    conditions.push(`t.type = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    conditions.push(`t.status = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search.replace(/[%_]/g, '')}%`);
    conditions.push(`(t.reference ILIKE $${params.length} OR t.memo ILIKE $${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = await db.one<{ count: string }>(`SELECT count(*)::text AS count FROM prs.transactions t ${where}`, params);
  params.push(pageSize, (page - 1) * pageSize);
  const items = await db.query(
    `SELECT t.id, t.reference, t.type, t.status, t.amount_minor::text, t.fee_minor::text, t.created_at,
            t.completed_at, t.memo, t.failure_code,
            sp.full_name_fa AS sender_name, rp.full_name_fa AS receiver_name,
            sw.public_ref AS sender_wallet_ref, rw.public_ref AS receiver_wallet_ref,
            lt.sequence_no AS ledger_sequence
       FROM prs.transactions t
       LEFT JOIN prs.wallets sw ON sw.id = t.sender_wallet_id
       LEFT JOIN prs.wallets rw ON rw.id = t.receiver_wallet_id
       LEFT JOIN prs.profiles sp ON sp.id = sw.profile_id
       LEFT JOIN prs.profiles rp ON rp.id = rw.profile_id
       LEFT JOIN prs.ledger_transactions lt ON lt.id = t.ledger_transaction_id
       ${where}
      ORDER BY t.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items, total: Number(total?.count ?? 0) };
}

export async function listCardsForAdmin(
  db: Database,
  query: { search?: string; status?: string; page?: number; pageSize?: number },
): Promise<{ items: Record<string, unknown>[]; total: number }> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 25));
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (query.status) {
    params.push(query.status);
    conditions.push(`c.status = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search.replace(/[%_]/g, '')}%`);
    conditions.push(`(c.card_number ILIKE $${params.length} OR p.full_name_fa ILIKE $${params.length} OR p.public_ref ILIKE $${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = await db.one<{ count: string }>(
    `SELECT count(*)::text AS count FROM prs.cards c JOIN prs.profiles p ON p.id = c.profile_id ${where}`,
    params,
  );
  params.push(pageSize, (page - 1) * pageSize);
  const items = await db.query(
    `SELECT c.id, c.card_number, c.expiry_month, c.expiry_year, c.status, c.scheme, c.network_label,
            c.issued_at, c.cardholder_name_fa, p.public_ref AS profile_ref, p.full_name_fa AS holder_name,
            w.public_ref AS wallet_ref
       FROM prs.cards c
       JOIN prs.profiles p ON p.id = c.profile_id
       JOIN prs.wallets w ON w.id = c.wallet_id
       ${where}
      ORDER BY c.issued_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items, total: Number(total?.count ?? 0) };
}
