/**
 * BANK PARS — people: registration, profile administration, role changes.
 *
 * Role changes are the most dangerous administrative operation in a monetary
 * institution, so they run through the two-person rule (`ADMIN_ROLE_CHANGE`) and
 * revoke the affected person's sessions the moment they take effect.
 */
import type { AdminRole, ProfileRole, ProfileStatus } from '@parsbank/types';
import { DomainError, assertCan, permissionsFor } from '@parsbank/domain';
import type { Database, TransactionContext } from '../db/types.ts';
import { hashSecret } from '../lib/crypto.ts';
import { registerApprovalExecutor } from './approval-registry.ts';
import { writeAudit } from './audit.service.ts';
import { revokeAllSessions } from './auth.service.ts';
import type { ServiceContext } from './context.ts';
import { requireActor } from './context.ts';
import { createWallet } from './wallets.service.ts';

export interface RegisterInput {
  fullNameFa: string;
  fullNameEn: string;
  email?: string | null;
  phone?: string | null;
  password: string;
  role?: ProfileRole;
  auditActor?: { profileId: string; role: ProfileRole; sessionId: string | null; audience: 'USER' | 'ADMIN'; mfaSatisfied: boolean } | null;
}

/**
 * Creates a person + credential + primary wallet + optional card in ONE
 * transaction. A profile without a wallet cannot receive money, so the two are
 * always created together.
 */
export async function registerProfile(
  db: Database,
  input: RegisterInput,
): Promise<{ profileId: string; publicRef: string; walletId: string; walletRef: string }> {
  if (input.password.length < 10) {
    throw new DomainError('VALIDATION_FAILED', {
      fields: [{ path: 'password', message: 'گذرواژه باید حداقل ۱۰ نویسه باشد.' }],
    });
  }

  const passwordHash = await hashSecret(input.password);

  return db.transaction(async (tx) => {
    const profile = await tx.one<{ id: string; public_ref: string }>(
      `INSERT INTO prs.profiles (public_ref, full_name_fa, full_name_en, email, phone, role, status)
       VALUES (prs.next_profile_ref(), $1, $2, $3, $4, $5, 'ACTIVE')
       RETURNING id, public_ref`,
      [input.fullNameFa, input.fullNameEn, input.email ?? null, input.phone ?? null, input.role ?? 'USER'],
    );
    if (!profile) throw new DomainError('INTERNAL_ERROR', { messageEn: 'profile insert failed' });

    await tx.execute(
      `INSERT INTO prs.account_credentials (profile_id, password_hash, must_rotate) VALUES ($1,$2,true)`,
      [profile.id, passwordHash],
    );

    const walletRef = await tx.one<{ ref: string }>('SELECT prs.next_wallet_ref() AS ref');
    const wallet = await createWallet(tx, {
      profileId: profile.id,
      labelFa: 'کیف پول اصلی',
      isPrimary: true,
      publicRef: walletRef!.ref,
    });

    await writeAudit(tx, {
      actor: input.auditActor ?? null,
      action: 'profile.register',
      category: 'ADMIN',
      severity: 'NOTICE',
      entityType: 'profile',
      entityId: profile.id,
      entityRef: profile.public_ref,
      afterState: { role: input.role ?? 'USER', walletRef: walletRef!.ref },
      metadata: { selfService: !input.auditActor },
      meta: { requestId: 'registration', ipHash: null, userAgent: null },
    });

    return { profileId: profile.id, publicRef: profile.public_ref, walletId: wallet.walletId, walletRef: walletRef!.ref };
  });
}

export async function listProfiles(
  db: Database,
  query: { search?: string; role?: string; status?: string; page?: number; pageSize?: number },
): Promise<{ items: Record<string, unknown>[]; total: number }> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 25));
  const params: unknown[] = [];
  const conditions: string[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    conditions.push(clause.replaceAll('?', `$${params.length}`));
  };
  if (query.role) add('p.role = ?', query.role);
  if (query.status) add('p.status = ?', query.status);
  if (query.search) {
    add('(p.full_name_fa ILIKE ? OR p.full_name_en ILIKE ? OR p.public_ref ILIKE ?)', `%${query.search.replace(/[%_]/g, '')}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = await db.one<{ count: string }>(`SELECT count(*)::text AS count FROM prs.profiles p ${where}`, params);
  params.push(pageSize, (page - 1) * pageSize);

  const rows = await db.query(
    `SELECT p.id, p.public_ref, p.full_name_fa, p.full_name_en, p.role, p.status, p.email, p.phone,
            p.mfa_enabled, p.last_login_at, p.created_at,
            COALESCE(SUM(b.balance_minor), 0)::text AS total_balance_minor,
            count(DISTINCT c.id)::text AS card_count
       FROM prs.profiles p
       LEFT JOIN prs.wallets w ON w.profile_id = p.id
       LEFT JOIN prs.wallet_balances b ON b.wallet_id = w.id
       LEFT JOIN prs.cards c ON c.profile_id = p.id AND c.status = 'ACTIVE'
       ${where}
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { items: rows, total: Number(total?.count ?? 0) };
}

export async function getProfileDetail(db: Database, profileId: string): Promise<Record<string, unknown>> {
  const profile = await db.one(
    `SELECT p.id, p.public_ref, p.full_name_fa, p.full_name_en, p.role, p.status, p.email, p.phone,
            p.mfa_enabled, p.locale, p.last_login_at, p.created_at, p.locked_until
       FROM prs.profiles p WHERE p.id = $1`,
    [profileId],
  );
  if (!profile) throw new DomainError('PROFILE_NOT_FOUND');

  const [wallets, cards, recentTransactions, activity] = await Promise.all([
    db.query(
      `SELECT w.id, w.public_ref, w.label_fa, w.status, w.is_primary, COALESCE(b.balance_minor,0)::text AS balance_minor
         FROM prs.wallets w LEFT JOIN prs.wallet_balances b ON b.wallet_id = w.id
        WHERE w.profile_id = $1 ORDER BY w.is_primary DESC`,
      [profileId],
    ),
    db.query(
      `SELECT c.id, c.card_number, c.status, c.expiry_month, c.expiry_year, c.cardholder_name_fa
         FROM prs.cards c WHERE c.profile_id = $1 ORDER BY c.issued_at DESC`,
      [profileId],
    ),
    db.query(
      `SELECT t.reference, t.type, t.status, t.amount_minor::text, t.created_at
         FROM prs.transactions t
        WHERE t.initiated_by_profile_id = $1
           OR t.sender_wallet_id IN (SELECT id FROM prs.wallets WHERE profile_id = $1)
           OR t.receiver_wallet_id IN (SELECT id FROM prs.wallets WHERE profile_id = $1)
        ORDER BY t.created_at DESC LIMIT 25`,
      [profileId],
    ),
    db.query(
      `SELECT kind, detail, occurred_at FROM prs.profile_activity_events WHERE profile_id = $1
        ORDER BY occurred_at DESC LIMIT 25`,
      [profileId],
    ),
  ]);

  return {
    profile,
    wallets,
    cards: cards.map((card: Record<string, unknown>) => ({
      ...card,
      card_number: String(card.card_number).replace(/^(\d{4})(\d{4})(\d{4})$/, '$1••••$3'),
    })),
    recentTransactions,
    activity,
    permissions: permissionsFor((profile as { role: ProfileRole }).role),
  };
}

export async function updateProfileStatus(
  context: ServiceContext,
  input: { profileId: string; status: ProfileStatus; reason: string },
): Promise<void> {
  const actor = requireActor(context);
  assertCan(actor.role, 'admin.users.write');
  if (input.profileId === actor.profileId) {
    throw new DomainError('FORBIDDEN', { messageFa: 'تغییر وضعیت حساب خودتان از این مسیر مجاز نیست.' });
  }

  await context.db.transaction(async (tx) => {
    const before = await tx.one<{ status: string }>('SELECT status FROM prs.profiles WHERE id = $1 FOR UPDATE', [
      input.profileId,
    ]);
    if (!before) throw new DomainError('PROFILE_NOT_FOUND');
    await tx.execute('UPDATE prs.profiles SET status = $2 WHERE id = $1', [input.profileId, input.status]);
    if (input.status !== 'ACTIVE') {
      await revokeAllSessions(tx, input.profileId, `status:${input.status}`);
    }
    await writeAudit(tx, {
      actor,
      action: 'admin.user.status',
      category: 'ADMIN',
      severity: 'CRITICAL',
      entityType: 'profile',
      entityId: input.profileId,
      reason: input.reason,
      beforeState: { status: before.status },
      afterState: { status: input.status },
      meta: context.meta,
    });
  });
}

registerApprovalExecutor('ADMIN_ROLE_CHANGE', async (tx, { action, actor, meta }) => {
  const profileId = String(action.payload.profileId ?? '');
  const role = String(action.payload.role ?? '') as ProfileRole;
  const allowed: ProfileRole[] = ['USER', 'DESIGN_ADMIN', 'AUDITOR', 'TREASURY_OFFICER', 'SUPER_ADMIN'];
  if (!allowed.includes(role)) throw new DomainError('VALIDATION_FAILED', { messageFa: 'نقش نامعتبر است.' });

  const before = await tx.one<{ role: ProfileRole }>('SELECT role FROM prs.profiles WHERE id = $1 FOR UPDATE', [profileId]);
  if (!before) throw new DomainError('PROFILE_NOT_FOUND');
  if (profileId === actor.profileId && role === 'USER') {
    throw new DomainError('FORBIDDEN', { messageFa: 'حذف نقش مدیر ارشد از خودتان مجاز نیست.' });
  }

  await tx.execute('UPDATE prs.profiles SET role = $2 WHERE id = $1', [profileId, role]);
  // A role change invalidates every existing session of that person.
  await revokeAllSessions(tx, profileId, 'role_changed');

  await writeAudit(tx, {
    actor,
    action: 'admin.user.role_change',
    category: 'ADMIN',
    severity: 'CRITICAL',
    entityType: 'profile',
    entityId: profileId,
    reason: action.reason,
    beforeState: { role: before.role },
    afterState: { role },
    adminActionId: action.adminActionId,
    meta,
  });

  return { entityRef: profileId, result: { profileId, role, previousRole: before.role } };
});

registerApprovalExecutor('WALLET_FREEZE', async (tx, { action, actor, meta }) => {
  const walletId = String(action.payload.walletId ?? '');
  const freeze = action.payload.freeze !== false;
  const before = await tx.one<{ status: string }>('SELECT status FROM prs.wallets WHERE id = $1 FOR UPDATE', [walletId]);
  if (!before) throw new DomainError('WALLET_NOT_FOUND');
  const nextStatus = freeze ? 'FROZEN' : 'ACTIVE';
  await tx.execute(
    `UPDATE prs.wallets SET status = $2, freeze_reason = CASE WHEN $2 = 'FROZEN' THEN $3 ELSE NULL END WHERE id = $1`,
    [walletId, nextStatus, action.reason],
  );
  await tx.execute(
    `INSERT INTO prs.wallet_events (wallet_id, event, detail, actor_id) VALUES ($1,$2,$3,$4)`,
    [walletId, freeze ? 'FROZEN' : 'UNFROZEN', JSON.stringify({ reason: action.reason }), actor.profileId],
  );
  await revokeAllSessions(
    tx,
    (await tx.one<{ profile_id: string }>('SELECT profile_id FROM prs.wallets WHERE id = $1', [walletId]))!.profile_id,
    freeze ? 'wallet_frozen' : 'wallet_unfrozen',
  );
  await writeAudit(tx, {
    actor,
    action: 'admin.wallet.freeze',
    category: 'ADMIN',
    severity: 'CRITICAL',
    entityType: 'wallet',
    entityId: walletId,
    reason: action.reason,
    beforeState: { status: before.status },
    afterState: { status: nextStatus },
    adminActionId: action.adminActionId,
    meta,
  });
  return { entityRef: walletId, result: { status: nextStatus } };
});

export function rolePermissions(role: ProfileRole) {
  return permissionsFor(role);
}

export function isAdmin(role: ProfileRole): role is AdminRole {
  return role !== 'USER';
}

export async function countProfilesByRole(db: Database): Promise<Record<string, number>> {
  const rows = await db.query<{ role: string; count: string }>(
    'SELECT role, count(*)::text AS count FROM prs.profiles GROUP BY role',
  );
  return Object.fromEntries(rows.map((row) => [row.role, Number(row.count)]));
}

export async function suspendLockedAccounts(tx: TransactionContext): Promise<number> {
  return tx.execute(
    `UPDATE prs.profiles SET locked_until = NULL
      WHERE locked_until IS NOT NULL AND locked_until <= now()`,
  );
}
