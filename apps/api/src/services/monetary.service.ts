/**
 * BANK PARS — monetary state service.
 *
 * Reads the published snapshot and triggers server-side recomputation. Clients
 * never supply a rate, a supply figure or a reserve value: they may only READ the
 * last snapshot the server computed and stored.
 */
import type { MonetarySnapshot } from '@parsbank/types';
import type { Database, TransactionContext } from '../db/types.ts';
import {
  deriveMonetaryState,
  type MonetaryDerived,
  type MonetaryInputs,
  type ReserveItem,
} from '@parsbank/domain';

export async function loadMonetaryInputs(db: Database): Promise<MonetaryInputs> {
  const supply = await db.one<{
    total_issued_minor: string;
    circulating_supply_minor: string;
    bank_held_minor: string;
  }>('SELECT total_issued_minor::text, circulating_supply_minor::text, bank_held_minor::text FROM prs.supply_summary');

  const settings = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM prs.system_settings WHERE key IN ('max_supply_minor', 'policy.par_value_usd_minor')`,
  );
  const map = new Map(settings.map((row) => [row.key, Number(row.value as string)]));

  const reserves = await db.query<{
    id: string;
    book_value_usd_minor: string;
    haircut_bps: number;
    eligibility: ReserveItem['eligibility'];
    status: ReserveItem['status'];
  }>('SELECT id, book_value_usd_minor::text, haircut_bps, eligibility, status FROM prs.treasury_reserves');

  return {
    maxSupplyMinor: map.get('max_supply_minor') ?? 10_000,
    totalIssuedMinor: Number(supply?.total_issued_minor ?? 0),
    circulatingSupplyMinor: Number(supply?.circulating_supply_minor ?? 0),
    bankHeldMinor: Number(supply?.bank_held_minor ?? 0),
    parValueUsdMinor: map.get('policy.par_value_usd_minor') ?? 100,
    reserves: reserves.map((row) => ({
      id: row.id,
      bookValueUsdMinor: Number(row.book_value_usd_minor),
      haircutBps: row.haircut_bps,
      eligibility: row.eligibility,
      status: row.status,
    })),
  };
}

/** Recomputes the snapshot inside a transaction and appends valuation history. */
export async function refreshMonetaryState(
  tx: TransactionContext,
  actorProfileId: string | null,
  reasons: string[],
): Promise<void> {
  await tx.execute(`SELECT prs.refresh_monetary_state($1, $2)`, [actorProfileId, reasons]);
}

export async function getMonetarySnapshot(db: Database): Promise<MonetarySnapshot | null> {
  const row = await db.one<Record<string, string | number | boolean>>(
    `SELECT max_supply_minor, total_issued_minor, circulating_supply_minor, bank_held_minor,
            treasury_reserve_usd_minor, eligible_reserve_nav_usd_minor, reserve_coverage_ratio,
            reference_rate_prs_per_usd, par_value_usd_minor, is_parity_fallback, as_of, ledger_sequence
       FROM prs.monetary_state WHERE id = 1`,
  );
  if (!row) return null;
  return {
    maxSupplyMinor: Number(row.max_supply_minor),
    totalIssuedMinor: Number(row.total_issued_minor),
    circulatingSupplyMinor: Number(row.circulating_supply_minor),
    bankHeldMinor: Number(row.bank_held_minor),
    treasuryReserveUsdMinor: Number(row.treasury_reserve_usd_minor),
    eligibleReserveNavUsdMinor: Number(row.eligible_reserve_nav_usd_minor),
    reserveCoverageRatio: Number(row.reserve_coverage_ratio),
    referenceRatePrsPerUsd: Number(row.reference_rate_prs_per_usd),
    parValueUsdMinor: Number(row.par_value_usd_minor),
    isParityFallback: Boolean(row.is_parity_fallback),
    asOf: new Date(row.as_of as string).toISOString(),
    ledgerSequence: Number(row.ledger_sequence),
  };
}

/** Latest published rate (immutable snapshot), used to value receipts in USD. */
export async function latestReferenceRate(db: Database): Promise<number | null> {
  const row = await db.one<{ rate_prs_per_usd: string }>(
    `SELECT rate_prs_per_usd::text FROM prs.exchange_rates ORDER BY effective_at DESC, id DESC LIMIT 1`,
  );
  return row ? Number(row.rate_prs_per_usd) : null;
}

/** Pure projection used by the Treasury screens before an action is committed. */
export function projectMonetaryState(inputs: MonetaryInputs): MonetaryDerived {
  return deriveMonetaryState(inputs);
}

export async function valuationHistory(db: Database, limit = 50): Promise<Record<string, unknown>[]> {
  return db.query(
    `SELECT id, as_of, ledger_sequence, total_issued_minor, circulating_supply_minor, bank_held_minor,
            treasury_reserve_usd_minor, eligible_reserve_nav_usd_minor, reserve_coverage_ratio,
            reference_rate_prs_per_usd, eligible_reserve_count, reasons
       FROM prs.reserve_valuations ORDER BY as_of DESC LIMIT $1`,
    [limit],
  );
}

export async function rateHistory(db: Database, limit = 50): Promise<Record<string, unknown>[]> {
  return db.query(
    `SELECT id, base_currency, quote_currency, rate_prs_per_usd, inverse_rate_usd_per_prs, source,
            is_parity_fallback, effective_at, note
       FROM prs.exchange_rates ORDER BY effective_at DESC, id DESC LIMIT $1`,
    [limit],
  );
}
