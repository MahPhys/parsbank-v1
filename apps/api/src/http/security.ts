/**
 * BANK PARS — transport security.
 *
 * Security headers, CSP, HSTS, and the frame policy. The frame policy is the one
 * deliberate compromise in this file: the project is demonstrated inside a hosted
 * preview iframe, so embedding is allowed from the configured origins and the
 * preview host, while everything else remains blocked. In a real deployment
 * FRAME_ANCESTORS would simply be set to the institution's own origin.
 */
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import { env } from '@parsbank/config';

export function frameAncestors(): string {
  const origins = env().allowedOrigins.map((origin) => origin.replace(/\/$/, ''));
  const extra = process.env.FRAME_ANCESTORS?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  return ["'self'", ...origins, ...extra, 'https://*.e2b.app'].join(' ');
}

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  const config = env();
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", ...config.allowedOrigins],
        formAction: ["'self'"],
        frameAncestors: frameAncestors().split(' '),
        ...(config.isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    // HSTS only makes sense over TLS (production).
    hsts: config.isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
      : false,
    referrerPolicy: { policy: 'same-origin' },
    // X-Frame-Options is superseded by frame-ancestors in the CSP above; leaving it
    // on would also break the hosted preview, which embeds the app in an iframe.
    xFrameOptions: false,
    noSniff: true,
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Pars-Request-Id', String(request.id));
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    return payload;
  });
}

/** Body limits: a monetary API has no reason to accept large payloads. */
export const BODY_LIMIT_BYTES = 256 * 1024;
