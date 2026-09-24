/**
 * BANK PARS — human-facing identifiers.
 *
 * Transaction references are random (not sequential): the institution's volume is
 * never enumerable from a receipt. Public refs for profiles/wallets are padded
 * counters derived from the row's own sequence, generated on insert.
 */
import { randomBase32 } from './crypto.ts';

export function transactionReference(): string {
  return `PRS-TRX-${randomBase32(10)}`;
}

export function issuanceReference(): string {
  return `PRS-ISS-${randomBase32(8)}`;
}

export function burnReference(): string {
  return `PRS-BRN-${randomBase32(8)}`;
}

export function redemptionReference(): string {
  return `PRS-RDM-${randomBase32(8)}`;
}

export function adminActionReference(): string {
  return `PRS-ACT-${randomBase32(8)}`;
}

export function paymentSessionReference(): string {
  return `PRS-QRS-${randomBase32(8)}`;
}

export function batchCode(value: number): string {
  return String(value).padStart(4, '0');
}
