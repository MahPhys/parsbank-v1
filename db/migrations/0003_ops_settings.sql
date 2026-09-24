-- =============================================================================
-- BANK PARS — 0003 · operational settings, feature flags, events, notifications
-- =============================================================================
-- These tables form the runtime control plane. `system_settings` is read by the
-- ledger's invariant triggers, so it is created before the ledger.
-- A design administrator has no write grant here.
-- =============================================================================

CREATE TABLE prs.system_settings (
  key            text PRIMARY KEY,
  value          jsonb NOT NULL,
  value_type     text NOT NULL DEFAULT 'string' CHECK (value_type IN ('string','int','bigint','boolean','decimal','json')),
  category       text NOT NULL DEFAULT 'general'
                   CHECK (category IN ('monetary','policy','fees','security','financial_controls','presentation','general')),
  label_fa       text NOT NULL,
  description_fa text,
  is_critical    boolean NOT NULL DEFAULT false,        -- critical => dual approval to change
  min_value      bigint,
  max_value      bigint,
  updated_by     uuid REFERENCES prs.profiles(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN prs.system_settings.is_critical IS
  'Critical settings (supply cap, reserve rules, redemption rules, kill switches) require dual approval.';

-- ---------------------------------------------------------------------------
-- feature_flags — runtime toggles surfaced in the admin control plane
-- ---------------------------------------------------------------------------
CREATE TABLE prs.feature_flags (
  key            text PRIMARY KEY,
  enabled        boolean NOT NULL DEFAULT false,
  scope          text NOT NULL DEFAULT 'global' CHECK (scope IN ('global','public_app','admin_app','api')),
  rollout_percent int NOT NULL DEFAULT 100 CHECK (rollout_percent BETWEEN 0 AND 100),
  description_fa text,
  requires_dual_approval boolean NOT NULL DEFAULT false,
  updated_by     uuid REFERENCES prs.profiles(id),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prs.feature_flag_history (
  id          bigserial PRIMARY KEY,
  key         text NOT NULL,
  enabled     boolean NOT NULL,
  rollout_percent int NOT NULL,
  changed_by  uuid REFERENCES prs.profiles(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- system_events — machine/institution timeline (health, incidents, jobs)
-- ---------------------------------------------------------------------------
CREATE TABLE prs.system_events (
  id           bigserial PRIMARY KEY,
  severity     text NOT NULL CHECK (severity IN ('DEBUG','INFO','NOTICE','WARNING','ERROR','CRITICAL')),
  source       text NOT NULL,
  code         text NOT NULL,
  message      text NOT NULL,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id     uuid REFERENCES prs.profiles(id),
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX system_events_recent_idx ON prs.system_events (occurred_at DESC);
CREATE INDEX system_events_severity_idx ON prs.system_events (severity, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- notifications — user-facing (and admin-facing) message inbox
-- ---------------------------------------------------------------------------
CREATE TABLE prs.notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid NOT NULL REFERENCES prs.profiles(id) ON DELETE CASCADE,
  audience     text NOT NULL DEFAULT 'USER' CHECK (audience IN ('USER','ADMIN')),
  kind         text NOT NULL,
  title_fa     text NOT NULL,
  body_fa      text NOT NULL,
  action_url   text,
  severity     text NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','SUCCESS','WARNING','CRITICAL')),
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_profile_idx ON prs.notifications (profile_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON prs.notifications (profile_id) WHERE read_at IS NULL;

-- ---------------------------------------------------------------------------
-- Helpers that read settings (created after the table exists)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prs.setting_bigint(p_key text, p_default bigint) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT (value #>> '{}')::bigint FROM prs.system_settings WHERE key = p_key),
    p_default);
$$;

CREATE OR REPLACE FUNCTION prs.setting_bool(p_key text, p_default boolean) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT (value #>> '{}')::boolean FROM prs.system_settings WHERE key = p_key),
    p_default);
$$;

CREATE OR REPLACE FUNCTION prs.setting_text(p_key text, p_default text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT value #>> '{}' FROM prs.system_settings WHERE key = p_key),
    p_default);
$$;

CREATE OR REPLACE FUNCTION prs.flag_enabled(p_key text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT enabled FROM prs.feature_flags WHERE key = p_key), false);
$$;

-- ---------------------------------------------------------------------------
-- Default settings — monetary constants of the PRS system.
-- Changing a row with is_critical = true requires dual approval (enforced in the
-- service layer AND audited; the DB re-checks the ceiling inside the supply trigger).
-- ---------------------------------------------------------------------------
INSERT INTO prs.system_settings (key, value, value_type, category, label_fa, description_fa, is_critical, min_value, max_value) VALUES
  ('max_supply_minor',        '10000', 'bigint',  'monetary',           'سقف عرضه کل',        'حداکثر موجودی قابل انتشار (پارسه)', true, 1, 10000),
  ('policy.par_value_usd_minor','100','bigint',  'policy',             'ارزش اسمی پشتوانه',   'ارزش اسمی هر پارسه برای محاسبه پوشش', true, 1, 100000),
  ('policy.min_coverage_ratio','1.00','decimal', 'policy',             'حداقل نسبت پوشش',     'نسبت پوشش لازم برای انتشار جدید', true, 0, 100),
  ('policy.issuance_requires_reserve','true','boolean','policy',        'الزام پشتوانه',      'انتشار بدون واریز پشتوانه مجاز نیست', true, NULL, NULL),
  ('policy.max_transfer_minor','10000','bigint', 'policy',             'سقف هر انتقال',       'حداکثر مبلغ هر تراکنش', false, 1, 10000),
  ('policy.daily_transfer_limit_minor','10000','bigint','policy',       'سقف روزانه انتقال',   'حداکثر مبلغ انتقال در ۲۴ ساعت', false, 1, 10000),
  ('policy.redemption_fee_minor','0','bigint',   'policy',             'کارمزد بازخرید',      'کارمزد بازخرید به پشتوانه', false, 0, 1000),
  ('fees.transfer_fee_minor', '0', 'bigint',     'fees',               'کارمزد انتقال',       'کارمزد هر انتقال بین کیف پول‌ها', false, 0, 1000),
  ('fees.qr_fee_minor',       '0', 'bigint',     'fees',               'کارمزد پرداخت QR',    'کارمزد پرداخت با کارت', false, 0, 1000),
  ('security.session_idle_minutes','30','int',   'security',           'انقضای بی‌کاری نشست', 'دقیقه تا انقضای نشست بی‌فعالیت', false, 5, 240),
  ('security.session_absolute_hours','12','int', 'security',           'انقضای مطلق نشست',    'حداکثر عمر نشست', false, 1, 72),
  ('security.admin_session_idle_minutes','15','int','security',          'انقضای نشست مدیریت',  'نشست پنل مدیریت کوتاه‌تر است', false, 3, 120),
  ('security.max_login_attempts','5','int',      'security',           'حداکثر تلاش ورود',    'تلاش ناموفق قبل از قفل موقت', false, 3, 20),
  ('security.lockout_minutes','15','int',        'security',           'مدت قفل موقت',        'دقیقه قفل پس از تلاش‌های ناموفق', false, 1, 240),
  ('security.txn_authorization_seconds','120','int','security',         'اعتبار مجوز تراکنش',  'ثانیه اعتبار مجوز اختصاصی تراکنش', false, 30, 600),
  ('security.qr_session_ttl_seconds','600','int','security',            'اعتبار نشست QR',      'ثانیه اعتبار اسکن کارت', false, 60, 3600),
  ('financial_controls.transfers','true','boolean','financial_controls','کنترل انتقال',        'غیرفعال‌سازی اضطراری انتقال‌ها', true, NULL, NULL),
  ('financial_controls.issuance','true','boolean','financial_controls','کنترل انتشار',        'غیرفعال‌سازی اضطراری انتشار', true, NULL, NULL),
  ('financial_controls.burning','true','boolean','financial_controls', 'کنترل امحا',          'غیرفعال‌سازی اضطراری امحا', true, NULL, NULL),
  ('financial_controls.withdrawals','true','boolean','financial_controls','کنترل برداشت',     'غیرفعال‌سازی اضطراری برداشت', true, NULL, NULL),
  ('financial_controls.redemptions','true','boolean','financial_controls','کنترل بازخرید',    'غیرفعال‌سازی اضطراری بازخرید', true, NULL, NULL),
  ('presentation.default_theme','"light"','string','presentation',      'پوسته پیش‌فرض',       'پوسته پیش‌فرض برنامه عمومی', false, NULL, NULL),
  ('presentation.brand_name_fa','"بانک پارس"','string','presentation',  'نام برند (فارسی)',    'نام نمایشی برند', false, NULL, NULL),
  ('presentation.brand_name_en','"BANK PARS"','string','presentation',  'نام برند (انگلیسی)',  'نام نمایشی بین‌المللی برند', false, NULL, NULL);

INSERT INTO prs.feature_flags (key, enabled, scope, description_fa, requires_dual_approval) VALUES
  ('public.transfers',        true,  'public_app', 'انتقال بین کاربران',                false),
  ('public.qr_payments',      true,  'public_app', 'پرداخت با کارت و QR',               false),
  ('public.physical_notes',   true,  'public_app', 'نمایش اسکناس‌های فیزیکی',           false),
  ('public.receipts',         true,  'public_app', 'رسید قابل چاپ',                     false),
  ('public.self_service_pin_reset', false, 'public_app', 'تغییر پین توسط کاربر',        false),
  ('admin.issuance',          true,  'admin_app',  'انتشار پول توسط خزانه',             true),
  ('admin.burning',           true,  'admin_app',  'امحای پول',                         true),
  ('admin.redemption',        false, 'admin_app',  'بازخرید پارسه',                     true),
  ('admin.banknote_printing', false, 'admin_app',  'تولید اثر اسکناس جدید',             false),
  ('admin.maintenance_mode',  false, 'admin_app',  'حالت نگهداری',                      true),
  ('api.strict_idempotency',  true,  'api',        'الزام کلید یکتاسازی در تراکنش‌های مالی', false),
  ('api.audit_read_logging',  true,  'api',        'ثبت خواندن داده‌های حساس',          false);
