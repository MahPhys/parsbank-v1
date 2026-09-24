-- =============================================================================
-- BANK PARS — 0008 · physical banknote registry
-- =============================================================================
-- Each physical note is an individually registered bearer instrument. The banknote
-- registry is connected to the monetary ledger through account 2300
-- PHYSICAL_NOTES_OUTSTANDING: a note carries outstanding value exactly while it is
-- outside the vault (ASSIGNED / IN_CIRCULATION / FROZEN / LOST / STOLEN).
-- =============================================================================

CREATE TABLE prs.banknote_batches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_code     text NOT NULL UNIQUE CHECK (batch_code ~ '^[0-9]{4}$'),
  series_label   text NOT NULL,                          -- e.g. 'PARSE SERIES A'
  denomination_minor bigint NOT NULL CHECK (denomination_minor > 0),
  quantity       int NOT NULL CHECK (quantity > 0),
  printed_at     timestamptz,
  authorised_by  uuid REFERENCES prs.profiles(id),
  approved_by    uuid REFERENCES prs.profiles(id),
  approval_action_id uuid,
  design_version text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT banknote_batches_dual_control CHECK (authorised_by IS NULL OR approved_by IS NULL OR authorised_by <> approved_by)
);

CREATE TABLE prs.banknotes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number     text NOT NULL UNIQUE CHECK (serial_number ~ '^PRS-[0-9]{3}-[0-9]{4}-[0-9]{5}-[0-9A-Z]$'),
  denomination_minor bigint NOT NULL
                      CHECK (denomination_minor IN (1, 2, 5, 10, 50, 100, 200)),
  batch_id          uuid REFERENCES prs.banknote_batches(id) ON DELETE RESTRICT,
  batch_code        text NOT NULL CHECK (batch_code ~ '^[0-9]{4}$'),
  series_label      text NOT NULL DEFAULT 'PARSE SERIES A',
  status            text NOT NULL DEFAULT 'REGISTERED'
                      CHECK (status IN ('REGISTERED','ASSIGNED','IN_CIRCULATION','IN_VAULT','DEPOSITED',
                                        'FROZEN','LOST','STOLEN','DESTROYED','RETIRED')),
  holder_profile_id uuid REFERENCES prs.profiles(id) ON DELETE SET NULL,
  holder_wallet_id  uuid REFERENCES prs.wallets(id) ON DELETE SET NULL,
  custodian         text NOT NULL DEFAULT 'TREASURY' CHECK (custodian IN ('TREASURY','VAULT','HOLDER')),
  condition_grade   text NOT NULL DEFAULT 'UNC' CHECK (condition_grade IN ('UNC','AU','EF','VF','F')),
  carries_outstanding_value boolean NOT NULL DEFAULT false,
  design_version    text,
  artwork_key       text,
  issued_at         timestamptz,
  last_event_at     timestamptz,
  destroyed_at      timestamptz,
  created_by        uuid REFERENCES prs.profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT banknotes_outstanding_value_consistency
    CHECK (carries_outstanding_value = (status IN ('ASSIGNED','IN_CIRCULATION','FROZEN','LOST','STOLEN'))),
  CONSTRAINT banknotes_holder_requires_status
    CHECK (holder_profile_id IS NULL OR status <> 'IN_VAULT'),
  CONSTRAINT banknotes_destroyed_has_timestamp CHECK ((status = 'DESTROYED') = (destroyed_at IS NOT NULL))
);

CREATE INDEX banknotes_status_idx ON prs.banknotes (status);
CREATE INDEX banknotes_denomination_idx ON prs.banknotes (denomination_minor);
CREATE INDEX banknotes_holder_idx ON prs.banknotes (holder_profile_id);
CREATE INDEX banknotes_batch_idx ON prs.banknotes (batch_id);
CREATE INDEX banknotes_created_idx ON prs.banknotes (created_at DESC);

CREATE TRIGGER banknotes_touch BEFORE UPDATE ON prs.banknotes
  FOR EACH ROW EXECUTE FUNCTION prs.touch_updated_at();

-- ---------------------------------------------------------------------------
-- banknote_events — append-only history of every state change / verification
-- ---------------------------------------------------------------------------
CREATE TABLE prs.banknote_events (
  id            bigserial PRIMARY KEY,
  banknote_id   uuid NOT NULL REFERENCES prs.banknotes(id) ON DELETE CASCADE,
  event         text NOT NULL CHECK (event IN
                  ('REGISTERED','ASSIGNED','HANDOVER','RECEIVED','VERIFIED','VERIFICATION_FAILED',
                   'DEPOSITED','WITHDRAWN','FROZEN','UNFROZEN','MARKED_LOST','MARKED_STOLEN','RECOVERED',
                   'DESTROYED','RETIRED','TRANSFERRED')),
  from_status   text,
  to_status     text NOT NULL,
  from_holder   uuid REFERENCES prs.profiles(id),
  to_holder     uuid REFERENCES prs.profiles(id),
  ledger_transaction_id uuid REFERENCES prs.ledger_transactions(id),
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id      uuid REFERENCES prs.profiles(id),
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX banknote_events_note_idx ON prs.banknote_events (banknote_id, occurred_at DESC);
CREATE INDEX banknote_events_recent_idx ON prs.banknote_events (occurred_at DESC);

CREATE TRIGGER banknote_events_immutable
  BEFORE UPDATE OR DELETE ON prs.banknote_events
  FOR EACH ROW EXECUTE FUNCTION prs.reject_mutation();

-- ---------------------------------------------------------------------------
-- banknote_transfers — a record of physical movement between holders
-- ---------------------------------------------------------------------------
CREATE TABLE prs.banknote_transfers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banknote_id    uuid NOT NULL REFERENCES prs.banknotes(id) ON DELETE RESTRICT,
  transfer_type  text NOT NULL CHECK (transfer_type IN
                   ('ISSUE_TO_HOLDER','HOLDER_TO_HOLDER','HOLDER_TO_VAULT','VAULT_TO_HOLDER',
                    'RETURN_TO_TREASURY','DESTRUCTION')),
  from_profile_id uuid REFERENCES prs.profiles(id),
  to_profile_id   uuid REFERENCES prs.profiles(id),
  from_wallet_id  uuid REFERENCES prs.wallets(id),
  to_wallet_id    uuid REFERENCES prs.wallets(id),
  ledger_transaction_id uuid REFERENCES prs.ledger_transactions(id),
  witness_profile_id uuid REFERENCES prs.profiles(id),
  reference      text,
  memo           text,
  created_by     uuid REFERENCES prs.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX banknote_transfers_note_idx ON prs.banknote_transfers (banknote_id, created_at DESC);
CREATE INDEX banknote_transfers_recent_idx ON prs.banknote_transfers (created_at DESC);

CREATE TRIGGER banknote_transfers_immutable
  BEFORE UPDATE OR DELETE ON prs.banknote_transfers
  FOR EACH ROW EXECUTE FUNCTION prs.reject_mutation();

-- ---------------------------------------------------------------------------
-- banknote_verifications — the "verification history" of a note
-- ---------------------------------------------------------------------------
CREATE TABLE prs.banknote_verifications (
  id             bigserial PRIMARY KEY,
  banknote_id    uuid REFERENCES prs.banknotes(id) ON DELETE SET NULL,
  submitted_serial text NOT NULL,
  checksum_valid boolean NOT NULL,
  found          boolean NOT NULL,
  reported_status text,
  outcome        text NOT NULL CHECK (outcome IN ('GENUINE','UNKNOWN_SERIAL','INVALID_CHECKSUM','REPORTED_LOST','REPORTED_STOLEN','FROZEN','DESTROYED','DENOMINATION_MISMATCH')),
  denomination_claimed bigint,
  denomination_actual bigint,
  verifier_profile_id uuid REFERENCES prs.profiles(id),
  ip_hash        prs.hex_hash,
  channel        text NOT NULL DEFAULT 'PUBLIC_APP' CHECK (channel IN ('PUBLIC_APP','ADMIN_APP','API')),
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX banknote_verifications_note_idx ON prs.banknote_verifications (banknote_id, verified_at DESC);
CREATE INDEX banknote_verifications_recent_idx ON prs.banknote_verifications (verified_at DESC);

CREATE TRIGGER banknote_verifications_immutable
  BEFORE UPDATE OR DELETE ON prs.banknote_verifications
  FOR EACH ROW EXECUTE FUNCTION prs.reject_mutation();

-- Reconciliation helper: registry face value that must equal ledger account 2300.
CREATE OR REPLACE FUNCTION prs.banknote_registry_outstanding() RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(denomination_minor), 0)::bigint
    FROM prs.banknotes
   WHERE carries_outstanding_value;
$$;
