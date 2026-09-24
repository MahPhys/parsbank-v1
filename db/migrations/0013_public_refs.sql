-- =============================================================================
-- BANK PARS — 0013 · public reference generators
-- =============================================================================
-- Human-facing references (PRS-U-000123, PRS-W-000123) are allocated in the
-- database, not by the client, so two concurrent registrations can never collide
-- and the number can never be chosen by a user.
-- =============================================================================

CREATE SEQUENCE IF NOT EXISTS prs.profile_ref_seq START WITH 1000;
CREATE SEQUENCE IF NOT EXISTS prs.wallet_ref_seq START WITH 1000;

CREATE OR REPLACE FUNCTION prs.next_profile_ref() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT 'PRS-U-' || lpad(nextval('prs.profile_ref_seq')::text, 6, '0');
$$;

CREATE OR REPLACE FUNCTION prs.next_wallet_ref() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT 'PRS-W-' || lpad(nextval('prs.wallet_ref_seq')::text, 6, '0');
$$;

COMMENT ON FUNCTION prs.next_profile_ref() IS
  'Server-allocated public reference for a person. Users cannot choose or enumerate it.';

-- New objects need explicit grants: the blanket grants in 0012 only covered the
-- objects that existed at that moment.
GRANT USAGE, SELECT ON SEQUENCE prs.profile_ref_seq, prs.wallet_ref_seq
  TO pars_app, pars_admin, pars_auditor, pars_design;
GRANT EXECUTE ON FUNCTION prs.next_profile_ref(), prs.next_wallet_ref()
  TO pars_app, pars_admin, pars_auditor, pars_design;
