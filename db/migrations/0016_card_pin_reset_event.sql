-- =============================================================================
-- BANK PARS — 0016 · operator PIN reset becomes a first-class card event
-- =============================================================================
-- Migration 0007 enumerated the card event vocabulary. An operator resetting a
-- holder's PIN is a distinct, auditable act: the register must show that somebody
-- other than the holder replaced the credential, and when.
--
-- The append-only rule means a behaviour change never edits 0007 — the constraint is
-- replaced here, and the new event is additive. Existing rows are untouched.
-- =============================================================================

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
    FROM pg_constraint
   WHERE conrelid = 'prs.card_events'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%PIN_CHANGED%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE prs.card_events DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE prs.card_events
  ADD CONSTRAINT card_events_event_check CHECK (event IN
    ('ISSUED','ACTIVATED','PIN_SET','PIN_CHANGED','PIN_RESET','PIN_FAILED',
     'CVV_VERIFIED','CVV_FAILED','QR_ISSUED','QR_ROTATED','QR_VERIFIED',
     'FROZEN','UNFROZEN','CANCELLED','USED_IN_PAYMENT'));

COMMENT ON COLUMN prs.card_events.event IS
  'Card lifecycle vocabulary. PIN_RESET is written when an operator (not the holder) replaces a PIN.';
