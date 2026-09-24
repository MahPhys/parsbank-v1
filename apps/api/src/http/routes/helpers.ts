/**
 * BANK PARS — route helpers.
 *
 * Small, explicit adapters between HTTP and the service layer. They exist so that
 * every route builds its service context the same way and enforces the same
 * audience/CSRF rules — there is exactly one place to get this right.
 */
import type { FastifyRequest } from 'fastify';
import { DomainError, assertCan, type Permission } from '@parsbank/domain';
import type { Database } from '../../db/types.ts';
import type { AuthenticatedSession } from '../../services/auth.service.ts';
import type { ActorContext, RequestMeta, ServiceContext } from '../../services/context.ts';
import { assertCsrf, assertTrustedOrigin, requestMeta, resolveSession } from '../session.ts';

export function serviceContext(
  db: Database,
  session: AuthenticatedSession | null,
  meta: RequestMeta,
): ServiceContext {
  const actor: ActorContext | null = session
    ? {
        profileId: session.profileId,
        role: session.role,
        sessionId: session.sessionId,
        audience: session.audience,
        mfaSatisfied: session.mfaSatisfied,
        fullNameFa: session.fullNameFa,
      }
    : null;
  return { db, actor, meta };
}

export function requireSession(session: AuthenticatedSession | null): AuthenticatedSession {
  if (!session) throw new DomainError('AUTHENTICATION_REQUIRED');
  return session;
}

export interface AuthedRequestOptions {
  audience?: 'USER' | 'ADMIN';
  permission?: Permission;
  mfaRequired?: boolean;
}

/**
 * The standard prologue of an authenticated route: origin check, session lookup,
 * CSRF (for state-changing verbs), permission gate, optional MFA requirement.
 */
export async function authed(
  db: Database,
  request: FastifyRequest,
  options: AuthedRequestOptions = {},
): Promise<{ session: AuthenticatedSession; context: ServiceContext }> {
  assertTrustedOrigin(request);
  const audience = options.audience ?? 'USER';
  const session = await resolveSession(db, request, audience);
  if (!session) throw new DomainError('AUTHENTICATION_REQUIRED');

  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') assertCsrf(request, session);

  if (options.permission) assertCan(session.role, options.permission);

  if (options.mfaRequired && !session.mfaSatisfied) {
    throw new DomainError('MFA_REQUIRED', {
      messageFa: 'برای این عملیات باید ورود دو مرحله‌ای فعال باشد.',
    });
  }

  return { session, context: serviceContext(db, session, requestMeta(request)) };
}

export function metaFor(request: FastifyRequest): RequestMeta {
  return requestMeta(request);
}
