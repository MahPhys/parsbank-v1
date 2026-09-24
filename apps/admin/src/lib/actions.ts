/**
 * APPROVAL ACTION CATALOGUE — the fifteen governed operations.
 *
 * The console never performs any of these directly. It files a request, a second
 * administrator approves it, and only then does the server-side executor run. The
 * catalogue below describes, per action type, which payload the executor expects and
 * which permission is needed to *ask* for it — nothing more. Authority to approve is
 * decided by the server (and by the no-self-approval rule), not by this file.
 */
import type { ApprovalActionType } from '@parsbank/types';
import type { Permission } from '@parsbank/domain';

export interface ActionField {
  key: string;
  labelFa: string;
  kind: 'text' | 'number' | 'boolean' | 'select';
  options?: Array<{ value: string; labelFa: string }>;
  required?: boolean;
  hintFa?: string;
  placeholder?: string;
  defaultValue?: string | number | boolean;
}

export interface ApprovalActionSpec {
  type: ApprovalActionType;
  labelFa: string;
  summaryFa: string;
  requestPermission: Permission;
  /** Some actions belong to a section screen; the console links there. */
  sectionHint?: string;
  fields: ActionField[];
  buildPayload: (values: Record<string, string | number | boolean>) => Record<string, unknown>;
}

const RESERVE_ASSET_KINDS = ['CASH_USD', 'CUSTODY_DEPOSIT', 'GOLD', 'SILVER', 'SOVEREIGN_BOND', 'CORPORATE_BOND', 'OTHER'] as const;
const BANKNOTE_STATUSES = ['ISSUED', 'ASSIGNED', 'DEPOSITED', 'WITHDRAWN', 'FROZEN', 'LOST', 'STOLEN', 'DESTROYED'] as const;
const ROLES = ['USER', 'DESIGN_ADMIN', 'AUDITOR', 'TREASURY_OFFICER', 'SUPER_ADMIN'] as const;

const select = (options: readonly string[], labels?: Record<string, string>): ActionField['options'] =>
  options.map((value) => ({ value, labelFa: labels?.[value] ?? value }));

const number = (key: string, labelFa: string, hintFa?: string): ActionField => ({
  key,
  labelFa,
  kind: 'number',
  required: true,
  hintFa,
});

const text = (key: string, labelFa: string, required = true, hintFa?: string): ActionField => ({
  key,
  labelFa,
  kind: 'text',
  required,
  hintFa,
});

/**
 * Keys that must be dropped when empty: the executors distinguish "absent" from
 * "present but empty" for optional references.
 */
function compact(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === '' || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

export const APPROVAL_ACTIONS: ApprovalActionSpec[] = [
  {
    type: 'ISSUANCE',
    labelFa: 'انتشار پول تازه',
    summaryFa:
      'پارسهٔ تازه فقط در برابر پشتوانهٔ واجد شرایط منتشر می‌شود؛ سهم پشتوانه باید دست‌کم برابر مبلغ × ارزش اسمی باشد.',
    requestPermission: 'treasury.issue.request',
    sectionHint: 'issuance',
    fields: [
      number('amountMinor', 'مبلغ انتشار (پارسه)'),
      number('reserveContributionUsdMinor', 'سهم پشتوانه (سِنت دلار)'),
      { key: 'reserveId', labelFa: 'شناسهٔ پشتوانه', kind: 'text', hintFa: 'اگر خالی بماند، نخستین پشتوانهٔ واجد شرایط استفاده می‌شود.' },
      {
        key: 'destinationKind',
        labelFa: 'مقصد',
        kind: 'select',
        options: [
          { value: 'WALLET', labelFa: 'کیف پول' },
          { value: 'PHYSICAL_NOTES', labelFa: 'اسکناس فیزیکی' },
        ],
        defaultValue: 'WALLET',
      },
      text('destinationWalletRef', 'شناسهٔ کیف پول مقصد', false, 'برای انتشار به اسکناس، خالی بماند.'),
      text('batchCode', 'کد سری اسکناس', false, 'چهار رقم؛ برای انتشار فیزیکی.'),
    ],
    buildPayload: (values) =>
      compact({
        amountMinor: Number(values.amountMinor),
        reserveContributionUsdMinor: Number(values.reserveContributionUsdMinor),
        reserveId: values.reserveId,
        destinationKind: values.destinationKind ?? 'WALLET',
        destinationWalletRef: values.destinationWalletRef,
        batchCode: values.batchCode,
      }),
  },
  {
    type: 'BURN',
    labelFa: 'امحای پارسه',
    summaryFa: 'امحا با ثبت دفتری انجام می‌شود؛ هیچ ردیفی حذف نمی‌شود و عرضه به همان اندازه کاهش می‌یابد.',
    requestPermission: 'treasury.burn.request',
    sectionHint: 'burning',
    fields: [
      number('amountMinor', 'مبلغ امحا (پارسه)'),
      {
        key: 'sourceKind',
        labelFa: 'منبع',
        kind: 'select',
        options: [
          { value: 'WALLET', labelFa: 'کیف پول' },
          { value: 'PHYSICAL_NOTES', labelFa: 'اسکناس فیزیکی' },
        ],
        defaultValue: 'WALLET',
      },
      text('sourceWalletRef', 'شناسهٔ کیف پول مبدأ', false),
      text('banknoteSerial', 'سریال اسکناس', false, 'برای امحای فیزیکی الزامی است.'),
      text('destructionRef', 'شمارهٔ صورت‌جلسهٔ امحا', false),
    ],
    buildPayload: (values) =>
      compact({
        amountMinor: Number(values.amountMinor),
        sourceKind: values.sourceKind ?? 'WALLET',
        sourceWalletRef: values.sourceWalletRef,
        banknoteSerial: values.banknoteSerial,
        destructionRef: values.destructionRef,
      }),
  },
  {
    type: 'REDEMPTION',
    labelFa: 'بازخرید از کیف پول',
    summaryFa: 'خروج پول از گردش در برابر پشتوانه؛ بازخرید نیز مثل امحا با ثبت دفتری انجام می‌شود.',
    requestPermission: 'treasury.redemption.request',
    sectionHint: 'burning',
    fields: [
      number('amountMinor', 'مبلغ بازخرید (پارسه)'),
      text('walletRef', 'شناسهٔ کیف پول متقاضی'),
      number('feeMinor', 'کارمزد (پارسه)'),
      text('reserveId', 'شناسهٔ پشتوانه', false),
    ],
    buildPayload: (values) =>
      compact({
        amountMinor: Number(values.amountMinor),
        walletRef: values.walletRef,
        feeMinor: Number(values.feeMinor ?? 0),
        reserveId: values.reserveId,
      }),
  },
  {
    type: 'RESERVE_VALUATION',
    labelFa: 'ثبت ارزش‌گذاری پشتوانه',
    summaryFa: 'ارزش‌گذاری، پشتوانهٔ واجد شرایط را تغییر می‌دهد و نسبت پوشش و نرخ مرجع را جابه‌جا می‌کند.',
    requestPermission: 'treasury.reserve.request',
    sectionHint: 'reserve',
    fields: [
      text('reserveRef', 'شناسهٔ پشتوانه', true, 'برای دارایی تازه، شناسهٔ تازه‌ای بسازید.'),
      {
        key: 'assetKind',
        labelFa: 'نوع دارایی',
        kind: 'select',
        options: select(RESERVE_ASSET_KINDS),
        defaultValue: 'CASH_USD',
      },
      text('descriptionFa', 'شرح'),
      number('bookValueUsdMinor', 'ارزش دفتری (سِنت دلار)'),
      number('haircutBps', 'کسر ارزش (پایهٔ ۱۰۰۰۰)'),
      {
        key: 'eligibility',
        labelFa: 'واجد شرایط بودن',
        kind: 'select',
        options: [
          { value: 'ELIGIBLE', labelFa: 'واجد شرایط' },
          { value: 'PENDING_REVIEW', labelFa: 'در انتظار بررسی' },
          { value: 'INELIGIBLE', labelFa: 'واجد شرایط نیست' },
        ],
        defaultValue: 'ELIGIBLE',
      },
    ],
    buildPayload: (values) =>
      compact({
        reserveRef: values.reserveRef,
        assetKind: values.assetKind,
        descriptionFa: values.descriptionFa,
        bookValueUsdMinor: Number(values.bookValueUsdMinor),
        haircutBps: Number(values.haircutBps ?? 0),
        eligibility: values.eligibility ?? 'ELIGIBLE',
      }),
  },
  {
    type: 'MAX_SUPPLY_CHANGE',
    labelFa: 'تغییر سقف عرضه',
    summaryFa: 'سقف عرضه هرگز نمی‌تواند کمتر از عرضهٔ موجود شود و از ۱۰٫۰۰۰ پارسه فراتر نمی‌رود.',
    requestPermission: 'treasury.policy.request',
    sectionHint: 'treasury',
    fields: [number('maxSupplyMinor', 'سقف تازه (پارسه)')],
    buildPayload: (values) => ({ maxSupplyMinor: Number(values.maxSupplyMinor) }),
  },
  {
    type: 'RESERVE_RULE_CHANGE',
    labelFa: 'تغییر قاعدهٔ پشتوانه',
    summaryFa: 'نسبت حداقلی پوشش، ارزش اسمی دلاری هر پارسه و الزام پشتوانه برای انتشار در همین‌جا تعیین می‌شود.',
    requestPermission: 'treasury.policy.request',
    sectionHint: 'reserve',
    fields: [
      {
        key: 'key',
        labelFa: 'قاعده',
        kind: 'select',
        options: [
          { value: 'policy.min_coverage_ratio', labelFa: 'حداقل نسبت پوشش (۱٫۰۰ = ۱۰۰٪)' },
          { value: 'policy.par_value_usd_minor', labelFa: 'ارزش اسمی هر پارسه (سِنت دلار)' },
          { value: 'policy.issuance_requires_reserve', labelFa: 'الزام پشتوانه برای انتشار' },
        ],
        defaultValue: 'policy.min_coverage_ratio',
      },
      text('value', 'مقدار', true, 'برای قاعدهٔ الزام پشتوانه، true یا false.'),
    ],
    buildPayload: (values) => {
      const raw = String(values.value ?? '').trim();
      const parsed = raw === 'true' ? true : raw === 'false' ? false : Number.isFinite(Number(raw)) && raw !== '' ? Number(raw) : raw;
      return { key: values.key, value: parsed };
    },
  },
  {
    type: 'REDEMPTION_RULE_CHANGE',
    labelFa: 'تغییر قاعدهٔ بازخرید',
    summaryFa: 'قاعدهٔ بازخرید فقط از طریق همین درخواست دو‌نفره تغییر می‌کند.',
    requestPermission: 'treasury.policy.request',
    sectionHint: 'burning',
    fields: [
      {
        key: 'key',
        labelFa: 'قاعده',
        kind: 'select',
        options: [{ value: 'policy.redemption_fee_minor', labelFa: 'کارمزد بازخرید (پارسه)' }],
        defaultValue: 'policy.redemption_fee_minor',
      },
      text('value', 'مقدار'),
    ],
    buildPayload: (values) => ({ key: values.key, value: Number(values.value) }),
  },
  {
    type: 'DISABLE_FINANCIAL_CONTROLS',
    labelFa: 'خاموش کردن کنترل‌های مالی',
    summaryFa:
      'این پرخطرترین گزینه است: با خاموش شدن کنترل‌ها، انتشار و امحا از مسیر عادی باز می‌شود. تنها دو مدیر ارشد می‌توانند آن را انجام دهند.',
    requestPermission: 'admin.controls.toggle.request',
    sectionHint: 'feature-flags',
    fields: [
      {
        key: 'key',
        labelFa: 'کنترل',
        kind: 'select',
        options: [
          { value: 'financial_controls.transfers', labelFa: 'کنترل انتقال‌ها' },
          { value: 'financial_controls.issuance', labelFa: 'کنترل انتشار' },
          { value: 'financial_controls.burning', labelFa: 'کنترل امحا' },
          { value: 'financial_controls.withdrawals', labelFa: 'کنترل برداشت‌ها' },
          { value: 'financial_controls.redemptions', labelFa: 'کنترل بازخرید' },
        ],
        defaultValue: 'financial_controls.transfers',
      },
      { key: 'enabled', labelFa: 'مقدار', kind: 'select', options: [
        { value: 'false', labelFa: 'خاموش' },
        { value: 'true', labelFa: 'روشن' },
      ], defaultValue: 'false' },
    ],
    buildPayload: (values) => ({ key: values.key, enabled: String(values.enabled) === 'true' }),
  },
  {
    type: 'ADMIN_ROLE_CHANGE',
    labelFa: 'تغییر نقش مدیر',
    summaryFa: 'نقش‌ها یکدیگر را به ارث نمی‌برند: نقش تازه دقیقاً همان اختیارهای خودش را می‌دهد.',
    requestPermission: 'admin.roles.request',
    sectionHint: 'users',
    fields: [
      text('profileId', 'شناسهٔ پروفایل', true, 'شناسهٔ UUID کاربر از فهرست کاربران.'),
      {
        key: 'role',
        labelFa: 'نقش تازه',
        kind: 'select',
        options: select(ROLES),
        defaultValue: 'USER',
      },
    ],
    buildPayload: (values) => ({ profileId: values.profileId, role: values.role }),
  },
  {
    type: 'WALLET_FREEZE',
    labelFa: 'انجماد یا رفع انجماد کیف پول',
    summaryFa: 'کیف پول منجمد می‌تواند پول بگیرد ولی نمی‌تواند بفرستد؛ ثبت در گزارش حسابرسی الزامی است.',
    requestPermission: 'admin.wallets.freeze',
    sectionHint: 'wallets',
    fields: [
      text('walletId', 'شناسهٔ کیف پول'),
      {
        key: 'freeze',
        labelFa: 'عملیات',
        kind: 'select',
        options: [
          { value: 'true', labelFa: 'انجماد' },
          { value: 'false', labelFa: 'رفع انجماد' },
        ],
        defaultValue: 'true',
      },
    ],
    buildPayload: (values) => ({ walletId: values.walletId, freeze: String(values.freeze) !== 'false' }),
  },
  {
    type: 'CARD_FREEZE',
    labelFa: 'انجماد یا رفع انجماد کارت',
    summaryFa: 'کارت منجمد از پرداخت بازمی‌ماند؛ دارایی در کیف پول دست‌نخورده می‌ماند.',
    requestPermission: 'admin.cards.freeze',
    sectionHint: 'cards',
    fields: [
      text('cardId', 'شناسهٔ کارت'),
      {
        key: 'freeze',
        labelFa: 'عملیات',
        kind: 'select',
        options: [
          { value: 'true', labelFa: 'انجماد' },
          { value: 'false', labelFa: 'رفع انجماد' },
        ],
        defaultValue: 'true',
      },
    ],
    buildPayload: (values) => ({ cardId: values.cardId, freeze: String(values.freeze) !== 'false' }),
  },
  {
    type: 'BANKNOTE_STATUS_CHANGE',
    labelFa: 'تغییر وضعیت اسکناس',
    summaryFa: 'برای مفقودی و مسروقگی: برگ در دفتر اسکناس علامت می‌خورد و از گردش بیرون می‌آید.',
    requestPermission: 'admin.banknote.status.request',
    sectionHint: 'banknotes',
    fields: [
      text('serialNumber', 'سریال اسکناس'),
      {
        key: 'status',
        labelFa: 'وضعیت تازه',
        kind: 'select',
        options: select(BANKNOTE_STATUSES),
        defaultValue: 'FROZEN',
      },
    ],
    buildPayload: (values) => ({ serialNumber: values.serialNumber, status: values.status }),
  },
  {
    type: 'SETTING_CHANGE_CRITICAL',
    labelFa: 'تغییر تنظیم حیاتی',
    summaryFa: 'تنظیم‌های حیاتی مستقیم ذخیره نمی‌شوند؛ از این مسیر با تأیید دوم اعمال می‌شوند.',
    requestPermission: 'admin.controls.toggle.request',
    sectionHint: 'feature-flags',
    fields: [text('key', 'کلید تنظیم'), text('value', 'مقدار')],
    buildPayload: (values) => {
      const raw = String(values.value ?? '').trim();
      const parsed = raw === 'true' ? true : raw === 'false' ? false : Number.isFinite(Number(raw)) && raw !== '' ? Number(raw) : raw;
      return { key: values.key, value: parsed };
    },
  },
  {
    type: 'FEATURE_FLAG_CRITICAL',
    labelFa: 'تغییر پرچم حیاتی',
    summaryFa: 'پرچم‌های حیاتی با تأیید دوم روشن یا خاموش می‌شوند.',
    requestPermission: 'admin.controls.toggle.request',
    sectionHint: 'feature-flags',
    fields: [
      text('key', 'کلید پرچم'),
      {
        key: 'enabled',
        labelFa: 'وضعیت',
        kind: 'select',
        options: [
          { value: 'true', labelFa: 'روشن' },
          { value: 'false', labelFa: 'خاموش' },
        ],
        defaultValue: 'false',
      },
    ],
    buildPayload: (values) => ({ key: values.key, enabled: String(values.enabled) === 'true' }),
  },
  {
    type: 'THEME_PUBLISH',
    labelFa: 'انتشار نسخهٔ ظاهر',
    summaryFa: 'انتشار ظاهر روی همهٔ کاربران اثر می‌گذارد؛ طراحی پیش‌نمایش و بازگردانی دارد.',
    requestPermission: 'cms.theme.publish',
    sectionHint: 'design-system',
    fields: [text('themeId', 'شناسهٔ نسخهٔ ظاهر')],
    buildPayload: (values) => ({ themeId: values.themeId }),
  },
];

export const APPROVAL_ACTIONS_BY_TYPE: Record<string, ApprovalActionSpec> = Object.fromEntries(
  APPROVAL_ACTIONS.map((spec) => [spec.type, spec]),
);

export function actionSpec(type: string): ApprovalActionSpec | undefined {
  return APPROVAL_ACTIONS_BY_TYPE[type];
}

/** Build the initial form values from the spec defaults. */
export function initialValues(spec: ApprovalActionSpec): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of spec.fields) {
    if (field.defaultValue !== undefined) values[field.key] = String(field.defaultValue);
    else values[field.key] = '';
  }
  return values;
}
