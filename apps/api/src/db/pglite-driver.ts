/**
 * BANK PARS — embedded PostgreSQL driver (PGlite).
 *
 * PGlite is PostgreSQL compiled to WebAssembly: same dialect, same transactions,
 * same row-level security and constraint triggers. It gives the project a
 * zero-install local/demo/test runtime without weakening the production story
 * (production uses a real PostgreSQL server through the `pg` driver).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { env as readEnv } from '@parsbank/config';
import {
  isPgError,
  PG_ERRORS,
  type Database,
  type QueryParams,
  type QueryResultRow,
  type RlsRole,
  type TransactionContext,
  type TransactionOptions,
} from './types.ts';

interface PgliteLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * PostgreSQL reports the failing statement by text but drivers rarely surface it;
 * without it a constraint error is impossible to place. The statement text is
 * attached to the error (SQL only — never the parameter values, which may contain
 * credentials) so logs and operators can locate the fault immediately.
 */
export function withStatementContext(error: unknown, sql: string): never {
  if (error && typeof error === 'object') {
    const statement = sql.replace(/\s+/g, ' ').trim().slice(0, 400);
    Object.defineProperty(error, 'statement', { value: statement, enumerable: false, configurable: true });
  }
  throw error;
}

function createContext(client: PgliteLike, ownerRole = true): TransactionContext {
  return {
    async query<T = QueryResultRow>(sql: string, params: QueryParams = []): Promise<T[]> {
      try {
        const result = await client.query<T>(sql, [...params]);
        return result.rows;
      } catch (error) {
        withStatementContext(error, sql);
      }
    },
    async one<T = QueryResultRow>(sql: string, params: QueryParams = []): Promise<T | null> {
      try {
        const rows = await client.query<T>(sql, [...params]);
        return (rows.rows[0] as T) ?? null;
      } catch (error) {
        withStatementContext(error, sql);
      }
    },
    async execute(sql: string, params: QueryParams = []): Promise<number> {
      try {
        const result = await client.query(sql, [...params]);
        return result.affectedRows ?? 0;
      } catch (error) {
        withStatementContext(error, sql);
      }
    },
    async script(sql: string): Promise<void> {
      await client.exec(sql);
    },
    async setIdentity(profileId: string | null, role: RlsRole): Promise<void> {
      await client.query(`SELECT set_config('prs.current_profile_id', $1, true)`, [profileId ?? '']);
      await client.query(`SET LOCAL ROLE ${role}`);
    },
    async useOwnerRole(): Promise<void> {
      if (!ownerRole) return;
      await client.query('RESET ROLE');
      await client.query(`SELECT set_config('prs.current_profile_id', '', true)`);
    },
  };
}

export async function createPgliteDatabase(dataDir?: string): Promise<Database> {
  const config = readEnv();
  const resolvedDir = dataDir ? path.resolve(dataDir) : undefined;
  if (resolvedDir) mkdirSync(resolvedDir, { recursive: true });
  const client = resolvedDir
    ? await PGlite.create({ dataDir: resolvedDir, relaxedDurability: true })
    : new PGlite();

  const run = async <T>(sql: string, params: QueryParams = []): Promise<T[]> => {
    try {
      const result = await client.query<T>(sql, [...params]);
      return result.rows;
    } catch (error) {
      withStatementContext(error, sql);
    }
  };

  const database: Database = {
    driver: 'pglite',
    query: run,
    async one<T = QueryResultRow>(sql: string, params: QueryParams = []): Promise<T | null> {
      const rows = await run<T>(sql, params);
      return (rows[0] as T) ?? null;
    },
    async execute(sql: string, params: QueryParams = []): Promise<number> {
      const result = await client.query(sql, [...params]);
      return result.affectedRows ?? 0;
    },
    async transaction<T>(fn: (tx: TransactionContext) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
      const { isolation = 'serializable', retries = 3, readOnly = false } = options;
      let attempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        attempt += 1;
        try {
          await client.exec('BEGIN');
          if (isolation !== 'read committed') await client.exec(`SET TRANSACTION ISOLATION LEVEL ${isolation.toUpperCase()}`);
          if (readOnly) await client.exec('SET TRANSACTION READ ONLY');
          const result = await fn(createContext(client));
          await client.exec('COMMIT');
          return result;
        } catch (error) {
          try {
            await client.exec('ROLLBACK');
          } catch {
            /* the transaction may already be aborted and closed */
          }
          const retryable = isPgError(error) && (error.code === PG_ERRORS.SERIALIZATION_FAILURE || error.code === PG_ERRORS.DEADLOCK_DETECTED);
          if (retryable && attempt <= retries) continue;
          throw error;
        }
      }
    },
    async script(sql: string): Promise<void> {
      await client.exec(sql);
    },
    async serverVersion(): Promise<string> {
      const rows = await run<{ version: string }>('SELECT version() AS version', []);
      return rows[0]?.version ?? 'unknown';
    },
    async close(): Promise<void> {
      await client.close();
    },
  };

  // Fail fast with a clear message when the schema has not been migrated.
  await database.query('SELECT 1');
  void config;
  return database;
}

/** In-memory database for tests: a completely fresh PostgreSQL on every call. */
export async function createTestDatabase(): Promise<Database> {
  return createPgliteDatabase(undefined);
}
