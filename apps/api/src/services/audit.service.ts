/**
 * BANK PARS — audit logging.
 *
 * audit_logs is append-only (enforced by trigger). We log successes AND failures:
 * an attempt to move money without authority is itself evidence, so denials are
 * recorded with the same care as completions. Every financial mutation passes
 * through this module — see the acceptance test "Admin actions are auditable".
 */
import type { Database, TransactionContext } from '../db/types.ts';
import type { ActorContext, RequestMeta } from './context.ts';

export type AuditSeverity = 'INFO' | 'NOTICE' | 'WARNING' | 'CRITICAL';
export type AuditOutcome = 'SUCCESS' | 'DENIED' | 'FAILED';
export type AuditCategory =
  | 'AUTH'
  | 'MONEY'
  | 'TREASURY'
  | 'CARD'
  | 'BANKNOTE'
  | 'ADMIN'
  | 'CONTENT'
  | 'SECURITY'
  | 'GENERAL';

export interface AuditEntry {
  actor: ActorContext | null;
  action: string;
  category: AuditCategory;
  severity?: AuditSeverity;
  outcome?: AuditOutcome;
  entityType?: string | null;
  entityId?: string | null;
  entityRef?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  reason?: string | null;
  adminActionId?: string | null;
  metadata?: Record<string, unknown>;
  meta: RequestMeta;
}

type Runner = Database | TransactionContext;

/** Writes one audit row. Callers normally pass the transaction that did the work. */
export async function writeAudit(runner: Runner, entry: AuditEntry): Promise<void> {
  await runner.execute(
    `INSERT INTO prs.audit_logs (
        actor_profile_id, actor_role, actor_label, action, category, severity, outcome,
        entity_type, entity_id, entity_ref, before_state, after_state, reason,
        request_id, session_id, ip_hash, user_agent, admin_action_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      entry.actor?.profileId ?? null,
      entry.actor?.role ?? null,
      entry.actor?.fullNameFa ?? null,
      entry.action,
      entry.category,
      entry.severity ?? 'INFO',
      entry.outcome ?? 'SUCCESS',
      entry.entityType ?? null,
      entry.entityId ?? null,
      entry.entityRef ?? null,
      entry.beforeState ? JSON.stringify(entry.beforeState) : null,
      entry.afterState ? JSON.stringify(entry.afterState) : null,
      entry.reason ?? null,
      entry.meta.requestId,
      entry.actor?.sessionId ?? null,
      entry.meta.ipHash,
      entry.meta.userAgent,
      entry.adminActionId ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}

/** Records a denied attempt. Never throws: an audit failure must not mask a 403. */
export async function writeDenied(
  runner: Runner,
  entry: Omit<AuditEntry, 'outcome'> & { outcome?: AuditOutcome },
): Promise<void> {
  try {
    await writeAudit(runner, { ...entry, outcome: entry.outcome ?? 'DENIED' });
  } catch {
    /* the authorization decision stands even if the audit write fails */
  }
}

export interface AuditQuery {
  page?: number;
  pageSize?: number;
  actorProfileId?: string;
  action?: string;
  category?: string;
  severity?: string;
  outcome?: string;
  entityType?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
}

export async function listAuditLogs(
  db: Database,
  query: AuditQuery,
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
  const conditions: string[] = [];
  const params: unknown[] = [];

  const add = (clause: string, value: unknown) => {
    params.push(value);
    conditions.push(clause.replaceAll('?', `$${params.length}`));
  };

  if (query.actorProfileId) add('actor_profile_id = ?', query.actorProfileId);
  if (query.action) add('action = ?', query.action);
  if (query.category) add('category = ?', query.category);
  if (query.severity) add('severity = ?', query.severity);
  if (query.outcome) add('outcome = ?', query.outcome);
  if (query.entityType) add('entity_type = ?', query.entityType);
  if (query.entityId) add('entity_id = ?', query.entityId);
  if (query.from) add('occurred_at >= ?', query.from);
  if (query.to) add('occurred_at <= ?', query.to);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = await db.one<{ count: string }>(`SELECT count(*)::text AS count FROM prs.audit_logs ${where}`, params);
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await db.query(
    `SELECT id, occurred_at, actor_label, actor_role, action, category, severity, outcome,
            entity_type, entity_ref, reason, request_id, ip_hash IS NOT NULL AS has_ip, metadata
       FROM prs.audit_logs ${where}
      ORDER BY occurred_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows, total: Number(total?.count ?? 0) };
}
