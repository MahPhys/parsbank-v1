-- =============================================================================
-- BANK PARS — 0007 · cards, card credentials, QR tokens, payment sessions
-- =============================================================================
-- The card number and expiry are public (they are printed on the card and shown
-- by the secure QR page). The CVV and the PIN are secrets: they are stored as
-- scrypt hashes and are never returned by any endpoint.
-- =============================================================================

CREATE TABLE prs.cards (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id      uuid NOT NULL REFERENCES prs.wallets(id) ON DELETE RESTRICT,
  profile_id     uuid NOT NULL REFERENCES prs.profiles(id) ON DELETE RESTRICT,
  card_number    text NOT NULL UNIQUE CHECK (card_number ~ '^[0-9]{12}$'),
  cardholder_name_fa text NOT NULL,
  expiry_month   smallint NOT NULL CHECK (expiry_month BETWEEN 1 AND 12),
  expiry_year    smallint NOT NULL CHECK (expiry_year BETWEEN 2020 AND 2100),
  scheme         text NOT NULL DEFAULT 'PARS' CHECK (scheme IN ('PARS')),
  network_label  text NOT NULL DEFAULT 'PARS PRIVATE',
  status         text NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('PENDING','ACTIVE','FROZEN','EXPIRED','CANCELLED')),
  contactless    boolean NOT NULL DEFAULT true,
  daily_limit_minor bigint CHECK (daily_limit_minor IS NULL OR daily_limit_minor > 0),
  issued_at      timestamptz NOT NULL DEFAULT now(),
  activated_at   timestamptz,
  frozen_at      timestamptz,
  cancelled_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cards_wallet_idx ON prs.cards (wallet_id);
CREATE INDEX cards_profile_idx ON prs.cards (profile_id);
CREATE UNIQUE INDEX cards_one_active_per_wallet ON prs.cards (wallet_id) WHERE status = 'ACTIVE';

CREATE TRIGGER cards_touch BEFORE UPDATE ON prs.cards
  FOR EACH ROW EXECUTE FUNCTION prs.touch_updated_at();

-- ---------------------------------------------------------------------------
-- card_credentials — PIN and CVV. Hashed, never printable, never recoverable.
-- ---------------------------------------------------------------------------
CREATE TABLE prs.card_credentials (
  card_id               uuid PRIMARY KEY REFERENCES prs.cards(id) ON DELETE CASCADE,
  pin_hash              text NOT NULL CHECK (length(pin_hash) > 40),
  pin_algo              text NOT NULL DEFAULT 'scrypt-2^15-8-1',
  pin_updated_at        timestamptz NOT NULL DEFAULT now(),
  cvv_hash              text NOT NULL CHECK (length(cvv_hash) > 40),
  cvv_algo              text NOT NULL DEFAULT 'scrypt-2^15-8-1',
  cvv_rotated_at        timestamptz NOT NULL DEFAULT now(),
  failed_pin_attempts   int NOT NULL DEFAULT 0,
  pin_locked_until      timestamptz,
  failed_cvv_attempts   int NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT card_credentials_no_plaintext_columns CHECK (pin_hash <> cvv_hash)
);

COMMENT ON TABLE prs.card_credentials IS
  'PIN/CVV material. Only scrypt hashes live here — the clear values exist once, at issuance, in the response body.';

-- ---------------------------------------------------------------------------
-- card_qr_tokens — the opaque public token printed on the back of the card.
-- The QR image holds the raw token; the database holds only sha256(token), so a
-- database read cannot reproduce a card's QR code, let alone its PIN/CVV.
-- ---------------------------------------------------------------------------
CREATE TABLE prs.card_qr_tokens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id           uuid NOT NULL REFERENCES prs.cards(id) ON DELETE CASCADE,
  token_hash        prs.hex_hash NOT NULL UNIQUE,       -- sha256(raw opaque token)
  token_prefix      text NOT NULL CHECK (token_prefix ~ '^prs1_[0-9A-Z]{4}$'), -- display/reference only
  status            text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ROTATED','REVOKED')),
  issued_at         timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,
  rotated_at        timestamptz,
  revoked_at        timestamptz,
  replaced_by_token_id uuid REFERENCES prs.card_qr_tokens(id),
  verification_count int NOT NULL DEFAULT 0,
  last_verified_at  timestamptz,
  CONSTRAINT card_qr_tokens_active_not_revoked
    CHECK (status <> 'ACTIVE' OR revoked_at IS NULL)
);
CREATE INDEX card_qr_tokens_card_idx ON prs.card_qr_tokens (card_id);
CREATE UNIQUE INDEX card_qr_tokens_one_active ON prs.card_qr_tokens (card_id) WHERE status = 'ACTIVE';

COMMENT ON COLUMN prs.card_qr_tokens.token_prefix IS
  'First characters of the raw token, for human support reference. Contains no secret and cannot be used to reconstruct the token.';

-- ---------------------------------------------------------------------------
-- card_payment_sessions — lifecycle of a scanned QR payment.
-- A session is created when a QR is scanned; it binds the destination card, then
-- the payer authenticates and confirms. Destination number must match the session.
-- ---------------------------------------------------------------------------
CREATE TABLE prs.card_payment_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_ref          text NOT NULL UNIQUE,
  qr_token_id         uuid NOT NULL REFERENCES prs.card_qr_tokens(id) ON DELETE RESTRICT,
  destination_card_id uuid NOT NULL REFERENCES prs.cards(id) ON DELETE RESTRICT,
  payer_profile_id    uuid REFERENCES prs.profiles(id) ON DELETE SET NULL,
  payer_wallet_id     uuid REFERENCES prs.wallets(id) ON DELETE SET NULL,
  amount_minor        bigint CHECK (amount_minor IS NULL OR amount_minor > 0),
  status              text NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN','AWAITING_AUTHORIZATION','COMPLETED','EXPIRED','ABORTED','FAILED')),
  scan_ip_hash        prs.hex_hash,
  user_agent          text,
  failure_code        text,
  transaction_id      uuid REFERENCES prs.transactions(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  completed_at        timestamptz,
  CONSTRAINT card_payment_sessions_window CHECK (expires_at > created_at),
  CONSTRAINT card_payment_sessions_completed CHECK (status <> 'COMPLETED' OR transaction_id IS NOT NULL)
);
CREATE INDEX card_payment_sessions_recent_idx ON prs.card_payment_sessions (created_at DESC);
CREATE INDEX card_payment_sessions_open_idx ON prs.card_payment_sessions (status) WHERE status IN ('OPEN','AWAITING_AUTHORIZATION');

-- ---------------------------------------------------------------------------
-- card_events — append-only card lifecycle log (issuance, PIN change, QR rotation,
-- freeze, verification). Distinct from audit_logs: this is the card's own file.
-- ---------------------------------------------------------------------------
CREATE TABLE prs.card_events (
  id          bigserial PRIMARY KEY,
  card_id     uuid NOT NULL REFERENCES prs.cards(id) ON DELETE CASCADE,
  event       text NOT NULL CHECK (event IN
                ('ISSUED','ACTIVATED','PIN_SET','PIN_CHANGED','PIN_FAILED','CVV_VERIFIED','CVV_FAILED',
                 'QR_ISSUED','QR_ROTATED','QR_VERIFIED','FROZEN','UNFROZEN','CANCELLED','USED_IN_PAYMENT')),
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id    uuid REFERENCES prs.profiles(id),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX card_events_card_idx ON prs.card_events (card_id, occurred_at DESC);

CREATE TRIGGER card_events_immutable
  BEFORE UPDATE OR DELETE ON prs.card_events
  FOR EACH ROW EXECUTE FUNCTION prs.reject_mutation();
