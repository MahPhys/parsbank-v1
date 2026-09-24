/**
 * BANK PARS — PostgreSQL server driver (production).
 */
import pg from 'pg';
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

const { Pool } = pg;

type PgClient = pg.PoolClient;

function contextFor(client: PgClient): TransactionContext {
  return {
    async query<T = QueryResultRow>(sql: string, params: QueryParams = []): Promise<T[]> {
      const result = await client.query(sql, params as unknown[]);
      return result.rows as T[];
    },
    async one<T = QueryResultRow>(sql: string, params: QueryParams = []): Promise<T | null> {
      const result = await client.query(sql, params as unknown[]);
      return (result.rows[0] as T) ?? null;
    },
    async execute(sql: string, params: QueryParams = []): Promise<number> {
      const result = await client.query(sql, params as unknown[]);
      return result.rowCount ?? 0;
    },
    async script(sql: string): Promise<void> {
      await client.query(sql);
    },
    async setIdentity(profileId: string | null, role: RlsRole): Promise<void> {
      await client.query(`SELECT set_config('prs.current_profile_id', $1, true)`, [profileId ?? '']);
      await client.query(`SELECT set_config('prs.current_role', $1, true)`, [role]);
      await client.query(`SET LOCAL ROLE ${role}`);
    },
    async useOwnerRole(): Promise<void> {
      await client.query('RESET ROLE');
      await client.query(`SELECT set_config('prs.current_profile_id', '', true)`);
      await client.query(`SELECT set_config('prs.current_role', '', true)`);
    },
  };
}

export async function createPgDatabase(connectionString: string, options: { max?: number } = {}): Promise<Database> {
  const pool = new Pool({
    connectionString,
    max: options.max ?? 10,
    application_name: 'bank-pars-api',
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
  });

  return {
    driver: 'pg',
    async query<T = QueryResultRow>(sql: string, params: QueryParams = []): Promise<T[]> {
      const result = await pool.query(sql, params as unknown[]);
      return result.rows as T[];
    },
    async one<T = QueryResultRow>(sql: string, params: QueryParams = []): Promise<T | null> {
      const result = await pool.query(sql, params as unknown[]);
      return (result.rows[0] as T) ?? null;
    },
    async execute(sql: string, params: QueryParams = []): Promise<number> {
      const result = await pool.query(sql, params as unknown[]);
      return result.rowCount ?? 0;
    },
    async transaction<T>(fn: (tx: TransactionContext) => Promise<T>, opts: TransactionOptions = {}): Promise<T> {
      const { isolation = 'serializable', retries = 3, readOnly = false } = opts;
      let attempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        attempt += 1;
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolation.toUpperCase()}`);
          if (readOnly) await client.query('SET TRANSACTION READ ONLY');
          const result = await fn(contextFor(client));
          await client.query('COMMIT');
          return result;
        } catch (error) {
          try {
            await client.query('ROLLBACK');
          } catch {
            /* connection already reset */
          }
          const retryable = isPgError(error) && (error.code === PG_ERRORS.SERIALIZATION_FAILURE || error.code === PG_ERRORS.DEADLOCK_DETECTED);
          if (retryable && attempt <= retries) continue;
          throw error;
        } finally {
          client.release();
        }
      }
    },
    async script(sql: string): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query(sql);
      } finally {
        client.release();
      }
    },
    async serverVersion(): Promise<string> {
      const result = await pool.query('SELECT version() AS version');
      return String(result.rows[0]?.version ?? 'unknown');
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
