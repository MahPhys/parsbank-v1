/**
 * BANK PARS — database abstraction.
 *
 * Two drivers, one identical PostgreSQL dialect:
 *   • `pg`        — production / docker-compose (DATABASE_URL)
 *   • `@electric-sql/pglite` — embedded PostgreSQL for local runs, demo and tests
 *
 * Services depend on this interface only; they never know which engine is under
 * them, and no service ever builds SQL by string concatenation of user input.
 */

export type QueryParams = readonly unknown[];

export interface QueryResultRow {
  [column: string]: unknown;
}

export interface TransactionContext {
  query<T = QueryResultRow>(sql: string, params?: QueryParams): Promise<T[]>;
  one<T = QueryResultRow>(sql: string, params?: QueryParams): Promise<T | null>;
  execute(sql: string, params?: QueryParams): Promise<number>;
  /** Runs a multi-statement SQL script inside the transaction (migrations only). */
  script(sql: string): Promise<void>;
  /** Sets the RLS identity for the remainder of the transaction (never global). */
  setIdentity(profileId: string | null, role: RlsRole): Promise<void>;
  /** Bypasses RLS for the remainder of the transaction (money / maintenance work). */
  useOwnerRole(): Promise<void>;
}

export type RlsRole = 'pars_app' | 'pars_admin' | 'pars_auditor' | 'pars_design';

export interface Database {
  readonly driver: 'pg' | 'pglite';
  query<T = QueryResultRow>(sql: string, params?: QueryParams): Promise<T[]>;
  one<T = QueryResultRow>(sql: string, params?: QueryParams): Promise<T | null>;
  execute(sql: string, params?: QueryParams): Promise<number>;
  /**
   * Runs `fn` inside a single database transaction.
   * Financial work uses SERIALIZABLE with a bounded retry loop on 40001/40P01.
   */
  transaction<T>(fn: (tx: TransactionContext) => Promise<T>, options?: TransactionOptions): Promise<T>;
  /** Multi-statement script execution (migrations only). */
  script(sql: string): Promise<void>;
  serverVersion(): Promise<string>;
  close(): Promise<void>;
}

export interface TransactionOptions {
  isolation?: 'read committed' | 'repeatable read' | 'serializable';
  retries?: number;
  readOnly?: boolean;
}

/** Postgres error codes we translate rather than leak. */
export const PG_ERRORS = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  RESTRICT_VIOLATION: '23001',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  INSUFFICIENT_PRIVILEGE: '42501',
  INVALID_TRANSACTION_STATE: '25P02',
  INVALID_TEXT_REPRESENTATION: '22P02',
} as const;

export interface PgError {
  code?: string;
  message?: string;
  detail?: string;
  constraint?: string;
}

export function isPgError(error: unknown): error is PgError {
  return typeof error === 'object' && error !== null && 'code' in error;
}
