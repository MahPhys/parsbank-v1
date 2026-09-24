/**
 * BANK PARS — migration CLI.
 *
 *   npm run db:migrate             apply pending migrations
 *   npm run db:migrate -- --fresh  drop schema prs and rebuild from zero (destructive)
 *   npm run db:migrate -- --status show applied / pending state
 */
import { loadEnv } from '@parsbank/config';
import { getDatabase, closeDatabase } from '../src/db/index.ts';
import { applyMigrations, loadMigrationFiles } from '../src/db/migrate.ts';

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const config = loadEnv();
  const db = await getDatabase(config);
  const version = await db.serverVersion();
  const engine = db.driver === 'pg' ? 'PostgreSQL server' : 'embedded PostgreSQL (PGlite)';

  console.log(`BANK PARS · migrations · ${engine}`);
  console.log(`  ${version.split(' ').slice(0, 2).join(' ')}`);
  console.log(`  target: ${config.databaseUrl ? 'DATABASE_URL' : config.pgliteDir}`);

  if (args.has('--status')) {
    const applied = await db.query<{ version: string; name: string }>(
      'SELECT version, name FROM prs.schema_migrations',
    );
    const appliedVersions = new Set(applied.map((row) => row.version));
    for (const migration of loadMigrationFiles()) {
      console.log(`  ${appliedVersions.has(migration.version) ? '✓' : '•'} ${migration.name}${appliedVersions.has(migration.version) ? '' : ' (pending)'}`);
    }
    await closeDatabase();
    return;
  }

  if (args.has('--fresh')) {
    console.log('\n--fresh: dropping schema prs (destructive)');
  }

  const result = await applyMigrations(db, { fresh: args.has('--fresh'), log: (message) => console.log(message) });

  if (result.applied.length === 0) {
    console.log('\nDatabase is up to date.');
  } else {
    console.log(`\nApplied ${result.applied.length} migration(s).`);
  }

  await closeDatabase();
}

main().catch(async (error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
  await closeDatabase();
});
