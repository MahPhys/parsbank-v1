/**
 * BANK PARS — monetary policy math (pure).
 *
 * Supply definitions, coverage, reference rate, and the issuance/burn/redemption
 * gates. All arithmetic is integer or integer-scaled (rate stored with 8 decimals,
 * matching numeric(18,8) in the database). No floating-point money.
 */
import { DomainError } from './errors.ts';

export interface ReserveItem {
  id: string;
  bookValueUsdMinor: number;
  haircutBps: number; // 0..10000
  eligibility: 'ELIGIBLE' | 'INELIGIBLE' | 'PENDING_REVIEW';
  status: 'ACTIVE' | 'RELEASED' | 'FROZEN' | 'PENDING';
}

export interface MonetaryInputs {
  maxSupplyMinor: number;
  totalIssuedMinor: number;
  circulatingSupplyMinor: number;
  bankHeldMinor: number;
  parValueUsdMinor: number;
  reserves: readonly ReserveItem[];
}

export interface MonetaryDerived {
  treasuryReserveUsdMinor: number;
  eligibleReserveNavUsdMinor: number;
  eligibleReserveCount: number;
  /** eligible NAV / (circulating × par) — 1.00 means 100 % coverage */
  reserveCoverageRatio: number;
  /** PRS per USD, 8 decimals */
  referenceRatePrsPerUsd: number;
  isParityFallback: boolean;
  headroomToMaxSupplyMinor: number;
}

/** Σ book value of active reserves (regardless of eligibility). */
export function totalReserveBookValue(reserves: readonly ReserveItem[]): number {
  return reserves
    .filter((r) => r.status === 'ACTIVE')
    .reduce((sum, r) => sum + Math.max(0, Math.trunc(r.bookValueUsdMinor)), 0);
}

/** Σ (book value × (1 − haircut)) over eligible, active reserves. */
export function eligibleReserveNav(reserves: readonly ReserveItem[]): number {
  return reserves
    .filter((r) => r.status === 'ACTIVE' && r.eligibility === 'ELIGIBLE')
    .reduce((sum, r) => {
      const haircut = Math.min(10000, Math.max(0, Math.trunc(r.haircutBps)));
      return sum + Math.floor((Math.max(0, Math.trunc(r.bookValueUsdMinor)) * (10000 - haircut)) / 10000);
    }, 0);
}

function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

/**
 * Derive the published monetary snapshot.
 *
 * reference rate  = eligible reserve NAV / circulating supply
 * coverage ratio  = eligible reserve NAV / (circulating supply × par value)
 *
 * When nothing circulates, the rate falls back to par and is explicitly flagged —
 * the system never divides by zero to invent a price.
 */
export function deriveMonetaryState(inputs: MonetaryInputs): MonetaryDerived {
  const { maxSupplyMinor, totalIssuedMinor, circulatingSupplyMinor, bankHeldMinor, parValueUsdMinor } = inputs;
  const nav = eligibleReserveNav(inputs.reserves);
  const eligibleReserveCount = inputs.reserves.filter((r) => r.status === 'ACTIVE' && r.eligibility === 'ELIGIBLE').length;

  let referenceRatePrsPerUsd: number;
  let reserveCoverageRatio: number;
  let isParityFallback: boolean;

  if (circulatingSupplyMinor > 0) {
    referenceRatePrsPerUsd = round8(nav / circulatingSupplyMinor);
    // A ratio in the same unit as policy.coverageFloor: 1.0 covers circulating PRS
    // at par exactly. Percentages belong to the presentation layer only.
    reserveCoverageRatio = round8(nav / (circulatingSupplyMinor * Math.max(1, parValueUsdMinor)));
    isParityFallback = false;
  } else {
    referenceRatePrsPerUsd = round8(parValueUsdMinor);
    reserveCoverageRatio = 0;
    isParityFallback = true;
  }

  return {
    treasuryReserveUsdMinor: totalReserveBookValue(inputs.reserves),
    eligibleReserveNavUsdMinor: nav,
    eligibleReserveCount,
    reserveCoverageRatio,
    referenceRatePrsPerUsd,
    isParityFallback,
    headroomToMaxSupplyMinor: Math.max(0, maxSupplyMinor - totalIssuedMinor),
  };
}

export interface IssuancePolicy {
  maxSupplyMinor: number;
  coverageFloor: number; // e.g. 1.0
  parValueUsdMinor: number;
  requireReserve: boolean;
}

export interface IssuanceRequest {
  amountMinor: number;
  reserveContributionUsdMinor: number;
}

/**
 * Gate an issuance request BEFORE any money is created. Throws DomainError with a
 * precise reason; returns the projected state when allowed.
 */
export function assertIssuanceAllowed(
  request: IssuanceRequest,
  policy: IssuancePolicy,
  inputs: MonetaryInputs,
): MonetaryDerived {
  const amount = Math.trunc(request.amountMinor);
  if (amount <= 0) {
    throw new DomainError('INVALID_AMOUNT', { messageEn: 'issuance amount must be positive' });
  }
  if (inputs.totalIssuedMinor + amount > policy.maxSupplyMinor) {
    throw new DomainError('SUPPLY_CAP_EXCEEDED', {
      context: { totalIssuedMinor: inputs.totalIssuedMinor, amount, maxSupplyMinor: policy.maxSupplyMinor },
    });
  }
  if (policy.requireReserve) {
    const required = amount * policy.parValueUsdMinor;
    if (Math.trunc(request.reserveContributionUsdMinor) < required) {
      throw new DomainError('RESERVE_REQUIRED', {
        context: { requiredUsdMinor: required, provided: request.reserveContributionUsdMinor },
      });
    }
  }

  // Project the post-issuance snapshot to test the coverage floor.
  const projectedReserves = [...inputs.reserves];
  if (request.reserveContributionUsdMinor > 0) {
    projectedReserves.push({
      id: 'projected',
      bookValueUsdMinor: Math.trunc(request.reserveContributionUsdMinor),
      haircutBps: 0,
      eligibility: 'ELIGIBLE',
      status: 'ACTIVE',
    });
  }
  const projected = deriveMonetaryState({
    ...inputs,
    totalIssuedMinor: inputs.totalIssuedMinor + amount,
    circulatingSupplyMinor: inputs.circulatingSupplyMinor + amount,
    reserves: projectedReserves,
  });

  if (projected.reserveCoverageRatio < policy.coverageFloor) {
    throw new DomainError('RESERVE_COVERAGE_INSUFFICIENT', {
      context: {
        projectedCoverage: projected.reserveCoverageRatio,
        floor: policy.coverageFloor,
      },
    });
  }

  return projected;
}

/** A burn may not exceed the balance that is actually held by the source. */
export function assertBurnAllowed(
  amountMinor: number,
  sourceBalanceMinor: number,
  totalIssuedMinor: number,
): void {
  const amount = Math.trunc(amountMinor);
  if (amount <= 0) throw new DomainError('INVALID_AMOUNT', { messageEn: 'burn amount must be positive' });
  if (amount > sourceBalanceMinor) throw new DomainError('INSUFFICIENT_FUNDS');
  if (amount > totalIssuedMinor) {
    throw new DomainError('LEDGER_OVERDRAFT', {
      messageEn: 'cannot burn more than the total issued supply',
      context: { amount, totalIssuedMinor },
    });
  }
}

/** Redemption settlement value at a frozen rate (USD cents). */
export function redemptionSettlementUsdMinor(amountMinor: number, frozenRatePrsPerUsd: number): number {
  if (!(frozenRatePrsPerUsd > 0)) {
    throw new DomainError('INTERNAL_ERROR', { messageEn: 'a positive frozen rate is required' });
  }
  const rateScaled = Math.round(frozenRatePrsPerUsd * 1e8);
  return Math.round((Math.trunc(amountMinor) * 100 * 1e8) / rateScaled);
}

/** Headroom of the reserve above a floor, used by the Treasury screens. */
export function coverageHeadroom(
  nav: number,
  circulating: number,
  parValueUsdMinor: number,
  floor: number,
): { requiredNavUsdMinor: number; surplusUsdMinor: number } {
  const requiredNavUsdMinor = Math.ceil(floor * circulating * Math.max(1, parValueUsdMinor));
  return { requiredNavUsdMinor, surplusUsdMinor: nav - requiredNavUsdMinor };
}
