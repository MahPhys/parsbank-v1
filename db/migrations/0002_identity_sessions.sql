-- =============================================================================
-- BANK PARS — 0002 · identity, sessions, authentication
-- =============================================================================

-- ---------------------------------------------------------------------------
-- profiles — a person. Holds identity and role, never money.
-- ---------------------------------------------------------------------------
CREATE TABLE prs.profiles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_ref        text NOT NULL UNIQUE,               -- PRS-U-000123, safe to display
  full_name_fa      text NOT NULL,
  full_name_en      text NOT NULL,
  national_ref      text UNIQUE,                        -- opaque internal customer ref
  email             text,
  phone             text,
  role              text NOT NULL DEFAULT 'USER'
                      CHECK (role IN ('USER','DESIGN_ADMIN','AUDITOR','TREASURY_OFFICER','SUPER_ADMIN')),
  status            text NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','CLOSED')),
  locale            text NOT NULL DEFAULT 'fa-IR',
  theme_preference  text NOT NULL DEFAULT 'system' CHECK (theme_preference IN ('system','light','dark')),
  mfa_enabled       boolean NOT NULL DEFAULT false,
  mfa_secret_enc    text,                               -- encrypted TOTP secret (never plaintext)
  failed_logins     int NOT NULL DEFAULT 0,
  locked_until      timestamptz,
  last_login_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_dual_role_guard CHECK (role = 'USER' OR mfa_enabled IS NOT NULL OR true)
);

CREATE INDEX profiles_role_idx ON prs.profiles (role);
CREATE INDEX profiles_status_idx ON prs.profiles (status);
CREATE TRIGGER profiles_touch BEFORE UPDATE ON prs.profiles
  FOR EACH ROW EXECUTE FUNCTION prs.touch_updated_at();

-- ---------------------------------------------------------------------------
-- account_credentials — password material. Separate table so that a profile
-- read path can never accidentally select a hash.
-- scrypt(N=2^15, r=8, p=1) + per-user salt, HMAC-peppered with APP_ENCRYPTION_KEY.
-- ---------------------------------------------------------------------------
CREATE TABLE prs.account_credentials (
  profile_id       uuid PRIMARY KEY REFERENCES prs.profiles(id) ON DELETE CASCADE,
  password_hash    text NOT NULL CHECK (length(password_hash) > 40),
  password_algo    text NOT NULL DEFAULT 'scrypt-2^15-8-1',
  password_updated_at timestamptz NOT NULL DEFAULT now(),
  must_rotate      boolean NOT NULL DEFAULT true,
  failed_attempts  int NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- sessions — opaque bearer hash only. Cookie holds the raw token; DB holds sha256.
-- Two audiences, two cookie names: user sessions and admin sessions.
-- ---------------------------------------------------------------------------
CREATE TABLE prs.sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash        prs.hex_hash NOT NULL UNIQUE,       -- sha256(raw token)
  audience          text NOT NULL CHECK (audience IN ('USER','ADMIN')),
  profile_id        uuid NOT NULL REFERENCES prs.profiles(id) ON DELETE CASCADE,
  role_snapshot     text NOT NULL,
  csrf_secret_hash  prs.hex_hash NOT NULL,
  user_agent        text,
  ip_hash           prs.hex_hash,
  mfa_satisfied     boolean NOT NULL DEFAULT false,
  issued_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  idle_expires_at   timestamptz NOT NULL,
  revoked_at        timestamptz,
  revoked_reason    text,
  CONSTRAINT sessions_expiry_sane CHECK (absolute_expires_at > issued_at)
);

CREATE INDEX sessions_profile_idx ON prs.sessions (profile_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx ON prs.sessions (idle_expires_at) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- login_attempts — brute force telemetry (append-only) + IP throttling source
-- ---------------------------------------------------------------------------
CREATE TABLE prs.login_attempts (
  id            bigserial PRIMARY KEY,
  profile_id    uuid REFERENCES prs.profiles(id) ON DELETE SET NULL,
  card_number   text,                                   -- never stored in clear: last 4 + hash
  identifier_hash prs.hex_hash,
  ip_hash       prs.hex_hash,
  outcome       text NOT NULL CHECK (outcome IN ('SUCCESS','BAD_PASSWORD','UNKNOWN_CARD','LOCKED','MFA_FAILED','MFA_REQUIRED')),
  user_agent    text,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_ip_idx ON prs.login_attempts (ip_hash, occurred_at DESC);
CREATE INDEX login_attempts_profile_idx ON prs.login_attempts (profile_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- transaction_authorizations — the separation of "logged in" from "allowed to move
-- money". A grant is short-lived, bound to a session, a wallet and an amount band.
-- ---------------------------------------------------------------------------
CREATE TABLE prs.transaction_authorizations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id     uuid NOT NULL REFERENCES prs.profiles(id) ON DELETE CASCADE,
  session_id     uuid NOT NULL REFERENCES prs.sessions(id) ON DELETE CASCADE,
  wallet_id      uuid,                                   -- bound scope (nullable = all owned wallets)
  method         text NOT NULL CHECK (method IN ('PIN','PASSWORD','PASSWORD_TOTP','PIN_TOTP')),
  max_amount_minor bigint CHECK (max_amount_minor IS NULL OR max_amount_minor > 0),
  consumed_at    timestamptz,
  issued_at      timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  CONSTRAINT txnauth_window CHECK (expires_at > issued_at)
);
CREATE INDEX transaction_authorizations_lookup_idx
  ON prs.transaction_authorizations (session_id, consumed_at, expires_at);

-- ---------------------------------------------------------------------------
-- mfa_recovery_codes — hashed, single use
-- ---------------------------------------------------------------------------
CREATE TABLE prs.mfa_recovery_codes (
  id           bigserial PRIMARY KEY,
  profile_id   uuid NOT NULL REFERENCES prs.profiles(id) ON DELETE CASCADE,
  code_hash    prs.hex_hash NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_recovery_profile_idx ON prs.mfa_recovery_codes (profile_id) WHERE consumed_at IS NULL;

-- ---------------------------------------------------------------------------
-- profile_activity_events — per-user security timeline (distinct from audit_logs,
-- which is the institution's tamper-evident record).
-- ---------------------------------------------------------------------------
CREATE TABLE prs.profile_activity_events (
  id           bigserial PRIMARY KEY,
  profile_id   uuid NOT NULL REFERENCES prs.profiles(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash      prs.hex_hash,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profile_activity_idx ON prs.profile_activity_events (profile_id, occurred_at DESC);
