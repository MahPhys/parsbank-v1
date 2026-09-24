/**
 * BANK PARS — database factory.
 */
import { DomainError } from '@parsbank/domain';
import type { AppEnv } from '@parsbank/config';
import { isPgError, PG_ERRORS, type Database } from './types.ts';
import { createPgliteDatabase } from './pglite-driver.ts';
import { createPgDatabase } from './pg-driver.ts';

export * from './types.ts';

let instance: Database | null = null;

export async function getDatabase(config: AppEnv): Promise<Database> {
  if (instance) return instance;
  instance = config.databaseUrl
    ? await createPgDatabase(config.databaseUrl, { max: 10 })
    : await createPgliteDatabase(config.pgliteDir);
  return instance;
}

export async function closeDatabase(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}

/** True when a concurrent transaction failed and the operation is worth retrying. */
export function isRetryable(error: unknown): boolean {
  return isPgError(error) && (error.code === PG_ERRORS.SERIALIZATION_FAILURE || error.code === PG_ERRORS.DEADLOCK_DETECTED);
}

/**
 * Maps low-level database failures onto domain errors. Called at the service
 * boundary so that raw PostgreSQL messages never reach a client.
 */
export function translateDatabaseError(error: unknown): never {
  if (error instanceof DomainError) throw error;
  if (isPgError(error)) {
    const message = String(error.message ?? '');
    // A malformed identifier (usually a non-uuid where a uuid is expected) is a
    // caller mistake, not a server fault. Mapping it to a validation failure keeps
    // internal schema details and stack traces out of the response.
    if (error.code === PG_ERRORS.INVALID_TEXT_REPRESENTATION) {
      throw new DomainError('VALIDATION_FAILED', {
        messageEn: 'malformed identifier',
        fields: [{ path: 'id', message: 'شناسهٔ ارسالی معتبر نیست.' }],
      });
    }
    if (error.code === PG_ERRORS.UNIQUE_VIOLATION) {
      if (error.constraint?.includes('idempotency')) {
        throw new DomainError('DUPLICATE_IDEMPOTENCY_KEY', { context: { constraint: error.constraint } });
      }
      throw new DomainError('VALIDATION_FAILED', { messageEn: 'duplicate record' });
    }
    if (error.code === PG_ERRORS.CHECK_VIOLATION || error.code === PG_ERRORS.RESTRICT_VIOLATION) {
      if (message.includes('LEDGER_UNBALANCED')) throw new DomainError('LEDGER_UNBALANCED');
      if (message.includes('LEDGER_OVERDRAFT')) throw new DomainError('LEDGER_OVERDRAFT');
      if (message.includes('SUPPLY_CAP_EXCEEDED')) throw new DomainError('SUPPLY_CAP_EXCEEDED');
      if (message.includes('SUPPLY_NEGATIVE')) throw new DomainError('LEDGER_OVERDRAFT');
      if (message.includes('IMMUTABLE_TABLE')) throw new DomainError('IMMUTABLE_RECORD');
      throw new DomainError('VALIDATION_FAILED', { messageEn: 'database constraint rejected the operation' });
    }
    if (error.code === PG_ERRORS.SERIALIZATION_FAILURE || error.code === PG_ERRORS.DEADLOCK_DETECTED) {
      throw new DomainError('CONCURRENCY_CONFLICT');
    }
  }
  throw error;
}
