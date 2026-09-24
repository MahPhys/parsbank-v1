/**
 * BANK PARS — domain error taxonomy.
 *
 * Every rejection the money layer can produce is enumerated here with a stable
 * code, an HTTP status and a user-facing Persian message. Services throw
 * DomainError; the HTTP layer only translates. Nothing else may invent an error
 * shape, and messages never contain internal identifiers, SQL or stack traces.
 */

export type DomainErrorCode =
  | 'VALIDATION_FAILED'
  | 'AUTHENTICATION_REQUIRED'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED'
  | 'FORBIDDEN'
  | 'WALLET_NOT_OWNED'
  | 'WALLET_NOT_FOUND'
  | 'CARD_NOT_FOUND'
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_SUSPENDED'
  | 'ACCOUNT_FROZEN'
  | 'ACCOUNT_CLOSED'
  | 'CARD_FROZEN'
  | 'CARD_EXPIRED'
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_AMOUNT'
  | 'AMOUNT_NOT_INTEGER'
  | 'FRACTIONAL_NOT_SUPPORTED'
  | 'LIMIT_EXCEEDED'
  | 'SELF_TRANSFER_NOT_ALLOWED'
  | 'DUPLICATE_IDEMPOTENCY_KEY'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'SUPPLY_CAP_EXCEEDED'
  | 'RESERVE_COVERAGE_INSUFFICIENT'
  | 'RESERVE_REQUIRED'
  | 'TREASURY_DISABLED'
  | 'FINANCIAL_CONTROLS_DISABLED'
  | 'DUAL_APPROVAL_REQUIRED'
  | 'SELF_APPROVAL_FORBIDDEN'
  | 'APPROVAL_EXPIRED'
  | 'APPROVAL_ALREADY_DECIDED'
  | 'APPROVAL_NOT_FOUND'
  | 'TRANSACTION_NOT_FOUND'
  | 'SESSION_NOT_FOUND'
  | 'APPROVAL_NONCE_INVALID'
  | 'INSUFFICIENT_ROLE'
  | 'TRANSACTION_AUTHORIZATION_REQUIRED'
  | 'TRANSACTION_AUTHORIZATION_INVALID'
  | 'TRANSACTION_AUTHORIZATION_EXPIRED'
  | 'PIN_INVALID'
  | 'PIN_LOCKED'
  | 'CVV_INVALID'
  | 'PASSWORD_INVALID'
  | 'MFA_REQUIRED'
  | 'MFA_INVALID'
  | 'QR_TOKEN_INVALID'
  | 'QR_TOKEN_EXPIRED'
  | 'QR_SESSION_EXPIRED'
  | 'QR_DESTINATION_MISMATCH'
  | 'BANKNOTE_NOT_FOUND'
  | 'BANKNOTE_INVALID_SERIAL'
  | 'BANKNOTE_STATUS_CONFLICT'
  | 'BANKNOTE_ALREADY_REGISTERED'
  | 'LEDGER_UNBALANCED'
  | 'LEDGER_OVERDRAFT'
  | 'IMMUTABLE_RECORD'
  | 'CONCURRENCY_CONFLICT'
  | 'RATE_LIMITED'
  | 'LOCKED_OUT'
  | 'CREDENTIAL_NOT_CONFIGURED'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR';

const STATUS: Partial<Record<DomainErrorCode, number>> = {
  VALIDATION_FAILED: 422,
  AUTHENTICATION_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  SESSION_REVOKED: 401,
  FORBIDDEN: 403,
  WALLET_NOT_OWNED: 403,
  INSUFFICIENT_ROLE: 403,
  SELF_APPROVAL_FORBIDDEN: 403,
  LEDGER_UNBALANCED: 500,
  IMMUTABLE_RECORD: 409,
  WALLET_NOT_FOUND: 404,
  CARD_NOT_FOUND: 404,
  PROFILE_NOT_FOUND: 404,
  APPROVAL_NOT_FOUND: 404,
  TRANSACTION_NOT_FOUND: 404,
  SESSION_NOT_FOUND: 404,
  BANKNOTE_NOT_FOUND: 404,
  ACCOUNT_FROZEN: 423,
  ACCOUNT_CLOSED: 423,
  CARD_FROZEN: 423,
  PROFILE_SUSPENDED: 423,
  PIN_LOCKED: 423,
  LOCKED_OUT: 429,
  RATE_LIMITED: 429,
  DUPLICATE_IDEMPOTENCY_KEY: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  APPROVAL_ALREADY_DECIDED: 409,
  CONCURRENCY_CONFLICT: 409,
  SUPPLY_CAP_EXCEEDED: 422,
  RESERVE_COVERAGE_INSUFFICIENT: 422,
  RESERVE_REQUIRED: 422,
  DUAL_APPROVAL_REQUIRED: 409,
  BANKNOTE_STATUS_CONFLICT: 409,
  BANKNOTE_ALREADY_REGISTERED: 409,
  NOT_IMPLEMENTED: 501,
  INTERNAL_ERROR: 500,
};

const MESSAGES_FA: Record<string, string> = {
  VALIDATION_FAILED: 'اطلاعات ارسالی نامعتبر است.',
  AUTHENTICATION_REQUIRED: 'برای انجام این عملیات باید وارد شوید.',
  SESSION_EXPIRED: 'نشست شما منقضی شده است. دوباره وارد شوید.',
  SESSION_REVOKED: 'نشست شما پایان یافته است.',
  FORBIDDEN: 'شما مجاز به انجام این عملیات نیستید.',
  WALLET_NOT_OWNED: 'این کیف پول به شما تعلق ندارد.',
  WALLET_NOT_FOUND: 'کیف پول یافت نشد.',
  CARD_NOT_FOUND: 'کارت یافت نشد.',
  PROFILE_NOT_FOUND: 'کاربر یافت نشد.',
  PROFILE_SUSPENDED: 'حساب کاربری شما غیرفعال است.',
  ACCOUNT_FROZEN: 'حساب در حال حاضر غیرفعال (مسدود) است.',
  ACCOUNT_CLOSED: 'این حساب بسته شده است.',
  CARD_FROZEN: 'این کارت مسدود است.',
  CARD_EXPIRED: 'این کارت منقضی شده است.',
  INSUFFICIENT_FUNDS: 'موجودی کافی نیست.',
  INVALID_AMOUNT: 'مبلغ نامعتبر است.',
  AMOUNT_NOT_INTEGER: 'مبلغ باید عدد صحیح باشد.',
  FRACTIONAL_NOT_SUPPORTED: 'واحد کوچکتر از یک پارسه در این نسخه پشتیبانی نمی‌شود.',
  LIMIT_EXCEEDED: 'مبلغ از سقف مجاز بیشتر است.',
  SELF_TRANSFER_NOT_ALLOWED: 'انتقال به کیف پول خودتان امکان‌پذیر نیست.',
  DUPLICATE_IDEMPOTENCY_KEY: 'این درخواست قبلاً ثبت شده است.',
  IDEMPOTENCY_KEY_REUSED: 'این کلید یکتاسازی با درخواست دیگری استفاده شده است.',
  IDEMPOTENCY_KEY_REQUIRED: 'ارسال کلید یکتاسازی الزامی است.',
  SUPPLY_CAP_EXCEEDED: 'انتشار این مقدار، سقف عرضه کل را رد می‌کند.',
  RESERVE_COVERAGE_INSUFFICIENT: 'پشتوانه کافی برای این عملیات وجود ندارد.',
  RESERVE_REQUIRED: 'انتشار پول بدون واریز پشتوانه مجاز نیست.',
  TREASURY_DISABLED: 'عملیات خزانه در حال حاضر غیرفعال است.',
  FINANCIAL_CONTROLS_DISABLED: 'کنترل‌های مالی این عملیات را موقتاً متوقف کرده‌اند.',
  DUAL_APPROVAL_REQUIRED: 'این عملیات نیازمند تأیید دوم است.',
  SELF_APPROVAL_FORBIDDEN: 'تأیید درخواست خودتان مجاز نیست.',
  APPROVAL_EXPIRED: 'مهلت این درخواست تأیید به پایان رسیده است.',
  APPROVAL_ALREADY_DECIDED: 'این درخواست قبلاً تصمیم‌گیری شده است.',
  APPROVAL_NOT_FOUND: 'درخواست تأیید یافت نشد.',
  TRANSACTION_NOT_FOUND: 'تراکنش یافت نشد.',
  SESSION_NOT_FOUND: 'نشست یافت نشد.',
  APPROVAL_NONCE_INVALID: 'توکن تأیید نامعتبر یا مصرف‌شده است.',
  INSUFFICIENT_ROLE: 'نقش شما اجازه این کار را نمی‌دهد.',
  TRANSACTION_AUTHORIZATION_REQUIRED: 'برای انجام تراکنش باید مجوز تراکنش بگیرید.',
  TRANSACTION_AUTHORIZATION_INVALID: 'مجوز تراکنش نامعتبر است.',
  TRANSACTION_AUTHORIZATION_EXPIRED: 'مجوز تراکنش منقضی شده است. دوباره تلاش کنید.',
  PIN_INVALID: 'رمز کارت نادرست است.',
  PIN_LOCKED: 'رمز کارت به دلیل تلاش‌های ناموفق موقتاً قفل شده است.',
  CVV_INVALID: 'کد امنیتی کارت نادرست است.',
  PASSWORD_INVALID: 'گذرواژه نادرست است.',
  MFA_REQUIRED: 'ورود با عامل دوم الزامی است.',
  MFA_INVALID: 'کد عامل دوم نامعتبر است.',
  QR_TOKEN_INVALID: 'این کد کارت معتبر نیست.',
  QR_TOKEN_EXPIRED: 'اعتبار این کد کارت به پایان رسیده است.',
  QR_SESSION_EXPIRED: 'زمان این پرداخت به پایان رسیده است. کارت را دوباره اسکن کنید.',
  QR_DESTINATION_MISMATCH: 'شماره کارت مقصد با کارت اسکن‌شده مطابقت ندارد.',
  BANKNOTE_NOT_FOUND: 'اسکناس با این شماره سریال ثبت نشده است.',
  BANKNOTE_INVALID_SERIAL: 'قالب شماره سریال نامعتبر است.',
  BANKNOTE_STATUS_CONFLICT: 'وضعیت این اسکناس اجازه این عملیات را نمی‌دهد.',
  BANKNOTE_ALREADY_REGISTERED: 'این شماره سریال قبلاً ثبت شده است.',
  LEDGER_UNBALANCED: 'خطای داخلی در ثبت دفتر کل.',
  LEDGER_OVERDRAFT: 'این عملیات موجودی را منفی می‌کند.',
  IMMUTABLE_RECORD: 'سوابق مالی قابل تغییر نیستند.',
  CONCURRENCY_CONFLICT: 'همزمانی درخواست‌ها؛ دوباره تلاش کنید.',
  RATE_LIMITED: 'تعداد درخواست‌ها زیاد است. کمی بعد تلاش کنید.',
  LOCKED_OUT: 'حساب موقتاً قفل شده است.',
  CREDENTIAL_NOT_CONFIGURED: 'برای این حساب رمز کارت تنظیم نشده است.',
  NOT_IMPLEMENTED: 'این قابلیت در این نسخه فعال نیست.',
  INTERNAL_ERROR: 'خطای داخلی سامانه.',
};

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly httpStatus: number;
  readonly messageFa: string;
  readonly fields?: Array<{ path: string; message: string }>;
  /** Extra machine-readable context for the audit log (never shown to clients). */
  readonly context?: Record<string, unknown>;

  constructor(
    code: DomainErrorCode,
    options: {
      messageFa?: string;
      messageEn?: string;
      fields?: Array<{ path: string; message: string }>;
      context?: Record<string, unknown>;
    } = {},
  ) {
    super(options.messageEn ?? code);
    this.name = 'DomainError';
    this.code = code;
    this.httpStatus = STATUS[code] ?? 400;
    this.messageFa = options.messageFa ?? MESSAGES_FA[code] ?? MESSAGES_FA.INTERNAL_ERROR!;
    this.fields = options.fields;
    this.context = options.context;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        messageFa: this.messageFa,
        fields: this.fields,
      },
    };
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

export const userMessageFa = (code: DomainErrorCode): string => MESSAGES_FA[code] ?? MESSAGES_FA.INTERNAL_ERROR!;
