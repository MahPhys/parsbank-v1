/**
 * BANK PARS — authentication routes.
 *
 * Login is deliberately split by audience: the public application posts to
 * /auth/login, the control plane to /auth/admin/login. The API refuses an
 * administrative session for a USER-role account even if somebody finds the URL.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '@parsbank/config';
import { DomainError } from '@parsbank/domain';
import {
  changePasswordSchema,
  loginSchema,
  transactionAuthorizationSchema,
} from '@parsbank/validation';
import type { Database } from '../../db/types.ts';
import {
  changePassword,
  issueTransactionAuthorization,
  login,
  revokeSession,
} from '../../services/auth.service.ts';
import { writeDenied } from '../../services/audit.service.ts';
import {
  assertCsrf,
  assertTrustedOrigin,
  clearSessionCookies,
  requestMeta,
  resolveSession,
  setSessionCookies,
} from '../session.ts';

export async function registerAuthRoutes(app: FastifyInstance, db: Database): Promise<void> {
  const authLimit = {
    rateLimit: {
      max: env().rateLimitAuthMax,
      timeWindow: '1 minute',
      keyGenerator: (request: { ip: string }) => request.ip,
    },
  };

  /** Exchanges card number + password (and TOTP when enabled) for a session. */
  const loginHandler = (audience: 'USER' | 'ADMIN') => async (request: FastifyRequest, reply: FastifyReply) => {
    assertTrustedOrigin(request);
    const body = loginSchema.parse(request.body ?? {});
    const meta = requestMeta(request);

    const session = await login(db, {
      cardNumber: body.cardNumber,
      password: body.password,
      totpCode: body.totpCode ?? null,
      audience,
      meta,
      userAgent: request.headers['user-agent'] ?? null,
    });

    setSessionCookies(request, reply, audience, {
      token: session.token,
      csrfToken: session.csrfToken,
      expiresAt: session.absoluteExpiresAt,
    });

    return {
      profileId: session.profileId,
      role: session.role,
      fullNameFa: session.fullNameFa,
      fullNameEn: session.fullNameEn,
      publicRef: session.publicRef,
      audience: session.audience,
      mfaSatisfied: session.mfaSatisfied,
      mustRotatePassword: session.mustRotatePassword,
      csrfToken: session.csrfToken,
      idleExpiresAt: session.idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
    };
  };

  const loginUser = loginHandler('USER');
  const loginAdmin = loginHandler('ADMIN');
  app.post('/auth/login', { config: authLimit }, async (request, reply) => loginUser(request, reply));
  app.post('/auth/admin/login', { config: authLimit }, async (request, reply) => loginAdmin(request, reply));

  for (const audience of ['USER', 'ADMIN'] as const) {
    const prefix = audience === 'ADMIN' ? '/auth/admin' : '/auth';

    app.post(`${prefix}/logout`, async (request, reply) => {
      assertTrustedOrigin(request);
      const session = await resolveSession(db, request, audience);
      if (session) {
        assertCsrf(request, session);
        await revokeSession(db, session.sessionId!, 'user_logout');
      }
      clearSessionCookies(request, reply, audience);
      return { ok: true };
    });

    app.get(`${prefix}/session`, async (request, reply) => {
      const session = await resolveSession(db, request, audience);
      if (!session) {
        return reply.code(401).send({ error: { code: 'AUTHENTICATION_REQUIRED', messageFa: 'وارد نشده‌اید.' } });
      }
      return {
        profileId: session.profileId,
        role: session.role,
        fullNameFa: session.fullNameFa,
        fullNameEn: session.fullNameEn,
        publicRef: session.profile.publicRef,
        audience: session.audience,
        mfaSatisfied: session.mfaSatisfied,
        mustRotatePassword: false,
      };
    });
  }

  /**
   * Issues the short-lived grant that authorises ONE money movement. Requires the
   * account password or the transaction PIN — never the CVV alone.
   */
  app.post('/auth/transaction-authorization', { config: authLimit }, async (request) => {
    assertTrustedOrigin(request);
    const session = await resolveSession(db, request, 'USER');
    if (!session) throw new DomainError('AUTHENTICATION_REQUIRED');
    assertCsrf(request, session);

    const body = transactionAuthorizationSchema.parse(request.body ?? {});

    const authorization = await issueTransactionAuthorization(db, {
      profileId: session.profileId,
      sessionId: session.sessionId,
      walletId: body.walletRef ?? null,
      credential: {
        kind: body.credential.kind,
        value: body.credential.value,
        totpCode: body.credential.totpCode ?? null,
      },
      maxAmountMinor: body.maxAmountMinor ?? null,
    });

    return authorization;
  });

  app.post('/auth/password/change', { config: authLimit }, async (request) => {
    assertTrustedOrigin(request);
    const session = await resolveSession(db, request, 'USER');
    if (!session) throw new DomainError('AUTHENTICATION_REQUIRED');
    assertCsrf(request, session);
    const body = changePasswordSchema.parse(request.body ?? {});
    await changePassword(db, {
      profileId: session.profileId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      actor: session,
      meta: requestMeta(request),
    });
    return { ok: true };
  });

  app.get('/auth/failed-attempts', async (request) => {
    const session = await resolveSession(db, request, 'USER');
    if (!session) throw new DomainError('AUTHENTICATION_REQUIRED');
    const rows = await db.query(
      `SELECT outcome, occurred_at FROM prs.login_attempts
        WHERE profile_id = $1 ORDER BY occurred_at DESC LIMIT 10`,
      [session.profileId],
    );
    return { items: rows };
  });

  app.post('/auth/denied-probe', async (request, reply) => {
    // Used by the security tests to confirm that a rejected probe is audited.
    const session = await resolveSession(db, request, 'USER');
    await writeDenied(db, {
      actor: session,
      action: 'security.probe',
      category: 'SECURITY',
      severity: 'WARNING',
      entityType: 'probe',
      reason: 'manual probe',
      meta: requestMeta(request),
    });
    return reply.code(403).send({ error: { code: 'FORBIDDEN', messageFa: 'این عملیات مجاز نیست.' } });
  });
}
