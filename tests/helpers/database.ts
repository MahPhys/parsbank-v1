/**
 * BANK PARS — test database harness.
 *
 * Every suite gets a brand-new in-memory PostgreSQL with the full migration set
 * applied. Nothing is mocked: deferred constraint triggers, RLS policies, CHECK
 * constraints and isolation levels behave exactly as they do in production —
 * the only difference is the engine packaging (WASM instead of a server).
 */
import { applyMigrations } from '../../apps/api/src/db/migrate.ts';
import { createTestDatabase } from '../../apps/api/src/db/pglite-driver.ts';
import type { Database } from '../../apps/api/src/db/types.ts';

export interface TestDatabase extends Database {
  /** Test-only teardown. */
  destroy(): Promise<void>;
}

export async function createMigratedDatabase(): Promise<TestDatabase> {
  const db = await createTestDatabase();
  await applyMigrations(db, { fresh: true });
  return Object.assign(db, {
    destroy: async () => {
      await db.close();
    },
  });
}

export async function seedMinimal(db: Database): Promise<{
  adminId: string;
  treasurerId: string;
  auditorId: string;
  designerId: string;
  userId: string;
  userWalletId: string;
  otherUserId: string;
  otherWalletId: string;
  voucherWalletId: string;
}> {
  const profiles = await db.query<{ id: string; role: string }>(`
    INSERT INTO prs.profiles (public_ref, full_name_fa, full_name_en, role, status, mfa_enabled)
    VALUES
      (prs.next_profile_ref(),'مدیر ارشد سامانه','System Administrator','SUPER_ADMIN','ACTIVE',true),
      (prs.next_profile_ref(),'افسر خزانه','Treasury Officer','TREASURY_OFFICER','ACTIVE',true),
      (prs.next_profile_ref(),'حسابرس مستقل','Independent Auditor','AUDITOR','ACTIVE',true),
      (prs.next_profile_ref(),'مدیر طراحی','Design Administrator','DESIGN_ADMIN','ACTIVE',true),
      (prs.next_profile_ref(),'کاربر نمونه','Sample User','USER','ACTIVE',false),
      (prs.next_profile_ref(),'کاربر دوم','Second User','USER','ACTIVE',false)
    RETURNING id, role
  `);

  const byRole = (role: string) => profiles.find((p) => p.role === role)!.id;
  const adminId = byRole('SUPER_ADMIN');
  const treasurerId = byRole('TREASURY_OFFICER');
  const auditorId = byRole('AUDITOR');
  const designerId = byRole('DESIGN_ADMIN');
  const userId = profiles[4]!.id;
  const otherUserId = profiles[5]!.id;

  const wallets = await db.query<{ id: string; profile_id: string; public_ref: string; label_fa: string }>(`
    INSERT INTO prs.wallets (public_ref, profile_id, label_fa, is_primary)
    VALUES
      (prs.next_wallet_ref(), $1, 'کیف پول کاربر نمونه', true),
      (prs.next_wallet_ref(), $2, 'کیف پول کاربر دوم', true),
      (prs.next_wallet_ref(), $1, 'کیف پول آزمایشی', false)
    RETURNING id, profile_id, public_ref, label_fa
  `, [userId, otherUserId]);

  const byLabel = (label: string) => wallets.find((w) => w.label_fa === label)!.id;
  const userWalletId = byLabel('کیف پول کاربر نمونه');
  const otherWalletId = byLabel('کیف پول کاربر دوم');
  const voucherWalletId = byLabel('کیف پول آزمایشی');

  await db.query(`
    INSERT INTO prs.accounts (code, name_fa, name_en, class, kind, normal_balance, allow_negative, is_system, is_circulating, wallet_id)
    SELECT 'WALLET:' || w.id, 'کیف پول', 'Wallet', 'LIABILITY', 'WALLET', 'CREDIT', false, false, true, w.id
      FROM prs.wallets w
  `);

  for (const wallet of [userWalletId, otherWalletId, voucherWalletId]) {
    await db.query('SELECT prs.refresh_wallet_balance($1)', [wallet]);
  }

  return {
    adminId,
    treasurerId,
    auditorId,
    designerId,
    userId,
    userWalletId,
    otherUserId,
    otherWalletId,
    voucherWalletId,
  };
}

/** Resolves the chart-of-accounts rows used by the ledger builders. */
export async function accountRef(db: Database, code: string) {
  const row = await db.one<{
    id: string;
    code: string;
    is_circulating: boolean;
    allow_negative: boolean;
    normal_balance: 'DEBIT' | 'CREDIT';
  }>(
    `SELECT a.id, a.code, a.is_circulating, a.allow_negative, a.normal_balance
       FROM prs.accounts a WHERE a.code = $1`,
    [code],
  );
  if (!row) throw new Error(`account ${code} not found`);
  return {
    accountId: row.id,
    code: row.code,
    isCirculating: row.is_circulating,
    allowNegative: row.allow_negative,
    normalBalance: row.normal_balance,
  };
}

export async function walletAccountRef(db: Database, walletId: string) {
  const row = await db.one<{
    id: string;
    code: string;
    is_circulating: boolean;
    allow_negative: boolean;
    normal_balance: 'DEBIT' | 'CREDIT';
  }>(
    `SELECT a.id, a.code, a.is_circulating, a.allow_negative, a.normal_balance
       FROM prs.accounts a WHERE a.wallet_id = $1`,
    [walletId],
  );
  if (!row) throw new Error(`wallet account for ${walletId} not found`);
  return {
    accountId: row.id,
    code: row.code,
    isCirculating: row.is_circulating,
    allowNegative: row.allow_negative,
    normalBalance: row.normal_balance,
  };
}
