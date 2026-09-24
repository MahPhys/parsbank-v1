/**
 * BANK PARS — cryptographic primitives.
 *
 * Rules enforced here:
 *   • passwords / PINs / CVVs are hashed with scrypt (N=2^15, r=8, p=1) + a
 *     per-record random salt and an HMAC-SHA256 pepper held only in the server
 *     environment. Plaintext never reaches the database, a log or a response.
 *   • session tokens, QR tokens and approval nonces are 256-bit random values;
 *     the database stores sha256 hashes only.
 *   • comparisons are constant time.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { env } from '@parsbank/config';

function scrypt(
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 } as const;

/** Base32 alphabet without I, L, O, U (Crookford) for human-safe tokens. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomBase32(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += CROCKFORD[bytes[i]! % 32];
  }
  return out;
}

export function randomDigits(length: number): string {
  let out = '';
  while (out.length < length) {
    out += String(randomInt(0, 10));
  }
  return out;
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacHex(value: string, key = env().passwordPepper): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // Still perform a comparison to keep timing flat.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/* -------------------------------------------------------------------------- */
/* Password / PIN / CVV hashing                                                */
/* -------------------------------------------------------------------------- */

export async function hashSecret(plaintext: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(hmacHex(plaintext), salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_PARAMS.maxmem,
  });
  return [
    'scrypt',
    `N=${SCRYPT_PARAMS.N}`,
    `r=${SCRYPT_PARAMS.r}`,
    `p=${SCRYPT_PARAMS.p}`,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifySecret(plaintext: string, stored: string): Promise<boolean> {
  try {
    const [scheme, nPart, rPart, pPart, saltPart, hashPart] = stored.split('$');
    if (scheme !== 'scrypt' || !nPart || !rPart || !pPart || !saltPart || !hashPart) return false;
    const N = Number(nPart.slice(2));
    const r = Number(rPart.slice(2));
    const p = Number(pPart.slice(2));
    const salt = Buffer.from(saltPart, 'base64url');
    const expected = Buffer.from(hashPart, 'base64url');
    const derived = await scrypt(hmacHex(plaintext), salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_PARAMS.maxmem,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Tokens                                                                      */
/* -------------------------------------------------------------------------- */

export interface OpaqueToken {
  raw: string;
  hash: string;
  prefix: string;
}

/** Session / CSRF tokens: 256 bits, single-use-hash-addressed. */
export function createSessionToken(): OpaqueToken {
  const raw = randomBase32(52);
  return { raw, hash: sha256Hex(raw), prefix: raw.slice(0, 6) };
}

/** Card QR token: `prs1_` + 26 Crookford chars (130 bits). */
export function createCardQrToken(): OpaqueToken {
  const body = randomBase32(26);
  const raw = `prs1_${body}`;
  return { raw, hash: sha256Hex(raw), prefix: `prs1_${body.slice(0, 4)}` };
}

export function createApprovalNonce(): OpaqueToken {
  const raw = randomBase32(40);
  return { raw, hash: sha256Hex(raw), prefix: raw.slice(0, 6) };
}

export function hashToken(raw: string): string {
  return sha256Hex(raw);
}

/* -------------------------------------------------------------------------- */
/* Card material                                                               */
/* -------------------------------------------------------------------------- */

/** 12-digit card number with a Luhn check digit, generated server-side. */
export function generateCardNumber(): string {
  let base = randomDigits(11);
  // Avoid an all-zero body so cards look plausible and never collide with padding.
  if (/^0+$/.test(base)) base = `1${base.slice(1)}`;
  for (let check = 0; check <= 9; check += 1) {
    const candidate = `${base}${check}`;
    if (luhnValid(candidate)) return candidate;
  }
  throw new Error('unable to generate a Luhn-valid card number');
}

function luhnValid(cardNumber: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = cardNumber.length - 1; i >= 0; i -= 1) {
    let value = Number(cardNumber[i]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/** CVV: never stored in clear, never returned after issuance. */
export function generateCvv(): string {
  return randomDigits(3);
}

/** Transaction PIN: returned once to the user, stored as a hash only. */
export function generatePin(): string {
  let pin = randomDigits(4);
  const weak = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321']);
  while (weak.has(pin)) pin = randomDigits(4);
  return pin;
}

/* -------------------------------------------------------------------------- */
/* Second factor (TOTP, RFC 6238) — secret encrypted at rest                    */
/* -------------------------------------------------------------------------- */

export function generateTotpSecret(): string {
  return randomBase32(32);
}

export function totpCode(secret: string, timestamp = Date.now(), step = 30): string {
  const counter = Math.floor(timestamp / 1000 / step);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const key = base32Decode(secret);
  const digest = createHmac('sha1', key).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

/** Accepts the previous, current and next window to tolerate clock drift. */
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  const normalized = (code ?? '').replace(/\D/g, '');
  if (normalized.length !== 6) return false;
  for (const offset of [-1, 0, 1]) {
    if (safeEqual(totpCode(secret, now + offset * 30_000), normalized)) return true;
  }
  return false;
}

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of input.toUpperCase().replace(/=+$/, '')) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

/* -------------------------------------------------------------------------- */
/* Symmetric encryption for stored second-factor secrets                       */
/* -------------------------------------------------------------------------- */

function encryptionKey(): Buffer {
  return createHash('sha256').update(env().appEncryptionKey).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSecret(payload: string): string | null {
  try {
    const [version, ivPart, tagPart, dataPart] = payload.split('.');
    if (version !== 'v1' || !ivPart || !tagPart || !dataPart) return null;
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** IP addresses are only ever stored as salted hashes (privacy by default). */
export function hashIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  return hmacHex(`ip:${ip}`, env().appEncryptionKey);
}

export function randomReference(prefix: string, length = 10): string {
  return `${prefix}-${randomBase32(length)}`;
}
