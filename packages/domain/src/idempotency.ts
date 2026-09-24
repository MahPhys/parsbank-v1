/**
 * BANK PARS — idempotency & replay-protection rules (pure).
 *
 * Rules
 *  1. every money-moving request carries an `Idempotency-Key`;
 *  2. the key is scoped to (initiator, operation) and stored UNIQUE in the DB;
 *  3. the request payload is fingerprinted: replaying a key with a DIFFERENT
 *     payload is an error, not a silent no-op;
 *  4. replaying the identical request returns the ORIGINAL result.
 */
import { DomainError } from './errors.ts';

const KEY_PATTERN = /^[A-Za-z0-9._:\-]{16,80}$/;

export function assertIdempotencyKey(key: unknown): string {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', {
      fields: [{ path: 'headers.Idempotency-Key', message: 'کلید یکتاسازی الزامی است.' }],
    });
  }
  const value = key.trim();
  if (!KEY_PATTERN.test(value)) {
    throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', {
      messageEn: 'idempotency key must be 16-80 chars of [A-Za-z0-9._:-]',
      fields: [{ path: 'headers.Idempotency-Key', message: 'قالب کلید یکتاسازی نامعتبر است.' }],
    });
  }
  return value;
}

/** Deterministic canonical form: key order independent, undefined dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** Fingerprint string that a server-side hash function turns into prs.hex_hash. */
export function fingerprintPayload(operation: string, payload: unknown): string {
  return `${operation}|${canonicalJson(payload)}`;
}

/** Thrown when a key is reused with a different payload. */
export function assertSamePayload(storedFingerprint: string, incomingFingerprint: string): void {
  if (storedFingerprint !== incomingFingerprint) {
    throw new DomainError('IDEMPOTENCY_KEY_REUSED', {
      messageEn: 'idempotency key was already used with a different payload',
    });
  }
}

/** A per-request nonce for admin approvals: single use, short lived. */
export function assertApprovalNonce(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:\-]{16,200}$/.test(value.trim())) {
    throw new DomainError('APPROVAL_NONCE_INVALID', {
      fields: [{ path: 'headers.X-Pars-Approval-Nonce', message: 'توکن تأیید نامعتبر است.' }],
    });
  }
  return value.trim();
}
