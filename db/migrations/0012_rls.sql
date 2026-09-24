-- =============================================================================
-- BANK PARS — 0012 · row-level security + least-privilege grants
-- =============================================================================
-- RLS is DEFENCE IN DEPTH, not the only check: the API also authorizes every
-- request in the service layer. The pattern is:
--
--   BEGIN;
--     SET LOCAL ROLE pars_app;
--     SET LOCAL prs.current_profile_id = '<uuid>';
--     ... queries ...            -- RLS restricts rows to that profile
--   COMMIT;
--
-- Fail-closed: when the GUC is unset, current_setting(..., true) is NULL, the
-- policy predicate is NULL, and no rows are visible.
-- =============================================================================

CREATE OR REPLACE FUNCTION prs.current_profile_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('prs.current_profile_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION prs.current_role_name() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('prs.current_role', true), '');
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
ALTER TABLE prs.profiles                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.account_credentials        ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.sessions                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.login_attempts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.transaction_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.mfa_recovery_codes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.profile_activity_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.wallets                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.wallet_balance_cache       ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.wallet_limits              ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.wallet_events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.cards                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.card_credentials           ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.card_qr_tokens             ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.card_payment_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.card_events                ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.transactions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.ledger_entries             ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.banknotes                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.banknote_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.banknote_transfers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.banknote_verifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.treasury_accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.treasury_reserves          ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.issuances                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.burns                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.redemptions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.exchange_rates             ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.reserve_valuations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.monetary_state             ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.audit_logs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.admin_actions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.admin_action_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.admin_action_nonces        ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.notifications              ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.system_settings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.feature_flags              ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.design_tokens              ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.theme_versions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.assets                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.asset_versions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.content_blocks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.content_block_versions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.pages                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.page_versions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs.navigation_items           ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- pars_app — an ordinary authenticated user (public application)
-- ===========================================================================
CREATE POLICY profiles_self ON prs.profiles
  FOR SELECT TO pars_app USING (id = prs.current_profile_id());
CREATE POLICY profiles_self_update ON prs.profiles
  FOR UPDATE TO pars_app USING (id = prs.current_profile_id())
  WITH CHECK (id = prs.current_profile_id());

CREATE POLICY sessions_self ON prs.sessions
  FOR SELECT TO pars_app USING (profile_id = prs.current_profile_id());
CREATE POLICY txnauth_self ON prs.transaction_authorizations
  FOR SELECT TO pars_app USING (profile_id = prs.current_profile_id());
CREATE POLICY recovery_self ON prs.mfa_recovery_codes
  FOR SELECT TO pars_app USING (profile_id = prs.current_profile_id());
CREATE POLICY activity_self ON prs.profile_activity_events
  FOR SELECT TO pars_app USING (profile_id = prs.current_profile_id());

CREATE POLICY wallets_own ON prs.wallets
  FOR SELECT TO pars_app USING (profile_id = prs.current_profile_id());
CREATE POLICY wallet_cache_own ON prs.wallet_balance_cache
  FOR SELECT TO pars_app
  USING (wallet_id IN (SELECT id FROM prs.wallets WHERE profile_id = prs.current_profile_id()));
CREATE POLICY wallet_limits_own ON prs.wallet_limits
  FOR SELECT TO pars_app
  USING (wallet_id IN (SELECT id FROM prs.wallets WHERE profile_id = prs.current_profile_id()));
CREATE POLICY wallet_events_own ON prs.wallet_events
  FOR SELECT TO pars_app
  USING (wallet_id IN (SELECT id FROM prs.wallets WHERE profile_id = prs.current_profile_id()));

CREATE POLICY cards_own ON prs.cards
  FOR SELECT TO pars_app USING (profile_id = prs.current_profile_id());
-- card_credentials / card_qr_tokens: deliberately NO policy for pars_app.
-- A user session can never read PIN/CVV hashes or QR token hashes, even by SQL.

CREATE POLICY card_sessions_own ON prs.card_payment_sessions
  FOR SELECT TO pars_app USING (payer_profile_id = prs.current_profile_id());
CREATE POLICY card_events_own ON prs.card_events
  FOR SELECT TO pars_app
  USING (card_id IN (SELECT id FROM prs.cards WHERE profile_id = prs.current_profile_id()));

CREATE POLICY transactions_own ON prs.transactions
  FOR SELECT TO pars_app
  USING (
    initiated_by_profile_id = prs.current_profile_id()
    OR sender_wallet_id IN (SELECT id FROM prs.wallets WHERE profile_id = prs.current_profile_id())
    OR receiver_wallet_id IN (SELECT id FROM prs.wallets WHERE profile_id = prs.current_profile_id())
  );

CREATE POLICY ledger_entries_own ON prs.ledger_entries
  FOR SELECT TO pars_app
  USING (
    account_id IN (
      SELECT a.id FROM prs.accounts a
        JOIN prs.wallets w ON w.id = a.wallet_id
       WHERE w.profile_id = prs.current_profile_id()
    )
  );

CREATE POLICY banknotes_own ON prs.banknotes
  FOR SELECT TO pars_app USING (holder_profile_id = prs.current_profile_id());
CREATE POLICY banknote_events_own ON prs.banknote_events
  FOR SELECT TO pars_app
  USING (banknote_id IN (SELECT id FROM prs.banknotes WHERE holder_profile_id = prs.current_profile_id()));
CREATE POLICY banknote_transfers_own ON prs.banknote_transfers
  FOR SELECT TO pars_app
  USING (from_profile_id = prs.current_profile_id() OR to_profile_id = prs.current_profile_id());
CREATE POLICY banknote_verifications_own ON prs.banknote_verifications
  FOR SELECT TO pars_app USING (verifier_profile_id = prs.current_profile_id());

CREATE POLICY notifications_own ON prs.notifications
  FOR SELECT TO pars_app USING (profile_id = prs.current_profile_id());
CREATE POLICY notifications_own_update ON prs.notifications
  FOR UPDATE TO pars_app USING (profile_id = prs.current_profile_id())
  WITH CHECK (profile_id = prs.current_profile_id());

-- Public read of published presentation content only.
CREATE POLICY theme_published_read ON prs.theme_versions
  FOR SELECT TO pars_app USING (status = 'PUBLISHED');
CREATE POLICY tokens_read ON prs.design_tokens FOR SELECT TO pars_app USING (true);
CREATE POLICY assets_public_read ON prs.assets
  FOR SELECT TO pars_app USING (status = 'ACTIVE');
CREATE POLICY content_public_read ON prs.content_blocks
  FOR SELECT TO pars_app USING (status = 'PUBLISHED');
CREATE POLICY pages_public_read ON prs.pages
  FOR SELECT TO pars_app USING (status = 'PUBLISHED');
CREATE POLICY nav_public_read ON prs.navigation_items
  FOR SELECT TO pars_app USING (visible);
-- Reference rate is public information inside the closed network.
CREATE POLICY exchange_rates_read ON prs.exchange_rates FOR SELECT TO pars_app USING (true);
CREATE POLICY monetary_state_read ON prs.monetary_state FOR SELECT TO pars_app USING (true);
CREATE POLICY settings_public_read ON prs.system_settings
  FOR SELECT TO pars_app USING (category = 'presentation');
CREATE POLICY flags_public_read ON prs.feature_flags
  FOR SELECT TO pars_app USING (scope IN ('public_app','global'));

-- ===========================================================================
-- pars_admin — administrative session (role checks are ALSO done in the service)
-- ===========================================================================
CREATE POLICY admin_profiles_all ON prs.profiles FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_wallets_all ON prs.wallets FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_cards_all ON prs.cards FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_transactions_all ON prs.transactions FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_ledger_all ON prs.ledger_entries FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_banknotes_all ON prs.banknotes FOR ALL TO pars_admin USING (true) WITH CHECK (true);
CREATE POLICY admin_banknote_events_all ON prs.banknote_events FOR INSERT TO pars_admin WITH CHECK (true);
CREATE POLICY admin_banknote_events_read ON prs.banknote_events FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_banknote_transfers_all ON prs.banknote_transfers FOR ALL TO pars_admin USING (true) WITH CHECK (true);
CREATE POLICY admin_banknote_verifications_all ON prs.banknote_verifications FOR ALL TO pars_admin USING (true) WITH CHECK (true);
CREATE POLICY admin_monetary_read_reserves ON prs.treasury_reserves FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_monetary_read_issuances ON prs.issuances FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_monetary_read_burns ON prs.burns FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_monetary_read_redeems ON prs.redemptions FOR ALL TO pars_admin USING (true) WITH CHECK (true);
CREATE POLICY admin_monetary_read_rates ON prs.exchange_rates FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_monetary_read_valuations ON prs.reserve_valuations FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_monetary_read_state ON prs.monetary_state FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_treasury_accounts ON prs.treasury_accounts FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_audit_read ON prs.audit_logs FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_audit_insert ON prs.audit_logs FOR INSERT TO pars_admin WITH CHECK (true);
CREATE POLICY admin_actions_all ON prs.admin_actions FOR ALL TO pars_admin USING (true) WITH CHECK (true);
CREATE POLICY admin_action_events_all ON prs.admin_action_events FOR ALL TO pars_admin USING (true) WITH CHECK (true);
CREATE POLICY admin_action_nonces_all ON prs.admin_action_nonces FOR ALL TO pars_admin USING (true) WITH CHECK (true);
CREATE POLICY admin_notifications_all ON prs.notifications FOR ALL TO pars_admin USING (true) WITH CHECK (true);
CREATE POLICY admin_settings_all ON prs.system_settings FOR ALL TO pars_admin USING (true) WITH CHECK (true);
CREATE POLICY admin_flags_all ON prs.feature_flags FOR ALL TO pars_admin USING (true) WITH CHECK (true);
CREATE POLICY admin_content_read ON prs.content_blocks FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_pages_read ON prs.pages FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_nav_read ON prs.navigation_items FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_tokens_read ON prs.design_tokens FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_themes_read ON prs.theme_versions FOR SELECT TO pars_admin USING (true);
CREATE POLICY admin_assets_read ON prs.assets FOR SELECT TO pars_admin USING (true);

-- ===========================================================================
-- pars_auditor — read-only financial and audit visibility, by construction
-- ===========================================================================
CREATE POLICY auditor_profiles_read ON prs.profiles FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_wallets_read ON prs.wallets FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_cards_read ON prs.cards FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_transactions_read ON prs.transactions FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_ledger_read ON prs.ledger_entries FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_ledger_tx_read ON prs.ledger_transactions FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_banknotes_read ON prs.banknotes FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_banknote_events_read ON prs.banknote_events FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_banknote_transfers_read ON prs.banknote_transfers FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_banknote_verifications_read ON prs.banknote_verifications FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_treasury_read ON prs.treasury_accounts FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_reserves_read ON prs.treasury_reserves FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_issuances_read ON prs.issuances FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_burns_read ON prs.burns FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_redemptions_read ON prs.redemptions FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_rates_read ON prs.exchange_rates FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_valuations_read ON prs.reserve_valuations FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_state_read ON prs.monetary_state FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_audit_read ON prs.audit_logs FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_admin_actions_read ON prs.admin_actions FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_admin_events_read ON prs.admin_action_events FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_settings_read ON prs.system_settings FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_flags_read ON prs.feature_flags FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_activity_read ON prs.profile_activity_events FOR SELECT TO pars_auditor USING (true);
CREATE POLICY auditor_login_read ON prs.login_attempts FOR SELECT TO pars_auditor USING (true);

-- ===========================================================================
-- pars_design — content plane only. NO access to any monetary table.
-- ===========================================================================
CREATE POLICY design_tokens_all ON prs.design_tokens FOR ALL TO pars_design USING (true) WITH CHECK (true);
CREATE POLICY design_themes_all ON prs.theme_versions FOR ALL TO pars_design USING (true) WITH CHECK (true);
CREATE POLICY design_assets_all ON prs.assets FOR ALL TO pars_design USING (true) WITH CHECK (true);
CREATE POLICY design_asset_versions_all ON prs.asset_versions FOR ALL TO pars_design USING (true) WITH CHECK (true);
CREATE POLICY design_content_all ON prs.content_blocks FOR ALL TO pars_design USING (true) WITH CHECK (true);
CREATE POLICY design_content_versions_all ON prs.content_block_versions FOR ALL TO pars_design USING (true) WITH CHECK (true);
CREATE POLICY design_pages_all ON prs.pages FOR ALL TO pars_design USING (true) WITH CHECK (true);
CREATE POLICY design_page_versions_all ON prs.page_versions FOR ALL TO pars_design USING (true) WITH CHECK (true);
CREATE POLICY design_nav_all ON prs.navigation_items FOR ALL TO pars_design USING (true) WITH CHECK (true);
CREATE POLICY design_profile_self ON prs.profiles FOR SELECT TO pars_design USING (id = prs.current_profile_id());
CREATE POLICY design_notifications_own ON prs.notifications
  FOR SELECT TO pars_design USING (profile_id = prs.current_profile_id());
-- Note the absence of ANY policy granting pars_design access to wallets, cards,
-- transactions, ledger_entries, issuances, burns, treasury_reserves, exchange_rates
-- or admin_actions. Combined with the table grants below, a design session cannot
-- read or write monetary data at all.

-- ===========================================================================
-- Table / sequence grants (RLS is not enough on its own: privileges too)
-- ===========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA prs TO pars_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA prs TO pars_admin;

GRANT SELECT ON ALL TABLES IN SCHEMA prs TO pars_auditor;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA prs TO pars_auditor;

GRANT SELECT ON ALL TABLES IN SCHEMA prs TO pars_app;
GRANT INSERT (profile_id, audience, kind, title_fa, body_fa, severity, action_url) ON prs.notifications TO pars_app;
GRANT UPDATE (read_at) ON prs.notifications TO pars_app;
GRANT UPDATE (full_name_fa, full_name_en, email, phone, locale, theme_preference, mfa_enabled, updated_at)
  ON prs.profiles TO pars_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA prs TO pars_app;

GRANT SELECT ON ALL TABLES IN SCHEMA prs TO pars_design;
GRANT INSERT, UPDATE, DELETE ON
  prs.design_tokens, prs.theme_versions, prs.assets, prs.asset_versions,
  prs.content_blocks, prs.content_block_versions, prs.pages, prs.page_versions,
  prs.navigation_items
  TO pars_design;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA prs TO pars_design;

-- Financial tables are explicitly NOT writable by any of the four application
-- roles. Writing to them requires the owner role, which only the money services
-- and the migration runner use.
REVOKE INSERT, UPDATE, DELETE ON
  prs.accounts, prs.ledger_transactions, prs.ledger_entries,
  prs.issuances, prs.burns, prs.treasury_reserves, prs.reserve_valuations,
  prs.exchange_rates, prs.monetary_state
  FROM pars_app, pars_admin, pars_auditor, pars_design;

-- Views: run with the invoker's rights so RLS of the base tables applies.
CREATE OR REPLACE VIEW prs.wallet_balances_secure
  WITH (security_invoker = true) AS
  SELECT * FROM prs.wallet_balances;
GRANT SELECT ON prs.wallet_balances_secure TO pars_app, pars_admin, pars_auditor;

COMMENT ON VIEW prs.wallet_balances_secure IS
  'security_invoker view of wallet_balances: a user session sees only its own wallets.';
