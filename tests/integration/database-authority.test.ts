/**
 * BANK PARS — database authority (audit findings B-1, B-2, B-3).
 *
 * These are attack tests, not feature tests. Each one tries to do the thing the
 * audit found possible and asserts that the database now refuses it:
 *
 *   B-2  history could be emptied with TRUNCATE (row triggers never fire on it)
 *   B-3  monetary policy, wallet ownership and the derived balance cache were
 *        writable by any SQL statement that could reach the table
 *   B-1  RLS was enabled but never forced, and the request path never set an
 *        identity, so no policy was ever consulted
 *
 * Run against a throwaway migrated database; nothing here touches a live book.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDatabase, seedMinimal, type TestDatabase } from '../helpers/database.ts';
import { claimControlPlane } from '../../apps/api/src/db/control-plane.ts';

let db: TestDatabase;

beforeAll(async () => {
  db = await createMigratedDatabase();
  // Row-level guards only fire on rows, so the book needs a book.
  await seedMinimal(db);
}, 120_000);

afterAll(async () => {
  await db?.destroy();
});

/** Runs the statement in its own transaction; returns the error code, or null. */
async function attempt(sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql, params);
    });
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'UNKNOWN';
  }
}

describe('B-2 · append-only history resists every form of erasure', () => {
  const history = [
    'prs.ledger_entries',
    'prs.ledger_transactions',
    'prs.transactions',
    'prs.audit_logs',
    'prs.card_events',
    'prs.banknote_events',
    'prs.issuances',
    'prs.burns',
    'prs.reserve_valuations',
    'prs.exchange_rates',
  ];

  it.each(history)('%s cannot be truncated', async (table) => {
    expect(await attempt(`TRUNCATE ${table} CASCADE`)).toBe('23514');
  });

  it('refuses to rewrite or delete a row that exists', async () => {
    await db.execute(
      `INSERT INTO prs.audit_logs (action, category, severity, outcome) VALUES ('probe.write','GENERAL','INFO','SUCCESS')`,
    );
    expect(await attempt(`UPDATE prs.audit_logs SET action = 'tampered'`)).toBe('23001');
    expect(await attempt(`DELETE FROM prs.audit_logs`)).toBe('23001');
  });

  it('refuses to rewrite or delete a ledger entry', async () => {
    const wallet = await db.one<{ id: string }>('SELECT id FROM prs.wallets ORDER BY created_at LIMIT 1');
    const account = await db.one<{ id: string }>('SELECT id FROM prs.accounts WHERE wallet_id = $1', [wallet!.id]);
    const ledgerTx = await db.one<{ id: string }>(
      `INSERT INTO prs.ledger_transactions (type, memo) VALUES ('ADJUSTMENT', 'probe') RETURNING id`,
    );
    await db.execute(
      `INSERT INTO prs.ledger_entries (ledger_transaction_id, account_id, direction, amount_minor, line_no)
       VALUES ($1, $2, 'CREDIT', 5, 1), ($1, (SELECT id FROM prs.accounts WHERE code = '1100'), 'DEBIT', 5, 2)`,
      [ledgerTx!.id, account!.id],
    );
    expect(await attempt(`UPDATE prs.ledger_entries SET amount_minor = 9999`)).toBe('23001');
    expect(await attempt(`DELETE FROM prs.ledger_entries`)).toBe('23001');
  });
});

describe('B-3 · the control plane is not reachable by ordinary SQL', () => {
  it('refuses a direct monetary policy change', async () => {
    expect(await attempt(`UPDATE prs.system_settings SET value = '"99999"' WHERE key = 'max_supply_minor'`)).toBe('42501');
  });

  it('refuses a direct feature-flag change', async () => {
    expect(await attempt(`UPDATE prs.feature_flags SET enabled = false`)).toBe('42501');
  });

  it('refuses a direct wallet ownership change', async () => {
    // The unique constraint on primary wallets would also fire; the guard runs first,
    // which is the point — ownership is not a writable field.
    expect(
      await attempt(`UPDATE prs.wallets SET profile_id = (SELECT id FROM prs.profiles WHERE role = 'SUPER_ADMIN' LIMIT 1)`),
    ).toBe('42501');
  });

  it('refuses a direct write to the derived balance cache', async () => {
    expect(await attempt(`UPDATE prs.wallet_balance_cache SET balance_minor = 999999`)).toBe('42501');
  });

  it('allows the approved path to change policy', async () => {
    const code = await attempt(`UPDATE prs.system_settings SET value = '"9000"' WHERE key = 'max_supply_minor'`);
    expect(code).toBe('42501');

    // The same statement inside a transaction that has declared itself the control
    // plane — which only the approval executor and the settings service ever do.
    await db.transaction(async (tx) => {
      await claimControlPlane(tx);
      await tx.execute(`UPDATE prs.system_settings SET value = '"9000"' WHERE key = 'max_supply_minor'`);
    });

    const row = await db.one<{ value: unknown }>(`SELECT value FROM prs.system_settings WHERE key = 'max_supply_minor'`);
    expect(String(row?.value)).toBe('9000');
  });

  it('still lets the ledger maintain its own cache, and the cache agrees with the ledger', async () => {
    const wallet = await db.one<{ id: string }>('SELECT id FROM prs.wallets ORDER BY created_at LIMIT 1');
    await db.transaction(async (tx) => {
      await tx.execute('SELECT prs.refresh_wallet_balance($1)', [wallet!.id]);
    });
    const cache = await db.one<{ balance_minor: string }>(
      'SELECT balance_minor::text FROM prs.wallet_balance_cache WHERE wallet_id = $1',
      [wallet!.id],
    );
    const ledger = await db.one<{ balance: string }>(
      `SELECT COALESCE(SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END), 0)::text AS balance
         FROM prs.ledger_entries e JOIN prs.accounts a ON a.id = e.account_id
        WHERE a.wallet_id = $1`,
      [wallet!.id],
    );
    expect(cache?.balance_minor).toBe(ledger?.balance);
    expect(cache?.balance_minor).not.toBe('999999');
  });
});

describe('B-1 · row level security is forced, and binds the requesting identity', () => {
  it('has FORCE on every table that has RLS enabled', async () => {
    const rows = await db.query<{ relname: string }>(`
      SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'prs' AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
       ORDER BY c.relname`);
    expect(rows.map((row) => row.relname)).toEqual([]);
  });

  it('shows a member only their own wallet, and nothing at all without an identity', async () => {
    const owned = await db.one<{ profile_id: string }>(
      `SELECT profile_id FROM prs.wallets ORDER BY created_at LIMIT 1`,
    );

    await db.transaction(async (tx) => {
      await tx.setIdentity(owned!.profile_id, 'pars_app');
      const visible = await tx.query<{ id: string }>('SELECT id FROM prs.wallets');
      const mine = await tx.query<{ id: string }>('SELECT id FROM prs.wallets WHERE profile_id = $1', [owned!.profile_id]);
      expect(visible.length).toBe(mine.length);
      // Every visible wallet is the caller's: no foreign row survives the policy.
      const foreign = await tx.query<{ id: string }>(
        'SELECT id FROM prs.wallets WHERE profile_id <> $1',
        [owned!.profile_id],
      );
      expect(foreign.length).toBe(0);
    });

    await db.transaction(async (tx) => {
      await tx.setIdentity(null, 'pars_app');
      const none = await tx.query<{ id: string }>('SELECT id FROM prs.wallets');
      expect(none.length).toBe(0);
    });
  });

  it('keeps another member ledger lines invisible', async () => {
    const wallets = await db.query<{ id: string; profile_id: string }>(
      'SELECT id, profile_id FROM prs.wallets ORDER BY created_at LIMIT 2',
    );
    const [mine, theirs] = wallets;
    expect(mine && theirs).toBeTruthy();
    // One entry on my wallet, one on theirs, both balanced against 1100.
    for (const wallet of [mine!, theirs!]) {
      const account = await db.one<{ id: string }>('SELECT id FROM prs.accounts WHERE wallet_id = $1', [wallet.id]);
      const ledgerTx = await db.one<{ id: string }>(
        `INSERT INTO prs.ledger_transactions (type, memo) VALUES ('ADJUSTMENT', 'visibility probe') RETURNING id`,
      );
      await db.execute(
        `INSERT INTO prs.ledger_entries (ledger_transaction_id, account_id, direction, amount_minor, line_no)
         VALUES ($1, $2, 'CREDIT', 3, 1), ($1, (SELECT id FROM prs.accounts WHERE code = '1100'), 'DEBIT', 3, 2)`,
        [ledgerTx!.id, account!.id],
      );
    }

    await db.transaction(async (tx) => {
      await tx.setIdentity(mine!.profile_id, 'pars_app');
      const visible = await tx.query<{ account_id: string }>('SELECT account_id FROM prs.ledger_entries');
      const ownAccounts = await tx.query<{ id: string }>('SELECT id FROM prs.accounts WHERE wallet_id = $1', [mine!.id]);
      const own = new Set(ownAccounts.map((row) => row.id));
      expect(visible.length).toBeGreaterThan(0);
      expect(visible.every((row) => own.has(row.account_id))).toBe(true);
    });
  });
});
