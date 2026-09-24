/**
 * BANK PARS — system health.
 *
 * "Health" in a monetary system means: does the ledger still agree with itself,
 * does the note registry reconcile with account 2300, is the balance cache
 * honest, and are the financial controls in the state the institution believes
 * they are in. All of it is computed from the database, never from a cache of a
 * cache.
 */
import type { SystemHealthDto } from '@parsbank/types';
import type { Database } from '../db/types.ts';
import { getMonetarySnapshot } from './monetary.service.ts';

interface IntegrityFinding {
  check_code: string;
  severity: 'WARNING' | 'CRITICAL';
  detail: string;
}

export const APP_VERSION = '1.0.0';

export async function systemHealth(db: Database): Promise<SystemHealthDto> {
  const started = Date.now();
  const version = await db.serverVersion();
  const latencyMs = Date.now() - started;

  const findings = await db.query<IntegrityFinding>('SELECT * FROM prs.check_monetary_integrity()');
  const monetary = await getMonetarySnapshot(db);

  const balances = await db.one<{
    wallets: string;
    circulating: string;
    bank_held: string;
    total_issued: string;
    notes_outstanding: string;
    ledger_notes: string;
    ledger_entries: string;
    transactions: string;
    profiles: string;
    cards: string;
    sessions: string;
    pending_approvals: string;
  }>(`
    SELECT
      (SELECT count(*)::text FROM prs.wallets WHERE status <> 'CLOSED') AS wallets,
      (SELECT circulating_supply_minor::text FROM prs.supply_summary) AS circulating,
      (SELECT bank_held_minor::text FROM prs.supply_summary) AS bank_held,
      (SELECT total_issued_minor::text FROM prs.supply_summary) AS total_issued,
      (SELECT prs.banknote_registry_outstanding()::text) AS notes_outstanding,
      (SELECT prs.account_balance_by_code('2300')::text) AS ledger_notes,
      (SELECT count(*)::text FROM prs.ledger_entries) AS ledger_entries,
      (SELECT count(*)::text FROM prs.transactions) AS transactions,
      (SELECT count(*)::text FROM prs.profiles) AS profiles,
      (SELECT count(*)::text FROM prs.cards WHERE status = 'ACTIVE') AS cards,
      (SELECT count(*)::text FROM prs.sessions WHERE revoked_at IS NULL AND idle_expires_at > now()) AS sessions,
      (SELECT count(*)::text FROM prs.admin_actions WHERE status = 'PENDING') AS pending_approvals
  `);

  const controls = await db.query<{ key: string; value: unknown; label_fa: string }>(
    `SELECT key, value, label_fa FROM prs.system_settings WHERE category = 'financial_controls' ORDER BY key`,
  );

  const critical = findings.filter((finding) => finding.severity === 'CRITICAL');
  const status: SystemHealthDto['status'] = critical.length > 0 ? 'CRITICAL' : findings.length > 0 ? 'DEGRADED' : 'OK';

  const checks: SystemHealthDto['checks'] = [
    {
      code: 'LEDGER_INTEGRITY',
      labelFa: 'یکپارچگی دفتر کل',
      status: critical.length > 0 ? 'CRITICAL' : 'OK',
      detailFa:
        critical.length > 0
          ? critical.map((finding) => `${finding.check_code}: ${finding.detail}`).join(' · ')
          : 'دفتر کل متوازن است و هیچ ناهمخوانی یافت نشد.',
    },
    {
      code: 'SUPPLY',
      labelFa: 'عرضه و سقف',
      status: monetary && monetary.totalIssuedMinor > monetary.maxSupplyMinor ? 'CRITICAL' : 'OK',
      detailFa: monetary
        ? `عرضه کل ${monetary.totalIssuedMinor} از سقف ${monetary.maxSupplyMinor} پارسه`
        : 'وضعیت پولی محاسبه نشده است.',
      value: monetary?.totalIssuedMinor ?? null,
    },
    {
      code: 'RESERVE_COVERAGE',
      labelFa: 'نسبت پوشش پشتوانه',
      status:
        monetary === null
          ? 'WARNING'
          : monetary.isParityFallback
            ? 'WARNING'
            : monetary.reserveCoverageRatio >= 1
              ? 'OK'
              : 'WARNING',
      detailFa: monetary
        ? monetary.isParityFallback
          ? 'هیچ پارسه‌ای در گردش نیست؛ نرخ مرجع بر پایه ارزش اسمی منتشر می‌شود.'
          : `پوشش ${(monetary.reserveCoverageRatio * 100).toFixed(2)}٪ — نرخ مرجع ${monetary.referenceRatePrsPerUsd} پارسه بر دلار`
        : 'وضعیت پشتوانه در دسترس نیست.',
      value: monetary?.reserveCoverageRatio ?? null,
    },
    {
      code: 'BANKNOTE_RECONCILIATION',
      labelFa: 'تطبیق دفتر اسکناس',
      status:
        Number(balances?.notes_outstanding ?? 0) === Number(balances?.ledger_notes ?? 0) ? 'OK' : 'CRITICAL',
      detailFa:
        Number(balances?.notes_outstanding ?? 0) === Number(balances?.ledger_notes ?? 0)
          ? `دفتر اسکناس با حساب ۲۳۰۰ مطابقت دارد (${balances?.notes_outstanding ?? 0} پارسه).`
          : `ناهمخوانی: دفتر اسکناس ${balances?.notes_outstanding ?? 0} در برابر حساب ۲۳۰۰ برابر ${balances?.ledger_notes ?? 0}.`,
      value: Number(balances?.notes_outstanding ?? 0),
    },
    {
      code: 'BALANCE_CACHE',
      labelFa: 'همخوانی حافظه موقت موجودی',
      status: findings.some((finding) => finding.check_code === 'BALANCE_CACHE_DRIFT') ? 'CRITICAL' : 'OK',
      detailFa: 'موجودی‌ها از دفتر کل بازسازی و با حافظه موقت مقایسه می‌شوند.',
    },
    {
      code: 'FINANCIAL_CONTROLS',
      labelFa: 'کنترل‌های مالی',
      status: controls.every((control) => control.value === true) ? 'OK' : 'WARNING',
      detailFa: controls
        .filter((control) => control.value !== true)
        .map((control) => `${control.label_fa}: غیرفعال`)
        .join(' · ') || 'همه کنترل‌های مالی فعال هستند.',
    },
    {
      code: 'PENDING_APPROVALS',
      labelFa: 'تأییدهای در انتظار',
      status: Number(balances?.pending_approvals ?? 0) > 0 ? 'WARNING' : 'OK',
      detailFa: `${balances?.pending_approvals ?? 0} عملیات حساس در انتظار تأیید دوم`,
      value: Number(balances?.pending_approvals ?? 0),
    },
  ];

  return {
    status,
    checks,
    monetary,
    database: {
      driver: db.driver,
      latencyMs,
      version: version.split(' ').slice(0, 2).join(' '),
    },
    version: APP_VERSION,
    generatedAt: new Date().toISOString(),
  };
}

export async function integrityFindings(db: Database): Promise<IntegrityFinding[]> {
  return db.query<IntegrityFinding>('SELECT * FROM prs.check_monetary_integrity()');
}

export interface LedgerAuditReport {
  balanced: boolean;
  totalDebitsMinor: number;
  totalCreditsMinor: number;
  entriesCount: number;
  transactionsCount: number;
  unbalancedPostingSets: Array<{ ledger_transaction_id: string; debits: number; credits: number }>;
  supply: { totalIssuedMinor: number; circulatingSupplyMinor: number; bankHeldMinor: number };
  findings: IntegrityFinding[];
}

/** The institution's own end-to-end audit, exposed to AUDITOR and the CLI. */
export async function auditLedger(db: Database): Promise<LedgerAuditReport> {
  const totals = await db.one<{ debits: string; credits: string; entries: string }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_minor ELSE 0 END),0)::text AS debits,
            COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE 0 END),0)::text AS credits,
            count(*)::text AS entries
       FROM prs.ledger_entries`,
  );

  const unbalanced = await db.query<{ ledger_transaction_id: string; debits: string; credits: string }>(
    `SELECT ledger_transaction_id, debits::text, credits::text FROM (
        SELECT ledger_transaction_id,
               SUM(CASE WHEN direction = 'DEBIT' THEN amount_minor ELSE 0 END) AS debits,
               SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE 0 END) AS credits
          FROM prs.ledger_entries GROUP BY ledger_transaction_id
     ) t WHERE debits <> credits`,
  );

  const supply = await db.one<{ total_issued_minor: string; circulating_supply_minor: string; bank_held_minor: string }>(
    `SELECT total_issued_minor::text, circulating_supply_minor::text, bank_held_minor::text FROM prs.supply_summary`,
  );
  const transactions = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM prs.ledger_transactions');

  return {
    balanced: unbalanced.length === 0 && Number(totals?.debits ?? 0) === Number(totals?.credits ?? 0),
    totalDebitsMinor: Number(totals?.debits ?? 0),
    totalCreditsMinor: Number(totals?.credits ?? 0),
    entriesCount: Number(totals?.entries ?? 0),
    transactionsCount: Number(transactions?.count ?? 0),
    unbalancedPostingSets: unbalanced.map((row) => ({
      ledger_transaction_id: row.ledger_transaction_id,
      debits: Number(row.debits),
      credits: Number(row.credits),
    })),
    supply: {
      totalIssuedMinor: Number(supply?.total_issued_minor ?? 0),
      circulatingSupplyMinor: Number(supply?.circulating_supply_minor ?? 0),
      bankHeldMinor: Number(supply?.bank_held_minor ?? 0),
    },
    findings: await integrityFindings(db),
  };
}
