-- =============================================================================
-- BANK PARS — 0004 · wallets
-- =============================================================================
-- A wallet is an accounting container owned by exactly one profile. It never
-- carries an authoritative balance: the ledger does (see 0005/0006).
-- =============================================================================

CREATE TABLE prs.wallets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_ref        text NOT NULL UNIQUE,               -- PRS-W-000123 (displayable)
  profile_id        uuid NOT NULL REFERENCES prs.profiles(id) ON DELETE RESTRICT,
  label_fa          text NOT NULL DEFAULT 'کیف پول اصلی',
  kind              text NOT NULL DEFAULT 'STANDARD'
                      CHECK (kind IN ('STANDARD','TREASURY','FEE','ESCROW','PHYSICAL')),
  status            text NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('CREATED','ACTIVE','FROZEN','CLOSED')),
  is_primary        boolean NOT NULL DEFAULT true,
  freeze_reason     text,
  opened_at         timestamptz NOT NULL DEFAULT now(),
  closed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallets_closed_has_timestamp CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  CONSTRAINT wallets_treasury_has_no_owner CHECK (kind = 'STANDARD' OR kind = 'TREASURY')
);

CREATE INDEX wallets_profile_idx ON prs.wallets (profile_id);
CREATE INDEX wallets_status_idx ON prs.wallets (status);
CREATE UNIQUE INDEX wallets_one_primary_per_profile
  ON prs.wallets (profile_id) WHERE is_primary AND status <> 'CLOSED';

CREATE TRIGGER wallets_touch BEFORE UPDATE ON prs.wallets
  FOR EACH ROW EXECUTE FUNCTION prs.touch_updated_at();

-- ---------------------------------------------------------------------------
-- wallet_balance_cache — performance cache, NEVER the source of truth.
-- Refreshed from the ledger inside the posting transaction; verified against the
-- ledger by prs.verify_balance_cache() and on the admin System Health screen.
-- ---------------------------------------------------------------------------
CREATE TABLE prs.wallet_balance_cache (
  wallet_id       uuid PRIMARY KEY REFERENCES prs.wallets(id) ON DELETE CASCADE,
  balance_minor   bigint NOT NULL DEFAULT 0,
  ledger_sequence bigint NOT NULL DEFAULT 0,            -- highest entry seq folded in
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- wallet_events — lifecycle & governance timeline of a wallet
-- ---------------------------------------------------------------------------
CREATE TABLE prs.wallet_events (
  id          bigserial PRIMARY KEY,
  wallet_id   uuid NOT NULL REFERENCES prs.wallets(id) ON DELETE CASCADE,
  event       text NOT NULL CHECK (event IN
                ('CREATED','ACTIVATED','FROZEN','UNFROZEN','CLOSED','LIMIT_CHANGED','ADMIN_NOTE')),
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id    uuid REFERENCES prs.profiles(id),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_events_wallet_idx ON prs.wallet_events (wallet_id, occurred_at DESC);

-- Per-wallet overrides of policy limits (nullable = inherit system settings).
CREATE TABLE prs.wallet_limits (
  wallet_id                 uuid PRIMARY KEY REFERENCES prs.wallets(id) ON DELETE CASCADE,
  max_transfer_minor        bigint CHECK (max_transfer_minor IS NULL OR max_transfer_minor > 0),
  daily_transfer_limit_minor bigint CHECK (daily_transfer_limit_minor IS NULL OR daily_transfer_limit_minor > 0),
  updated_by                uuid REFERENCES prs.profiles(id),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
