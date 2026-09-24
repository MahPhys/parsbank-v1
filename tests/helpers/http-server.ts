/**
 * BANK PARS — HTTP acceptance harness.
 *
 * Boots the real server (same Fastify instance, same routes, same middleware as
 * production) on top of a fresh embedded PostgreSQL, and drives it through
 * `app.inject()` — the same request pipeline a browser would exercise, including
 * cookies, CSRF, rate limiting and the security headers.
 *
 * Nothing about the money paths is stubbed: the acceptance suite talks HTTP, then
 * inspects the ledger through SQL to confirm what the response claimed.
 *
 * The environment is configured *before* the server modules are imported, because
 * the configuration module resolves and caches `process.env` on first use.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../../apps/api/src/db/types.ts';

const sandbox = mkdtempSync(path.join(tmpdir(), 'parspay-accept-'));
process.env.NODE_ENV = 'test';
process.env.PGLITE_DIR = path.join(sandbox, 'pg');
process.env.DATA_DIR = sandbox;
process.env.LOG_LEVEL = 'silent';
process.env.RATE_LIMIT_AUTH_MAX = '500';
process.env.RATE_LIMIT_GLOBAL_MAX = '50000';
process.env.RATE_LIMIT_PUBLIC_MAX = '5000';

export interface TestServer {
  app: FastifyInstance;
  db: Database;
  close: () => Promise<void>;
}

let booted: TestServer | null = null;

/** One server per test file: the module registry (and therefore env) is per-file. */
export async function bootTestServer(): Promise<TestServer> {
  if (booted) return booted;
  const { buildServer } = await import('../../apps/api/src/http/server.ts');
  const { getDatabase } = await import('../../apps/api/src/db/index.ts');
  const { env } = await import('@parsbank/config');
  const { app } = await buildServer();
  const db = await getDatabase(env());
  booted = {
    app,
    db,
    close: async () => {
      await app.close();
      booted = null;
    },
  };
  return booted;
}

export interface InjectOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Send the request without cookies/CSRF — used to prove a session is required. */
  anonymous?: boolean;
}

export interface InjectedResponse<T = Record<string, unknown>> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
}

/**
 * A cookie-keeping client. The console uses the ADMIN audience cookie, members the
 * USER one; passing the wrong one is exactly the behaviour several criteria test.
 */
export class Client {
  private readonly cookies = new Map<string, string>();
  private csrf: string | null = null;

  constructor(private readonly server: TestServer, private readonly audience: 'USER' | 'ADMIN') {}

  get csrfToken(): string | null {
    return this.csrf;
  }

  cookieHeader(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  /** Seeds the browser-equivalent state after a successful login. */
  adoptSession(token: string, csrfToken: string): void {
    const name = this.audience === 'ADMIN' ? 'prs_admin_session' : 'prs_session';
    const csrfName = this.audience === 'ADMIN' ? 'prs_admin_csrf' : 'prs_csrf';
    this.cookies.set(name, token);
    this.cookies.set(csrfName, csrfToken);
    this.csrf = csrfToken;
  }

  async request<T = Record<string, unknown>>(path: string, options: InjectOptions = {}): Promise<InjectedResponse<T>> {
    const method = options.method ?? 'GET';
    const search = options.query
      ? Object.entries(options.query)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
          .join('&')
      : '';
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (!options.anonymous) {
      const cookie = this.cookieHeader();
      if (cookie) headers.cookie = cookie;
      if (method !== 'GET' && this.csrf) headers['x-pars-csrf'] = this.csrf;
    }

    const response = await this.server.app.inject({
      method,
      url: `/api/v1${path}${search ? `?${search}` : ''}`,
      headers,
      payload: options.body as never,
    });

    const setCookie = response.headers['set-cookie'];
    for (const raw of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
      const [pair] = String(raw).split(';');
      const [name, ...rest] = (pair ?? '').split('=');
      if (!name) continue;
      const value = rest.join('=');
      if (value === '') this.cookies.delete(name.trim());
      else this.cookies.set(name.trim(), value);
    }

    let body: T;
    try {
      body = response.json<T>();
    } catch {
      body = { raw: response.body } as T;
    }
    return { status: response.statusCode, body, headers: response.headers as Record<string, unknown> };
  }

  get<T = Record<string, unknown>>(path: string, query?: InjectOptions['query']) {
    return this.request<T>(path, { method: 'GET', query });
  }

  post<T = Record<string, unknown>>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>(path, { method: 'POST', body, headers });
  }

  /** Signs in as an administrator (ADMIN audience) and keeps the CSRF token. */
  async loginAdmin(cardNumber: string, password: string): Promise<InjectedResponse<AdminLoginBody>> {
    const response = await this.request<AdminLoginBody>('/auth/admin/login', { method: 'POST', body: { cardNumber, password } });
    if (response.status === 200) {
      const cookie = this.cookies.get('prs_admin_session');
      this.adoptSession(cookie ?? response.body.csrfToken, response.body.csrfToken);
    }
    return response;
  }

  /** Signs in as a member (USER audience). */
  async loginMember(cardNumber: string, password: string): Promise<InjectedResponse<AdminLoginBody>> {
    const response = await this.request<AdminLoginBody>('/auth/login', { method: 'POST', body: { cardNumber, password } });
    if (response.status === 200) {
      const cookie = this.cookies.get('prs_session');
      this.adoptSession(cookie ?? response.body.csrfToken, response.body.csrfToken);
    }
    return response;
  }
}

export interface AdminLoginBody {
  profileId: string;
  role: string;
  fullNameFa: string;
  audience: string;
  csrfToken: string;
  mustRotatePassword: boolean;
}

export function adminClient(server: TestServer): Client {
  return new Client(server, 'ADMIN');
}

export function memberClient(server: TestServer): Client {
  return new Client(server, 'USER');
}

/** A single row from a scalar query — keeps assertions short and typed. */
export async function scalar(db: Database, sql: string, params: unknown[] = []): Promise<string> {
  const row = await db.one<Record<string, unknown>>(sql, params);
  const value = row ? Object.values(row)[0] : null;
  return value === null || value === undefined ? '' : String(value);
}

export async function scalarNumber(db: Database, sql: string, params: unknown[] = []): Promise<number> {
  return Number(await scalar(db, sql, params));
}

export const ACCEPTANCE_ORIGIN = 'http://localhost:5174';
