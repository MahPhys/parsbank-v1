-- =============================================================================
-- BANK PARS — 0010 · governance: audit log, dual approval, approval policy
-- =============================================================================

-- ---------------------------------------------------------------------------
-- audit_logs — the institution's tamper-evident record. Append-only.
-- ---------------------------------------------------------------------------
CREATE TABLE prs.audit_logs (
  id               bigserial PRIMARY KEY,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  actor_profile_id uuid REFERENCES prs.profiles(id) ON DELETE SET NULL,
  actor_role       text,
  actor_label      text,                                 -- denormalised for long-term readability
  action           text NOT NULL,                        -- e.g. 'transfer.create', 'treasury.issue'
  category         text NOT NULL DEFAULT 'GENERAL'
                     CHECK (category IN ('AUTH','MONEY','TREASURY','CARD','BANKNOTE','ADMIN','CONTENT','SECURITY','GENERAL')),
  severity         text NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','NOTICE','WARNING','CRITICAL')),
  outcome          text NOT NULL DEFAULT 'SUCCESS' CHECK (outcome IN ('SUCCESS','DENIED','FAILED')),
  entity_type      text,
  entity_id        text,
  entity_ref       text,
  before_state     jsonb,
  after_state      jsonb,
  reason           text,
  request_id       text,
  session_id       uuid,
  ip_hash          prs.hex_hash,
  user_agent       text,
  admin_action_id  uuid,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX audit_logs_recent_idx ON prs.audit_logs (occurred_at DESC);
CREATE INDEX audit_logs_actor_idx ON prs.audit_logs (actor_profile_id, occurred_at DESC);
CREATE INDEX audit_logs_entity_idx ON prs.audit_logs (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_logs_action_idx ON prs.audit_logs (action, occurred_at DESC);
CREATE INDEX audit_logs_severity_idx ON prs.audit_logs (severity, occurred_at DESC);

CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON prs.audit_logs
  FOR EACH ROW EXECUTE FUNCTION prs.reject_mutation();

COMMENT ON TABLE prs.audit_logs IS
  'Append-only. Denials are recorded too: an attempt to move money without authority is itself evidence.';

-- ---------------------------------------------------------------------------
-- approval_policies — data-driven description of the two-person rule
-- ---------------------------------------------------------------------------
CREATE TABLE prs.approval_policies (
  action_type          text PRIMARY KEY,
  label_fa             text NOT NULL,
  required_role        text NOT NULL CHECK (required_role IN ('SUPER_ADMIN','TREASURY_OFFICER','AUDITOR','DESIGN_ADMIN')),
  approver_role        text NOT NULL CHECK (approver_role IN ('SUPER_ADMIN','TREASURY_OFFICER','AUDITOR','DESIGN_ADMIN')),
  requires_second_approver boolean NOT NULL DEFAULT true,
  distinct_approver_required boolean NOT NULL DEFAULT true,
  expires_minutes      int NOT NULL DEFAULT 60 CHECK (expires_minutes BETWEEN 5 AND 10080),
  description_fa       text
);

INSERT INTO prs.approval_policies
  (action_type, label_fa, required_role, approver_role, requires_second_approver, expires_minutes, description_fa) VALUES
  ('ISSUANCE',                  'انتشار پول',              'TREASURY_OFFICER', 'SUPER_ADMIN',     true, 240, 'ایجاد پارسه جدید با پشتوانه و صورت‌جلسه'),
  ('BURN',                      'امحای پول',               'TREASURY_OFFICER', 'SUPER_ADMIN',     true, 240, 'خروج پارسه از گردش به‌صورت دفتری یا فیزیکی'),
  ('REDEMPTION',                'بازخرید پارسه',           'TREASURY_OFFICER', 'SUPER_ADMIN',     true, 240, 'تسویه پارسه در برابر پشتوانه'),
  ('MAX_SUPPLY_CHANGE',         'تغییر سقف عرضه',          'SUPER_ADMIN',      'SUPER_ADMIN',     true, 1440, 'تغییر حداکثر عرضه کل'),
  ('RESERVE_RULE_CHANGE',       'تغییر قواعد پشتوانه',     'TREASURY_OFFICER', 'SUPER_ADMIN',     true, 1440, 'تغییر سیاست پشتوانه و نسبت پوشش'),
  ('REDEMPTION_RULE_CHANGE',    'تغییر قواعد بازخرید',     'TREASURY_OFFICER', 'SUPER_ADMIN',     true, 1440, 'تغییر شرایط بازخرید'),
  ('ADMIN_ROLE_CHANGE',         'تغییر نقش مدیران',        'SUPER_ADMIN',      'SUPER_ADMIN',     true, 1440, 'اعطا یا سلب نقش مدیریتی'),
  ('DISABLE_FINANCIAL_CONTROLS','غیرفعال‌سازی کنترل‌ها',   'SUPER_ADMIN',      'SUPER_ADMIN',     true, 60,   'خاموش‌کردن کنترل‌های مالی اضطراری'),
  ('RESERVE_VALUATION',         'ثبت/تجدید ارزش پشتوانه',  'TREASURY_OFFICER', 'SUPER_ADMIN',     true, 1440, 'افزودن یا ارزیابی مجدد دارایی پشتوانه'),
  ('WALLET_FREEZE',             'انجماد کیف پول',          'SUPER_ADMIN',      'TREASURY_OFFICER', true, 240, 'توقف عملیات یک کیف پول'),
  ('CARD_FREEZE',               'انجماد کارت',             'SUPER_ADMIN',      'TREASURY_OFFICER', true, 240, 'توقف یک کارت بانکی داخلی'),
  ('BANKNOTE_STATUS_CHANGE',    'تغییر وضعیت اسکناس',      'TREASURY_OFFICER', 'SUPER_ADMIN',     true, 1440, 'گم‌شده/سرقت‌شده/امحا کردن اسکناس ثبت‌شده'),
  ('SETTING_CHANGE_CRITICAL',   'تغییر تنظیم حساس',        'SUPER_ADMIN',      'TREASURY_OFFICER', true, 1440, 'تغییر تنظیمات مالی حساس سیستم'),
  ('FEATURE_FLAG_CRITICAL',     'تغییر پرچم حساس',         'SUPER_ADMIN',      'TREASURY_OFFICER', true, 1440, 'تغییر پرچم‌های نیازمند تأیید دوم'),
  ('THEME_PUBLISH',             'انتشار پوسته',            'DESIGN_ADMIN',     'DESIGN_ADMIN',    false, 1440, 'انتشار نسخه طراحی در سطح سازمان');

-- ---------------------------------------------------------------------------
-- admin_actions — requests, approvals, executions. Two-person rule lives here.
-- ---------------------------------------------------------------------------
CREATE TABLE prs.admin_actions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_ref        text NOT NULL UNIQUE,
  action_type       text NOT NULL REFERENCES prs.approval_policies(action_type),
  status            text NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','APPROVED','REJECTED','EXECUTED','FAILED','EXPIRED','CANCELLED')),
  requires_second_approver boolean NOT NULL DEFAULT true,
  required_role     text NOT NULL,
  approver_role     text NOT NULL,
  requested_by      uuid NOT NULL REFERENCES prs.profiles(id),
  requested_at      timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  reason            text NOT NULL CHECK (length(btrim(reason)) >= 8),
  payload           jsonb NOT NULL,
  payload_hash      prs.hex_hash NOT NULL,
  decided_by        uuid REFERENCES prs.profiles(id),
  decided_at        timestamptz,
  decision_note     text,
  consumed_nonce_hash prs.hex_hash,
  executed_at       timestamptz,
  execution_result  jsonb,
  failure_reason    text,
  resulting_entity_ref text,
  CONSTRAINT admin_actions_second_approver_differs
    CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT admin_actions_decision_consistency
    CHECK ((status IN ('APPROVED','REJECTED','EXECUTED','FAILED')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT admin_actions_window CHECK (expires_at > requested_at)
);

CREATE INDEX admin_actions_status_idx ON prs.admin_actions (status, requested_at DESC);
CREATE INDEX admin_actions_type_idx ON prs.admin_actions (action_type, requested_at DESC);
CREATE INDEX admin_actions_requester_idx ON prs.admin_actions (requested_by, requested_at DESC);

CREATE OR REPLACE FUNCTION prs.admin_actions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE_TABLE: admin actions may not be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.action_type <> OLD.action_type
     OR NEW.payload::text <> OLD.payload::text
     OR NEW.requested_by <> OLD.requested_by
     OR NEW.requested_at <> OLD.requested_at
     OR NEW.action_ref <> OLD.action_ref THEN
    RAISE EXCEPTION 'IMMUTABLE_TABLE: admin action request fields may not be modified'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'PENDING' AND NEW.status = 'PENDING' THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION: cannot return an action to PENDING' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('EXECUTED','REJECTED','EXPIRED','CANCELLED') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION: % is terminal', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'APPROVED' AND NEW.status NOT IN ('APPROVED','EXECUTED','FAILED','EXPIRED') THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION: APPROVED -> % is not allowed', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.decided_by IS NOT NULL AND (NEW.decided_by IS DISTINCT FROM OLD.decided_by
       OR NEW.decided_at IS DISTINCT FROM OLD.decided_at) THEN
    RAISE EXCEPTION 'IMMUTABLE_TABLE: the recorded decision may not be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER admin_actions_guard BEFORE UPDATE OR DELETE ON prs.admin_actions
  FOR EACH ROW EXECUTE FUNCTION prs.admin_actions_guard();

-- ---------------------------------------------------------------------------
-- admin_action_nonces — single-use approval nonces (anti-replay for approvals)
-- ---------------------------------------------------------------------------
CREATE TABLE prs.admin_action_nonces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_action_id uuid NOT NULL REFERENCES prs.admin_actions(id) ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES prs.profiles(id) ON DELETE CASCADE,
  nonce_hash      prs.hex_hash NOT NULL UNIQUE,
  purpose         text NOT NULL CHECK (purpose IN ('APPROVE','REJECT','EXECUTE')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz
);
CREATE INDEX admin_action_nonces_lookup_idx ON prs.admin_action_nonces (admin_action_id, purpose) WHERE consumed_at IS NULL;

-- ---------------------------------------------------------------------------
-- admin_action_events — append-only trail of the approval workflow itself
-- ---------------------------------------------------------------------------
CREATE TABLE prs.admin_action_events (
  id              bigserial PRIMARY KEY,
  admin_action_id uuid NOT NULL REFERENCES prs.admin_actions(id) ON DELETE CASCADE,
  event           text NOT NULL CHECK (event IN ('REQUESTED','APPROVED','REJECTED','EXECUTED','FAILED','EXPIRED','CANCELLED','VIEWED')),
  actor_id        uuid REFERENCES prs.profiles(id),
  actor_role      text,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_action_events_idx ON prs.admin_action_events (admin_action_id, occurred_at DESC);

CREATE TRIGGER admin_action_events_immutable BEFORE UPDATE OR DELETE ON prs.admin_action_events
  FOR EACH ROW EXECUTE FUNCTION prs.reject_mutation();

-- Convenience view for the admin "Approvals" queue.
CREATE VIEW prs.pending_approvals AS
SELECT a.id, a.action_ref, a.action_type, p.label_fa AS action_label_fa,
       a.requested_by, req.full_name_fa AS requested_by_name,
       a.requested_at, a.expires_at, a.reason, a.payload, a.required_role, a.approver_role,
       (a.expires_at < now()) AS is_expired
  FROM prs.admin_actions a
  JOIN prs.approval_policies p ON p.action_type = a.action_type
  JOIN prs.profiles req ON req.id = a.requested_by
 WHERE a.status = 'PENDING';
