/**
 * BANK PARS — card rules (pure).
 *
 * Card numbers are 12 digits with a Luhn check digit so that a mistyped number is
 * rejected locally. CVV, PIN and QR tokens are NOT produced here: they are
 * generated and hashed in the server crypto module, and only their hashes ever
 * reach the database.
 */
import { CARD } from '@parsbank/config/constants';
import { DomainError } from './errors.ts';

export const CARD_NUMBER_LENGTH = CARD.numberLength;

/** Luhn checksum over a numeric string. */
export function luhnChecksum(digits: string): number {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (Number.isNaN(value)) return -1;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10;
}

export function isValidLuhn(cardNumber: string): boolean {
  return /^\d+$/.test(cardNumber) && luhnChecksum(cardNumber) === 0;
}

/** Normalise user input: Persian/Arabic digits, spaces and dashes tolerated. */
export function normalizeDigits(input: string): string {
  return (input ?? '')
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\d]/g, '');
}

export function assertCardNumber(input: string): string {
  const digits = normalizeDigits(input);
  if (digits.length !== CARD_NUMBER_LENGTH) {
    throw new DomainError('VALIDATION_FAILED', {
      messageEn: `card number must have ${CARD_NUMBER_LENGTH} digits`,
      fields: [{ path: 'cardNumber', message: 'شماره کارت باید ۱۲ رقم باشد.' }],
    });
  }
  if (!isValidLuhn(digits)) {
    throw new DomainError('VALIDATION_FAILED', {
      messageEn: 'card number failed the Luhn check',
      fields: [{ path: 'cardNumber', message: 'شماره کارت نامعتبر است.' }],
    });
  }
  return digits;
}

export function assertCvv(input: string, cvvLength = CARD.cvvLength): string {
  const digits = normalizeDigits(input);
  if (digits.length !== cvvLength) {
    throw new DomainError('CVV_INVALID', {
      messageEn: `CVV must have ${cvvLength} digits`,
      fields: [{ path: 'cvv', message: 'کد امنیتی باید ۳ رقم باشد.' }],
    });
  }
  return digits;
}

export function assertPin(input: string, pinLength = CARD.pinLength): string {
  const digits = normalizeDigits(input);
  if (digits.length !== pinLength) {
    throw new DomainError('PIN_INVALID', {
      messageEn: `PIN must have ${pinLength} digits`,
      fields: [{ path: 'pin', message: 'رمز کارت باید ۴ رقم باشد.' }],
    });
  }
  const weak = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123']);
  if (weak.has(digits)) {
    throw new DomainError('PIN_INVALID', {
      messageEn: 'PIN is too easy to guess',
      fields: [{ path: 'pin', message: 'این رمز بسیار ساده است؛ رمز دیگری انتخاب کنید.' }],
    });
  }
  return digits;
}

/** 1 PRS = 1 IRR? No — this is a closed internal network: mask for display only. */
export function maskCardNumber(cardNumber: string, options: { keepFirst?: number } = {}): string {
  const digits = normalizeDigits(cardNumber);
  const keep = options.keepFirst ?? 4;
  if (digits.length <= keep) return digits.padStart(digits.length, '•');
  return `${digits.slice(0, keep)} •••• ${digits.slice(-(digits.length - keep - 4 > 0 ? 4 : digits.length - keep))}`;
}

/** Groups a 12-digit number as 4-4-4, as printed on the card. */
export function groupCardNumber(cardNumber: string): string {
  const digits = normalizeDigits(cardNumber);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function formatExpiry(month: number, year: number): string {
  const m = String(month).padStart(2, '0');
  const y = year % 100;
  return `${m}/${String(y).padStart(2, '0')}`;
}

export function isCardExpired(month: number, year: number, now = new Date()): boolean {
  const expiryEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59)); // last day of expiry month
  return expiryEnd.getTime() < now.getTime();
}

/**
 * Build the exact text encoded in the card's QR code.
 * Contains the opaque token and nothing else — no PIN, no CVV, no balance, no id.
 */
export function buildQrPayload(rawToken: string): string {
  return `${CARD.qrPayloadPrefix}${rawToken}`;
}

export function qrSecurePath(rawToken: string): string {
  return `${CARD.securePathPrefix}${rawToken}`;
}

/** Extract a token from a scanned payload or a pasted secure URL. */
export function extractTokenFromScan(input: string): string | null {
  const value = (input ?? '').trim();
  const prefixed = new RegExp(`^${CARD.qrPayloadPrefix}(${CARD.qrTokenPrefix}[0-9A-Z]{26})$`).exec(value);
  if (prefixed) return prefixed[1]!;
  const urlMatch = new RegExp(`${CARD.securePathPrefix}(${CARD.qrTokenPrefix}[0-9A-Z]{26})`).exec(value);
  if (urlMatch) return urlMatch[1]!;
  const bare = new RegExp(`^(${CARD.qrTokenPrefix}[0-9A-Z]{26})$`).exec(value);
  if (bare) return bare[1]!;
  return null;
}

export function assertOpaqueToken(token: string): string {
  const value = (token ?? '').trim();
  if (!new RegExp(`^${CARD.qrTokenPrefix}[0-9A-Z]{26}$`).test(value)) {
    throw new DomainError('QR_TOKEN_INVALID');
  }
  return value;
}
