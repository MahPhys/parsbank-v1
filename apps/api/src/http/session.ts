/**
 * BANK PARS — session resolution & CSRF.
 *
 * Sessions live in the database; the cookie carries only an opaque random token.
 * CSRF uses the double-submit pattern: the browser stores a non-HttpOnly cookie
 * and must echo it in a header, which a cross-site attacker cannot read.
 * Additionally the Origin/Host of every state-changing request must match a
 * configured application origin.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
// Importing the plugin registers its type augmentation (request.cookies,
// reply.setCookie, reply.clearCookie) for the whole program.
import '@fastify/cookie';
import { env } from '@parsbank/config';
import { COOKIES, HEADERS } from '@parsbank/config/constants';
import { DomainError } from '@parsbank/domain';
import type { Database } from '../db/types.ts';
import {
  authenticateSession,
  cookieNames,
  verifyCsrfToken,
  type AuthenticatedSession,
} from '../services/auth.service.ts';
import { hashIp } from '../lib/crypto.ts';

export interface RequestContextCarrier {
  actor: AuthenticatedSession | null;
  meta: { requestId: string; ipHash: string | null; userAgent: string | null };
}

declare module 'fastify' {
  interface FastifyRequest {
    session?: AuthenticatedSession | null;
  }
}

export async function resolveSession(
  db: Database,
  request: FastifyRequest,
  audience: 'USER' | 'ADMIN',
): Promise<AuthenticatedSession | null> {
  if (request.session !== undefined) return request.session;
  const names = cookieNames(audience);
  const raw = request.cookies?.[names.session];
  if (!raw) {
    request.session = null;
    return null;
  }
  const session = await authenticateSession(db, raw, audience);
  request.session = session;
  return session;
}

export function requestMeta(request: FastifyRequest) {
  return {
    requestId: String(request.id),
    ipHash: hashIp(request.ip),
    userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
  };
}

/** Origin/Host validation for state-changing verbs — defence against CSRF. */
export function assertTrustedOrigin(request: FastifyRequest): void {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;

  const origin = request.headers.origin;
  const host = request.headers.host;
  const config = env();

  if (!origin) {
    // Same-origin form posts and server-to-server calls may omit Origin; the
    // double-submit CSRF token still applies to cookie-authenticated requests.
    return;
  }

  const trusted = new Set(config.allowedOrigins.map((value) => value.replace(/\/$/, '')));
  // The hosted preview and local development ports are trusted explicitly.
  const isPreview = /^https:\/\/[a-z0-9-]+\.e2b\.app$/.test(origin);
  const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const sameHost = host ? origin.endsWith(`//${host}`) : false;

  if (!trusted.has(origin.replace(/\/$/, '')) && !isPreview && !isLocalhost && !sameHost) {
    throw new DomainError('FORBIDDEN', {
      messageEn: 'origin is not trusted for state-changing requests',
      context: { origin },
    });
  }
}

export function assertCsrf(request: FastifyRequest, session: AuthenticatedSession | null): void {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  if (!session) return; // unauthenticated endpoints (login) are rate limited instead

  const names = cookieNames(session.audience);
  const cookieValue = request.cookies?.[names.csrf];
  const headerValue = request.headers[HEADERS.csrfToken.toLowerCase()] ?? request.headers[HEADERS.csrfToken];

  if (!cookieValue || !headerValue || String(headerValue) !== cookieValue) {
    throw new DomainError('FORBIDDEN', { messageFa: 'توکن امنیتی درخواست نامعتبر است.' });
  }
  // The presented token must hash to the value stored on the session row.
  if (!verifyCsrfToken(session, String(headerValue))) {
    throw new DomainError('FORBIDDEN', { messageFa: 'توکن امنیتی درخواست نامعتبر است.' });
  }
}

/**
 * Decides the SameSite attribute for a login response.
 *
 * A cross-site request over TLS (the application rendered inside the hosted preview
 * iframe) may only receive a cookie the browser will actually keep — that means
 * `none`, which requires `secure`. Anything else and the login appears to succeed
 * while the session silently evaporates, which is precisely the failure mode the
 * console must never have.
 */
export function cookiePolicy(request: FastifyRequest): { secure: boolean; sameSite: 'strict' | 'lax' | 'none' } {
  const config = env();
  const configured = config.cookieSameSite;
  if (configured !== 'auto') {
    return { secure: config.cookieSecure || configured === 'none', sameSite: configured };
  }
  const crossSite = request.headers['sec-fetch-site'] === 'cross-site';
  const forwardedProto = String(request.headers['x-forwarded-proto'] ?? '');
  const https = request.protocol === 'https' || forwardedProto.split(',')[0]?.trim() === 'https';
  if (crossSite && https) return { secure: true, sameSite: 'none' };
  return { secure: config.cookieSecure, sameSite: 'strict' };
}

export function setSessionCookies(
  request: FastifyRequest,
  reply: FastifyReply,
  audience: 'USER' | 'ADMIN',
  input: { token: string; csrfToken: string; expiresAt: string },
): void {
  const names = cookieNames(audience);
  const { secure, sameSite } = cookiePolicy(request);
  reply.setCookie(names.session, input.token, {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    expires: new Date(input.expiresAt),
  });
  // The CSRF cookie is intentionally readable by the app so it can echo it back.
  reply.setCookie(names.csrf, input.csrfToken, {
    httpOnly: false,
    secure,
    sameSite,
    path: '/',
    expires: new Date(input.expiresAt),
  });
}

export function clearSessionCookies(
  request: FastifyRequest,
  reply: FastifyReply,
  audience: 'USER' | 'ADMIN',
): void {
  const names = cookieNames(audience);
  const { secure, sameSite } = cookiePolicy(request);
  reply.clearCookie(names.session, { path: '/', secure, sameSite });
  reply.clearCookie(names.csrf, { path: '/', secure, sameSite });
}

export const COOKIE_NAMES = COOKIES;
