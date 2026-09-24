/**
 * AUDIT PROBE 4 — the two monetary guarantees a hostile SQL writer would test:
 *   (a) can an account be driven negative (overdraft)?
 *   (b) can supply be driven past the 10 000 PRS cap?
 * Both are balanced postings, so only the DEFERRED constraint triggers stand in
 * the way. Run against a throwaway migrated database.
 */
import { createMigratedDatabase, seedMinimal } from '../helpers/database.ts';
import { postPostingSet } from '../../apps/api/src/services/ledger.service.ts';

const db = await createMigratedDatabase();
await seedMinimal(db);

const wallet = await db.one<{ id: string; public_ref: string }>(
  `SELECT w.id, w.public_ref FROM prs.wallets w ORDER BY w.created_at LIMIT 1`,
);
const walletAccount = await db.one<{ id: string; balance: string }>(
  `SELECT a.id, COALESCE(c.balance_minor,0)::text AS balance
     FROM prs.accounts a LEFT JOIN prs.wallet_balance_cache c ON c.wallet_id = a.wallet_id
    WHERE a.wallet_id = $1`,
  [wallet!.id],
);
console.log(`\n  wallet ${wallet!.public_ref} ledger balance ${walletAccount!.balance}`);

/* (a) overdraft: debit the wallet 500 against the currency-in-existence account. */
try {
  await db.transaction(async (tx) => {
    const lt = await tx.one<{ id: string }>(
      `INSERT INTO prs.ledger_transactions (type, memo) VALUES ('ADJUSTMENT', 'probe overdraft') RETURNING id`,
    );
    await tx.execute(
      `INSERT INTO prs.ledger_entries (ledger_transaction_id, account_id, direction, amount_minor, line_no)
       SELECT $1::uuid, $2::uuid, 'DEBIT', 500, 1
       UNION ALL SELECT $1::uuid, id, 'CREDIT', 500, 2 FROM prs.accounts WHERE code = '1100'`,
      [lt!.id, walletAccount!.id],
    );
  });
  console.log('  (a) overdraft a wallet by raw SQL          ALLOWED — money created from nothing');
} catch (error) {
  console.log(`  (a) overdraft a wallet by raw SQL          blocked (${(error as Error).message.split(':')[0]})`);
}

/* (b) supply cap: mint 20 000 PRS — DEBIT the currency-in-existence account,
       CREDIT a wallet. This is the real shape of an issuance. */
try {
  await db.transaction(async (tx) => {
    const lt = await tx.one<{ id: string }>(
      `INSERT INTO prs.ledger_transactions (type, memo) VALUES ('ISSUANCE', 'probe mint') RETURNING id`,
    );
    await tx.execute(
      `INSERT INTO prs.ledger_entries (ledger_transaction_id, account_id, direction, amount_minor, line_no)
       SELECT $1::uuid, id, 'DEBIT', 20000, 1 FROM prs.accounts WHERE code = '1100'
       UNION ALL SELECT $1::uuid, $2::uuid, 'CREDIT', 20000, 2`,
      [lt!.id, walletAccount!.id],
    );
  });
  console.log('  (b) mint past the 10 000 PRS cap           ALLOWED');
} catch (error) {
  console.log(`  (b) mint past the 10 000 PRS cap           blocked (${(error as Error).message.split(':')[0]})`);
}

/* (c) does the service layer refuse the same thing politely? */
try {
  await db.transaction(async (tx) => {
    const account = await db.one<{ id: string; code: string; normal_balance: string; allow_negative: boolean; is_circulating: boolean }>(
      `SELECT id, code, normal_balance, allow_negative, is_circulating FROM prs.accounts WHERE code = '1100'`,
    );
    await postPostingSet(tx as never, {
      set: {
        type: 'ISSUANCE',
        lines: [
          { account: { accountId: account!.id, code: '1100', normalBalance: 'DEBIT', allowNegative: false, isCirculating: false }, direction: 'DEBIT', amountMinor: 20000 },
          { account: { accountId: account!.id, code: '1100', normalBalance: 'DEBIT', allowNegative: false, isCirculating: false }, direction: 'CREDIT', amountMinor: 20000 },
        ],
        memo: 'service-level probe',
      },
      actor: null,
    } as never);
  });
  console.log('  (c) same attempt through the ledger service ALLOWED');
} catch (error) {
  console.log(`  (c) same attempt through the ledger service blocked (${(error as Error).message.split(':')[0]})`);
}

await db.destroy();
console.log('');
