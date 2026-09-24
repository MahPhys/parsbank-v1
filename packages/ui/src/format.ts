/**
 * @parsbank/ui — presentation formatting.
 *
 * Money is an integer count of PRS. This module is the only place that turns it
 * into a string. It never does arithmetic on money, and it never invents a value
 * the server did not send: the reference USD figure always comes from the API's
 * own `referenceUsdMinor`.
 */

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;

/** `1404` → `۱۴۰۴`. Applied at the very end of every formatting path. */
export function toPersianDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)] ?? digit);
}

/** Normalises Persian/Arabic digits typed by a user into ASCII digits. */
export function normalizeDigits(value: string): string {
  return value
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

function group(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
}

/** `1234` → `۱٬۲۳۴` (PRS, no fractional part in v1). */
export function formatPrs(minor: number | string | null | undefined, withUnit = false): string {
  const amount = Number(minor ?? 0);
  if (!Number.isFinite(amount)) return '—';
  const sign = amount < 0 ? '−' : '';
  const text = toPersianDigits(group(String(Math.abs(Math.trunc(amount)))));
  return withUnit ? `${sign}${text} پارسه` : `${sign}${text}`;
}

/** Minor units of USD (cents) → `۱٬۲۳۴٫۵۶` dollars. Display only. */
export function formatUsd(minor: number | string | null | undefined, withUnit = false): string {
  const amount = Number(minor ?? 0);
  if (!Number.isFinite(amount)) return '—';
  const sign = amount < 0 ? '−' : '';
  const absolute = Math.abs(Math.trunc(amount));
  const whole = Math.floor(absolute / 100);
  const cents = String(absolute % 100).padStart(2, '0');
  const text = `${toPersianDigits(group(String(whole)))}٫${toPersianDigits(cents)}`;
  return withUnit ? `${sign}${text} دلار` : `${sign}${text}`;
}

/** Coverage ratio (1 = 100 %). The API stores a ratio; the UI shows percent. */
export function formatPercent(ratio: number | null | undefined, digits = 2): string {
  const value = Number(ratio ?? 0);
  if (!Number.isFinite(value)) return '—';
  return `${toPersianDigits((value * 100).toFixed(digits))}٪`;
}

export function formatRate(rate: number | null | undefined, digits = 2): string {
  const value = Number(rate ?? 0);
  if (!Number.isFinite(value)) return '—';
  return toPersianDigits(value.toFixed(digits));
}

const dateTimeFormatter = new Intl.DateTimeFormat('fa-IR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const dateFormatter = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' });

const timeFormatter = new Intl.DateTimeFormat('fa-IR', { timeStyle: 'short' });

function asDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  const date = asDate(value);
  return date ? dateTimeFormatter.format(date) : '—';
}

export function formatDate(value: string | number | Date | null | undefined): string {
  const date = asDate(value);
  return date ? dateFormatter.format(date) : '—';
}

export function formatTime(value: string | number | Date | null | undefined): string {
  const date = asDate(value);
  return date ? timeFormatter.format(date) : '—';
}

/** Compact relative label in Persian, used in activity lists. */
export function formatRelative(value: string | number | Date | null | undefined, now = Date.now()): string {
  const date = asDate(value);
  if (!date) return '—';
  const diffSeconds = Math.round((date.getTime() - now) / 1000);
  const absolute = Math.abs(diffSeconds);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 3600],
    ['hour', 86_400],
    ['day', 604_800],
    ['week', 2_592_000],
    ['month', 31_536_000],
  ];
  const formatter = new Intl.RelativeTimeFormat('fa-IR', { numeric: 'auto' });
  if (absolute < 45) return formatter.format(diffSeconds, 'second');
  for (let index = 0; index < units.length; index += 1) {
    const [unit, limit] = units[index]!;
    if (absolute < limit) {
      const divisor = index === 0 ? 60 : units[index - 1]![1];
      return formatter.format(Math.round(diffSeconds / divisor), unit);
    }
  }
  return formatter.format(Math.round(diffSeconds / 31_536_000), 'year');
}

/** `1404/06/31`-safe countdown used by approval and QR sessions. */
export function formatCountdown(expiresAt: string | null | undefined, now = Date.now()): string {
  const date = asDate(expiresAt);
  if (!date) return '—';
  const remaining = Math.max(0, Math.round((date.getTime() - now) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return toPersianDigits(`${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
}

/* ------------------------------------------------------------------ masking */

/** `123456789012` → `۱۲۳۴ ۵۶۷۸ ۹۰۱۲` (groups of four, per the card face). */
export function groupCardNumber(cardNumber: string, persian = true): string {
  const digits = normalizeDigits(cardNumber).replace(/\D/g, '');
  const grouped = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  return persian ? toPersianDigits(grouped) : grouped;
}

export function maskCardNumber(cardNumber: string): string {
  const digits = normalizeDigits(cardNumber).replace(/\D/g, '');
  if (digits.length < 8) return '••••';
  return `${toPersianDigits(digits.slice(0, 4))} •••• ${toPersianDigits(digits.slice(-4))}`;
}

export function maskSerial(serial: string, visible = 4): string {
  if (serial.length <= visible) return serial;
  return `${'•'.repeat(Math.max(4, serial.length - visible))}${serial.slice(-visible)}`;
}

/** `2026/07`-style expiry, shown as `۰۷/۲۶`. */
export function formatExpiry(month: number, year: number): string {
  const shortYear = year % 100;
  return toPersianDigits(`${String(month).padStart(2, '0')}/${String(shortYear).padStart(2, '0')}`);
}

/* -------------------------------------------------------------- label maps */

const TRANSACTION_TYPE_FA: Record<string, string> = {
  TRANSFER: 'انتقال',
  QR_PAYMENT: 'پرداخت با کد',
  DEPOSIT: 'واریز',
  WITHDRAWAL: 'برداشت',
  ISSUANCE: 'انتشار',
  BURN: 'امحا',
  REDEMPTION: 'بازخرید',
  FEE: 'کارمزد',
  REVERSAL: 'اصلاح',
  ADJUSTMENT: 'تعدیل',
};

const STATUS_FA: Record<string, string> = {
  PENDING: 'در انتظار',
  COMPLETED: 'انجام‌شده',
  FAILED: 'ناموفق',
  REVERSED: 'اصلاح‌شده',
  EXPIRED: 'منقضی',
  APPROVED: 'تأییدشده',
  REJECTED: 'ردشده',
  EXECUTED: 'اجراشده',
  CANCELLED: 'لغوشده',
  ACTIVE: 'فعال',
  FROZEN: 'مسدود',
  SUSPENDED: 'معلق',
  CLOSED: 'بسته',
  CREATED: 'ایجادشده',
  DRAFT: 'پیش‌نویس',
  PREVIEW: 'پیش‌نمایش',
  PUBLISHED: 'منتشرشده',
  SUPERSEDED: 'جانشین‌شده',
  ARCHIVED: 'بایگانی',
  AWAITING_AUTHORIZATION: 'در انتظار مجوز',
  ABORTED: 'نیمه‌کاره',
  DESTROYED: 'امحاشده',
  LOST: 'مفقود',
  STOLEN: 'مسروقه',
  DEPOSITED: 'سپرده‌شده',
  WITHDRAWN: 'برداشت‌شده',
  ASSIGNED: 'تخصیص‌یافته',
  REGISTERED: 'ثبت‌شده',
  RETIRED: 'بازنشسته',
  UNKNOWN_SERIAL: 'سریال ناشناس',
  GENUINE: 'اصیل',
  INVALID_CHECKSUM: 'کنترل رقم نامعتبر',
};

export function labelFa(value: string | null | undefined): string {
  if (!value) return '—';
  return STATUS_FA[value] ?? value;
}

export function transactionTypeFa(value: string | null | undefined): string {
  if (!value) return '—';
  return TRANSACTION_TYPE_FA[value] ?? value;
}

const ROLE_FA: Record<string, string> = {
  SUPER_ADMIN: 'راهبر ارشد',
  TREASURY_OFFICER: 'افسر خزانه',
  AUDITOR: 'حسابرس',
  DESIGN_ADMIN: 'مدیر طراحی',
  USER: 'عضو',
};

export function roleFa(role: string | null | undefined): string {
  if (!role) return '—';
  return ROLE_FA[role] ?? role;
}

const DENOMINATION_FIGURE_FA: Record<number, string> = {
  1: 'خوارزمی',
  2: 'رازی',
  5: 'بیرونی',
  10: 'ابن‌سینا',
  50: 'خیام',
  100: 'فردوسی',
  200: 'حافظ',
};

export function denominationFigureFa(denomination: number): string {
  return DENOMINATION_FIGURE_FA[denomination] ?? '—';
}

/** Persian state tone for a status string, used by badges. */
export function statusTone(status: string | null | undefined): 'positive' | 'warning' | 'critical' | 'info' | 'muted' {
  switch (status) {
    case 'COMPLETED':
    case 'ACTIVE':
    case 'EXECUTED':
    case 'APPROVED':
    case 'PUBLISHED':
    case 'GENUINE':
    case 'OK':
      return 'positive';
    case 'PENDING':
    case 'DRAFT':
    case 'PREVIEW':
    case 'AWAITING_AUTHORIZATION':
    case 'WARNING':
    case 'CREATED':
      return 'warning';
    case 'FAILED':
    case 'REJECTED':
    case 'FROZEN':
    case 'SUSPENDED':
    case 'LOST':
    case 'STOLEN':
    case 'DESTROYED':
    case 'CRITICAL':
    case 'REVERSED':
      return 'critical';
    case 'EXPIRED':
    case 'CLOSED':
    case 'ARCHIVED':
    case 'SUPERSEDED':
      return 'muted';
    default:
      return 'info';
  }
}
