-- =============================================================================
-- BANK PARS — 0006 · ledger invariants, derived balances, integrity views
-- =============================================================================
-- The invariants below are DEFERRED CONSTRAINT TRIGGERS: they fire at COMMIT.
-- A service bug that posts an unbalanced set, an overdraft or a supply breach
-- therefore cannot be committed — the database refuses the whole transaction.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- L1 — every posting set balances: Σ debits = Σ credits
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prs.enforce_entry_set_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_tx     uuid := COALESCE(NEW.ledger_transaction_id, OLD.ledger_transaction_id);
  v_debit  bigint;
  v_credit bigint;
  v_lines  int;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT'  THEN amount_minor END), 0),
         COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor END), 0),
         count(*)
    INTO v_debit, v_credit, v_lines
    FROM prs.ledger_entries
   WHERE ledger_transaction_id = v_tx;

  IF v_lines < 2 THEN
    RAISE EXCEPTION 'LEDGER_INCOMPLETE: posting set % has % entries (minimum 2)', v_tx, v_lines
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'LEDGER_UNBALANCED: posting set % debits % <> credits %', v_tx, v_debit, v_credit
      USING ERRCODE = 'check_violation',
            HINT = 'Double-entry: total debits must equal total credits for every completed transaction.';
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON prs.ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION prs.enforce_entry_set_balance();

-- ---------------------------------------------------------------------------
-- L4 — no overdraft on accounts that do not allow it
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prs.enforce_account_not_negative() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_account uuid := COALESCE(NEW.account_id, OLD.account_id);
  v_allow   boolean;
  v_normal  text;
  v_bal     bigint;
BEGIN
  SELECT allow_negative, normal_balance INTO v_allow, v_normal FROM prs.accounts WHERE id = v_account;
  IF v_allow IS NULL OR v_allow THEN
    RETURN NULL;
  END IF;

  -- Balance measured in the account's own normal direction:
  -- debit-normal accounts (1100 currency in existence) grow with debits and may
  -- never go below zero; credit-normal accounts (wallets, liabilities) grow with
  -- credits and may never go below zero either.
  SELECT COALESCE(
           CASE WHEN v_normal = 'DEBIT'
                THEN SUM(CASE WHEN direction = 'DEBIT' THEN amount_minor ELSE -amount_minor END)
                ELSE SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE -amount_minor END)
           END, 0)
    INTO v_bal
    FROM prs.ledger_entries
   WHERE account_id = v_account;

  IF v_bal < 0 THEN
    RAISE EXCEPTION 'LEDGER_OVERDRAFT: account % would hold % (negative balances are forbidden)', v_account, v_bal
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER ledger_entries_no_overdraft
  AFTER INSERT ON prs.ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION prs.enforce_account_not_negative();

-- ---------------------------------------------------------------------------
-- L5 — supply can never exceed max supply
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prs.enforce_supply_cap() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_account uuid := COALESCE(NEW.account_id, OLD.account_id);
  v_code    text;
  v_issued  bigint;
  v_max     bigint;
BEGIN
  SELECT code INTO v_code FROM prs.accounts WHERE id = v_account;
  IF v_code IS DISTINCT FROM '1100' THEN
    RETURN NULL;
  END IF;

  SELECT total_issued_minor INTO v_issued FROM prs.supply_summary;
  v_max := prs.setting_bigint('max_supply_minor', 10000);

  IF v_issued > v_max THEN
    RAISE EXCEPTION 'SUPPLY_CAP_EXCEEDED: resulting supply % exceeds maximum supply %', v_issued, v_max
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_issued < 0 THEN
    RAISE EXCEPTION 'SUPPLY_NEGATIVE: total issued would be %', v_issued USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER ledger_entries_supply_cap
  AFTER INSERT ON prs.ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION prs.enforce_supply_cap();

-- ---------------------------------------------------------------------------
-- L9 — balance cache must be refreshed with the ledger, and drift is detectable
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prs.refresh_wallet_balance(p_wallet_id uuid) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_balance bigint;
  v_seq     bigint;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END), 0)
    INTO v_balance
    FROM prs.ledger_entries e
    JOIN prs.accounts a ON a.id = e.account_id
   WHERE a.wallet_id = p_wallet_id;

  SELECT COALESCE(MAX(sequence_no), 0) INTO v_seq FROM prs.ledger_transactions;

  INSERT INTO prs.wallet_balance_cache (wallet_id, balance_minor, ledger_sequence, updated_at)
  VALUES (p_wallet_id, v_balance, v_seq, now())
  ON CONFLICT (wallet_id) DO UPDATE
    SET balance_minor = EXCLUDED.balance_minor,
        ledger_sequence = EXCLUDED.ledger_sequence,
        updated_at = now();

  RETURN v_balance;
END $$;

-- The cache is maintained BY THE DATABASE, not by service code: every inserted
-- entry refreshes its wallet. A service cannot forget to do it, and a rolled-back
-- transaction rolls the cache update back with it.
CREATE OR REPLACE FUNCTION prs.trigger_refresh_wallet_cache() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_wallet uuid;
BEGIN
  SELECT wallet_id INTO v_wallet FROM prs.accounts WHERE id = NEW.account_id;
  IF v_wallet IS NOT NULL THEN
    PERFORM prs.refresh_wallet_balance(v_wallet);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER ledger_entries_refresh_cache
  AFTER INSERT ON prs.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prs.trigger_refresh_wallet_cache();

CREATE OR REPLACE FUNCTION prs.wallet_balance(p_wallet_id uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END), 0)::bigint
    FROM prs.ledger_entries e
    JOIN prs.accounts a ON a.id = e.account_id
   WHERE a.wallet_id = p_wallet_id;
$$;

-- Balance in the account's OWN normal direction (positive == healthy).
-- Debit-normal accounts (1100) report debits - credits; liabilities and equity
-- report credits - debits. Callers never need to know which is which.
CREATE OR REPLACE FUNCTION prs.account_balance(p_account_id uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
           CASE WHEN a.normal_balance = 'DEBIT'
                THEN SUM(CASE WHEN e.direction = 'DEBIT' THEN e.amount_minor ELSE -e.amount_minor END)
                ELSE SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END)
           END, 0)::bigint
    FROM prs.accounts a
    LEFT JOIN prs.ledger_entries e ON e.account_id = a.id
   WHERE a.id = p_account_id
   GROUP BY a.normal_balance;
$$;

CREATE OR REPLACE FUNCTION prs.account_balance_by_code(p_code text) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
           CASE WHEN a.normal_balance = 'DEBIT'
                THEN SUM(CASE WHEN e.direction = 'DEBIT' THEN e.amount_minor ELSE -e.amount_minor END)
                ELSE SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END)
           END, 0)::bigint
    FROM prs.accounts a
    LEFT JOIN prs.ledger_entries e ON e.account_id = a.id
   WHERE a.code = p_code
   GROUP BY a.normal_balance;
$$;

COMMENT ON FUNCTION prs.account_balance_by_code(text) IS
  'Balance of a chart account expressed in its normal direction (1100: debits-credits, 2300: credits-debits).';

-- Drift detector: returns one row per wallet whose cache disagrees with the ledger.
CREATE OR REPLACE FUNCTION prs.verify_balance_cache() RETURNS TABLE (
  wallet_id uuid, cached_minor bigint, ledger_minor bigint, drift_minor bigint)
LANGUAGE sql STABLE AS $$
  SELECT w.id,
         COALESCE(c.balance_minor, 0),
         prs.wallet_balance(w.id),
         COALESCE(c.balance_minor, 0) - prs.wallet_balance(w.id)
    FROM prs.wallets w
    LEFT JOIN prs.wallet_balance_cache c ON c.wallet_id = w.id
   WHERE COALESCE(c.balance_minor, 0) <> prs.wallet_balance(w.id);
$$;

-- ---------------------------------------------------------------------------
-- Derived balance views — the authoritative read path for balances
-- ---------------------------------------------------------------------------
CREATE VIEW prs.account_balances AS
SELECT a.id                AS account_id,
       a.code              AS code,
       a.name_fa,
       a.class,
       a.kind,
       a.normal_balance,
       a.allow_negative,
       a.is_system,
       a.is_circulating,
       a.wallet_id,
       COALESCE(SUM(CASE WHEN e.direction = 'DEBIT'  THEN e.amount_minor ELSE 0 END), 0)::bigint AS debits_minor,
       COALESCE(SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_minor ELSE 0 END), 0)::bigint AS credits_minor,
       (COALESCE(SUM(CASE WHEN e.direction = 'DEBIT'  THEN e.amount_minor ELSE -e.amount_minor END), 0))::bigint AS debit_balance_minor,
       (COALESCE(SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END), 0))::bigint AS credit_balance_minor
  FROM prs.accounts a
  LEFT JOIN prs.ledger_entries e ON e.account_id = a.id
 GROUP BY a.id;

COMMENT ON VIEW prs.account_balances IS
  'Balances derived from the ledger. Nothing in the system stores a mutable balance as truth.';

CREATE VIEW prs.wallet_balances AS
SELECT w.id            AS wallet_id,
       w.public_ref,
       w.profile_id,
       w.status        AS wallet_status,
       w.kind,
       w.is_primary,
       a.id            AS account_id,
       COALESCE(SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END), 0)::bigint AS balance_minor
  FROM prs.wallets w
  JOIN prs.accounts a ON a.wallet_id = w.id
  LEFT JOIN prs.ledger_entries e ON e.account_id = a.id
 GROUP BY w.id, w.public_ref, w.profile_id, w.status, w.kind, w.is_primary, a.id;

CREATE VIEW prs.supply_summary AS
SELECT
  COALESCE(MAX(CASE WHEN code = '1100' THEN debit_balance_minor END), 0)::bigint AS total_issued_minor,
  COALESCE(MAX(CASE WHEN code = '1100' THEN debit_balance_minor END), 0)::bigint
    - COALESCE(SUM(CASE WHEN is_circulating THEN credit_balance_minor ELSE 0 END), 0)::bigint AS bank_held_minor,
  COALESCE(SUM(CASE WHEN is_circulating THEN credit_balance_minor ELSE 0 END), 0)::bigint AS circulating_supply_minor
FROM prs.account_balances;

COMMENT ON VIEW prs.supply_summary IS
  'total_issued = balance(1100). circulating + bank_held = total_issued by construction.';
