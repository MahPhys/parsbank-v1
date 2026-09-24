/**
 * @parsbank/validation — the single input-shape boundary.
 *
 * Every HTTP handler validates its body/query/params with a schema from here
 * before touching a service. Authorization is NOT decided by these schemas: they
 * only guarantee that the service receives well-formed data. Persian digit input
 * is normalised at the edges (a user typing ۱۲۳۴ is not an error).
 */
import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

const persianDigits = (value: string): string =>
  value
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));

export const digitsOnly = (length?: number) =>
  z
    .string()
    .transform((value) => persianDigits(value).replace(/\D/g, ''))
    .refine((value) => (length ? value.length === length : value.length > 0), {
      message: length ? `باید ${length} رقم باشد.` : 'فقط رقم مجاز است.',
    });

export const cardNumberSchema = digitsOnly(12).describe('شماره کارت ۱۲ رقمی');
export const cvvSchema = digitsOnly(3).describe('کد امنیتی ۳ رقمی');
export const pinSchema = digitsOnly(4).describe('رمز کارت ۴ رقمی');
export const moneySchema = z
  .number({ invalid_type_error: 'مبلغ باید عدد باشد.' })
  .int('مبلغ باید عدد صحیح باشد.')
  .positive('مبلغ باید بزرگ‌تر از صفر باشد.')
  .max(10_000, 'مبلغ از سقف عرضه کل بیشتر است.');
export const amountFromBody = z
  .union([z.number(), z.string()])
  .transform((value) => Number(persianDigits(String(value))))
  .pipe(moneySchema);

export const idempotencyKeySchema = z
  .string()
  .min(16, 'کلید یکتاسازی باید حداقل ۱۶ نویسه باشد.')
  .max(80)
  .regex(/^[A-Za-z0-9._:\-]+$/, 'قالب کلید یکتاسازی نامعتبر است.');

export const passwordSchema = z
  .string()
  .min(10, 'گذرواژه باید حداقل ۱۰ نویسه باشد.')
  .max(200)
  .refine((value) => /[A-Za-z]/.test(value) && /[0-9]/.test(value), 'گذرواژه باید شامل حرف و رقم باشد.');

export const uuidSchema = z.string().uuid('شناسه نامعتبر است.');
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

/* -------------------------------------------------------------------------- */
/* Authentication                                                              */
/* -------------------------------------------------------------------------- */

export const loginSchema = z.object({
  cardNumber: cardNumberSchema,
  password: z.string().min(1, 'گذرواژه الزامی است.').max(200),
  totpCode: z
    .string()
    .transform((value) => persianDigits(value).replace(/\D/g, ''))
    .refine((value) => value.length === 0 || value.length === 6, 'کد عامل دوم باید ۶ رقم باشد.')
    .optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const transactionAuthorizationSchema = z.object({
  walletRef: z.string().min(1).max(64),
  credential: z.object({
    kind: z.enum(['PIN', 'PASSWORD']),
    value: z.string().min(1).max(200),
    totpCode: z.string().max(10).optional(),
  }),
  maxAmountMinor: moneySchema.optional(),
});

export const mfaEnableSchema = z.object({
  secret: z.string().min(16).max(64),
  totpCode: z.string().min(6).max(6),
});

/* -------------------------------------------------------------------------- */
/* Transfers & payments                                                        */
/* -------------------------------------------------------------------------- */

export const transferSchema = z
  .object({
    senderWalletRef: z.string().min(1).max(64),
    receiverCardNumber: cardNumberSchema.optional(),
    receiverWalletRef: z.string().min(1).max(64).optional(),
    amountMinor: amountFromBody,
    memo: z.string().max(200).optional().nullable(),
    transactionAuthorizationId: uuidSchema,
  })
  .refine((value) => Boolean(value.receiverCardNumber) !== Boolean(value.receiverWalletRef), {
    message: 'یکی از مقصدها (شماره کارت یا شناسه کیف پول) باید مشخص باشد.',
    path: ['receiverCardNumber'],
  });

export const resolveDestinationSchema = z
  .object({
    receiverCardNumber: cardNumberSchema.optional(),
    receiverWalletRef: z.string().min(1).max(64).optional(),
  })
  .refine((value) => Boolean(value.receiverCardNumber) !== Boolean(value.receiverWalletRef), {
    message: 'یکی از مقصدها باید مشخص باشد.',
  });

export const qrPaySchema = z.object({
  amountMinor: amountFromBody,
  destinationCardNumber: cardNumberSchema,
  cvv: cvvSchema,
  walletRef: z.string().min(1).max(64),
  payerCardId: uuidSchema.optional().nullable(),
  memo: z.string().max(200).optional().nullable(),
  credential: z.object({
    kind: z.enum(['PIN', 'PASSWORD']),
    value: z.string().min(1).max(200),
    totpCode: z.string().max(10).optional(),
  }),
});

/* -------------------------------------------------------------------------- */
/* Cards & banknotes                                                           */
/* -------------------------------------------------------------------------- */

export const setPinSchema = z.object({
  currentPin: pinSchema.optional(),
  newPin: pinSchema,
});

export const issueCardSchema = z.object({
  walletRef: z.string().min(1).max(64),
  cardholderNameFa: z.string().min(3, 'نام دارنده کارت الزامی است.').max(80),
});

export const banknoteVerifySchema = z.object({
  serialNumber: z.string().min(4).max(64),
  claimedDenominationMinor: z.number().int().positive().optional(),
});

export const banknoteRegisterBatchSchema = z.object({
  denominationMinor: z.number().int().positive(),
  quantity: z.number().int().min(1).max(5000),
  seriesLabel: z.string().min(3).max(80),
  designVersion: z.string().max(40).optional().nullable(),
  artworkKey: z.string().max(120).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const banknoteAssignSchema = z.object({
  serialNumber: z.string().min(4).max(64),
  holderWalletRef: z.string().min(1).max(64),
});

export const banknoteMoveSchema = z.object({
  serialNumber: z.string().min(4).max(64),
  walletRef: z.string().min(1).max(64),
});

/* -------------------------------------------------------------------------- */
/* Governance                                                                  */
/* -------------------------------------------------------------------------- */

export const approvalActionTypeSchema = z.enum([
  'ISSUANCE',
  'BURN',
  'REDEMPTION',
  'MAX_SUPPLY_CHANGE',
  'RESERVE_RULE_CHANGE',
  'REDEMPTION_RULE_CHANGE',
  'ADMIN_ROLE_CHANGE',
  'DISABLE_FINANCIAL_CONTROLS',
  'RESERVE_VALUATION',
  'WALLET_FREEZE',
  'CARD_FREEZE',
  'BANKNOTE_STATUS_CHANGE',
  'SETTING_CHANGE_CRITICAL',
  'FEATURE_FLAG_CRITICAL',
  'THEME_PUBLISH',
]);

export const requestApprovalSchema = z.object({
  actionType: approvalActionTypeSchema,
  payload: z.record(z.unknown()),
  reason: z.string().min(8, 'دلیل درخواست باید حداقل ۸ نویسه باشد.').max(500),
});

export const decisionSchema = z.object({
  nonce: z.string().min(16).max(200),
  note: z.string().max(500).optional().nullable(),
});

export const issuancePayloadSchema = z.object({
  amountMinor: moneySchema,
  reserveContributionUsdMinor: z.number().int().min(0),
  reserveId: uuidSchema.optional().nullable(),
  destinationKind: z.enum(['WALLET', 'PHYSICAL_NOTES']).default('WALLET'),
  destinationWalletRef: z.string().max(64).optional().nullable(),
  batchCode: z.string().regex(/^[0-9]{4}$/).optional().nullable(),
});

export const burnPayloadSchema = z.object({
  amountMinor: moneySchema,
  sourceKind: z.enum(['WALLET', 'PHYSICAL_NOTES']).default('WALLET'),
  sourceWalletRef: z.string().max(64).optional().nullable(),
  banknoteSerial: z.string().max(64).optional().nullable(),
  destructionRef: z.string().max(120).optional().nullable(),
});

export const reserveValuationPayloadSchema = z.object({
  reserveRef: z.string().min(3).max(80),
  assetKind: z.enum(['CASH_USD', 'CUSTODY_DEPOSIT', 'GOLD', 'SILVER', 'SOVEREIGN_BOND', 'CORPORATE_BOND', 'OTHER']),
  descriptionFa: z.string().min(3).max(200),
  bookValueUsdMinor: z.number().int().min(0),
  haircutBps: z.number().int().min(0).max(10_000).default(0),
  eligibility: z.enum(['ELIGIBLE', 'INELIGIBLE', 'PENDING_REVIEW']).default('ELIGIBLE'),
});

export const roleChangePayloadSchema = z.object({
  profileId: uuidSchema,
  role: z.enum(['USER', 'DESIGN_ADMIN', 'AUDITOR', 'TREASURY_OFFICER', 'SUPER_ADMIN']),
  reason: z.string().min(8, 'دلیل تغییر نقش باید حداقل ۸ نویسه باشد.').max(500),
});

export const statusChangePayloadSchema = z.object({
  profileId: uuidSchema,
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED']),
  reason: z.string().min(4, 'دلیل تغییر وضعیت الزامی است.').max(500),
});

/* -------------------------------------------------------------------------- */
/* Admin — users, settings, content                                            */
/* -------------------------------------------------------------------------- */

export const registerProfileSchema = z.object({
  fullNameFa: z.string().min(3).max(80),
  fullNameEn: z.string().min(3).max(80),
  email: z.string().email().max(120).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  password: passwordSchema,
  role: z.enum(['USER', 'DESIGN_ADMIN', 'AUDITOR', 'TREASURY_OFFICER', 'SUPER_ADMIN']).default('USER'),
});

export const settingUpdateSchema = z.object({
  key: z.string().min(3).max(80),
  value: z.union([z.string(), z.number(), z.boolean(), z.record(z.unknown())]),
});

export const featureFlagUpdateSchema = z.object({
  key: z.string().min(3).max(80),
  enabled: z.boolean(),
  rolloutPercent: z.number().int().min(0).max(100).optional(),
});

export const profileUpdateSchema = z.object({
  fullNameFa: z.string().min(3).max(80).optional(),
  fullNameEn: z.string().min(3).max(80).optional(),
  email: z.string().email().max(120).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  locale: z.enum(['fa-IR', 'en-US']).optional(),
  themePreference: z.enum(['system', 'light', 'dark']).optional(),
});

export const designTokenUpdateSchema = z.object({
  updates: z
    .array(
      z.object({
        key: z.string().min(2).max(80),
        value: z.string().max(400),
      }),
    )
    .min(1)
    .max(200),
});

export const themeDraftSchema = z.object({
  name: z.string().min(2).max(80),
  noteFa: z.string().max(300).optional().nullable(),
});

export const themePublishRequestSchema = z.object({
  themeId: uuidSchema,
  reason: z.string().min(8).max(500),
});

export const themeRollbackSchema = z.object({
  targetThemeId: uuidSchema,
  noteFa: z.string().min(4).max(300),
});

export const assetUpsertSchema = z.object({
  assetKey: z.string().min(2).max(80).regex(/^[a-z0-9][a-z0-9.\-]+$/, 'کلید دارایی نامعتبر است.'),
  nameFa: z.string().min(2).max(120),
  kind: z.enum([
    'LOGO',
    'LOGO_VARIANT',
    'ICON',
    'IMAGE',
    'PATTERN',
    'BANKNOTE_ART',
    'CARD_ART',
    'PORTRAIT',
    'FONT',
    'ILLUSTRATION',
    'SOCIAL',
  ]),
  mimeType: z.string().max(80).default('image/svg+xml'),
  storagePath: z.string().min(1).max(2000),
  altFa: z.string().max(200).optional().nullable(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  denominationMinor: z.number().int().positive().optional().nullable(),
  side: z.enum(['FRONT', 'REVERSE']).optional().nullable(),
  width: z.number().int().positive().optional().nullable(),
  height: z.number().int().positive().optional().nullable(),
  byteSize: z.number().int().nonnegative().optional().nullable(),
  checksum: z.string().max(128).optional().nullable(),
});

export const contentBlockSchema = z.object({
  blockKey: z.string().min(2).max(80),
  kind: z.enum(['TEXT', 'HERO', 'ANNOUNCEMENT', 'BANNER', 'FAQ', 'LEGAL', 'CTA', 'STAT', 'FOOTER_NOTE']),
  titleFa: z.string().max(160).optional().nullable(),
  bodyFa: z.string().max(4000),
  bodyEn: z.string().max(4000).optional().nullable(),
  data: z.record(z.unknown()).optional(),
  publish: z.boolean().optional(),
});

export const pageSchema = z.object({
  slug: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9/\-]*$/),
  titleFa: z.string().min(2).max(160),
  descriptionFa: z.string().max(400).optional().nullable(),
  layout: z.array(z.record(z.unknown())).max(60),
  publish: z.boolean().optional(),
  isSystem: z.boolean().optional(),
});

export const navigationItemSchema = z.object({
  id: uuidSchema.optional().nullable(),
  location: z.enum(['PUBLIC_HEADER', 'PUBLIC_FOOTER', 'PUBLIC_APP_NAV', 'ADMIN_SIDEBAR', 'ADMIN_HEADER']),
  labelFa: z.string().min(1).max(80),
  labelEn: z.string().max(80).optional().nullable(),
  href: z.string().min(1).max(200),
  iconKey: z.string().max(60).optional().nullable(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  requiredRole: z
    .enum(['USER', 'DESIGN_ADMIN', 'AUDITOR', 'TREASURY_OFFICER', 'SUPER_ADMIN'])
    .optional()
    .nullable(),
  requiredPermission: z.string().max(80).optional().nullable(),
  visible: z.boolean().optional(),
});

/* -------------------------------------------------------------------------- */
/* Query helpers                                                               */
/* -------------------------------------------------------------------------- */

export const transactionQuerySchema = paginationSchema.extend({
  walletId: uuidSchema.optional(),
  type: z.enum(['TRANSFER', 'QR_PAYMENT', 'DEPOSIT', 'WITHDRAWAL', 'ISSUANCE', 'BURN', 'REDEMPTION', 'FEE', 'REVERSAL', 'ADJUSTMENT']).optional(),
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED', 'REVERSED', 'EXPIRED']).optional(),
  search: z.string().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const auditQuerySchema = paginationSchema.extend({
  category: z.enum(['AUTH', 'MONEY', 'TREASURY', 'CARD', 'BANKNOTE', 'ADMIN', 'CONTENT', 'SECURITY', 'GENERAL']).optional(),
  severity: z.enum(['INFO', 'NOTICE', 'WARNING', 'CRITICAL']).optional(),
  outcome: z.enum(['SUCCESS', 'DENIED', 'FAILED']).optional(),
  action: z.string().max(80).optional(),
  actorProfileId: uuidSchema.optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
});

export const adminListQuerySchema = paginationSchema.extend({
  search: z.string().max(80).optional(),
  status: z.string().max(40).optional(),
  role: z.string().max(40).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type TransferInputSchema = z.infer<typeof transferSchema>;
export type QrPayInputSchema = z.infer<typeof qrPaySchema>;
