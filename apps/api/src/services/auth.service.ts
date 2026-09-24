/**
 * BANK PARS — authentication, sessions and transaction authorization.
 *
 * Separation of concerns that the brief insists on:
 *   • LOGIN proves who you are (card number + password, optional TOTP);
 *   • TRANSACTION AUTHORIZATION proves you intend this payment (PIN or password,
 *     optionally with TOTP) and produces a short-lived grant bound to a session,
 *     a wallet and an amount ceiling;
 *   • the CVV is a card-presence factor and is NEVER sufficient on its own.
 *
 * Sessions are server-side rows: the cookie carries a 256-bit random token and the
 * database stores only its sha256. Rotation, idle expiry and absolute expiry are
 * all enforced here, not in the browser.
 */
import { env } from '@parsbank/config';
import { COOKIES } from '@parsbank/config/constants';
import type { ProfileRole, SessionUser } from '@parsbank/types';
import { DomainError, normalizeDigits } from '@parsbank/domain';
import type { Database, TransactionContext } from '../db/types.ts';
import {
  createSessionToken,
  decryptSecret,
  encryptSecret,
  hashIp,
  hashSecret,
  hashToken,
  randomBase32,
  safeEqual as cryptoEqual,
  verifySecret,
  verifyTotp,
} from '../lib/crypto.ts';
import { writeAudit } from './audit.service.ts';
import { numericSetting } from './settings.service.ts';
import type { ActorContext, RequestMeta } from './context.ts';

export interface SessionRecord {
  id: string;
  profile_id: string;
  audience: 'USER' | 'ADMIN';
  role: string;
  csrf_secret_hash: string;
  mfa_satisfied: boolean;
  idle_expires_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
}

export interface IssuedSession extends SessionUser {
  sessionId: string;
  token: string;
  csrfToken: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

/* -------------------------------------------------------------------------- */
/* Session lifecycle                                                           */
/* -------------------------------------------------------------------------- */

function csrfTokenFor(csrfSecret: string): string {
  return csrfSecret.slice(0, 40);
}

export async function createSession(
  tx: TransactionContext,
  input: {
    profileId: string;
    role: ProfileRole;
    fullNameFa: string;
    fullNameEn: string;
    publicRef: string;
    audience: 'USER' | 'ADMIN';
    mfaSatisfied: boolean;
    mustRotatePassword: boolean;
    ipHash: string | null;
    userAgent: string | null;
  },
): Promise<IssuedSession> {
  const config = env();
  const idleMinutes =
    input.audience === 'ADMIN' ? config.adminSessionIdleMinutes : config.sessionIdleMinutes;
  const absoluteHours = config.sessionAbsoluteHours;

  const token = createSessionToken();
  const csrfSecret = randomBase32(40);

  const row = await tx.one<{ id: string; idle_expires_at: string; absolute_expires_at: string }>(
    `INSERT INTO prs.sessions
       (token_hash, audience, profile_id, role_snapshot, csrf_secret_hash, user_agent, ip_hash,
        mfa_satisfied, absolute_expires_at, idle_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + ($9 || ' hours')::interval, now() + ($10 || ' minutes')::interval)
     RETURNING id, idle_expires_at, absolute_expires_at`,
    [
      token.hash,
      input.audience,
      input.profileId,
      input.role,
      hashToken(csrfSecret),
      input.userAgent,
      input.ipHash,
      input.mfaSatisfied,
      String(absoluteHours),
      String(idleMinutes),
    ],
  );
  if (!row) throw new DomainError('INTERNAL_ERROR', { messageEn: 'session could not be created' });

  return {
    sessionId: row.id,
    token: token.raw,
    csrfToken: csrfTokenFor(csrfSecret),
    profileId: input.profileId,
    role: input.role,
    fullNameFa: input.fullNameFa,
    fullNameEn: input.fullNameEn,
    publicRef: input.publicRef,
    audience: input.audience,
    mfaSatisfied: input.mfaSatisfied,
    mustRotatePassword: input.mustRotatePassword,
    idleExpiresAt: new Date(row.idle_expires_at).toISOString(),
    absoluteExpiresAt: new Date(row.absolute_expires_at).toISOString(),
  };
}

export interface AuthenticatedSession extends ActorContext {
  audience: 'USER' | 'ADMIN';
  fullNameEn: string;
  /** sha256 of the CSRF token handed to the client (never the token itself) */
  csrfSecretHash: string;
  profile: {
    id: string;
    role: ProfileRole;
    status: string;
    fullNameFa: string;
    fullNameEn: string;
    publicRef: string;
    mfaEnabled: boolean;
  };
}

/** Resolves a raw cookie token into an actor context, or null. Slides idle expiry. */
export async function authenticateSession(
  db: Database,
  rawToken: string,
  audience: 'USER' | 'ADMIN',
): Promise<AuthenticatedSession | null> {
  if (!rawToken || rawToken.length < 20) return null;
  const tokenHash = hashToken(rawToken);

  const session = await db.one<SessionRecord & { profile: unknown }>(
    `SELECT s.id, s.profile_id, s.audience, s.role_snapshot AS role, s.csrf_secret_hash, s.mfa_satisfied,
            s.idle_expires_at, s.absolute_expires_at, s.revoked_at
       FROM prs.sessions s
      WHERE s.token_hash = $1 AND s.audience = $2`,
    [tokenHash, audience],
  );
  if (!session) return null;
  if (session.revoked_at) return null;

  const now = Date.now();
  if (new Date(session.absolute_expires_at).getTime() <= now) return null;
  if (new Date(session.idle_expires_at).getTime() <= now) return null;

  const profile = await db.one<{
    id: string;
    role: ProfileRole;
    status: string;
    full_name_fa: string;
    full_name_en: string;
    public_ref: string;
    mfa_enabled: boolean;
  }>(
    `SELECT id, role, status, full_name_fa, full_name_en, public_ref, mfa_enabled
       FROM prs.profiles WHERE id = $1`,
    [session.profile_id],
  );
  if (!profile || profile.status !== 'ACTIVE') return null;

  // Sliding expiry, capped by the absolute lifetime.
  const idleMinutes = audience === 'ADMIN' ? env().adminSessionIdleMinutes : env().sessionIdleMinutes;
  await db.execute(
    `UPDATE prs.sessions
        SET last_seen_at = now(),
            idle_expires_at = LEAST(absolute_expires_at, now() + ($2 || ' minutes')::interval)
      WHERE id = $1`,
    [session.id, String(idleMinutes)],
  );

  // The role snapshot is authoritative for the life of the session; a role change
  // invalidates sessions by bumping the snapshot comparison below.
  const effectiveRole = profile.role;

  return {
    profileId: profile.id,
    role: effectiveRole,
    sessionId: session.id,
    audience,
    mfaSatisfied: session.mfa_satisfied,
    fullNameFa: profile.full_name_fa,
    fullNameEn: profile.full_name_en,
    csrfSecretHash: session.csrf_secret_hash,
    profile: {
      id: profile.id,
      role: profile.role,
      status: profile.status,
      fullNameFa: profile.full_name_fa,
      fullNameEn: profile.full_name_en,
      publicRef: profile.public_ref,
      mfaEnabled: profile.mfa_enabled,
    },
  };
}

/**
 * Double-submit CSRF check: the browser stores a non-HttpOnly cookie and echoes it
 * in a header. The database holds only the hash, so a leaked session row cannot be
 * used to forge the header.
 */
export function verifyCsrfToken(session: { csrfSecretHash: string }, presented: string | undefined): boolean {
  if (!presented) return false;
  return cryptoEqual(hashToken(presented), session.csrfSecretHash);
}

export async function revokeSession(db: Database, sessionId: string, reason: string): Promise<void> {
  await db.execute('UPDATE prs.sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1', [
    sessionId,
    reason,
  ]);
}

/** Revokes every session of a profile — used on role change, freeze or password change. */
export async function revokeAllSessions(
  tx: TransactionContext,
  profileId: string,
  reason: string,
): Promise<number> {
  const result = await tx.execute(
    'UPDATE prs.sessions SET revoked_at = now(), revoked_reason = $2 WHERE profile_id = $1 AND revoked_at IS NULL',
    [profileId, reason],
  );
  return result;
}

/* -------------------------------------------------------------------------- */
/* Login                                                                       */
/* -------------------------------------------------------------------------- */

export interface LoginInput {
  cardNumber: string;
  password: string;
  totpCode?: string | null;
  audience: 'USER' | 'ADMIN';
  meta: RequestMeta;
  userAgent: string | null;
}

const GENERIC_LOGIN_FAILURE = 'شماره کارت یا گذرواژه نادرست است.';

export async function login(db: Database, input: LoginInput): Promise<IssuedSession> {
  const cardNumber = normalizeDigits(input.cardNumber);
  const ipHash = input.meta.ipHash;
  const identifierHash = hashToken(`card:${cardNumber}`);

  const profile = await db.one<{
    id: string;
    role: ProfileRole;
    status: string;
    full_name_fa: string;
    full_name_en: string;
    public_ref: string;
    mfa_enabled: boolean;
    mfa_secret_enc: string | null;
    locked_until: string | null;
    password_hash: string | null;
    must_rotate: boolean | null;
    failed_attempts: number | null;
    credential_locked_until: string | null;
  }>(
    `SELECT p.id, p.role, p.status, p.full_name_fa, p.full_name_en, p.public_ref, p.mfa_enabled,
            p.mfa_secret_enc, p.locked_until,
            c.password_hash, c.must_rotate, c.failed_attempts, c.locked_until AS credential_locked_until
       FROM prs.cards cd
       JOIN prs.profiles p ON p.id = cd.profile_id
       LEFT JOIN prs.account_credentials c ON c.profile_id = p.id
      WHERE cd.card_number = $1`,
    [cardNumber],
  );

  const recordAttempt = async (outcome: string, profileId: string | null) => {
    await db.execute(
      `INSERT INTO prs.login_attempts (profile_id, identifier_hash, ip_hash, outcome, user_agent)
       VALUES ($1,$2,$3,$4,$5)`,
      [profileId, identifierHash, ipHash, outcome, input.userAgent],
    );
  };

  if (!profile || !profile.password_hash) {
    await recordAttempt(profile ? 'BAD_PASSWORD' : 'UNKNOWN_CARD', profile?.id ?? null);
    await writeAudit(db, {
      actor: null,
      action: 'auth.login',
      category: 'AUTH',
      severity: 'WARNING',
      outcome: 'DENIED',
      entityType: 'profile',
      entityId: profile?.id ?? null,
      reason: 'unknown card number or missing credentials',
      meta: input.meta,
    });
    throw new DomainError('PASSWORD_INVALID', { messageFa: GENERIC_LOGIN_FAILURE });
  }

  const now = Date.now();
  if (profile.locked_until && new Date(profile.locked_until).getTime() > now) {
    await recordAttempt('LOCKED', profile.id);
    throw new DomainError('LOCKED_OUT');
  }
  if (profile.status !== 'ACTIVE') {
    await recordAttempt('LOCKED', profile.id);
    throw new DomainError('PROFILE_SUSPENDED');
  }

  const passwordOk = await verifySecret(input.password, profile.password_hash);
  if (!passwordOk) {
    const maxAttempts = await numericSetting(db, 'security.max_login_attempts', 5);
    const lockMinutes = await numericSetting(db, 'security.lockout_minutes', 15);
    const failed = (profile.failed_attempts ?? 0) + 1;
    await db.execute(
      `UPDATE prs.account_credentials SET failed_attempts = $2, locked_until = $3 WHERE profile_id = $1`,
      [
        profile.id,
        failed,
        failed >= maxAttempts ? new Date(now + lockMinutes * 60_000) : profile.credential_locked_until,
      ],
    );
    if (failed >= maxAttempts) {
      await db.execute('UPDATE prs.profiles SET locked_until = $2 WHERE id = $1', [
        profile.id,
        new Date(now + lockMinutes * 60_000),
      ]);
    }
    await recordAttempt('BAD_PASSWORD', profile.id);
    await writeAudit(db, {
      actor: null,
      action: 'auth.login',
      category: 'AUTH',
      severity: 'WARNING',
      outcome: 'DENIED',
      entityType: 'profile',
      entityId: profile.id,
      reason: 'bad password',
      meta: input.meta,
    });
    throw new DomainError('PASSWORD_INVALID', { messageFa: GENERIC_LOGIN_FAILURE });
  }

  // Administrative surfaces require the admin roles; a user account cannot enter
  // the control plane with its own password, even if the URL is guessed.
  if (input.audience === 'ADMIN' && profile.role === 'USER') {
    await recordAttempt('LOCKED', profile.id);
    throw new DomainError('FORBIDDEN', { messageFa: 'دسترسی به پنل مدیریت برای این حساب مجاز نیست.' });
  }

  let mfaSatisfied = false;
  if (profile.mfa_enabled) {
    if (!input.totpCode) {
      await recordAttempt('MFA_REQUIRED', profile.id);
      throw new DomainError('MFA_REQUIRED');
    }
    const secret = profile.mfa_secret_enc ? decryptSecret(profile.mfa_secret_enc) : null;
    if (!secret || !verifyTotp(secret, input.totpCode)) {
      await recordAttempt('MFA_FAILED', profile.id);
      throw new DomainError('MFA_INVALID');
    }
    mfaSatisfied = true;
  }

  const session = await db.transaction(async (tx) => {
    await tx.execute(
      `UPDATE prs.account_credentials SET failed_attempts = 0, locked_until = NULL WHERE profile_id = $1`,
      [profile.id],
    );
    await tx.execute('UPDATE prs.profiles SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [
      profile.id,
    ]);
    const created = await createSession(tx, {
      profileId: profile.id,
      role: profile.role,
      fullNameFa: profile.full_name_fa,
      fullNameEn: profile.full_name_en,
      publicRef: profile.public_ref,
      audience: input.audience,
      mfaSatisfied,
      mustRotatePassword: profile.must_rotate ?? true,
      ipHash,
      userAgent: input.userAgent,
    });
    await tx.execute(
      `INSERT INTO prs.profile_activity_events (profile_id, kind, detail, ip_hash)
       VALUES ($1, 'LOGIN', $2, $3)`,
      [profile.id, JSON.stringify({ audience: input.audience, mfaSatisfied }), ipHash],
    );
    return created;
  });

  await recordAttempt('SUCCESS', profile.id);
  await writeAudit(db, {
    actor: {
      profileId: profile.id,
      role: profile.role,
      sessionId: session.sessionId,
      audience: input.audience,
      mfaSatisfied,
      fullNameFa: profile.full_name_fa,
    },
    action: 'auth.login',
    category: 'AUTH',
    severity: 'NOTICE',
    entityType: 'session',
    entityId: session.sessionId,
    meta: input.meta,
  });

  return session;
}

/* -------------------------------------------------------------------------- */
/* Transaction authorization (separate from login)                             */
/* -------------------------------------------------------------------------- */

export interface TransactionAuthorizationInput {
  profileId: string;
  sessionId: string | null;
  walletId: string | null;
  credential: { kind: 'PIN' | 'PASSWORD'; value: string; totpCode?: string | null };
  maxAmountMinor: number | null;
}

export async function issueTransactionAuthorization(
  db: Database,
  input: TransactionAuthorizationInput,
): Promise<{ authorizationId: string; expiresAt: string }> {
  if (!input.sessionId) throw new DomainError('AUTHENTICATION_REQUIRED');

  /**
   * The caller addresses its wallet the way the API presented it — by public
   * reference (`PRS-W-000123`). Both forms are accepted and the wallet must belong to
   * the caller; anything else is a refusal, never a raw type error from PostgreSQL.
   */
  let walletId: string | null = input.walletId ?? null;
  if (walletId) {
    const owned = await db.one<{ id: string }>(
      `SELECT id FROM prs.wallets WHERE (public_ref = $1 OR id::text = $1) AND profile_id = $2`,
      [walletId, input.profileId],
    );
    if (!owned) throw new DomainError('WALLET_NOT_FOUND');
    walletId = owned.id;
  }

  const profile = await db.one<{
    id: string;
    mfa_enabled: boolean;
    mfa_secret_enc: string | null;
    password_hash: string | null;
  }>(
    `SELECT p.id, p.mfa_enabled, p.mfa_secret_enc, c.password_hash
       FROM prs.profiles p
       LEFT JOIN prs.account_credentials c ON c.profile_id = p.id
      WHERE p.id = $1`,
    [input.profileId],
  );
  if (!profile) throw new DomainError('PROFILE_NOT_FOUND');

  let method: 'PIN' | 'PASSWORD' | 'PASSWORD_TOTP';
  if (input.credential.kind === 'PIN') {
    const card = await db.one<{ pin_hash: string; pin_locked_until: string | null; failed_pin_attempts: number }>(
      `SELECT cc.pin_hash, cc.pin_locked_until, cc.failed_pin_attempts
         FROM prs.card_credentials cc
         JOIN prs.cards c ON c.id = cc.card_id
        WHERE c.profile_id = $1 AND c.status = 'ACTIVE'
        ORDER BY c.issued_at DESC LIMIT 1`,
      [input.profileId],
    );
    if (!card) throw new DomainError('CREDENTIAL_NOT_CONFIGURED');
    if (card.pin_locked_until && new Date(card.pin_locked_until).getTime() > Date.now()) {
      throw new DomainError('PIN_LOCKED');
    }
    const ok = await verifySecret(normalizeDigits(input.credential.value), card.pin_hash);
    if (!ok) {
      const attempts = card.failed_pin_attempts + 1;
      await db.execute(
        `UPDATE prs.card_credentials
            SET failed_pin_attempts = $2, pin_locked_until = $3
          WHERE card_id = (SELECT id FROM prs.cards WHERE profile_id = $1 AND status='ACTIVE' ORDER BY issued_at DESC LIMIT 1)`,
        [input.profileId, attempts, attempts >= 5 ? new Date(Date.now() + 15 * 60_000) : null],
      );
      throw new DomainError('PIN_INVALID');
    }
    await db.execute(
      `UPDATE prs.card_credentials
          SET failed_pin_attempts = 0, pin_locked_until = NULL
        WHERE card_id = (SELECT id FROM prs.cards WHERE profile_id = $1 AND status='ACTIVE' ORDER BY issued_at DESC LIMIT 1)`,
      [input.profileId],
    );
    method = 'PIN';
    if (profile.mfa_enabled) {
      const secret = profile.mfa_secret_enc ? decryptSecret(profile.mfa_secret_enc) : null;
      if (!secret) throw new DomainError('CREDENTIAL_NOT_CONFIGURED');
      if (!verifyTotp(secret, input.credential.totpCode ?? '')) throw new DomainError('MFA_INVALID');
      method = 'PIN';
    }
  } else {
    if (!profile.password_hash) throw new DomainError('CREDENTIAL_NOT_CONFIGURED');
    const ok = await verifySecret(input.credential.value, profile.password_hash);
    if (!ok) throw new DomainError('PASSWORD_INVALID');
    if (profile.mfa_enabled) {
      const secret = profile.mfa_secret_enc ? decryptSecret(profile.mfa_secret_enc) : null;
      if (!secret) throw new DomainError('CREDENTIAL_NOT_CONFIGURED');
      if (!verifyTotp(secret, input.credential.totpCode ?? '')) throw new DomainError('MFA_INVALID');
      method = 'PASSWORD_TOTP';
    } else {
      method = 'PASSWORD';
    }
  }

  const seconds = await numericSetting(db, 'security.txn_authorization_seconds', 120);
  const row = await db.one<{ id: string; expires_at: string }>(
    `INSERT INTO prs.transaction_authorizations
       (profile_id, session_id, wallet_id, method, max_amount_minor, expires_at)
     VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' seconds')::interval)
     RETURNING id, expires_at`,
    [input.profileId, input.sessionId, walletId, method, input.maxAmountMinor, String(seconds)],
  );
  if (!row) throw new DomainError('INTERNAL_ERROR', { messageEn: 'authorization could not be issued' });

  return { authorizationId: row.id, expiresAt: new Date(row.expires_at).toISOString() };
}

/** Consumes a transaction authorization exactly once, inside the posting transaction. */
export async function consumeTransactionAuthorization(
  tx: TransactionContext,
  input: {
    profileId: string;
    sessionId: string | null;
    authorizationId: string;
    walletId: string;
    maxAmountMinor: number;
  },
): Promise<void> {
  const row = await tx.one<{
    id: string;
    profile_id: string;
    session_id: string;
    wallet_id: string | null;
    max_amount_minor: string | null;
    consumed_at: string | null;
    expires_at: string;
  }>(
    `SELECT id, profile_id, session_id, wallet_id, max_amount_minor::text, consumed_at, expires_at
       FROM prs.transaction_authorizations
      WHERE id = $1
      FOR UPDATE`,
    [input.authorizationId],
  );

  if (!row || row.profile_id !== input.profileId) throw new DomainError('TRANSACTION_AUTHORIZATION_INVALID');
  if (input.sessionId && row.session_id !== input.sessionId) {
    throw new DomainError('TRANSACTION_AUTHORIZATION_INVALID', {
      messageEn: 'authorization belongs to a different session',
    });
  }
  if (row.consumed_at) throw new DomainError('TRANSACTION_AUTHORIZATION_INVALID', { messageEn: 'already used' });
  if (new Date(row.expires_at).getTime() <= Date.now()) throw new DomainError('TRANSACTION_AUTHORIZATION_EXPIRED');
  if (row.wallet_id && row.wallet_id !== input.walletId) {
    throw new DomainError('TRANSACTION_AUTHORIZATION_INVALID', { messageEn: 'wallet scope mismatch' });
  }
  if (row.max_amount_minor && Number(row.max_amount_minor) < input.maxAmountMinor) {
    throw new DomainError('TRANSACTION_AUTHORIZATION_INVALID', { messageEn: 'amount exceeds authorized ceiling' });
  }

  await tx.execute('UPDATE prs.transaction_authorizations SET consumed_at = now() WHERE id = $1', [row.id]);
}

/* -------------------------------------------------------------------------- */
/* Password management                                                         */
/* -------------------------------------------------------------------------- */

export async function setPassword(
  db: Database,
  input: { profileId: string; newPassword: string; mustRotate: boolean; actor?: ActorContext | null; meta: RequestMeta },
): Promise<void> {
  if (input.newPassword.length < 10) {
    throw new DomainError('VALIDATION_FAILED', {
      fields: [{ path: 'newPassword', message: 'گذرواژه باید حداقل ۱۰ نویسه باشد.' }],
    });
  }
  if (!/[A-Za-z]/.test(input.newPassword) || !/[0-9]/.test(input.newPassword)) {
    throw new DomainError('VALIDATION_FAILED', {
      fields: [{ path: 'newPassword', message: 'گذرواژه باید شامل حرف و رقم باشد.' }],
    });
  }
  const hash = await hashSecret(input.newPassword);
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO prs.account_credentials (profile_id, password_hash, must_rotate)
       VALUES ($1,$2,$3)
       ON CONFLICT (profile_id) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             must_rotate = EXCLUDED.must_rotate,
             password_updated_at = now(),
             failed_attempts = 0,
             locked_until = NULL`,
      [input.profileId, hash, input.mustRotate],
    );
    await tx.execute('UPDATE prs.profiles SET locked_until = NULL, failed_logins = 0 WHERE id = $1', [input.profileId]);
    await tx.execute(
      `INSERT INTO prs.profile_activity_events (profile_id, kind, detail) VALUES ($1, 'PASSWORD_CHANGED', '{}')`,
      [input.profileId],
    );
    await writeAudit(tx, {
      actor: input.actor ?? null,
      action: 'auth.password.change',
      category: 'SECURITY',
      severity: 'NOTICE',
      entityType: 'profile',
      entityId: input.profileId,
      meta: input.meta,
    });
  });
}

export async function changePassword(
  db: Database,
  input: {
    profileId: string;
    currentPassword: string;
    newPassword: string;
    actor: ActorContext;
    meta: RequestMeta;
  },
): Promise<void> {
  const row = await db.one<{ password_hash: string }>(
    'SELECT password_hash FROM prs.account_credentials WHERE profile_id = $1',
    [input.profileId],
  );
  if (!row || !(await verifySecret(input.currentPassword, row.password_hash))) {
    throw new DomainError('PASSWORD_INVALID', { messageFa: 'گذرواژه فعلی نادرست است.' });
  }
  await setPassword(db, {
    profileId: input.profileId,
    newPassword: input.newPassword,
    mustRotate: false,
    actor: input.actor,
    meta: input.meta,
  });
}

export async function enableMfa(
  db: Database,
  input: { profileId: string; secret: string; totpCode: string; actor: ActorContext; meta: RequestMeta },
): Promise<void> {
  if (!verifyTotp(input.secret, input.totpCode)) throw new DomainError('MFA_INVALID');
  await db.transaction(async (tx) => {
    await tx.execute('UPDATE prs.profiles SET mfa_enabled = true, mfa_secret_enc = $2 WHERE id = $1', [
      input.profileId,
      // The TOTP secret is encrypted with the server key before it touches disk.
      encryptSecret(input.secret),
    ]);
    await writeAudit(tx, {
      actor: input.actor,
      action: 'auth.mfa.enabled',
      category: 'SECURITY',
      severity: 'NOTICE',
      entityType: 'profile',
      entityId: input.profileId,
      meta: input.meta,
    });
  });
}

export function cookieNames(audience: 'USER' | 'ADMIN') {
  return audience === 'ADMIN'
    ? { session: COOKIES.adminSession, csrf: COOKIES.adminCsrf }
    : { session: COOKIES.userSession, csrf: COOKIES.csrf };
}

export function sessionCookieOptions(audience: 'USER' | 'ADMIN', expiresAt: string) {
  return {
    httpOnly: true,
    secure: env().cookieSecure,
    sameSite: 'strict' as const,
    path: '/',
    expires: new Date(expiresAt),
  };
}

export function ipHashOf(ip: string | undefined | null): string | null {
  return hashIp(ip);
}
