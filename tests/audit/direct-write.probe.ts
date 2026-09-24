/**
 * AUDIT PROBE 3 — can the "balance" a user sees be forged, and does the database
 * stop an overdraft even when the service layer is bypassed?
 *
 * Everything runs against a throwaway migrated PGlite database.
 */
import { createMigratedDatabase, seedMinimal } from '../helpers/database.ts';

const db = await createMigratedDatabase();
await seedMinimal(db);

const wallet = await db.one<{ id: string; public_ref: string; balance_minor: string }>(
  `SELECT w.id, w.public_ref, COALESCE(c.balance_minor, 0)::text AS balance_minor
     FROM prs.wallets w LEFT JOIN prs.wallet_balance_cache c ON c.wallet_id = w.id
    ORDER BY w.created_at LIMIT 1`,
);
console.log(`\n  wallet ${wallet?.public_ref} real balance ${wallet?.balance_minor}`);

/* 1 — is the derived cache directly writable? */
try {
  await db.transaction(async (tx) => {
    await tx.execute('UPDATE prs.wallet_balance_cache SET balance_minor = 999999 WHERE wallet_id = $1', [wallet!.id]);
  });
  const after = await db.one<{ balance_minor: string }>(
    'SELECT balance_minor::text FROM prs.wallet_balance_cache WHERE wallet_id = $1',
    [wallet!.id],
  );
  console.log(`  UPDATE wallet_balance_cache           ALLOWED → now displays ${after?.balance_minor}`);
} catch (error) {
  console.log(`  UPDATE wallet_balance_cache           blocked (${(error as Error).message.slice(0, 60)})`);
}

/* 2 — a raw credit to a wallet account. This is the *issuance* direction, so the
       database allows it; the real question (can an account be driven negative?)
       is answered in database-guarantees.probe.ts, where the posting is a DEBIT. */
const account = await db.one<{ id: string }>('SELECT id FROM prs.accounts WHERE wallet_id = $1', [wallet!.id]);
const sink = await db.one<{ id: string }>(
  `SELECT id FROM prs.accounts WHERE code = '1100'`,
);
try {
  await db.transaction(async (tx) => {
    const lt = await tx.one<{ id: string }>(
      `INSERT INTO prs.ledger_transactions (type, memo) VALUES ('ADJUSTMENT', 'probe') RETURNING id`,
    );
    await tx.execute(
      `INSERT INTO prs.ledger_entries (ledger_transaction_id, account_id, direction, amount_minor, line_no)
       VALUES ($1, $2, 'CREDIT', 500, 1), ($1, $3, 'DEBIT', 500, 2)`,
      [lt!.id, account!.id, sink!.id],
    );
  });
  console.log('  raw credit to a wallet account         ALLOWED (issuance direction, as designed)');
} catch (error) {
  console.log(`  overdraft beyond ledger balance        blocked (${(error as Error).message.split(':')[0]})`);
}

/* 3 — is the forged cache corrected once the ledger moves? */
await db.transaction(async (tx) => {
  await tx.execute(`SELECT prs.refresh_wallet_balance($1)`, [wallet!.id]);
});
const healed = await db.one<{ balance_minor: string }>(
  'SELECT balance_minor::text FROM prs.wallet_balance_cache WHERE wallet_id = $1',
  [wallet!.id],
);
console.log(`  after a ledger refresh, cache shows   ${healed?.balance_minor}`);

/* 4 — can history be truncated? */
for (const table of ['prs.ledger_entries', 'prs.transactions', 'prs.ledger_transactions']) {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(`TRUNCATE ${table} CASCADE`);
    });
    console.log(`  TRUNCATE ${table.padEnd(24)} ALLOWED`);
  } catch (error) {
    console.log(`  TRUNCATE ${table.padEnd(24)} blocked (${(error as Error).message.split(':')[0]})`);
  }
}

/* 5 — can a wallet be reassigned to another profile? */
try {
  const victim = await db.one<{ id: string }>(
    `SELECT p.id FROM prs.profiles p
      WHERE NOT EXISTS (SELECT 1 FROM prs.wallets w WHERE w.profile_id = p.id AND w.is_primary)
      LIMIT 1`,
  );
  await db.transaction(async (tx) => {
    await tx.execute('UPDATE prs.wallets SET profile_id = $1 WHERE id = $2', [victim!.id, wallet!.id]);
  });
  const moved = await db.one<{ profile_id: string }>('SELECT profile_id FROM prs.wallets WHERE id = $1', [wallet!.id]);
  console.log(`  UPDATE wallets.profile_id              ALLOWED → wallet reassigned to ${moved!.profile_id.slice(0, 8)}`);
} catch (error) {
  console.log(`  UPDATE wallets.profile_id              blocked (${(error as Error).message.split(':')[0]})`);
}

await db.destroy();
console.log('');
