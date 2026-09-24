/**
 * BANK PARS — migration engine (shared by the CLI and the test harness).
 *
 * Migrations are immutable and checksummed: editing an applied file is a fatal
 * error, and schema change always happens through a new versioned file. This is
 * the only sanctioned path for altering the database structure — the business
 * admin UI has no raw-SQL surface at all.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../../../../db/migrations');

export interface MigrationFile {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export function loadMigrationFiles(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => {
      const sql = readFileSync(path.join(dir, file), 'utf8');
      return {
        version: file.split('_')[0]!,
        name: file,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex').slice(0, 32),
      };
    });
}

export interface ApplyResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function applyMigrations(
  db: Database,
  options: { fresh?: boolean; log?: (message: string) => void } = {},
): Promise<ApplyResult> {
  const log = options.log ?? (() => {});

  if (options.fresh) {
    await db.script('DROP SCHEMA IF EXISTS prs CASCADE');
  }

  await db.script(`
    CREATE SCHEMA IF NOT EXISTS prs;
    CREATE TABLE IF NOT EXISTS prs.schema_migrations (
      version     text PRIMARY KEY,
      name        text NOT NULL,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms int NOT NULL DEFAULT 0
    );
  `);

  const existing = await db.query<{ version: string; name: string; checksum: string }>(
    'SELECT version, name, checksum FROM prs.schema_migrations',
  );
  const byVersion = new Map(existing.map((row) => [row.version, row]));

  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  for (const migration of loadMigrationFiles()) {
    const record = byVersion.get(migration.version);
    if (record) {
      if (record.checksum !== migration.checksum) {
        throw new Error(
          `migration ${migration.name} changed after it was applied (checksum mismatch). ` +
            'Migrations are immutable — add a new migration file instead.',
        );
      }
      alreadyApplied.push(migration.name);
      continue;
    }
    const started = Date.now();
    await db.transaction(async (tx) => {
      await tx.script(migration.sql);
      await tx.execute(
        'INSERT INTO prs.schema_migrations (version, name, checksum, duration_ms) VALUES ($1, $2, $3, $4)',
        [migration.version, migration.name, migration.checksum, Date.now() - started],
      );
    });
    applied.push(migration.name);
    log(`  ✓ ${migration.version} ${migration.name} (${Date.now() - started} ms)`);
  }

  return { applied, alreadyApplied };
}
