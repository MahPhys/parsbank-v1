-- =============================================================================
-- BANK PARS — 0005 · double-entry ledger
-- =============================================================================
-- Every balance-affecting operation produces balanced debit/credit entries.
-- Balances are DERIVED from these rows; there is no mutable balance column on any
-- authoritative path. Ledger rows are append-only and immutable (see 0006).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- accounts — chart of accounts. One per wallet plus institutional control accounts.
-- ---------------------------------------------------------------------------
CREATE TABLE prs.accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,                  -- '1100', 'WALLET:<uuid>', ...
  name_fa        text NOT NULL,
  name_en        text NOT NULL,
  class          text NOT NULL CHECK (class IN ('ASSET','LIABILITY','EQUITY','BANK')),
  kind           text NOT NULL CHECK (kind IN
                   ('CURRENCY_IN_EXISTENCE','WALLET','ESCROW','PHYSICAL_NOTES','FEE_REVENUE',
                    'TREASURY_OPERATING','SUSPENSE')),
  normal_balance text NOT NULL CHECK (normal_balance IN ('DEBIT','CREDIT')),
  allow_negative boolean NOT NULL DEFAULT false,
  is_system      boolean NOT NULL DEFAULT false,
  is_circulating boolean NOT NULL DEFAULT false,        -- counts toward circulating supply
  wallet_id      uuid REFERENCES prs.wallets(id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_wallet_kind_consistency
    CHECK ((kind = 'WALLET') = (wallet_id IS NOT NULL)),
  CONSTRAINT accounts_system_wallets_none
    CHECK (kind = 'WALLET' OR wallet_id IS NULL)
);

CREATE UNIQUE INDEX accounts_system_code_idx ON prs.accounts (code) WHERE wallet_id IS NULL;
CREATE UNIQUE INDEX accounts_wallet_unique ON prs.accounts (wallet_id) WHERE wallet_id IS NOT NULL;

COMMENT ON TABLE prs.accounts IS
  'Chart of accounts. 1100 CURRENCY_IN_EXISTENCE is the mirror of every PRS unit in existence.';

-- ---------------------------------------------------------------------------
-- ledger_transactions — a posting set. Immutable once posted.
-- ---------------------------------------------------------------------------
CREATE TABLE prs.ledger_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_no       bigserial NOT NULL UNIQUE,          -- monotone ledger sequence
  type              text NOT NULL CHECK (type IN
                      ('TRANSFER','QR_PAYMENT','ISSUANCE','BURN','REDEMPTION','DEPOSIT','WITHDRAWAL',
                       'FEE','ESCROW_HOLD','ESCROW_CAPTURE','ESCROW_RELEASE','REVERSAL','ADJUSTMENT')),
  status            text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','REVERSED')),
  idempotency_key   text UNIQUE,
  request_fingerprint prs.hex_hash,
  initiated_by_profile_id uuid REFERENCES prs.profiles(id),
  memo              text,
  reason            text,
  reverses_ledger_transaction_id uuid REFERENCES prs.ledger_transactions(id),
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  posted_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_tx_reversal_requires_reference
    CHECK ((type = 'REVERSAL') = (reverses_ledger_transaction_id IS NOT NULL))
);

CREATE INDEX ledger_tx_type_idx ON prs.ledger_transactions (type, created_at DESC);
CREATE INDEX ledger_tx_initiator_idx ON prs.ledger_transactions (initiated_by_profile_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- ledger_entries — the postings themselves.
-- ---------------------------------------------------------------------------
CREATE TABLE prs.ledger_entries (
  id                    bigserial PRIMARY KEY,
  ledger_transaction_id uuid NOT NULL REFERENCES prs.ledger_transactions(id) ON DELETE RESTRICT,
  account_id            uuid NOT NULL REFERENCES prs.accounts(id) ON DELETE RESTRICT,
  direction             text NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount_minor          prs.money_minor NOT NULL,       -- strictly positive integer PRS
  line_no               int NOT NULL CHECK (line_no > 0),
  memo                  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_unique_line UNIQUE (ledger_transaction_id, line_no)
);

CREATE INDEX ledger_entries_account_idx ON prs.ledger_entries (account_id, id);
CREATE INDEX ledger_entries_tx_idx ON prs.ledger_entries (ledger_transaction_id);

-- ---------------------------------------------------------------------------
-- transactions — the business-level record a user sees. Reference id is random
-- and non-sequential (no enumeration of institution-wide volume).
-- ---------------------------------------------------------------------------
CREATE TABLE prs.transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference           text NOT NULL UNIQUE,             -- PRS-TRX-XXXXXXXXXX
  type                text NOT NULL CHECK (type IN
                        ('TRANSFER','QR_PAYMENT','DEPOSIT','WITHDRAWAL','ISSUANCE','BURN','REDEMPTION',
                         'FEE','REVERSAL','ADJUSTMENT')),
  status              text NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','COMPLETED','FAILED','REVERSED','EXPIRED')),
  channel             text NOT NULL DEFAULT 'WEB'
                        CHECK (channel IN ('WEB','CARD_QR','ADMIN','SYSTEM','PHYSICAL')),
  amount_minor        prs.money_minor NOT NULL,
  fee_minor           prs.nonneg_money_minor NOT NULL DEFAULT 0,
  currency            text NOT NULL DEFAULT 'PRS' CHECK (currency = 'PRS'),
  sender_wallet_id    uuid REFERENCES prs.wallets(id),
  receiver_wallet_id  uuid REFERENCES prs.wallets(id),
  sender_card_id      uuid,
  receiver_card_id    uuid,
  initiated_by_profile_id uuid NOT NULL REFERENCES prs.profiles(id),
  idempotency_key     text,
  request_fingerprint prs.hex_hash,
  ledger_transaction_id uuid REFERENCES prs.ledger_transactions(id),
  reverses_transaction_id uuid REFERENCES prs.transactions(id),
  memo                text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_code        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  CONSTRAINT transactions_wallets_differ
    CHECK (sender_wallet_id IS NULL OR receiver_wallet_id IS NULL OR sender_wallet_id <> receiver_wallet_id),
  CONSTRAINT transactions_completed_has_timestamp
    CHECK (status NOT IN ('COMPLETED','REVERSED') OR completed_at IS NOT NULL)
);

-- Duplicate-submission and replay protection at the database level.
CREATE UNIQUE INDEX transactions_idempotency_unique
  ON prs.transactions (initiated_by_profile_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX transactions_sender_idx ON prs.transactions (sender_wallet_id, created_at DESC);
CREATE INDEX transactions_receiver_idx ON prs.transactions (receiver_wallet_id, created_at DESC);
CREATE INDEX transactions_status_idx ON prs.transactions (status, created_at DESC);
CREATE INDEX transactions_type_idx ON prs.transactions (type, created_at DESC);
CREATE INDEX transactions_daily_limit_idx ON prs.transactions (sender_wallet_id, created_at DESC)
  WHERE status IN ('COMPLETED','PENDING');

COMMENT ON COLUMN prs.transactions.status IS
  'PENDING rows are created inside the same DB transaction that posts the ledger entries; a committed transfer is COMPLETED atomically or does not exist at all.';

-- One posting set per business transaction (L7).
CREATE UNIQUE INDEX transactions_ledger_unique
  ON prs.transactions (ledger_transaction_id) WHERE ledger_transaction_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Immutability: ledger rows can never be updated or deleted (L2, L3).
-- The single permitted state transition (POSTED -> REVERSED) is expressed on the
-- *business* transaction, and the reversal is itself a new posting set.
-- ---------------------------------------------------------------------------
CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON prs.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prs.reject_mutation();

CREATE TRIGGER ledger_transactions_immutable
  BEFORE UPDATE OR DELETE ON prs.ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION prs.reject_mutation();

-- transactions: allow status transitions only, and only legal ones.
CREATE OR REPLACE FUNCTION prs.transactions_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE_TABLE: transactions may not be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.id <> OLD.id
     OR NEW.reference <> OLD.reference
     OR NEW.type <> OLD.type
     OR NEW.amount_minor <> OLD.amount_minor
     OR NEW.currency <> OLD.currency
     OR NEW.initiated_by_profile_id <> OLD.initiated_by_profile_id
     OR COALESCE(NEW.sender_wallet_id::text,'') <> COALESCE(OLD.sender_wallet_id::text,'')
     OR COALESCE(NEW.receiver_wallet_id::text,'') <> COALESCE(OLD.receiver_wallet_id::text,'') THEN
    RAISE EXCEPTION 'IMMUTABLE_TABLE: transactions core fields may not be modified' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'PENDING' AND NEW.status <> OLD.status
     AND NOT (OLD.status IN ('COMPLETED') AND NEW.status IN ('REVERSED')) THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION: % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.ledger_transaction_id IS NOT NULL
     AND NEW.ledger_transaction_id IS DISTINCT FROM OLD.ledger_transaction_id THEN
    RAISE EXCEPTION 'IMMUTABLE_TABLE: ledger_transaction_id may not be reassigned' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER transactions_guard
  BEFORE UPDATE OR DELETE ON prs.transactions
  FOR EACH ROW EXECUTE FUNCTION prs.transactions_status_guard();
