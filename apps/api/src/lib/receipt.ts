/**
 * BANK PARS — receipt verification codes.
 *
 * A receipt carries a short HMAC-derived code. Any officer can recompute it from
 * the reference to confirm the receipt was issued by this institution; an outsider
 * cannot forge one without the server key.
 */
import { hmacHex } from './crypto.ts';

export function hmacReceiptCode(reference: string, length = 10): string {
  return hmacHex(`receipt:${reference}`)
    .slice(0, length)
    .replace(/(.{5})(?=.)/g, '$1-')
    .toUpperCase();
}

export function verifyReceiptCode(reference: string, code: string): boolean {
  return hmacReceiptCode(reference) === code.trim().toUpperCase();
}
