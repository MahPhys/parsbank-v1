/**
 * BANK PARS — physical banknote registry rules (pure).
 *
 * Serial format:  PRS-<denom:3>-<batch:4>-<seq:5>-<check:1>
 *   e.g.          PRS-100-0007-00042-K
 *
 * The check character is a weighted mod-37 checksum over the digit groups with the
 * Crookford Base32 alphabet (no I, L, O, U), so a mistyped serial fails before any
 * database lookup happens.
 */
import { BANKNOTE_OUTSTANDING_STATUSES, DENOMINATIONS, type BanknoteStatus } from '@parsbank/config/constants';

export type { BanknoteStatus };
import { DomainError } from './errors.ts';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function isDenomination(value: number): boolean {
  return (DENOMINATIONS as readonly number[]).includes(value);
}

export function assertDenomination(value: number): number {
  if (!isDenomination(value)) {
    throw new DomainError('VALIDATION_FAILED', {
      messageEn: `denomination ${value} is not part of the PRS series (1, 2, 5, 10, 50, 100, 200)`,
    });
  }
  return value;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

export function serialChecksum(denomination: number, batchCode: string, sequence: number): string {
  const payload = `${pad(denomination, 3)}${batchCode}${pad(sequence, 5)}`;
  let acc = 0;
  for (let i = 0; i < payload.length; i += 1) {
    const digit = Number(payload[i]);
    acc += (digit + 1) * (i + 7);
  }
  return ALPHABET[acc % ALPHABET.length]!;
}

export function formatSerial(denomination: number, batchCode: string, sequence: number): string {
  assertDenomination(denomination);
  if (!/^[0-9]{4}$/.test(batchCode)) {
    throw new DomainError('VALIDATION_FAILED', { messageEn: 'batch code must be 4 digits' });
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 99999) {
    throw new DomainError('VALIDATION_FAILED', { messageEn: 'sequence must be between 1 and 99999' });
  }
  const check = serialChecksum(denomination, batchCode, sequence);
  return `PRS-${pad(denomination, 3)}-${batchCode}-${pad(sequence, 5)}-${check}`;
}

export interface ParsedSerial {
  serial: string;
  denomination: number;
  batchCode: string;
  sequence: number;
  check: string;
  valid: boolean;
  reason?: 'FORMAT' | 'DENOMINATION' | 'CHECKSUM';
}

const SERIAL_PATTERN = /^PRS-(\d{3})-(\d{4})-(\d{5})-([0-9A-Z])$/;

/** Parse a serial WITHOUT trusting it. Never throws: verification must always answer. */
export function parseSerial(input: string): ParsedSerial {
  const serial = (input ?? '').trim().toUpperCase();
  const match = SERIAL_PATTERN.exec(serial);
  if (!match) {
    return { serial, denomination: 0, batchCode: '', sequence: 0, check: '', valid: false, reason: 'FORMAT' };
  }
  const denomination = Number(match[1]);
  const batchCode = match[2]!;
  const sequence = Number(match[3]);
  const check = match[4]!;

  if (!isDenomination(denomination)) {
    return { serial, denomination, batchCode, sequence, check, valid: false, reason: 'DENOMINATION' };
  }
  const expected = serialChecksum(denomination, batchCode, sequence);
  if (expected !== check) {
    return { serial, denomination, batchCode, sequence, check, valid: false, reason: 'CHECKSUM' };
  }
  return { serial, denomination, batchCode, sequence, check, valid: true };
}

export function assertValidSerial(input: string): ParsedSerial {
  const parsed = parseSerial(input);
  if (!parsed.valid) {
    throw new DomainError('BANKNOTE_INVALID_SERIAL', {
      context: { reason: parsed.reason },
    });
  }
  return parsed;
}

/* -------------------------------------------------------------------------- */
/* State machine                                                               */
/* -------------------------------------------------------------------------- */

const TRANSITIONS: Record<BanknoteStatus, BanknoteStatus[]> = {
  REGISTERED: ['IN_VAULT', 'ASSIGNED', 'FROZEN', 'DESTROYED', 'RETIRED'],
  IN_VAULT: ['REGISTERED', 'ASSIGNED', 'IN_CIRCULATION', 'FROZEN', 'DESTROYED', 'RETIRED'],
  ASSIGNED: ['IN_CIRCULATION', 'IN_VAULT', 'DEPOSITED', 'FROZEN', 'LOST', 'STOLEN'],
  IN_CIRCULATION: ['IN_VAULT', 'DEPOSITED', 'FROZEN', 'LOST', 'STOLEN'],
  DEPOSITED: ['IN_VAULT', 'ASSIGNED', 'DESTROYED'],
  FROZEN: ['IN_VAULT', 'IN_CIRCULATION', 'DEPOSITED', 'LOST', 'STOLEN', 'DESTROYED'],
  LOST: ['IN_VAULT', 'DEPOSITED', 'FROZEN', 'DESTROYED'],
  STOLEN: ['IN_VAULT', 'DEPOSITED', 'FROZEN', 'DESTROYED'],
  DESTROYED: [],
  RETIRED: [],
};

export function canTransition(from: BanknoteStatus, to: BanknoteStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: BanknoteStatus, to: BanknoteStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainError('BANKNOTE_STATUS_CONFLICT', {
      messageEn: `illegal banknote transition ${from} -> ${to}`,
      context: { from, to },
    });
  }
}

/** Whether the note keeps outstanding monetary value in a given status. */
export function carriesOutstandingValue(status: BanknoteStatus): boolean {
  return BANKNOTE_OUTSTANDING_STATUSES.includes(status);
}

export function isTerminal(status: BanknoteStatus): boolean {
  return status === 'DESTROYED' || status === 'RETIRED';
}

/** Total face value of a set of notes (for registry/ledger reconciliation). */
export function registryFaceValue(notes: ReadonlyArray<{ denominationMinor: number; status: BanknoteStatus }>): number {
  return notes
    .filter((n) => carriesOutstandingValue(n.status))
    .reduce((sum, n) => sum + n.denominationMinor, 0);
}
