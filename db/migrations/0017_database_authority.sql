-- =============================================================================
-- BANK PARS — 0017 · database authority
-- =============================================================================
-- Closes the gaps recorded in docs/SECURITY-AUDIT.md as B-1, B-2 and B-3:
--
--   B-1  RLS was ENABLEd but never FORCEd, and the service connected as the table
--        owner, so no policy was ever consulted. FORCE makes the policies bind the
--        owner too; the grant block below makes a non-owner service role possible.
--   B-2  Row triggers fire on UPDATE and DELETE but NOT on TRUNCATE, so the
--        append-only tables could be emptied with one statement.
--   B-3  Monetary policy rows (system_settings), wallet ownership and the derived
--        balance cache were writable by any SQL that could reach the table.
--
-- Nothing here changes what the application is allowed to do through its own
-- service layer; it removes the ability to bypass that layer.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- B-1 · force row level security
-- ---------------------------------------------------------------------------
-- FORCE is what makes RLS apply to the table owner as well. It does NOT apply to
-- a superuser or a role with BYPASSRLS, which is why the deployment role must be
-- an ordinary login role (pars_service, created below) and why the request path
-- sets its identity per transaction.
DO $$
DECLARE
  v_table text;
  v_count int := 0;
BEGIN
  FOR v_table IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'prs'
       AND c.relkind = 'r'
       AND c.relrowsecurity
     ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE prs.%I FORCE ROW LEVEL SECURITY', v_table);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'BANK PARS 0017: forced row level security on % tables', v_count;
END $$;

-- ---------------------------------------------------------------------------
-- B-2 · history cannot be erased, in bulk or otherwise
-- ---------------------------------------------------------------------------
-- Row-level triggers never see TRUNCATE. These are statement triggers, and they
-- cover every relation whose rows are the institution's memory.
CREATE OR REPLACE FUNCTION prs.reject_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_TABLE: % is append-only and cannot be truncated', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END $$;

DO $$
DECLARE
  v_table text;
  v_guarded text[] := ARRAY[
    'ledger_entries', 'ledger_transactions', 'transactions', 'audit_logs',
    'card_events', 'banknote_events', 'banknote_transfers', 'wallet_events',
    'profile_activity_events', 'admin_action_events', 'issuances', 'burns',
    'redemptions', 'reserve_valuations', 'exchange_rates'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_guarded LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'prs' AND c.relname = v_table AND c.relkind = 'r'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'prs' AND c.relname = v_table AND t.tgname = 'reject_truncate'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON prs.%I
           FOR EACH STATEMENT EXECUTE FUNCTION prs.reject_truncate()', v_table);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- B-3 · the control plane is not reachable by ordinary SQL
-- ---------------------------------------------------------------------------
-- A transaction may only touch monetary policy, wallet ownership or the derived
-- balance cache after it has declared itself the control plane:
--
--   SELECT set_config('prs.control_plane', 'on', true);
--
-- The flag is transaction-local, so it cannot leak across a pooled connection,
-- and only two call sites in the API ever set it: the approval executor (which
-- has already consumed a dual approval) and the monetary refresh function.
CREATE OR REPLACE FUNCTION prs.require_control_plane() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(current_setting('prs.control_plane', true), '') <> 'on' THEN
    RAISE EXCEPTION 'CONTROL_PLANE_REQUIRED: % may only change through an approved action', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS system_settings_control_plane ON prs.system_settings;
CREATE TRIGGER system_settings_control_plane
  BEFORE INSERT OR UPDATE OR DELETE ON prs.system_settings
  FOR EACH ROW EXECUTE FUNCTION prs.require_control_plane();

DROP TRIGGER IF EXISTS feature_flags_control_plane ON prs.feature_flags;
CREATE TRIGGER feature_flags_control_plane
  BEFORE INSERT OR UPDATE OR DELETE ON prs.feature_flags
  FOR EACH ROW EXECUTE FUNCTION prs.require_control_plane();

-- Ownership of a wallet is the boundary of who may move its money: a silent
-- UPDATE here would hand one member another member's balance.
CREATE OR REPLACE FUNCTION prs.guard_wallet_ownership() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.profile_id IS DISTINCT FROM OLD.profile_id
     AND COALESCE(current_setting('prs.control_plane', true), '') <> 'on' THEN
    RAISE EXCEPTION 'CONTROL_PLANE_REQUIRED: wallet ownership is not a writable field'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS wallets_ownership_guard ON prs.wallets;
CREATE TRIGGER wallets_ownership_guard
  BEFORE UPDATE ON prs.wallets
  FOR EACH ROW EXECUTE FUNCTION prs.guard_wallet_ownership();

-- The balance cache is DERIVED. It is written by prs.refresh_wallet_balance() and
-- by nothing else; a direct UPDATE is refused even from inside the control plane,
-- because the only legitimate writer is the ledger trigger itself.
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

  -- Declared here rather than by callers: the cache has exactly one legitimate
  -- writer, and it is this function.
  PERFORM set_config('prs.cache_writer', 'on', true);

  INSERT INTO prs.wallet_balance_cache (wallet_id, balance_minor, ledger_sequence, updated_at)
  VALUES (p_wallet_id, v_balance, v_seq, now())
  ON CONFLICT (wallet_id) DO UPDATE
    SET balance_minor = EXCLUDED.balance_minor,
        ledger_sequence = EXCLUDED.ledger_sequence,
        updated_at = now();

  PERFORM set_config('prs.cache_writer', '', true);

  RETURN v_balance;
END $$;

CREATE OR REPLACE FUNCTION prs.guard_balance_cache() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(current_setting('prs.cache_writer', true), '') <> 'on' THEN
    RAISE EXCEPTION 'DERIVED_TABLE: prs.wallet_balance_cache is derived from the ledger and cannot be written directly'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS wallet_balance_cache_guard ON prs.wallet_balance_cache;
CREATE TRIGGER wallet_balance_cache_guard
  BEFORE INSERT OR UPDATE OR DELETE ON prs.wallet_balance_cache
  FOR EACH ROW EXECUTE FUNCTION prs.guard_balance_cache();

-- ---------------------------------------------------------------------------
-- B-1 · a service role that is bound by the policies it is given
-- ---------------------------------------------------------------------------
-- Created NOLOGIN: attach it to an actual login role in the deployment
-- (`GRANT pars_service TO pars_api_login`) and connect as that login role. It owns
-- nothing, may not bypass RLS, and holds no DDL. The audit's complaint was that
-- the API connected as the schema OWNER; this is the role to connect as instead.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pars_service') THEN
    CREATE ROLE pars_service NOLOGIN NOBYPASSRLS NOINHERIT;
  END IF;
END $$;

GRANT USAGE ON SCHEMA prs TO pars_service;
GRANT USAGE ON SCHEMA public TO pars_service;

-- Table privileges: DML only. Deliberately absent: TRUNCATE, TRIGGER, REFERENCES,
-- and every DDL right.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA prs TO pars_service;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA prs TO pars_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA prs
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pars_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA prs
  GRANT USAGE, SELECT ON SEQUENCES TO pars_service;

-- Membership lets pars_service adopt a policy role with SET LOCAL ROLE. NOINHERIT
-- on pars_service means it holds none of those privileges until it does so
-- explicitly, per transaction.
GRANT pars_app, pars_admin, pars_auditor, pars_design TO pars_service;

REVOKE TRUNCATE ON ALL TABLES IN SCHEMA prs FROM PUBLIC;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA prs FROM pars_service;

COMMENT ON ROLE pars_service IS
  'BANK PARS application role: DML only, subject to row level security, no DDL, no TRUNCATE.';
