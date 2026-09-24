/**
 * BANK PARS — operations console API client.
 *
 * Three rules shape this file:
 *   • the console NEVER computes a monetary number. Everything shown is what the
 *     server returned; nothing is adjusted, recalculated or patched locally.
 *   • the console cannot change money directly. Money-moving actions are filed as
 *     approval requests and executed by a second administrator.
 *   • a 401 is not retried silently. The session provider hears about it through
 *     the `pars:admin-session-lost` event and returns the operator to the login
 *     screen, because a console that keeps rendering stale figures after its
 *     session died is worse than one that disappears.
 */

export interface ApiErrorBody {
  code: string;
  messageFa: string;
  messageEn?: string;
  fields?: Array<{ path: string; message: string }>;
  requestId?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly messageFa: string;
  readonly fields: Array<{ path: string; message: string }>;
  readonly requestId: string | null;

  constructor(status: number, body: Partial<ApiErrorBody>) {
    super(body.messageFa ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code ?? 'UNKNOWN';
    this.messageFa = body.messageFa ?? 'خطای نامشخص در ارتباط با سرور.';
    this.fields = body.fields ?? [];
    this.requestId = body.requestId ?? null;
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1] ?? '') : null;
}

/** The header value the API expects; cookie first, memory as a fallback. */
export function csrfHeaderValue(): string | null {
  return readCookie('prs_admin_csrf') ?? csrfToken;
}

export function newIdempotencyKey(prefix = 'adm'): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now().toString(36)}-${random}`.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 80);
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  anonymous?: boolean;
  idempotencyKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export const API_BASE = '/api/v1';

export async function adminRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const search = options.query
    ? Object.entries(options.query)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&')
    : '';

  const headers: Record<string, string> = { Accept: 'application/json', ...(options.headers ?? {}) };
  if (options.body !== undefined && method !== 'GET') headers['Content-Type'] = 'application/json';

  if (!options.anonymous) {
    const csrf = csrfHeaderValue();
    if (csrf && method !== 'GET') headers['X-Pars-CSRF'] = csrf;
  }
  if (method !== 'GET') {
    headers['Idempotency-Key'] = options.idempotencyKey ?? newIdempotencyKey();
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}${search ? `?${search}` : ''}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (error) {
    throw new ApiError(0, {
      code: 'NETWORK',
      messageFa: 'ارتباط با سرور برقرار نشد. اتصال شبکه را بررسی کنید.',
      messageEn: error instanceof Error ? error.message : undefined,
    });
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: { code: 'BAD_RESPONSE', messageFa: 'پاسخ سرور قابل خواندن نبود.' } };
    }
  }

  if (!response.ok) {
    const body = (payload as { error?: Partial<ApiErrorBody> } | null)?.error ?? {};
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pars:admin-session-lost'));
    }
    throw new ApiError(response.status, body);
  }

  // Unwrap `{ data: … }` envelopes if a route ever adds one; today routes return the
  // payload directly, so this is a no-op in practice.
  const maybe = payload as { data?: T } | null;
  return (maybe && typeof maybe === 'object' && 'data' in maybe && maybe.data !== undefined ? maybe.data : payload) as T;
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const fieldText = error.fields.map((field) => `${field.path}: ${field.message}`).join(' — ');
    return fieldText ? `${error.messageFa} (${fieldText})` : error.messageFa;
  }
  if (error instanceof Error) return error.message;
  return 'خطای نامشخص.';
}

export function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

/** Convenience façade used by the sections. */
export const adminApi = {
  get: <T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) => adminRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    adminRequest<T>(path, { ...options, method: 'POST', body: body ?? {} }),
};

/** Wraps a mutation so the section can show the server's Persian refusal verbatim. */
export async function attempt<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; message: string; code: string | null }> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, message: describeError(error), code: errorCode(error) };
  }
}
