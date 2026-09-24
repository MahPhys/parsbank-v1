-- 0015_coverage_ratio_unit.sql
-- BANK PARS — one unit for the reserve coverage ratio: 1.00000000 = 100 %.
--
-- The domain type and the monetary policy document always defined coverage as a
-- ratio (MonetaryPolicy.coverageFloor = 1.00, policy.min_coverage_ratio = 1.00),
-- but the first implementation of prs.refresh_monetary_state() and
-- deriveMonetaryState() multiplied by 100 before storing. That made the floor
-- check compare a percentage against 1.00 and made the admin screens render
-- 12000 %. This migration restores the documented unit and rewrites history.

ALTER TABLE prs.monetary_state
  ALTER COLUMN reserve_coverage_ratio TYPE numeric(18,8);

-- The *current* snapshot may be converted: it is mutable state, not history.
UPDATE prs.monetary_state
   SET reserve_coverage_ratio = round(reserve_coverage_ratio / 100, 8)
 WHERE reserve_coverage_ratio > 0;

-- prs.reserve_valuations and prs.exchange_rates are append-only by design; the
-- rows written before this migration therefore keep their old unit and are NOT
-- rewritten here. BANK PARS is pre-production: a ledger that predates 0015 is
-- rebuilt from migrations + seed rather than edited, which is the same rule the
-- burn/reversal model applies everywhere else.

COMMENT ON COLUMN prs.monetary_state.reserve_coverage_ratio IS
  'Eligible reserve NAV / (circulating supply x par value). 1.00000000 = 100 % coverage.';

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
    -- Ratio, not percent: 1.00000000 means the reserve NAV covers circulating PRS
    -- at par exactly. policy.min_coverage_ratio is expressed in the same unit.
    v_coverage := round(v_nav::numeric
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
