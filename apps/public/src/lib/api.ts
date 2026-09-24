/**
 * BANK PARS — public application API client.
 *
 * Rules this client follows, without exception:
 *   • every call is same-origin and relative — the browser never learns an internal
 *     host name and the session cookie is never sent cross-site;
 *   • state-changing calls carry the CSRF token in a header (double submit);
 *   • money-moving calls carry an Idempotency-Key so a retry cannot duplicate money;
 *   • nothing here computes a balance, a rate or a coverage ratio. Those are read
 *     from the server and displayed as received.
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

  constructor(status: number, body: Partial<ApiErrorBody> & { code?: string }) {
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

/** The session layer owns the token; the client only echoes it. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

/** A fresh idempotency key per money movement attempt (UUID v4 when available). */
export function newIdempotencyKey(prefix = 'ui'): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}.${random}.${Math.random().toString(36).slice(2, 8)}`;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Set when a route is public and must not send the CSRF header. */
  anonymous?: boolean;
}

const BASE = '/api/v1';

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  if (!options.anonymous && method !== 'GET' && csrfToken) headers['X-Pars-CSRF'] = csrfToken;

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const body = (payload ?? {}) as { error?: ApiErrorBody };
    throw new ApiError(response.status, body.error ?? {});
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'POST', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body: body ?? {} }),
};

/** One human sentence for the error banner; field errors stay attached. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.fields.length > 0) {
      return `${error.messageFa} (${error.fields.map((field) => field.message).join(' ')} )`;
    }
    return error.messageFa;
  }
  if (error instanceof Error) return error.message;
  return 'خطای نامشخص.';
}
