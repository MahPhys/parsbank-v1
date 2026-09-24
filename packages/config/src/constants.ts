/**
 * BANK PARS — non-secret, isomorphic constants.
 *
 * Safe to import from server AND browser code: contains no environment values,
 * no keys, no secrets. Anything that depends on the environment lives in env.ts
 * (server-only).
 */

export const BRAND = {
  nameFa: 'بانک پارس',
  nameEn: 'BANK PARS',
  shortFa: 'پارس',
  shortEn: 'PARS',
  taglineFa: 'سامانه مالی بسته و خصوصی',
  taglineEn: 'Closed private monetary system',
  legalNoticeFa:
    'پارسه (PRS) واحد داخلی این شبکه خصوصی است و پول قانونی نیست. این سامانه به هیچ سامانه بانکی یا پرداخت واقعی متصل نیست.',
  legalNoticeEn:
    'PRS (پارسه) is the internal unit of this closed private network. It is not legal tender and is not connected to any real-world banking or payment rail.',
} as const;

/** Internal currency code. */
export const CURRENCY_CODE = 'PRS' as const;
/** Currency name in Persian. */
export const CURRENCY_NAME_FA = 'پارسه' as const;
export const CURRENCY_NAME_EN = 'PARSE' as const;

/** Smallest unit is 1 PRS: there is no fractional PRS in v1. */
export const MINOR_UNITS_PER_PRS = 1 as const;

/** Hard monetary ceiling: 10,000 PRS. */
export const MAX_SUPPLY_MINOR = 10_000 as const;

/** The physical note series. */
export const DENOMINATIONS = [1, 2, 5, 10, 50, 100, 200] as const;
export type Denomination = (typeof DENOMINATIONS)[number];

/** Accounting par: 1 PRS = 1.00 USD par (used only to express coverage). */
export const PAR_VALUE_USD_MINOR = 100 as const;

export const DENOMINATION_THEMES: Record<
  number,
  { portrait: string; portraitFa: string; motif: string; motifFa: string; era: string }
> = {
  1: {
    portrait: 'Muhammad ibn Musa al-Khwarizmi',
    portraitFa: 'محمد بن موسی خوارزمی',
    motif: 'numerals and algorithms',
    motifFa: 'ارقام و الگوریتم',
    era: 'c. 780–850 CE',
  },
  2: {
    portrait: 'Muhammad al-Razi',
    portraitFa: 'محمد زکریای رازی',
    motif: 'pharmacy and distillation',
    motifFa: 'داروسازی و تقطیر',
    era: 'c. 854–925 CE',
  },
  5: {
    portrait: 'Abu Rayhan al-Biruni',
    portraitFa: 'ابوریحان بیرونی',
    motif: 'celestial measurement',
    motifFa: 'سنجش آسمانی',
    era: '973–1048 CE',
  },
  10: {
    portrait: 'Avicenna (Ibn Sina)',
    portraitFa: 'ابوعلی سینا',
    motif: 'medicine and the canon',
    motifFa: 'پزشکی و قانون',
    era: '980–1037 CE',
  },
  50: {
    portrait: 'Omar Khayyam',
    portraitFa: 'عمر خیام',
    motif: 'astronomy and quatrain',
    motifFa: 'نجوم و رباعی',
    era: '1048–1131 CE',
  },
  100: {
    portrait: 'Ferdowsi',
    portraitFa: 'حکیم ابوالقاسم فردوسی',
    motif: 'epic and Shahnameh',
    motifFa: 'حماسه و شاهنامه',
    era: '940–1020 CE',
  },
  200: {
    portrait: 'Hafez',
    portraitFa: 'حافظ شیرازی',
    motif: 'poetry and garden',
    motifFa: 'شعر و باغ ایرانی',
    era: '1315–1390 CE',
  },
};

/** System ledger account codes. */
export const ACCOUNT_CODES = {
  CURRENCY_IN_EXISTENCE: '1100',
  ESCROW_IN_FLIGHT: '2200',
  PHYSICAL_NOTES_OUTSTANDING: '2300',
  FEE_REVENUE: '2500',
  TREASURY_OPERATING: '2600',
  SUSPENSE_CLEARING: '2700',
} as const;

/** Card/route constants. */
export const CARD = {
  numberLength: 12,
  cvvLength: 3,
  pinLength: 4,
  qrTokenPrefix: 'prs1_',
  qrPayloadPrefix: 'PRSQR1:',
  securePathPrefix: '/secure/card/',
} as const;

export const TERMS = {
  TRANSFER: 'TRANSFER',
  QR_PAYMENT: 'QR_PAYMENT',
  ISSUANCE: 'ISSUANCE',
  BURN: 'BURN',
  REDEMPTION: 'REDEMPTION',
  DEPOSIT: 'DEPOSIT',
  WITHDRAWAL: 'WITHDRAWAL',
  FEE: 'FEE',
  ESCROW_HOLD: 'ESCROW_HOLD',
  ESCROW_CAPTURE: 'ESCROW_CAPTURE',
  ESCROW_RELEASE: 'ESCROW_RELEASE',
  REVERSAL: 'REVERSAL',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;

export type TransactionType = (typeof TERMS)[keyof typeof TERMS];

export const BANKNOTE_STATUSES = [
  'REGISTERED',
  'ASSIGNED',
  'IN_CIRCULATION',
  'IN_VAULT',
  'DEPOSITED',
  'FROZEN',
  'LOST',
  'STOLEN',
  'DESTROYED',
  'RETIRED',
] as const;
export type BanknoteStatus = (typeof BANKNOTE_STATUSES)[number];

/** Statuses in which a physical note still carries outstanding monetary value. */
export const BANKNOTE_OUTSTANDING_STATUSES: BanknoteStatus[] = [
  'ASSIGNED',
  'IN_CIRCULATION',
  'FROZEN',
  'LOST',
  'STOLEN',
];

export const WALLET_STATUSES = ['CREATED', 'ACTIVE', 'FROZEN', 'CLOSED'] as const;
export type WalletStatus = (typeof WALLET_STATUSES)[number];

export const CARD_STATUSES = ['PENDING', 'ACTIVE', 'FROZEN', 'EXPIRED', 'CANCELLED'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const TRANSACTION_STATUSES = ['PENDING', 'COMPLETED', 'FAILED', 'REVERSED', 'EXPIRED'] as const;

/** Header names used by the API contract (shared with clients). */
export const HEADERS = {
  idempotencyKey: 'Idempotency-Key',
  csrfToken: 'X-Pars-CSRF',
  requestId: 'X-Pars-Request-Id',
  adminNonce: 'X-Pars-Approval-Nonce',
  themeVersion: 'X-Pars-Theme',
} as const;

export const COOKIES = {
  userSession: 'prs_session',
  adminSession: 'prs_admin_session',
  csrf: 'prs_csrf',
  adminCsrf: 'prs_admin_csrf',
} as const;
