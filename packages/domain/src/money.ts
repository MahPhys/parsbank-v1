/**
 * BANK PARS — money arithmetic.
 *
 * Amounts are integer minor units (v1: 1 minor unit = 1 PRS). Floating point is
 * never used for money: every operation here is integer or integer-scaled, and
 * every public function asserts its inputs.
 */
import { MINOR_UNITS_PER_PRS } from '@parsbank/config/constants';
import { DomainError } from './errors.ts';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export function assertIntegerAmount(value: unknown, label = 'مبلغ'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DomainError('INVALID_AMOUNT', { messageEn: `${label} is not a finite number` });
  }
  if (!Number.isInteger(value)) {
    throw new DomainError('AMOUNT_NOT_INTEGER', { messageEn: `${label} must be an integer` });
  }
  if (Math.abs(value) > MAX_SAFE) {
    throw new DomainError('INVALID_AMOUNT', { messageEn: `${label} exceeds the supported range` });
  }
  return value;
}

/** A valid monetary amount: integer, > 0, no fractional PRS. */
export function assertPositiveAmount(value: unknown, label = 'مبلغ'): number {
  const amount = assertIntegerAmount(value, label);
  if (amount <= 0) {
    throw new DomainError('INVALID_AMOUNT', { messageEn: `${label} must be greater than zero` });
  }
  return amount;
}

export function assertNonNegativeAmount(value: unknown, label = 'مبلغ'): number {
  const amount = assertIntegerAmount(value, label);
  if (amount < 0) {
    throw new DomainError('INVALID_AMOUNT', { messageEn: `${label} must not be negative` });
  }
  return amount;
}

/** PRS (whole units) → minor units. v1 is 1:1 but the function documents intent. */
export function toMinor(prs: number): number {
  const value = assertIntegerAmount(prs, 'مبلغ');
  return value * MINOR_UNITS_PER_PRS;
}

/** Integer-safe sum of amounts. */
export function sumMinor(amounts: readonly number[]): number {
  let total = 0;
  for (const amount of amounts) {
    total += assertIntegerAmount(amount, 'مبلغ');
  }
  return total;
}

export function subtractMinor(a: number, b: number): number {
  return assertIntegerAmount(a) - assertIntegerAmount(b);
}

/**
 * Reference USD value of an amount, using a published snapshot rate.
 * Returns integer USD cents. Uses exact integer math:
 *   usdMinor = round(amountMinor * 100 / ratePrsPerUsd)
 */
export function referenceUsdMinor(amountMinor: number, ratePrsPerUsd: number | null | undefined): number | null {
  if (ratePrsPerUsd === null || ratePrsPerUsd === undefined) return null;
  const amount = assertIntegerAmount(amountMinor);
  if (!(ratePrsPerUsd > 0)) return null;
  const rateScaled = Math.round(ratePrsPerUsd * 1e8); // 8 decimals, same as DB numeric(18,8)
  return Math.round((amount * 100 * 1e8) / rateScaled);
}

/** Format for display: "۱٬۲۵۰ پارسه" (Persian digits, thousands separator). */
export function formatPrs(amountMinor: number, options: { persianDigits?: boolean; withUnit?: boolean } = {}): string {
  const { persianDigits = true, withUnit = true } = options;
  const grouped = assertIntegerAmount(amountMinor)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u066C');
  const text = persianDigits ? grouped.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!) : grouped;
  return withUnit ? `${text} پارسه` : text;
}

export function formatUsd(usdMinor: number): string {
  const value = usdMinor / 100;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Classify a ledger entry amount for display purposes (never for accounting). */
export function absoluteDifferences(a: number, b: number): number {
  return Math.abs(assertIntegerAmount(a) - assertIntegerAmount(b));
}
