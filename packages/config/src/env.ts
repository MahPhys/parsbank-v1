/**
 * BANK PARS — server environment.
 *
 * SERVER-ONLY. Never import this module from a frontend bundle: it is the
 * boundary that keeps service secrets out of client code. The build for
 * apps/public and apps/admin can only reach ./constants.
 */
import { z } from 'zod';
import path from 'node:path';

const boolFromString = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  API_HOST: z.string().default('0.0.0.0'),
  PUBLIC_ORIGIN: z.string().default('http://localhost:5173'),
  ADMIN_ORIGIN: z.string().default('http://localhost:5174'),

  /** When set, the API talks to a real PostgreSQL server. Otherwise it runs the
   *  embedded PostgreSQL (PGlite) under DATA_DIR — identical SQL either way. */
  DATABASE_URL: z.string().optional(),
  DATA_DIR: z.string().default('.data'),
  PGLITE_DIR: z.string().default('.data/pg'),
  MEDIA_DIR: z.string().default('.data/media'),

  /** Secrets. In development they are derived deterministically so the sandbox
   *  works with zero setup; production requires real values (checked below). */
  APP_ENCRYPTION_KEY: z.string().optional(),
  COOKIE_SECRET: z.string().optional(),
  PASSWORD_PEPPER: z.string().optional(),

  /** Absolute session lifetime always applies; idle timeout is configurable. */
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  ADMIN_SESSION_IDLE_MINUTES: z.coerce.number().int().min(3).max(120).default(15),

  TRUST_PROXY: boolFromString.default(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().min(10).default(600),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(3).default(10),
  /** Public, unauthenticated endpoints (card QR view, note verification). */
  RATE_LIMIT_PUBLIC_MAX: z.coerce.number().int().min(3).default(60),
  /** Set to 'true' in production so cookies are marked Secure (HTTPS only). */
  COOKIE_SECURE: boolFromString.optional(),

  /**
   * SameSite policy for session cookies.
   *
   * `auto` (the default) decides per request: a same-site request keeps `strict`,
   * while a request that arrives cross-site over HTTPS — the hosted preview embeds
   * the application in an iframe, which makes every request third-party — is issued
   * `none; secure`, because a `strict`/`lax` cookie is simply not stored by the
   * browser in that context and the session would silently never persist.
   *
   * Relaxing SameSite is a defence-in-depth change only: CSRF is enforced by the
   * double-submit token bound to the session row plus the Origin/Host allow-list,
   * neither of which depends on the cookie attribute. Set `strict` to forbid the
   * cross-site case outright (the correct value for a self-hosted deployment).
   */
  COOKIE_SAME_SITE: z.enum(['auto', 'strict', 'lax', 'none']).default('auto'),
});

export type RawEnv = z.infer<typeof schema>;

export interface AppEnv {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  apiPort: number;
  apiHost: string;
  publicOrigin: string;
  adminOrigin: string;
  databaseUrl: string | null;
  dataDir: string;
  pgliteDir: string;
  mediaDir: string;
  appEncryptionKey: string;
  cookieSecret: string;
  passwordPepper: string;
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
  adminSessionIdleMinutes: number;
  trustProxy: boolean;
  logLevel: RawEnv['LOG_LEVEL'];
  rateLimitGlobalMax: number;
  rateLimitAuthMax: number;
  rateLimitPublicMax: number;
  cookieSecure: boolean;
  cookieSameSite: 'auto' | 'strict' | 'lax' | 'none';
  allowedOrigins: string[];
}

/**
 * Development derives stable secrets from a fixed local seed so that the sandbox
 * runs out of the box. Production MUST provide them and the check below fails
 * hard rather than silently weakening the system.
 */
function deriveDevSecret(label: string): string {
  return `dev-only-${label}-do-not-use-in-production-bank-pars`;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`BANK PARS configuration error: ${issues}`);
  }
  const raw = parsed.data;
  const isProduction = raw.NODE_ENV === 'production';

  const missing: string[] = [];
  if (isProduction) {
    for (const key of ['APP_ENCRYPTION_KEY', 'COOKIE_SECRET', 'PASSWORD_PEPPER', 'DATABASE_URL'] as const) {
      if (!raw[key] || String(raw[key]).trim().length < 16) missing.push(key);
    }
    if (missing.length) {
      throw new Error(
        `BANK PARS refusing to start: production requires ${missing.join(', ')} (min 16 chars each).`,
      );
    }
  }

  const dataDir = path.resolve(raw.DATA_DIR);
  return {
    nodeEnv: raw.NODE_ENV,
    isProduction,
    apiPort: raw.API_PORT,
    apiHost: raw.API_HOST,
    publicOrigin: raw.PUBLIC_ORIGIN,
    adminOrigin: raw.ADMIN_ORIGIN,
    databaseUrl: raw.DATABASE_URL ? raw.DATABASE_URL : null,
    dataDir,
    pgliteDir: path.resolve(raw.PGLITE_DIR),
    mediaDir: path.resolve(raw.MEDIA_DIR),
    appEncryptionKey: raw.APP_ENCRYPTION_KEY ?? deriveDevSecret('encryption'),
    cookieSecret: raw.COOKIE_SECRET ?? deriveDevSecret('cookie'),
    passwordPepper: raw.PASSWORD_PEPPER ?? deriveDevSecret('pepper'),
    sessionIdleMinutes: raw.SESSION_IDLE_MINUTES,
    sessionAbsoluteHours: raw.SESSION_ABSOLUTE_HOURS,
    adminSessionIdleMinutes: raw.ADMIN_SESSION_IDLE_MINUTES,
    trustProxy: raw.TRUST_PROXY,
    logLevel: raw.LOG_LEVEL,
    rateLimitGlobalMax: raw.RATE_LIMIT_GLOBAL_MAX,
    rateLimitAuthMax: raw.RATE_LIMIT_AUTH_MAX,
    rateLimitPublicMax: raw.RATE_LIMIT_PUBLIC_MAX,
    cookieSecure: raw.COOKIE_SECURE ?? isProduction,
    cookieSameSite: raw.COOKIE_SAME_SITE,
    allowedOrigins: [raw.PUBLIC_ORIGIN, raw.ADMIN_ORIGIN],
  };
}

let cached: AppEnv | null = null;
export function env(): AppEnv {
  if (!cached) cached = loadEnv();
  return cached;
}
