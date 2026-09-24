/**
 * AUDIT PROBE 2 — corrected.
 *   • mutations are attempted inside a transaction on tables that actually have rows;
 *   • the RLS identity is set inside a transaction, the way the driver intends.
 */
import { createMigratedDatabase, seedMinimal, walletAccountRef } from '../helpers/database.ts';

const db = await createMigratedDatabase();
const ids = await seedMinimal(db);
const line = (label: string, value: unknown) => console.log(`  ${label.padEnd(50)} ${String(value)}`);

// Give the book some content so immutability triggers have rows to fire on.
await db.query(`INSERT INTO prs.audit_logs (action, category, severity, outcome, metadata)
  VALUES ('probe.write','GENERAL','INFO','SUCCESS','{}'::jsonb), ('probe.write2','GENERAL','INFO','SUCCESS','{}'::jsonb)`);

void walletAccountRef;

console.log('\n── trigers present on history tables');
const trigs = await db.query<{ table_name: string; tgname: string; op: string }>(`
  SELECT c.relname AS table_name, t.tgname, t.tgtype::text AS op
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='prs' AND NOT t.tgisinternal
     AND c.relname IN ('ledger_entries','audit_logs','card_events','banknote_events','ledger_transactions','transactions','burns','issuances','redemptions','reserve_valuations')
   ORDER BY c.relname, t.tgname`);
for (const t of trigs) console.log(`      ${t.table_name.padEnd(22)} ${t.tgname}`);

console.log('\n── immutability with rows present (inside a transaction)');
const attempt = async (label: string, sql: string) => {
  try {
    await db.transaction(async (tx) => {
      await tx.query(sql);
    });
    return `${label}: ALLOWED`;
  } catch (error) {
    return `${label}: blocked (${(error as Error).message.split('\n')[0]?.slice(0, 60)})`;
  }
};
console.log('     ', await attempt('UPDATE audit_logs', `UPDATE prs.audit_logs SET action = 'tampered'`));
console.log('     ', await attempt('DELETE audit_logs', `DELETE FROM prs.audit_logs`));
console.log('     ', await attempt('TRUNCATE audit_logs', `TRUNCATE prs.audit_logs`));
console.log('     ', await attempt('UPDATE fees setting', `UPDATE prs.system_settings SET value = '99' WHERE key = 'fees.transfer_fee_minor'`));

console.log('\n── RLS inside a transaction (how the driver intends to use it)');
await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL prs.current_profile_id = '${ids.userId}'`);
  const mine = await tx.query<{ public_ref: string }>('SELECT public_ref FROM prs.wallets');
  console.log(`      as prs_app identity=user  → wallets visible: ${mine.length} (${mine.map((w) => w.public_ref).join(', ')})`);
  const others = await tx.query<{ public_ref: string }>(`SELECT public_ref FROM prs.wallets WHERE public_ref = 'PRS-W-001001'`);
  console.log(`      other user's wallet visible: ${others.length}`);
});
await db.transaction(async (tx) => {
  const unscoped = await tx.query('SELECT public_ref FROM prs.wallets');
  console.log(`      with NO identity set      → wallets visible: ${unscoped.length}`);
});
try {
  await db.transaction(async (tx) => {
    await tx.query(`SET LOCAL ROLE pars_app`);
    await tx.query(`SET LOCAL prs.current_profile_id = '${ids.userId}'`);
    const scoped = await tx.query<{ public_ref: string }>('SELECT public_ref FROM prs.wallets');
    console.log(`      as pars_app identity=user → wallets visible: ${scoped.length}`);
    const w = await tx.query(`SELECT public_ref FROM prs.wallets WHERE public_ref = $1`, ['PRS-W-001001']);
    console.log(`      other wallet via pars_app → ${w.length} rows`);
  });
} catch (error) {
  console.log(`      SET LOCAL ROLE pars_app failed: ${(error as Error).message.slice(0, 90)}`);
}

console.log('\n── who reads the wallet_balance_cache?');
const consumers = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM prs.wallet_balance_cache`);
line('cache rows for seeded wallets', consumers[0]?.n);

await db.destroy();
console.log('');
