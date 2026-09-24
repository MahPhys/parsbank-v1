/**
 * BANK PARS — two-person approval workflow.
 *
 * Critical actions (issuance, burning, supply/reserve/redemption rule changes,
 * administrator role changes, disabling financial controls) never execute from a
 * single request. The lifecycle is:
 *
 *   1. an eligible officer REQUESTS the action   → admin_actions(status=PENDING)
 *   2. a DIFFERENT eligible officer obtains a single-use approval nonce
 *   3. that officer APPROVES (or REJECTS) it
 *   4. the action is EXECUTED inside one transaction, producing its ledger effect
 *
 * Self-approval is refused here, refused in the domain layer and refused by a
 * database CHECK constraint. Approval nonces are stored hashed, single-use and
 * time-boxed, so an approval cannot be replayed.
 */
import type { AdminActionDto, ApprovalActionType, AdminRole } from '@parsbank/types';
import { DomainError, assertApprovalDecision, assertCanRequest, requiresDualApproval, policyFor } from '@parsbank/domain';
import type { Database, TransactionContext } from '../db/types.ts';
import { createApprovalNonce, hashToken } from '../lib/crypto.ts';
import { adminActionReference } from '../lib/ids.ts';
import { getApprovalExecutor, type ApprovalActionRecord } from './approval-registry.ts';
import { writeAudit } from './audit.service.ts';
import { requireActor, type ServiceContext } from './context.ts';
import { fingerprintPayload } from '@parsbank/domain';

export async function requestAdminAction(
  context: ServiceContext,
  input: { actionType: ApprovalActionType; payload: Record<string, unknown>; reason: string },
): Promise<AdminActionDto> {
  const actor = requireActor(context);
  if (actor.audience !== 'ADMIN') throw new DomainError('FORBIDDEN', { messageEn: 'admin session required' });
  if (input.reason.trim().length < 8) {
    throw new DomainError('VALIDATION_FAILED', {
      fields: [{ path: 'reason', message: 'دلیل درخواست باید حداقل ۸ نویسه باشد.' }],
    });
  }
  assertCanRequest(input.actionType, actor.role as AdminRole);

  const policy = policyFor(input.actionType);
  const payloadHash = hashToken(fingerprintPayload(input.actionType, input.payload));

  const created = await context.db.transaction(async (tx) => {
    const row = await tx.one<{ id: string; action_ref: string; requested_at: string; expires_at: string }>(
      `INSERT INTO prs.admin_actions
         (action_ref, action_type, requires_second_approver, required_role, approver_role,
          requested_by, expires_at, reason, payload, payload_hash)
       VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' minutes')::interval, $8, $9, $10)
       RETURNING id, action_ref, requested_at, expires_at`,
      [
        adminActionReference(),
        input.actionType,
        policy.requiresSecondApprover,
        policy.requiredRole,
        policy.approverRole,
        actor.profileId,
        String(policy.expiresMinutes),
        input.reason,
        JSON.stringify(input.payload),
        payloadHash,
      ],
    );
    if (!row) throw new DomainError('INTERNAL_ERROR', { messageEn: 'admin action could not be created' });

    await tx.execute(
      `INSERT INTO prs.admin_action_events (admin_action_id, event, actor_id, actor_role, detail)
       VALUES ($1, 'REQUESTED', $2, $3, $4)`,
      [row.id, actor.profileId, actor.role, JSON.stringify({ reason: input.reason })],
    );

    await writeAudit(tx, {
      actor,
      action: `approval.request.${input.actionType}`,
      category: 'ADMIN',
      severity: 'NOTICE',
      entityType: 'admin_action',
      entityId: row.id,
      entityRef: row.action_ref,
      reason: input.reason,
      afterState: { actionType: input.actionType, payload: input.payload },
      meta: context.meta,
    });

    return row;
  });

  return (await getAdminAction(context.db, created.id)) as AdminActionDto;
}

/** Issues a one-time nonce a second officer must present when deciding. */
export async function issueApprovalNonce(
  context: ServiceContext,
  input: { actionId: string; purpose: 'APPROVE' | 'REJECT' | 'EXECUTE' },
): Promise<{ nonce: string; expiresAt: string }> {
  const actor = requireActor(context);
  const nonce = createApprovalNonce();

  const row = await context.db.transaction(async (tx) => {
    const action = await loadActionForDecision(tx, input.actionId);
    assertCanDecide(action, actor, input.purpose);
    const created = await tx.one<{ expires_at: string }>(
      `INSERT INTO prs.admin_action_nonces (admin_action_id, profile_id, nonce_hash, purpose, expires_at)
       VALUES ($1,$2,$3,$4, now() + interval '2 minutes')
       RETURNING expires_at`,
      [input.actionId, actor.profileId, hashToken(nonce.raw), input.purpose],
    );
    return created;
  });

  return { nonce: nonce.raw, expiresAt: new Date(row!.expires_at).toISOString() };
}

interface ActionForDecision {
  id: string;
  action_ref: string;
  action_type: ApprovalActionType;
  status: string;
  requested_by: string;
  expires_at: string;
  reason: string;
  payload: Record<string, unknown>;
  requires_second_approver: boolean;
  approver_role: string;
}

async function loadActionForDecision(tx: TransactionContext, actionId: string): Promise<ActionForDecision> {
  const action = await tx.one<ActionForDecision>(
    `SELECT id, action_ref, action_type, status, requested_by, expires_at, reason, payload,
            requires_second_approver, approver_role
       FROM prs.admin_actions WHERE id = $1`,
    [actionId],
  );
  if (!action) throw new DomainError('APPROVAL_NOT_FOUND');
  return action;
}

function assertCanDecide(
  action: ActionForDecision,
  actor: { profileId: string; role: string },
  purpose: 'APPROVE' | 'REJECT' | 'EXECUTE',
): void {
  if (purpose === 'EXECUTE') return; // executing an already-approved action
  if (action.status !== 'PENDING') throw new DomainError('APPROVAL_ALREADY_DECIDED');
  if (new Date(action.expires_at).getTime() <= Date.now()) throw new DomainError('APPROVAL_EXPIRED');
  if (action.requires_second_approver && action.requested_by === actor.profileId) {
    throw new DomainError('SELF_APPROVAL_FORBIDDEN');
  }
  assertApprovalDecision({
    actionType: action.action_type,
    requestedBy: action.requested_by,
    decidedBy: actor.profileId,
    decidedByRole: actor.role as AdminRole,
    status: action.status,
    expiresAt: new Date(action.expires_at),
  });
}

export async function approveAdminAction(
  context: ServiceContext,
  input: { actionId: string; nonce: string; note?: string | null },
): Promise<AdminActionDto> {
  const actor = requireActor(context);
  const result = await context.db.transaction(async (tx) => {
    const action = await loadActionForDecision(tx, input.actionId);
    assertCanDecide(action, actor, 'APPROVE');
    await consumeNonce(tx, { actionId: action.id, profileId: actor.profileId, purpose: 'APPROVE', nonce: input.nonce });

    await tx.execute(
      `UPDATE prs.admin_actions
          SET status = 'APPROVED', decided_by = $2, decided_at = now(), decision_note = $3,
              consumed_nonce_hash = $4
        WHERE id = $1 AND status = 'PENDING'`,
      [action.id, actor.profileId, input.note ?? null, hashToken(input.nonce)],
    );

    await tx.execute(
      `INSERT INTO prs.admin_action_events (admin_action_id, event, actor_id, actor_role, detail)
       VALUES ($1, 'APPROVED', $2, $3, $4)`,
      [action.id, actor.profileId, actor.role, JSON.stringify({ note: input.note ?? null })],
    );

    await writeAudit(tx, {
      actor,
      action: `approval.approve.${action.action_type}`,
      category: 'ADMIN',
      severity: 'CRITICAL',
      entityType: 'admin_action',
      entityId: action.id,
      entityRef: action.action_ref,
      reason: action.reason,
      beforeState: { status: 'PENDING' },
      afterState: { status: 'APPROVED', note: input.note ?? null },
      meta: context.meta,
    });

    return action;
  });

  void result;
  return (await getAdminAction(context.db, input.actionId)) as AdminActionDto;
}

export async function rejectAdminAction(
  context: ServiceContext,
  input: { actionId: string; nonce: string; note: string },
): Promise<AdminActionDto> {
  const actor = requireActor(context);
  await context.db.transaction(async (tx) => {
    const action = await loadActionForDecision(tx, input.actionId);
    assertCanDecide(action, actor, 'REJECT');
    await consumeNonce(tx, { actionId: action.id, profileId: actor.profileId, purpose: 'REJECT', nonce: input.nonce });

    await tx.execute(
      `UPDATE prs.admin_actions
          SET status = 'REJECTED', decided_by = $2, decided_at = now(), decision_note = $3
        WHERE id = $1 AND status = 'PENDING'`,
      [action.id, actor.profileId, input.note],
    );
    await tx.execute(
      `INSERT INTO prs.admin_action_events (admin_action_id, event, actor_id, actor_role, detail)
       VALUES ($1, 'REJECTED', $2, $3, $4)`,
      [action.id, actor.profileId, actor.role, JSON.stringify({ note: input.note })],
    );
    await writeAudit(tx, {
      actor,
      action: `approval.reject.${action.action_type}`,
      category: 'ADMIN',
      severity: 'NOTICE',
      entityType: 'admin_action',
      entityId: action.id,
      entityRef: action.action_ref,
      reason: input.note,
      meta: context.meta,
    });
  });
  return (await getAdminAction(context.db, input.actionId)) as AdminActionDto;
}

async function consumeNonce(
  tx: TransactionContext,
  input: { actionId: string; profileId: string; purpose: 'APPROVE' | 'REJECT' | 'EXECUTE'; nonce: string },
): Promise<void> {
  const row = await tx.one<{ id: string; consumed_at: string | null; expires_at: string; profile_id: string }>(
    `SELECT id, consumed_at, expires_at, profile_id
       FROM prs.admin_action_nonces
      WHERE admin_action_id = $1 AND purpose = $2 AND nonce_hash = $3
      FOR UPDATE`,
    [input.actionId, input.purpose, hashToken(input.nonce)],
  );
  if (!row || row.profile_id !== input.profileId) throw new DomainError('APPROVAL_NONCE_INVALID');
  if (row.consumed_at) throw new DomainError('APPROVAL_NONCE_INVALID', { messageEn: 'nonce already used' });
  if (new Date(row.expires_at).getTime() <= Date.now()) throw new DomainError('APPROVAL_NONCE_INVALID');
  await tx.execute('UPDATE prs.admin_action_nonces SET consumed_at = now() WHERE id = $1', [row.id]);
}

/**
 * Executes an APPROVED admin action. The effect is delegated to the module that
 * owns the domain (treasury, wallets, cms …) through the approval registry.
 */
export async function executeAdminAction(
  context: ServiceContext,
  input: { actionId: string },
): Promise<AdminActionDto> {
  const actor = requireActor(context);
  if (actor.audience !== 'ADMIN') throw new DomainError('FORBIDDEN');

  const action = await context.db.one<ActionForDecision & { decided_by: string | null }>(
    `SELECT id, action_ref, action_type, status, requested_by, decided_by, expires_at, reason, payload,
            requires_second_approver, approver_role
       FROM prs.admin_actions WHERE id = $1`,
    [input.actionId],
  );
  if (!action) throw new DomainError('APPROVAL_NOT_FOUND');
  if (action.status === 'EXECUTED') throw new DomainError('APPROVAL_ALREADY_DECIDED');
  if (action.status !== 'APPROVED') {
    throw new DomainError('DUAL_APPROVAL_REQUIRED', {
      messageEn: `action is ${action.status}; execution requires an approved decision`,
    });
  }

  const executor = getApprovalExecutor(action.action_type);
  if (!executor) {
    throw new DomainError('NOT_IMPLEMENTED', {
      messageEn: `no executor registered for ${action.action_type}`,
    });
  }

  await context.db.transaction(async (tx) => {
    const record: ApprovalActionRecord = {
      id: action.id,
      actionRef: action.action_ref,
      actionType: action.action_type,
      payload: action.payload,
      reason: action.reason,
      requestedBy: action.requested_by,
      decidedBy: action.decided_by,
      adminActionId: action.id,
    };

    try {
      const outcome = await executor(tx, { action: record, actor, meta: context.meta });
      await tx.execute(
        `UPDATE prs.admin_actions
            SET status = 'EXECUTED', executed_at = now(), execution_result = $2, resulting_entity_ref = $3
          WHERE id = $1 AND status = 'APPROVED'`,
        [action.id, JSON.stringify(outcome.result ?? {}), outcome.entityRef ?? null],
      );
      await tx.execute(
        `INSERT INTO prs.admin_action_events (admin_action_id, event, actor_id, actor_role, detail)
         VALUES ($1, 'EXECUTED', $2, $3, $4)`,
        [action.id, actor.profileId, actor.role, JSON.stringify(outcome.result ?? {})],
      );
      await writeAudit(tx, {
        actor,
        action: `approval.execute.${action.action_type}`,
        category: 'ADMIN',
        severity: 'CRITICAL',
        entityType: 'admin_action',
        entityId: action.id,
        entityRef: action.action_ref,
        afterState: outcome.result ?? {},
        reason: action.reason,
        meta: context.meta,
      });
    } catch (error) {
      // The failure is recorded on a separate connection path so the audit survives
      // the rollback of the action itself.
      const message = error instanceof Error ? error.message : 'unknown error';
      await context.db.execute(
        `UPDATE prs.admin_actions
            SET status = 'FAILED', executed_at = now(), failure_reason = $2
          WHERE id = $1 AND status = 'APPROVED'`,
        [action.id, message.slice(0, 500)],
      );
      await context.db.execute(
        `INSERT INTO prs.admin_action_events (admin_action_id, event, actor_id, actor_role, detail)
         VALUES ($1, 'FAILED', $2, $3, $4)`,
        [action.id, actor.profileId, actor.role, JSON.stringify({ message: message.slice(0, 500) })],
      );
      await writeAudit(context.db, {
        actor,
        action: `approval.failed.${action.action_type}`,
        category: 'ADMIN',
        severity: 'WARNING',
        outcome: 'FAILED',
        entityType: 'admin_action',
        entityId: action.id,
        entityRef: action.action_ref,
        reason: message.slice(0, 500),
        meta: context.meta,
      });
      throw error;
    }
  });

  return (await getAdminAction(context.db, input.actionId)) as AdminActionDto;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

async function getAdminAction(db: Database, actionId: string): Promise<AdminActionDto | null> {
  const row = await db.one<{
    id: string;
    action_ref: string;
    action_type: ApprovalActionType;
    status: AdminActionDto['status'];
    requires_second_approver: boolean;
    requested_by: string;
    requested_by_name: string;
    requested_at: string;
    expires_at: string;
    reason: string;
    payload: Record<string, unknown>;
    decided_by: string | null;
    decided_at: string | null;
    executed_at: string | null;
    resulting_entity_ref: string | null;
    action_label_fa: string;
  }>(
    `SELECT a.id, a.action_ref, a.action_type, a.status, a.requires_second_approver, a.requested_by,
            p.full_name_fa AS requested_by_name, a.requested_at, a.expires_at, a.reason, a.payload,
            a.decided_by, a.decided_at, a.executed_at, a.resulting_entity_ref,
            pol.label_fa AS action_label_fa
       FROM prs.admin_actions a
       JOIN prs.profiles p ON p.id = a.requested_by
       JOIN prs.approval_policies pol ON pol.action_type = a.action_type
      WHERE a.id = $1`,
    [actionId],
  );
  if (!row) return null;
  return toAdminActionDto(row);
}

function toAdminActionDto(row: Record<string, any>): AdminActionDto {
  return {
    id: row.id,
    actionRef: row.action_ref,
    actionType: row.action_type,
    actionLabelFa: row.action_label_fa,
    status: row.status,
    requiresSecondApprover: row.requires_second_approver,
    requestedBy: row.requested_by,
    requestedByNameFa: row.requested_by_name,
    requestedAt: new Date(row.requested_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    reason: row.reason,
    payloadPreview: summarizePayload(row.payload),
    decidedBy: row.decided_by,
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
    executedAt: row.executed_at ? new Date(row.executed_at).toISOString() : null,
    resultingEntityRef: row.resulting_entity_ref,
    canApprove: row.status === 'PENDING',
    cantApproveReasonFa: row.status === 'PENDING' ? undefined : 'این درخواست تصمیم‌گیری شده است.',
  };
}

/** Payload previews never include secrets; values are truncated for display. */
function summarizePayload(payload: Record<string, unknown> | null): Record<string, unknown> {
  if (!payload) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (/pin|cvv|password|secret|token/i.test(key)) {
      out[key] = '••••';
      continue;
    }
    out[key] = typeof value === 'string' && value.length > 120 ? `${value.slice(0, 117)}…` : value;
  }
  return out;
}

export async function listAdminActions(
  db: Database,
  query: { status?: string; actionType?: string; page?: number; pageSize?: number },
): Promise<{ items: AdminActionDto[]; total: number }> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (query.status) {
    params.push(query.status);
    conditions.push(`a.status = $${params.length}`);
  }
  if (query.actionType) {
    params.push(query.actionType);
    conditions.push(`a.action_type = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = await db.one<{ count: string }>(`SELECT count(*)::text AS count FROM prs.admin_actions a ${where}`, params);
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await db.query<Record<string, any>>(
    `SELECT a.id, a.action_ref, a.action_type, a.status, a.requires_second_approver, a.requested_by,
            p.full_name_fa AS requested_by_name, a.requested_at, a.expires_at, a.reason, a.payload,
            a.decided_by, a.decided_at, a.executed_at, a.resulting_entity_ref,
            pol.label_fa AS action_label_fa
       FROM prs.admin_actions a
       JOIN prs.profiles p ON p.id = a.requested_by
       JOIN prs.approval_policies pol ON pol.action_type = a.action_type
       ${where}
      ORDER BY a.requested_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { items: rows.map(toAdminActionDto), total: Number(total?.count ?? 0) };
}

export function dualApprovalRequired(actionType: ApprovalActionType): boolean {
  return requiresDualApproval(actionType);
}
