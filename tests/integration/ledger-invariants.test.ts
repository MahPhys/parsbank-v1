/**
 * BANK PARS — ledger invariant tests.
 *
 * These exercise the DATABASE layer directly (no service code): the deferred
 * constraint triggers must refuse unbalanced sets, overdrafts, supply breaches
 * and any attempt to rewrite history. If these tests pass, a service bug cannot
 * corrupt the money — it can only fail.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTransfer, buildIssuance, buildBurn, assertValidPostingSet } from '@parsbank/domain';
import {
  accountRef,
  createMigratedDatabase,
  seedMinimal,
  walletAccountRef,
  type TestDatabase,
} from '../helpers/database.ts';

let db: TestDatabase;
let seed: Awaited<ReturnType<typeof seedMinimal>>;

beforeAll(async () => {
  db = await createMigratedDatabase();
  seed = await seedMinimal(db);
});

afterAll(async () => {
  await db?.destroy();
});

describe('double-entry ledger invariants (enforced by the database)', () => {
  it('derives balances from the ledger, starting at zero', async () => {
    const balance = await db.one<{ balance_minor: number }>(
      'SELECT balance_minor FROM prs.wallet_balances WHERE wallet_id = $1',
      [seed.userWalletId],
    );
    expect(Number(balance?.balance_minor)).toBe(0);
  });

  it('rejects an unbalanced posting set at COMMIT (L1)', async () => {
    const sender = await walletAccountRef(db, seed.userWalletId);
    await expect(
      db.transaction(async (tx) => {
        const ledgerTx = await tx.one<{ id: string }>(
          `INSERT INTO prs.ledger_transactions (type, reason)
           VALUES ('TRANSFER', 'test unbalanced') RETURNING id`,
        );
        await tx.execute(
          `INSERT INTO prs.ledger_entries (ledger_transaction_id, account_id, direction, amount_minor, line_no)
           VALUES ($1, $2, 'DEBIT', 100, 1)`,
          [ledgerTx!.id, sender.accountId],
        );
        // deliberately omit the credit leg
      }),
    ).rejects.toThrow(/LEDGER_INCOMPLETE|LEDGER_UNBALANCED/);
  });

  it('rejects negative balances for accounts that do not allow overdraft (L4)', async () => {
    const sender = await walletAccountRef(db, seed.userWalletId);
    const receiver = await walletAccountRef(db, seed.otherWalletId);

    await expect(
      db.transaction(async (tx) => {
        const ledgerTx = await tx.one<{ id: string }>(
          `INSERT INTO prs.ledger_transactions (type, reason) VALUES ('TRANSFER', 'overdraft attempt') RETURNING id`,
        );
        await tx.execute(
          `INSERT INTO prs.ledger_entries (ledger_transaction_id, account_id, direction, amount_minor, line_no)
           VALUES ($1, $2, 'DEBIT', 500, 1), ($1, $3, 'CREDIT', 500, 2)`,
          [ledgerTx!.id, sender.accountId, receiver.accountId],
        );
      }),
    ).rejects.toThrow(/LEDGER_OVERDRAFT/);
  });

  it('appends history and never allows edits (L2/L3)', async () => {
    const circulation = await accountRef(db, '1100');
    const wallet = await walletAccountRef(db, seed.userWalletId);

    await db.transaction(async (tx) => {
      const set = buildIssuance({
        circulationAccount: circulation,
        destination: wallet,
        amountMinor: 500,
        reason: 'تست اولیه انتشار برای سنجش دفتر کل',
      });
      const ledgerTx = await tx.one<{ id: string }>(
        `INSERT INTO prs.ledger_transactions (type, reason) VALUES ('ISSUANCE', 'test issuance') RETURNING id`,
      );
      let line = 1;
      for (const entry of set.lines) {
        await tx.execute(
          `INSERT INTO prs.ledger_entries (ledger_transaction_id, account_id, direction, amount_minor, line_no)
           VALUES ($1, $2, $3, $4, $5)`,
          [ledgerTx!.id, entry.account.accountId, entry.direction, entry.amountMinor, line++],
        );
      }
    });

    const balance = await db.one<{ balance_minor: number }>(
      'SELECT balance_minor FROM prs.wallet_balances WHERE wallet_id = $1',
      [seed.userWalletId],
    );
    expect(Number(balance?.balance_minor)).toBe(500);

    await expect(
      db.execute(`UPDATE prs.ledger_entries SET amount_minor = 1 WHERE amount_minor = 500`),
    ).rejects.toThrow(/IMMUTABLE_TABLE/);

    await expect(db.execute(`DELETE FROM prs.ledger_entries`)).rejects.toThrow(/IMMUTABLE_TABLE/);
  });

  it('keeps debits equal to credits after a transfer', async () => {
    const circulation = await accountRef(db, '1100');
    const sender = await walletAccountRef(db, seed.userWalletId);
    const receiver = await walletAccountRef(db, seed.otherWalletId);
    void circulation;

    await db.transaction(async (tx) => {
      const set = buildTransfer({ sender, receiver, amountMinor: 120, memo: 'تست انتقال' });
      assertValidPostingSet(set);
      const ledgerTx = await tx.one<{ id: string }>(
        `INSERT INTO prs.ledger_transactions (type, memo) VALUES ('TRANSFER', 'test transfer') RETURNING id`,
      );
      let line = 1;
      for (const entry of set.lines) {
        await tx.execute(
          `INSERT INTO prs.ledger_entries (ledger_transaction_id, account_id, direction, amount_minor, line_no)
           VALUES ($1, $2, $3, $4, $5)`,
          [ledgerTx!.id, entry.account.accountId, entry.direction, entry.amountMinor, line++],
        );
      }
    });

    const totals = await db.one<{ debits: number; credits: number }>(`
      SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_minor ELSE 0 END), 0)::bigint AS debits,
             COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE 0 END), 0)::bigint AS credits
        FROM prs.ledger_entries
    `);
    expect(Number(totals?.debits)).toBe(Number(totals?.credits));

    const senderBalance = await db.one<{ balance_minor: number }>(
      'SELECT balance_minor FROM prs.wallet_balances WHERE wallet_id = $1',
      [seed.userWalletId],
    );
    const receiverBalance = await db.one<{ balance_minor: number }>(
      'SELECT balance_minor FROM prs.wallet_balances WHERE wallet_id = $1',
      [seed.otherWalletId],
    );
    expect(Number(senderBalance?.balance_minor)).toBe(380);
    expect(Number(receiverBalance?.balance_minor)).toBe(120);
  });

  it('refuses to exceed the maximum supply (L5)', async () => {
    const circulation = await accountRef(db, '1100');
    const wallet = await walletAccountRef(db, seed.userWalletId);

    await expect(
      db.transaction(async (tx) => {
        const set = buildIssuance({
          circulationAccount: circulation,
          destination: wallet,
          amountMinor: 9_900, // 500 already issued; cap is 10,000
          reason: 'تلاش برای عبور از سقف عرضه کل',
        });
        const ledgerTx = await tx.one<{ id: string }>(
          `INSERT INTO prs.ledger_transactions (type, reason) VALUES ('ISSUANCE', 'cap breach') RETURNING id`,
        );
        let line = 1;
        for (const entry of set.lines) {
          await tx.execute(
            `INSERT INTO prs.ledger_entries (ledger_transaction_id, account_id, direction, amount_minor, line_no)
             VALUES ($1, $2, $3, $4, $5)`,
            [ledgerTx!.id, entry.account.accountId, entry.direction, entry.amountMinor, line++],
          );
        }
      }),
    ).rejects.toThrow(/SUPPLY_CAP_EXCEEDED/);

    const supply = await db.one<{ total_issued_minor: number; circulating_supply_minor: number; bank_held_minor: number }>(
      'SELECT * FROM prs.supply_summary',
    );
    expect(Number(supply?.total_issued_minor)).toBe(500);
    expect(Number(supply?.circulating_supply_minor) + Number(supply?.bank_held_minor)).toBe(500);
  });

  it('burns via new ledger entries and reduces supply without deleting history', async () => {
    const circulation = await accountRef(db, '1100');
    const wallet = await walletAccountRef(db, seed.otherWalletId);

    const before = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM prs.ledger_entries');

    await db.transaction(async (tx) => {
      const set = buildBurn({
        circulationAccount: circulation,
        source: wallet,
        amountMinor: 20,
        reason: 'امحای آزمایشی بخشی از عرضه',
      });
      const ledgerTx = await tx.one<{ id: string }>(
        `INSERT INTO prs.ledger_transactions (type, reason) VALUES ('BURN', 'test burn') RETURNING id`,
      );
      let line = 1;
      for (const entry of set.lines) {
        await tx.execute(
          `INSERT INTO prs.ledger_entries (ledger_transaction_id, account_id, direction, amount_minor, line_no)
           VALUES ($1, $2, $3, $4, $5)`,
          [ledgerTx!.id, entry.account.accountId, entry.direction, entry.amountMinor, line++],
        );
      }
    });

    const supply = await db.one<{ total_issued_minor: number }>('SELECT total_issued_minor FROM prs.supply_summary');
    expect(Number(supply?.total_issued_minor)).toBe(480);

    const after = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM prs.ledger_entries');
    expect(Number(after?.count)).toBeGreaterThan(Number(before?.count));
  });

  it('reports a clean bill of health from prs.check_monetary_integrity()', async () => {
    const findings = await db.query<{ check_code: string; severity: string; detail: string }>(
      'SELECT * FROM prs.check_monetary_integrity()',
    );
    expect(findings).toEqual([]);
  });
});
