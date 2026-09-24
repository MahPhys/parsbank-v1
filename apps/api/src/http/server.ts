/**
 * BANK PARS — HTTP server.
 *
 * One process serves three things:
 *   • the API under /api/v1 (the only way to touch money),
 *   • the public application (built from apps/public) at /,
 *   • the administrative control plane (built from apps/admin) at /admin.
 *
 * Serving the two applications from separate prefixes is what keeps "public and
 * administrative applications are separate" true at runtime, not just in the repo
 * layout: different session cookies, different role gates, different bundles.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { env } from '@parsbank/config';
import { getDatabase } from '../db/index.ts';
import { applyMigrations } from '../db/migrate.ts';
import { errorHandler, notFoundHandler } from './errors.ts';
import { BODY_LIMIT_BYTES, registerSecurity } from './security.ts';
import { registerAuthRoutes } from './routes/auth.routes.ts';
import { registerPublicRoutes } from './routes/public.routes.ts';
import { registerQrRoutes } from './routes/qr.routes.ts';
import { registerAdminRoutes } from './routes/admin.routes.ts';
import { registerContentRoutes } from './routes/content.routes.ts';
import { APP_VERSION } from '../services/health.service.ts';
import { assertExecutorCoverage } from '../services/executors.ts';

export interface BuiltServer {
  app: FastifyInstance;
  close: () => Promise<void>;
}

const repoRoot = path.resolve(process.cwd());
const PUBLIC_DIST = path.join(repoRoot, 'apps/public/dist');
const ADMIN_DIST = path.join(repoRoot, 'apps/admin/dist');

export async function buildServer(): Promise<BuiltServer> {
  const config = env();
  const db = await getDatabase(config);

  // Boot applies pending migrations (checksum-verified, idempotent). A fresh
  // checkout therefore starts with a correct schema; set PARS_SKIP_MIGRATE=1 to
  // forbid the API from touching the schema at all (recommended in production).
  if (process.env.PARS_SKIP_MIGRATE !== '1') {
    const migration = await applyMigrations(db);
    if (migration.applied.length > 0) {
      console.log(`BANK PARS · applied ${migration.applied.length} migration(s)`);
    }
  }

  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: BODY_LIMIT_BYTES,
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'req.body.password',
          'req.body.pin',
          'req.body.cvv',
          'req.body.credentials',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
    },
    genReqId: () => `prs-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
  });

  await app.register(cookie, { secret: config.cookieSecret, parseOptions: {} });
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitGlobalMax,
    timeWindow: '1 minute',
    allowList: [],
    keyGenerator: (request) => request.ip,
  });
  await registerSecurity(app);

  // Fail fast if any approval action type lacks an implementation.
  const coverage = assertExecutorCoverage();
  app.log.info(`approval executors ready · ${coverage.registered.length} action types`);

  app.setErrorHandler(errorHandler);

  app.get('/healthz', async () => ({ status: 'ok', version: APP_VERSION, at: new Date().toISOString() }));

  await app.register(
    async (api) => {
      await registerAuthRoutes(api, db);
      await registerPublicRoutes(api, db);
      await registerQrRoutes(api, db);
      await registerContentRoutes(api, db);
      await registerAdminRoutes(api, db);
    },
    { prefix: '/api/v1' },
  );

  // ---------------------------------------------------------------- static apps
  //
  // Two separately built bundles are served from one process: the member
  // application at `/` and the operations console at `/admin/`. They are mounted in
  // that order — the console first — because a wildcard route is registered per
  // bundle and the more specific `/admin/*` prefix must win over the member `/*`.
  //
  // Files are read from disk on demand (the default wildcard behaviour), so a build
  // produced *after* the API started is picked up without a restart.
  const hasPublic = existsSync(path.join(PUBLIC_DIST, 'index.html'));
  const hasAdmin = existsSync(path.join(ADMIN_DIST, 'index.html'));

  if (hasAdmin) {
    await app.register(fastifyStatic, {
      root: ADMIN_DIST,
      prefix: '/admin/',
      // No `reply.sendFile`: the shells are read directly in the 404 handler, and
      // registering the decorator twice (once per bundle) is a boot-time error.
      decorateReply: false,
      index: ['index.html'],
      cacheControl: false,
    });
  }
  if (hasPublic) {
    await app.register(fastifyStatic, {
      root: PUBLIC_DIST,
      prefix: '/',
      decorateReply: false,
      index: ['index.html'],
      cacheControl: false,
    });
  }

  /**
   * SPA fallback: any unknown non-API path is handed the shell of its own application,
   * and a genuinely missing asset under `/api/` keeps the JSON error shape.
   *
   * The shells are read from disk here (with a one-second cache) rather than through
   * `reply.sendFile`, because asking the static layer for a missing file from inside a
   * 404 handler is explicitly rejected by Fastify — which would turn every deep link
   * into a bare "404 Not Found" instead of the application.
   */
  const shellCache = new Map<string, { html: string | null; readAt: number }>();
  const readShell = (root: string): string | null => {
    const indexPath = path.join(root, 'index.html');
    const cached = shellCache.get(indexPath);
    const now = Date.now();
    if (cached && now - cached.readAt < 1_000) return cached.html;
    const html = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null;
    shellCache.set(indexPath, { html, readAt: now });
    return html;
  };

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return notFoundHandler(request, reply);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', messageFa: 'یافت نشد.' } });
    }
    const isAdmin = request.url === '/admin' || request.url.startsWith('/admin/');
    const shell = readShell(isAdmin ? ADMIN_DIST : PUBLIC_DIST);
    if (shell !== null) {
      return reply.code(200).type('text/html; charset=utf-8').send(shell);
    }
    return reply
      .code(503)
      .type('text/html; charset=utf-8')
      .send(
        `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>BANK PARS</title>` +
          `<body style="font-family:system-ui;padding:2rem;line-height:1.9">` +
          `<h1>بانک پارس</h1><p>رابط کاربری هنوز ساخته نشده است.</p>` +
          `<p>برای ساخت رابط‌ها: <code>npm run build</code></p></body></html>`,
      );
  });

  return {
    app,
    close: async () => {
      await app.close();
    },
  };
}

export async function startServer(): Promise<FastifyInstance> {
  const config = env();
  const { app } = await buildServer();
  await app.listen({ port: config.apiPort, host: config.apiHost });
  app.log.info(
    `BANK PARS ready · port ${config.apiPort} · ${config.databaseUrl ? 'PostgreSQL server' : 'embedded PostgreSQL'}`,
  );
  return app;
}
