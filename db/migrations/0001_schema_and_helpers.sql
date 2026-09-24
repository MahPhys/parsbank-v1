-- =============================================================================
-- BANK PARS / بانک پارس — 0001 · extensions, schema, shared helpers
-- =============================================================================
-- All monetary objects live in the `prs` schema. Public schema stays empty so that
-- a stray client role cannot guess a table name in `public`.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS prs;
COMMENT ON SCHEMA prs IS 'BANK PARS internal schema. Currency: PRS (پارسه). Closed private network.';

-- Roles used by the RLS layer. Created if missing (NOLOGIN; the API maps a
-- logical principal onto these via SET LOCAL ROLE inside a transaction).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pars_app') THEN
    CREATE ROLE pars_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pars_admin') THEN
    CREATE ROLE pars_admin NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pars_auditor') THEN
    CREATE ROLE pars_auditor NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pars_design') THEN
    CREATE ROLE pars_design NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA prs TO pars_app, pars_admin, pars_auditor, pars_design;

-- ---------------------------------------------------------------------------
-- Money is BIGINT minor units. v1: 1 minor unit = 1 PRS (no fractional PRS).
-- ---------------------------------------------------------------------------
CREATE DOMAIN prs.money_minor AS bigint
  CHECK (VALUE > 0);

CREATE DOMAIN prs.nonneg_money_minor AS bigint
  CHECK (VALUE >= 0);

CREATE DOMAIN prs.hex_hash AS text
  CHECK (VALUE ~ '^[0-9a-f]{16,128}$');

COMMENT ON DOMAIN prs.money_minor IS 'Strictly positive integer amount in PRS minor units. No fractional PRS in v1.';

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prs.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Rejects all UPDATE/DELETE: the append-only guarantee for financial history.
CREATE OR REPLACE FUNCTION prs.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_TABLE: %.% is append-only, % is forbidden',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Financial history is corrected by posting a REVERSAL, never by editing rows.';
END $$;

-- NOTE: prs.setting_bigint()/prs.setting_bool() are defined in 0003_ops_settings.sql,
-- immediately after the system_settings table they read from.

-- Crookford base32 alphabet (no I, L, O, U) used for human-facing serials.
CREATE OR REPLACE FUNCTION prs.crockford(p_bytes bytea) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_num numeric := 0;
  v_out text := '';
  v_i int;
BEGIN
  FOR v_i IN 0 .. length(p_bytes) - 1 LOOP
    v_num := v_num * 256 + get_byte(p_bytes, v_i);
  END LOOP;
  IF v_num = 0 THEN RETURN '0'; END IF;
  WHILE v_num > 0 LOOP
    v_out := substr(v_alphabet, ((v_num % 32)::int) + 1, 1) || v_out;
    v_num := floor(v_num / 32);
  END LOOP;
  RETURN v_out;
END $$;
