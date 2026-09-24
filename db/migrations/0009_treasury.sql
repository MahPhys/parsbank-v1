-- =============================================================================
-- BANK PARS — 0009 · treasury, reserves, issuance, burning, redemption, rates
-- =============================================================================
-- This migration also seeds the institutional chart of accounts and defines the
-- monetary state machine: snapshot refresh + integrity check.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- institutional accounts (the rest of the chart of accounts)
-- ---------------------------------------------------------------------------
INSERT INTO prs.accounts (code, name_fa, name_en, class, kind, normal_balance, allow_negative, is_system, is_circulating) VALUES
  ('1100', 'پول در جریان وجود',   'CURRENCY_IN_EXISTENCE',       'ASSET',     'CURRENCY_IN_EXISTENCE', 'DEBIT',  false, true, false),
  ('2200', 'وجوه در انتقال',       'ESCROW_IN_FLIGHT',            'LIABILITY', 'ESCROW',                'CREDIT', false, true, true),
  ('2300', 'اسکناس‌های در گردش',   'PHYSICAL_NOTES_OUTSTANDING',  'LIABILITY', 'PHYSICAL_NOTES',        'CREDIT', false, true, true),
  ('2500', 'درآمد کارمزد',         'FEE_REVENUE',                 'EQUITY',    'FEE_REVENUE',           'CREDIT', false, true, false),
  ('2600', 'خزانه عملیاتی',        'TREASURY_OPERATING',          'BANK',      'TREASURY_OPERATING',    'CREDIT', false, true, false),
  ('2700', 'حساب میانی تسویه',     'SUSPENSE_CLEARING',           'BANK',      'SUSPENSE',              'CREDIT', true,  true, false);

COMMENT ON TABLE prs.accounts IS
  '1100 debits = total PRS ever issued. Circulating = WALLET + ESCROW + PHYSICAL_NOTES accounts.';

-- ---------------------------------------------------------------------------
-- treasury_accounts — custodian view of institutional holdings
-- ---------------------------------------------------------------------------
CREATE TABLE prs.treasury_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE,
  name_fa           text NOT NULL,
  name_en           text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('OPERATING','FEE','VAULT','ESCROW','RESERVE')),
  ledger_account_id uuid NOT NULL REFERENCES prs.accounts(id) ON DELETE RESTRICT,
  custodian_name    text,
  status            text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DORMANT','CLOSED')),
  opened_at         timestamptz NOT NULL DEFAULT now(),
  notes             text
);

INSERT INTO prs.treasury_accounts (code, name_fa, name_en, kind, ledger_account_id, custodian_name) VALUES
  ('TRS-OPS', 'خزانه عملیاتی', 'Treasury Operating', 'OPERATING', (SELECT id FROM prs.accounts WHERE code = '2600'), 'BANK PARS TREASURY'),
  ('TRS-FEE', 'درآمد کارمزد',  'Fee Revenue',        'FEE',       (SELECT id FROM prs.accounts WHERE code = '2500'), 'BANK PARS TREASURY'),
  ('TRS-VLT', 'خزانه اسکناس',  'Note Vault',         'VAULT',     (SELECT id FROM prs.accounts WHERE code = '2300'), 'BANK PARS VAULT'),
  ('TRS-ESC', 'تسویه در جریان','Clearing Escrow',    'ESCROW',    (SELECT id FROM prs.accounts WHERE code = '2200'), 'BANK PARS OPERATIONS');

-- ---------------------------------------------------------------------------
-- treasury_reserves — the reserve book backing issued PRS (USD book value).
-- Eligibility + haircut determine "eligible reserve NAV".
-- ---------------------------------------------------------------------------
CREATE TABLE prs.treasury_reserves (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reserve_ref           text NOT NULL UNIQUE,
  asset_kind            text NOT NULL CHECK (asset_kind IN
                          ('CASH_USD','CUSTODY_DEPOSIT','GOLD','SILVER','SOVEREIGN_BOND','CORPORATE_BOND','OTHER')),
  description_fa        text NOT NULL,
  book_value_usd_minor  bigint NOT NULL CHECK (book_value_usd_minor >= 0),
  haircut_bps           int NOT NULL DEFAULT 0 CHECK (haircut_bps BETWEEN 0 AND 10000),
  eligibility           text NOT NULL DEFAULT 'ELIGIBLE' CHECK (eligibility IN ('ELIGIBLE','INELIGIBLE','PENDING_REVIEW')),
  status                text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RELEASED','FROZEN','PENDING')),
  custodian             text NOT NULL DEFAULT 'BANK PARS TREASURY',
  evidence_ref          text,
  contributed_by        uuid REFERENCES prs.profiles(id),
  contribution_date     timestamptz NOT NULL DEFAULT now(),
  last_valued_at        timestamptz,
  approved_by           uuid REFERENCES prs.profiles(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT treasury_reserves_dual_control
    CHECK (contributed_by IS NULL OR approved_by IS NULL OR contributed_by <> approved_by)
);

CREATE INDEX treasury_reserves_status_idx ON prs.treasury_reserves (status, eligibility);
CREATE TRIGGER treasury_reserves_touch BEFORE UPDATE ON prs.treasury_reserves
  FOR EACH ROW EXECUTE FUNCTION prs.touch_updated_at();

-- ---------------------------------------------------------------------------
-- monetary_state — single-row derived snapshot of the whole monetary system.
-- Refreshed only by prs.refresh_monetary_state() inside a posting transaction.
-- ---------------------------------------------------------------------------
CREATE TABLE prs.monetary_state (
  id                        smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  max_supply_minor          bigint NOT NULL CHECK (max_supply_minor > 0),
  total_issued_minor        bigint NOT NULL CHECK (total_issued_minor >= 0),
  circulating_supply_minor  bigint NOT NULL CHECK (circulating_supply_minor >= 0),
  bank_held_minor           bigint NOT NULL CHECK (bank_held_minor >= 0),
  treasury_reserve_usd_minor bigint NOT NULL DEFAULT 0 CHECK (treasury_reserve_usd_minor >= 0),
  eligible_reserve_nav_usd_minor bigint NOT NULL DEFAULT 0 CHECK (eligible_reserve_nav_usd_minor >= 0),
  reserve_coverage_ratio    numeric(18,8) NOT NULL DEFAULT 0,
  reference_rate_prs_per_usd numeric(18,8) NOT NULL DEFAULT 1,
  par_value_usd_minor       bigint NOT NULL DEFAULT 100,
  is_parity_fallback        boolean NOT NULL DEFAULT true,
  as_of                     timestamptz NOT NULL DEFAULT now(),
  ledger_sequence           bigint NOT NULL DEFAULT 0,
  version                   bigint NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- reserve_valuations — immutable, timestamped valuation snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE prs.reserve_valuations (
  id                    bigserial PRIMARY KEY,
  as_of                 timestamptz NOT NULL DEFAULT now(),
  ledger_sequence       bigint NOT NULL,
  total_issued_minor    bigint NOT NULL,
  circulating_supply_minor bigint NOT NULL,
  bank_held_minor       bigint NOT NULL,
  treasury_reserve_usd_minor bigint NOT NULL,
  eligible_reserve_nav_usd_minor bigint NOT NULL,
  reserve_coverage_ratio numeric(18,8) NOT NULL,
  reference_rate_prs_per_usd numeric(18,8) NOT NULL,
  par_value_usd_minor   bigint NOT NULL,
  eligible_reserve_count int NOT NULL DEFAULT 0,
  reasons               text[] NOT NULL DEFAULT '{}',
  triggered_by_profile_id uuid REFERENCES prs.profiles(id)
);

CREATE INDEX reserve_valuations_asof_idx ON prs.reserve_valuations (as_of DESC);
CREATE TRIGGER reserve_valuations_immutable BEFORE UPDATE OR DELETE ON prs.reserve_valuations
  FOR EACH ROW EXECUTE FUNCTION prs.reject_mutation();

-- ---------------------------------------------------------------------------
-- exchange_rates — immutable reference rate snapshots (PRS per USD)
-- ---------------------------------------------------------------------------
CREATE TABLE prs.exchange_rates (
  id                    bigserial PRIMARY KEY,
  base_currency         text NOT NULL DEFAULT 'PRS',
  quote_currency        text NOT NULL DEFAULT 'USD',
  rate_prs_per_usd      numeric(18,8) NOT NULL CHECK (rate_prs_per_usd > 0),
  inverse_rate_usd_per_prs numeric(18,8) NOT NULL CHECK (inverse_rate_usd_per_prs > 0),
  source                text NOT NULL DEFAULT 'RESERVE_MODEL'
                          CHECK (source IN ('RESERVE_MODEL','PARITY_FALLBACK','MANUAL_POLICY')),
  is_parity_fallback    boolean NOT NULL DEFAULT false,
  valuation_id          bigint REFERENCES prs.reserve_valuations(id),
  effective_at          timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES prs.profiles(id),
  note                  text
);

CREATE INDEX exchange_rates_effective_idx ON prs.exchange_rates (effective_at DESC);
CREATE TRIGGER exchange_rates_immutable BEFORE UPDATE OR DELETE ON prs.exchange_rates
  FOR EACH ROW EXECUTE FUNCTION prs.reject_mutation();

-- ---------------------------------------------------------------------------
-- issuances — authorised money creation. Creation without this row is impossible.
-- ---------------------------------------------------------------------------
CREATE TABLE prs.issuances (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuance_ref          text NOT NULL UNIQUE,
  amount_minor          prs.money_minor NOT NULL,
  destination_kind      text NOT NULL CHECK (destination_kind IN ('WALLET','PHYSICAL_NOTES')),
  destination_wallet_id uuid REFERENCES prs.wallets(id),
  reserve_id            uuid REFERENCES prs.treasury_reserves(id) ON DELETE RESTRICT,
  reserve_contribution_usd_minor bigint NOT NULL DEFAULT 0 CHECK (reserve_contribution_usd_minor >= 0),
  reason                text NOT NULL CHECK (length(btrim(reason)) >= 8),
  authorizer_profile_id uuid NOT NULL REFERENCES prs.profiles(id),
  second_approver_profile_id uuid NOT NULL REFERENCES prs.profiles(id),
  approved_at           timestamptz NOT NULL,
  ledger_transaction_id uuid NOT NULL REFERENCES prs.ledger_transactions(id),
  admin_action_id       uuid,
  resulting_supply_minor bigint NOT NULL,
  resulting_circulating_supply_minor bigint NOT NULL,
  resulting_coverage_ratio numeric(18,8) NOT NULL,
  resulting_reference_rate numeric(18,8) NOT NULL,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT issuances_dual_approval CHECK (authorizer_profile_id <> second_approver_profile_id),
  CONSTRAINT issuances_destination_consistency
    CHECK ((destination_kind = 'WALLET') = (destination_wallet_id IS NOT NULL)),
  CONSTRAINT issuances_requires_reserve_reference
    CHECK (reserve_contribution_usd_minor = 0 OR reserve_id IS NOT NULL)
);

CREATE INDEX issuances_recent_idx ON prs.issuances (created_at DESC);
CREATE TRIGGER issuances_immutable BEFORE UPDATE OR DELETE ON prs.issuances
  FOR EACH ROW EXECUTE FUNCTION prs.reject_mutation();

COMMENT ON TABLE prs.issuances IS
  'Every row is a complete monetary event record: amount, reserve contribution, reason, authorizer, second approver, timestamp, ledger transaction, resulting supply and coverage.';

-- ---------------------------------------------------------------------------
-- burns — ledger-based destruction. History is never deleted.
-- ---------------------------------------------------------------------------
CREATE TABLE prs.burns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  burn_ref              text NOT NULL UNIQUE,
  kind                  text NOT NULL CHECK (kind IN ('LEDGER','PHYSICAL_NOTE_DESTRUCTION')),
  amount_minor          prs.money_minor NOT NULL,
  source_wallet_id      uuid REFERENCES prs.wallets(id),
  banknote_id           uuid REFERENCES prs.banknotes(id) ON DELETE RESTRICT,
  destruction_ref       text,
  reason                text NOT NULL CHECK (length(btrim(reason)) >= 8),
  authorizer_profile_id uuid NOT NULL REFERENCES prs.profiles(id),
  second_approver_profile_id uuid NOT NULL REFERENCES prs.profiles(id),
  approved_at           timestamptz NOT NULL,
  ledger_transaction_id uuid NOT NULL REFERENCES prs.ledger_transactions(id),
  admin_action_id       uuid,
  resulting_supply_minor bigint NOT NULL,
  resulting_circulating_supply_minor bigint NOT NULL,
  resulting_coverage_ratio numeric(18,8) NOT NULL,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT burns_dual_approval CHECK (authorizer_profile_id <> second_approver_profile_id),
  CONSTRAINT burns_source_consistency
    CHECK ((kind = 'LEDGER') = (source_wallet_id IS NOT NULL)),
  CONSTRAINT burns_note_consistency
    CHECK (kind <> 'PHYSICAL_NOTE_DESTRUCTION' OR banknote_id IS NOT NULL)
);

CREATE INDEX burns_recent_idx ON prs.burns (created_at DESC);
CREATE TRIGGER burns_immutable BEFORE UPDATE OR DELETE ON prs.burns
  FOR EACH ROW EXECUTE FUNCTION prs.reject_mutation();

-- ---------------------------------------------------------------------------
-- redemptions — returning PRS to the reserve (dual approved, frozen rate)
-- ---------------------------------------------------------------------------
CREATE TABLE prs.redemptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  redemption_ref        text NOT NULL UNIQUE,
  requested_by          uuid NOT NULL REFERENCES prs.profiles(id),
  wallet_id             uuid NOT NULL REFERENCES prs.wallets(id),
  amount_minor          prs.money_minor NOT NULL,
  fee_minor             bigint NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  frozen_rate_id        bigint REFERENCES prs.exchange_rates(id),
  settlement_value_usd_minor bigint NOT NULL CHECK (settlement_value_usd_minor >= 0),
  reserve_id            uuid REFERENCES prs.treasury_reserves(id) ON DELETE RESTRICT,
  status                text NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','APPROVED','SETTLED','REJECTED','CANCELLED')),
  authorizer_profile_id uuid REFERENCES prs.profiles(id),
  second_approver_profile_id uuid REFERENCES prs.profiles(id),
  ledger_transaction_id uuid REFERENCES prs.ledger_transactions(id),
  admin_action_id       uuid,
  reason                text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  decided_at            timestamptz,
  CONSTRAINT redemptions_dual_approval
    CHECK (authorizer_profile_id IS NULL OR second_approver_profile_id IS NULL
           OR authorizer_profile_id <> second_approver_profile_id),
  CONSTRAINT redemptions_settled_requires_ledger
    CHECK (status <> 'SETTLED' OR ledger_transaction_id IS NOT NULL)
);

CREATE INDEX redemptions_status_idx ON prs.redemptions (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- prs.eligible_reserve_nav() — Σ book value × (1 − haircut) for eligible, active
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prs.eligible_reserve_nav() RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM((book_value_usd_minor * (10000 - haircut_bps)) / 10000), 0)::bigint
    FROM prs.treasury_reserves
   WHERE status = 'ACTIVE' AND eligibility = 'ELIGIBLE';
$$;

CREATE OR REPLACE FUNCTION prs.total_reserve_book_value() RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(book_value_usd_minor), 0)::bigint
    FROM prs.treasury_reserves
   WHERE status = 'ACTIVE';
$$;

-- ---------------------------------------------------------------------------
-- prs.refresh_monetary_state() — recompute the snapshot and append history rows.
-- Called inside the posting transaction of every supply-affecting operation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prs.refresh_monetary_state(
  p_actor uuid DEFAULT NULL,
  p_reasons text[] DEFAULT '{}'
) RETURNS prs.monetary_state
LANGUAGE plpgsql AS $$
DECLARE
  v_max           bigint := prs.setting_bigint('max_supply_minor', 10000);
  v_par           bigint := prs.setting_bigint('policy.par_value_usd_minor', 100);
  v_issued        bigint;
  v_circulating   bigint;
  v_bank          bigint;
  v_reserve       bigint;
  v_nav           bigint;
  v_coverage      numeric(18,8);
  v_rate          numeric(18,8);
  v_fallback      boolean;
  v_seq           bigint;
  v_valuation_id  bigint;
  v_row           prs.monetary_state;
  v_eligible_count int;
BEGIN
  SELECT total_issued_minor, circulating_supply_minor, bank_held_minor
    INTO v_issued, v_circulating, v_bank
    FROM prs.supply_summary;

  v_reserve := prs.total_reserve_book_value();
  v_nav     := prs.eligible_reserve_nav();
  SELECT count(*) INTO v_eligible_count FROM prs.treasury_reserves WHERE status = 'ACTIVE' AND eligibility = 'ELIGIBLE';
  SELECT COALESCE(MAX(sequence_no), 0) INTO v_seq FROM prs.ledger_transactions;

  IF v_circulating > 0 THEN
    v_rate     := round(v_nav::numeric / v_circulating::numeric, 8);
    v_coverage := round((v_nav::numeric * 100)::numeric
                        / (v_circulating::numeric * GREATEST(v_par, 1)::numeric), 8);
    v_fallback := false;
  ELSE
    -- No circulating PRS: publish par rather than inventing a rate by dividing by zero.
    v_rate     := round(v_par::numeric, 8);
    v_coverage := 0;
    v_fallback := true;
  END IF;

  SELECT id, max_supply_minor, total_issued_minor, circulating_supply_minor, bank_held_minor,
         treasury_reserve_usd_minor, eligible_reserve_nav_usd_minor, reserve_coverage_ratio,
         reference_rate_prs_per_usd, par_value_usd_minor, is_parity_fallback, as_of,
         ledger_sequence, version
    INTO v_row
    FROM prs.monetary_state WHERE id = 1;

  INSERT INTO prs.reserve_valuations (
      ledger_sequence, total_issued_minor, circulating_supply_minor, bank_held_minor,
      treasury_reserve_usd_minor, eligible_reserve_nav_usd_minor, reserve_coverage_ratio,
      reference_rate_prs_per_usd, par_value_usd_minor, eligible_reserve_count, reasons,
      triggered_by_profile_id)
  VALUES (v_seq, v_issued, v_circulating, v_bank, v_reserve, v_nav, v_coverage, v_rate, v_par,
          v_eligible_count, COALESCE(p_reasons, '{}'), p_actor)
  RETURNING id INTO v_valuation_id;

  IF v_row.id IS NULL THEN
    INSERT INTO prs.monetary_state (
        id, max_supply_minor, total_issued_minor, circulating_supply_minor, bank_held_minor,
        treasury_reserve_usd_minor, eligible_reserve_nav_usd_minor, reserve_coverage_ratio,
        reference_rate_prs_per_usd, par_value_usd_minor, is_parity_fallback, as_of,
        ledger_sequence, version)
    VALUES (1, v_max, v_issued, v_circulating, v_bank, v_reserve, v_nav, v_coverage, v_rate, v_par,
            v_fallback, now(), v_seq, 1);
  ELSE
    UPDATE prs.monetary_state SET
        max_supply_minor = v_max,
        total_issued_minor = v_issued,
        circulating_supply_minor = v_circulating,
        bank_held_minor = v_bank,
        treasury_reserve_usd_minor = v_reserve,
        eligible_reserve_nav_usd_minor = v_nav,
        reserve_coverage_ratio = v_coverage,
        reference_rate_prs_per_usd = v_rate,
        par_value_usd_minor = v_par,
        is_parity_fallback = v_fallback,
        as_of = now(),
        ledger_sequence = v_seq,
        version = v_row.version + 1
     WHERE id = 1;
  END IF;

  -- A rate snapshot is appended whenever the reference rate or coverage changes.
  IF v_row.id IS NULL
     OR v_row.reference_rate_prs_per_usd IS DISTINCT FROM v_rate
     OR v_row.reserve_coverage_ratio IS DISTINCT FROM v_coverage
     OR v_row.circulating_supply_minor IS DISTINCT FROM v_circulating THEN
    INSERT INTO prs.exchange_rates (
        rate_prs_per_usd, inverse_rate_usd_per_prs, source, is_parity_fallback,
        valuation_id, created_by, note)
    VALUES (v_rate,
            round(1::numeric / GREATEST(v_rate, 0.00000001), 8),
            CASE WHEN v_fallback THEN 'PARITY_FALLBACK' ELSE 'RESERVE_MODEL' END,
            v_fallback, v_valuation_id, p_actor,
            format('circulating=%s nav_usd_minor=%s coverage=%s', v_circulating, v_nav, v_coverage));
  END IF;

  SELECT * INTO v_row FROM prs.monetary_state WHERE id = 1;
  RETURN v_row;
END $$;

-- ---------------------------------------------------------------------------
-- prs.check_monetary_integrity() — the institution's own audit routine.
-- Returns zero rows when every invariant holds.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prs.check_monetary_integrity() RETURNS TABLE (
  check_code text, severity text, detail text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_supply   record;
  v_state    prs.monetary_state;
  v_max      bigint := prs.setting_bigint('max_supply_minor', 10000);
  v_registry bigint;
  v_2300     bigint;
  v_imbalance bigint;
BEGIN
  SELECT * INTO v_supply FROM prs.supply_summary;
  SELECT * INTO v_state FROM prs.monetary_state WHERE id = 1;

  IF v_supply.total_issued_minor > v_max THEN
    RETURN QUERY SELECT 'SUPPLY_CAP', 'CRITICAL',
      format('total issued %s exceeds max supply %s', v_supply.total_issued_minor, v_max);
  END IF;

  IF v_supply.circulating_supply_minor + v_supply.bank_held_minor <> v_supply.total_issued_minor THEN
    RETURN QUERY SELECT 'SUPPLY_IDENTITY', 'CRITICAL',
      format('circulating(%s) + bank_held(%s) <> total issued(%s)',
             v_supply.circulating_supply_minor, v_supply.bank_held_minor, v_supply.total_issued_minor);
  END IF;

  IF v_supply.total_issued_minor <> prs.account_balance_by_code('1100') THEN
    RETURN QUERY SELECT 'CURRENCY_IN_EXISTENCE', 'CRITICAL',
      format('account 1100 balance %s <> supply summary %s',
             prs.account_balance_by_code('1100'), v_supply.total_issued_minor);
  END IF;

  IF v_state.id IS NOT NULL AND v_state.circulating_supply_minor <> v_supply.circulating_supply_minor THEN
    RETURN QUERY SELECT 'STATE_DRIFT', 'CRITICAL',
      format('monetary_state circulating %s <> ledger %s',
             v_state.circulating_supply_minor, v_supply.circulating_supply_minor);
  END IF;

  -- Unbalanced posting sets (should be impossible: deferred trigger).
  SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_minor ELSE -amount_minor END), 0)
    INTO v_imbalance
    FROM prs.ledger_entries;
  IF v_imbalance <> 0 THEN
    RETURN QUERY SELECT 'LEDGER_BALANCE', 'CRITICAL',
      format('global ledger imbalance of %s PRS (debits <> credits)', v_imbalance);
  END IF;

  -- Physical note registry vs ledger account 2300.
  v_registry := prs.banknote_registry_outstanding();
  v_2300     := prs.account_balance_by_code('2300');
  IF v_registry <> v_2300 THEN
    RETURN QUERY SELECT 'BANKNOTE_RECONCILIATION', 'CRITICAL',
      format('note registry outstanding %s <> ledger 2300 balance %s', v_registry, v_2300);
  END IF;

  -- Balance cache drift.
  RETURN QUERY
    SELECT 'BALANCE_CACHE_DRIFT', 'CRITICAL',
           format('wallet %s cached %s <> ledger %s', wallet_id, cached_minor, ledger_minor)
      FROM prs.verify_balance_cache();

  -- Note status/value consistency.
  RETURN QUERY
    SELECT 'NOTE_VALUE_FLAG', 'WARNING',
           format('banknote %s status %s carries_outstanding_value=%s', id, status, carries_outstanding_value)
      FROM prs.banknotes
     WHERE carries_outstanding_value IS DISTINCT FROM
           (status IN ('ASSIGNED','IN_CIRCULATION','FROZEN','LOST','STOLEN'));

  RETURN;
END $$;

COMMENT ON FUNCTION prs.check_monetary_integrity() IS
  'Server-side monetary audit. System Health and the audit CLI both consume this.';
