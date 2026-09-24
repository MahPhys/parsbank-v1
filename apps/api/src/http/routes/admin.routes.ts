/**
 * BANK PARS — administrative control plane API.
 *
 * Every route in this file sits on the ADMIN audience (a separate cookie, a
 * separate idle timeout) and declares the single permission it needs. Read-only
 * roles can therefore use the plane without any ability to change it, and
 * DESIGN_ADMIN reaches the CMS routes while being structurally unable to reach
 * monetary ones.
 *
 * Sensitive operations are NOT performed here directly: the route files a request
 * into the approval register, a second administrator approves it, and only then is
 * the executor run. That is why several POSTs below return an approval reference
 * rather than a completed effect.
 */
import type { FastifyInstance } from 'fastify';
import { DomainError, allowedSections, requiresDualApproval, type Permission } from '@parsbank/domain';
import type { ApprovalActionType } from '@parsbank/types';
import {
  adminListQuerySchema,
  assetUpsertSchema,
  auditQuerySchema,
  banknoteRegisterBatchSchema,
  banknoteAssignSchema,
  contentBlockSchema,
  designTokenUpdateSchema,
  decisionSchema,
  featureFlagUpdateSchema,
  issueCardSchema,
  navigationItemSchema,
  pageSchema,
  registerProfileSchema,
  requestApprovalSchema,
  roleChangePayloadSchema,
  settingUpdateSchema,
  statusChangePayloadSchema,
  themeDraftSchema,
  themeRollbackSchema,
  transactionQuerySchema,
} from '@parsbank/validation';
import type { Database } from '../../db/types.ts';
import { authed } from './helpers.ts';
import {
  adminOverview,
  listCardsForAdmin,
  listTransactionsForAdmin,
  listWalletsForAdmin,
} from '../../services/overview.service.ts';
import {
  countProfilesByRole,
  getProfileDetail,
  listProfiles,
  registerProfile,
  suspendLockedAccounts,
  updateProfileStatus,
} from '../../services/users.service.ts';
import {
  issueCard,
  listCardsForProfile,
  resetCardPin,
} from '../../services/cards.service.ts';
import { buildReceipt } from '../../services/transactions.service.ts';
import {
  listBurns,
  listIssuances,
  listRedemptions,
  simulateIssuance,
  treasuryOverview,
} from '../../services/treasury.service.ts';
import { rateHistory, valuationHistory } from '../../services/monetary.service.ts';
import {
  assignBanknote,
  banknoteRegistrySummary,
  listBanknotes,
  registerBatch,
} from '../../services/banknotes.service.ts';
import { listAuditLogs } from '../../services/audit.service.ts';
import { auditLedger, integrityFindings, systemHealth } from '../../services/health.service.ts';
import {
  approveAdminAction,
  executeAdminAction,
  issueApprovalNonce,
  listAdminActions,
  rejectAdminAction,
  requestAdminAction,
} from '../../services/approvals.service.ts';
import {
  createAsset,
  draftThemeVersion,
  listAssets,
  listContentBlocks,
  listDesignTokens,
  listNavigation,
  listPages,
  listThemeVersions,
  previewThemeVersion,
  rollbackTheme,
  updateDesignTokens,
  upsertContentBlock,
  upsertNavigationItem,
  upsertPage,
} from '../../services/design.service.ts';
import { listFeatureFlags, listSettings, writeFeatureFlag, writeSetting } from '../../services/settings.service.ts';

export async function registerAdminRoutes(app: FastifyInstance, db: Database): Promise<void> {
  /** Shorthand: ADMIN audience + one permission. */
  const guard = (request: Parameters<typeof authed>[1], permission: Permission) =>
    authed(db, request, { audience: 'ADMIN', permission });

  /* ------------------------------------------------------------------ overview */

  app.get('/admin/overview', async (request) => {
    const { session } = await guard(request, 'admin.overview.read');
    return { ...(await adminOverview(db)), sections: allowedSections(session.role) };
  });

  app.get('/admin/roles/summary', async (request) => {
    await guard(request, 'admin.users.read');
    return { counts: await countProfilesByRole(db) };
  });

  /* --------------------------------------------------------------------- users */

  app.get('/admin/users', async (request) => {
    await guard(request, 'admin.users.read');
    const query = adminListQuerySchema.parse(request.query ?? {});
    return listProfiles(db, query);
  });

  app.post('/admin/users', async (request) => {
    const { session } = await guard(request, 'admin.users.write');
    const body = registerProfileSchema.parse(request.body ?? {});
    return registerProfile(db, {
      ...body,
      auditActor: {
        profileId: session.profileId,
        role: session.role,
        sessionId: session.sessionId,
        audience: session.audience,
        mfaSatisfied: session.mfaSatisfied,
      },
    });
  });

  app.get('/admin/users/:profileId', async (request) => {
    await guard(request, 'admin.users.read');
    const { profileId } = request.params as { profileId: string };
    return getProfileDetail(db, profileId);
  });

  app.post('/admin/users/:profileId/status', async (request) => {
    const { context } = await guard(request, 'admin.users.write');
    const body = statusChangePayloadSchema.parse({
      ...(request.body as Record<string, unknown>),
      profileId: (request.params as { profileId: string }).profileId,
    });
    await updateProfileStatus(context, {
      profileId: body.profileId,
      status: body.status,
      reason: body.reason,
    });
    return { ok: true };
  });

  /**
   * Role changes are the classic privilege-escalation path, so they never happen
   * directly: the route files an ADMIN_ROLE_CHANGE request for a second approver.
   */
  app.post('/admin/users/:profileId/role', async (request) => {
    const { context } = await guard(request, 'admin.roles.request');
    const payload = roleChangePayloadSchema.parse({
      ...(request.body as Record<string, unknown>),
      profileId: (request.params as { profileId: string }).profileId,
    });
    return requestAdminAction(context, {
      actionType: 'ADMIN_ROLE_CHANGE',
      payload: { profileId: payload.profileId, role: payload.role },
      reason: payload.reason,
    });
  });

  /* ------------------------------------------------------------------- wallets */

  app.get('/admin/wallets', async (request) => {
    await guard(request, 'admin.wallets.read');
    const query = adminListQuerySchema.parse(request.query ?? {});
    return listWalletsForAdmin(db, query);
  });

  app.post('/admin/wallets/:walletId/freeze', async (request) => {
    const { context } = await guard(request, 'admin.wallets.freeze');
    const { walletId } = request.params as { walletId: string };
    const reason = String((request.body as Record<string, unknown>)?.reason ?? '');
    return requestAdminAction(context, {
      actionType: 'WALLET_FREEZE',
      payload: { walletId, freeze: (request.body as { freeze?: boolean })?.freeze !== false },
      reason,
    });
  });

  /* --------------------------------------------------------------------- cards */

  app.get('/admin/cards', async (request) => {
    await guard(request, 'admin.cards.read');
    const query = adminListQuerySchema.parse(request.query ?? {});
    return listCardsForAdmin(db, query);
  });

  /** Provisioning a card for a member is a user-provisioning act, not a teller act. */
  app.post('/admin/cards', async (request) => {
    const { session } = await guard(request, 'admin.users.write');
    const body = issueCardSchema.parse(request.body ?? {});
    return db.transaction(async (tx) => {
      const wallet = await tx.one<{ id: string; profile_id: string }>(
        'SELECT id, profile_id FROM prs.wallets WHERE public_ref = $1',
        [body.walletRef],
      );
      if (!wallet) throw new DomainError('WALLET_NOT_FOUND');
      return issueCard(tx, {
        profileId: wallet.profile_id,
        walletId: wallet.id,
        cardholderNameFa: body.cardholderNameFa,
        actorProfileId: session.profileId,
      });
    });
  });

  /**
   * Administrative PIN reset. The member changes their own PIN with the current one;
   * this route exists for the "I forgot it" case, and prints the new PIN exactly
   * once — nothing readable is stored, and the act is audited as SECURITY/WARNING.
   */
  app.post('/admin/cards/:cardId/pin', async (request) => {
    const { context } = await guard(request, 'admin.users.write');
    const { cardId } = request.params as { cardId: string };
    return resetCardPin(context, { cardId });
  });

  app.get('/admin/cards/:profileId/list', async (request) => {
    await guard(request, 'admin.cards.read');
    const { profileId } = request.params as { profileId: string };
    return { items: await listCardsForProfile(db, profileId) };
  });

  app.post('/admin/cards/:cardId/freeze', async (request) => {
    const { context } = await guard(request, 'admin.cards.freeze');
    const { cardId } = request.params as { cardId: string };
    return requestAdminAction(context, {
      actionType: 'CARD_FREEZE',
      payload: { cardId, freeze: (request.body as { freeze?: boolean })?.freeze !== false },
      reason: String((request.body as Record<string, unknown>)?.reason ?? ''),
    });
  });

  /* -------------------------------------------------------------- transactions */

  app.get('/admin/transactions', async (request) => {
    await guard(request, 'admin.transactions.read');
    const query = transactionQuerySchema.parse(request.query ?? {});
    return listTransactionsForAdmin(db, query);
  });

  app.get('/admin/transactions/:reference/receipt', async (request) => {
    await guard(request, 'admin.transactions.read');
    const { reference } = request.params as { reference: string };
    return buildReceipt(db, reference);
  });

  /* ------------------------------------------------------------------ treasury */

  app.get('/admin/treasury', async (request) => {
    await guard(request, 'admin.treasury.read');
    return treasuryOverview(db);
  });

  app.get('/admin/treasury/issuances', async (request) => {
    await guard(request, 'admin.issuance.read');
    return { items: await listIssuances(db) };
  });

  app.get('/admin/treasury/burns', async (request) => {
    await guard(request, 'admin.burning.read');
    return { items: await listBurns(db) };
  });

  app.get('/admin/treasury/redemptions', async (request) => {
    await guard(request, 'admin.treasury.read');
    return { items: await listRedemptions(db) };
  });

  /** Dry run: shows the projected supply, coverage and rate WITHOUT emitting money. */
  app.post('/admin/treasury/issuance/simulate', async (request) => {
    const { context } = await guard(request, 'treasury.issue.request');
    const body = request.body as { amountMinor?: number; reserveContributionUsdMinor?: number };
    return simulateIssuance(context, {
      amountMinor: Number(body?.amountMinor ?? 0),
      reserveContributionUsdMinor: Number(body?.reserveContributionUsdMinor ?? 0),
    });
  });

  /* -------------------------------------------------------- rates and reserves */

  app.get('/admin/rates', async (request) => {
    await guard(request, 'admin.rates.read');
    return { rates: await rateHistory(db, 120), valuations: await valuationHistory(db, 120) };
  });

  app.get('/admin/reserve', async (request) => {
    await guard(request, 'admin.reserve.read');
    const reserves = await db.query<Record<string, unknown>>(
      `SELECT r.id, r.reserve_ref, r.asset_kind, r.description_fa, r.book_value_usd_minor::text,
              r.haircut_bps, r.eligibility, r.status, r.last_valued_at, r.custodian, r.evidence_ref,
              (r.book_value_usd_minor * (10000 - r.haircut_bps) / 10000)::text AS eligible_nav_usd_minor
         FROM prs.treasury_reserves r
        WHERE r.status = 'ACTIVE'
        ORDER BY r.asset_kind, r.reserve_ref`,
    );
    const latest = await db.one<Record<string, unknown>>(
      `SELECT eligible_reserve_nav_usd_minor::text, reserve_coverage_ratio::text, reference_rate_prs_per_usd::text, as_of
         FROM prs.reserve_valuations ORDER BY as_of DESC LIMIT 1`,
    );
    return { reserves, latestValuation: latest };
  });

  /* ----------------------------------------------------------------- banknotes */

  app.get('/admin/banknotes', async (request) => {
    await guard(request, 'admin.banknotes.read');
    const query = request.query as Record<string, string | undefined>;
    return listBanknotes(db, {
      status: query.status,
      denomination: query.denomination ? Number(query.denomination) : undefined,
      batchCode: query.batchCode,
      search: query.search,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  });

  app.get('/admin/banknotes/summary', async (request) => {
    await guard(request, 'admin.banknotes.read');
    return banknoteRegistrySummary(db);
  });

  app.get('/admin/banknotes/batches', async (request) => {
    await guard(request, 'admin.banknotes.read');
    const batches = await db.query<Record<string, unknown>>(
      // `prs.banknote_batches` has no status column: a batch is a printing run and the
      // lifecycle belongs to the individual notes issued from it.
      `SELECT b.id, b.batch_code, b.series_label, b.denomination_minor::text, b.quantity,
              b.design_version, b.printed_at, b.created_at,
              (SELECT count(*)::int FROM prs.banknotes n WHERE n.batch_id = b.id) AS registered_notes,
              (SELECT COALESCE(SUM(n.denomination_minor), 0)::text FROM prs.banknotes n WHERE n.batch_id = b.id AND n.carries_outstanding_value) AS outstanding_value_minor
         FROM prs.banknote_batches b ORDER BY b.created_at DESC`,
    );
    return { items: batches };
  });

  /** Printing a batch registers the notes but does NOT put them in circulation. */
  app.post('/admin/banknotes/batches', async (request) => {
    const { context } = await guard(request, 'admin.banknotes.write');
    const body = banknoteRegisterBatchSchema.parse(request.body ?? {});
    return registerBatch(context, body);
  });

  app.post('/admin/banknotes/assign', async (request) => {
    const { context } = await guard(request, 'admin.banknotes.write');
    const body = banknoteAssignSchema.parse(request.body ?? {});
    return assignBanknote(context, body);
  });

  app.post('/admin/banknotes/status', async (request) => {
    const { context } = await guard(request, 'admin.banknote.status.request');
    const body = request.body as { serialNumber?: string; status?: string; reason?: string };
    return requestAdminAction(context, {
      actionType: 'BANKNOTE_STATUS_CHANGE',
      payload: { serialNumber: body?.serialNumber, status: body?.status },
      reason: String(body?.reason ?? ''),
    });
  });

  /* ------------------------------------------------------------ audit & health */

  app.get('/admin/audit', async (request) => {
    await guard(request, 'admin.audit.read');
    const query = auditQuerySchema.parse(request.query ?? {});
    return listAuditLogs(db, query);
  });

  app.get('/admin/ledger-audit', async (request) => {
    await guard(request, 'admin.audit.read');
    return auditLedger(db);
  });

  app.get('/admin/health', async (request) => {
    await guard(request, 'admin.health.read');
    return systemHealth(db);
  });

  app.get('/admin/health/findings', async (request) => {
    await guard(request, 'admin.health.read');
    return { items: await integrityFindings(db) };
  });

  /* ---------------------------------------------------------------- security */

  app.get('/admin/security', async (request) => {
    await guard(request, 'admin.security.read');
    const [sessions, attempts, locked] = await Promise.all([
      db.query<Record<string, unknown>>(
        `SELECT s.id, s.audience, p.public_ref, p.full_name_fa, s.issued_at, s.last_seen_at,
                s.absolute_expires_at, s.revoked_at, s.revoked_reason, s.ip_hash, s.user_agent
           FROM prs.sessions s JOIN prs.profiles p ON p.id = s.profile_id
          ORDER BY s.issued_at DESC LIMIT 100`,
      ),
      db.query<Record<string, unknown>>(
        `SELECT a.id, a.outcome, a.occurred_at, a.ip_hash, a.user_agent, p.public_ref
           FROM prs.login_attempts a LEFT JOIN prs.profiles p ON p.id = a.profile_id
          ORDER BY a.occurred_at DESC LIMIT 100`,
      ),
      db.query<Record<string, unknown>>(
        `SELECT id, public_ref, full_name_fa, role, failed_logins, locked_until
           FROM prs.profiles WHERE locked_until IS NOT NULL AND locked_until > now() ORDER BY locked_until DESC`,
      ),
    ]);
    return { sessions, loginAttempts: attempts, lockedProfiles: locked };
  });

  app.post('/admin/security/suspend-locked', async (request) => {
    const { context } = await guard(request, 'admin.users.write');
    return context.db.transaction(async (tx) => ({ suspended: await suspendLockedAccounts(tx) }));
  });

  /* ------------------------------------------------------- settings & flags */

  app.get('/admin/settings', async (request) => {
    await guard(request, 'admin.treasury.read');
    return { settings: await listSettings(db), flags: await listFeatureFlags(db) };
  });

  /**
   * Non-critical settings may be changed directly (and are audited); critical ones
   * raise DUAL_APPROVAL_REQUIRED, which the caller resolves through the approval
   * register below using action type SETTING_CHANGE_CRITICAL.
   */
  app.post('/admin/settings', async (request) => {
    const { session } = await guard(request, 'admin.controls.toggle.request');
    const body = settingUpdateSchema.parse(request.body ?? {});
    await db.transaction(async (tx) =>
      writeSetting(tx, {
        key: body.key,
        value: body.value,
        actor: {
          profileId: session.profileId,
          role: session.role,
          sessionId: session.sessionId,
          audience: session.audience,
          mfaSatisfied: session.mfaSatisfied,
        },
      }),
    );
    return { ok: true, applied: true };
  });

  app.post('/admin/feature-flags', async (request) => {
    const { session } = await guard(request, 'admin.controls.toggle.request');
    const body = featureFlagUpdateSchema.parse(request.body ?? {});
    await db.transaction(async (tx) =>
      writeFeatureFlag(tx, {
        key: body.key,
        enabled: body.enabled,
        rolloutPercent: body.rolloutPercent,
        actor: {
          profileId: session.profileId,
          role: session.role,
          sessionId: session.sessionId,
          audience: session.audience,
          mfaSatisfied: session.mfaSatisfied,
        },
      }),
    );
    return { ok: true, applied: true };
  });

  /* ------------------------------------------------------------- approvals */

  app.get('/admin/approvals', async (request) => {
    await guard(request, 'admin.approvals.request');
    const query = adminListQuerySchema.parse(request.query ?? {});
    const result = await listAdminActions(db, {
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        requiresSecondApprover: requiresDualApproval(item.actionType as ApprovalActionType),
      })),
    };
  });

  app.post('/admin/approvals', async (request) => {
    const { context } = await guard(request, 'admin.overview.read');
    const body = requestApprovalSchema.parse(request.body ?? {});
    return requestAdminAction(context, {
      actionType: body.actionType,
      payload: body.payload,
      reason: body.reason,
    });
  });

  app.post('/admin/approvals/:actionId/nonce', async (request) => {
    const { context } = await guard(request, 'admin.approvals.decide');
    const { actionId } = request.params as { actionId: string };
    const purpose = String((request.body as { purpose?: string })?.purpose ?? 'APPROVE') as 'APPROVE' | 'REJECT' | 'EXECUTE';
    return issueApprovalNonce(context, { actionId, purpose });
  });

  app.post('/admin/approvals/:actionId/approve', async (request) => {
    const { context } = await guard(request, 'admin.approvals.decide');
    const { actionId } = request.params as { actionId: string };
    const body = decisionSchema.parse(request.body ?? {});
    return approveAdminAction(context, { actionId, nonce: body.nonce, note: body.note ?? null });
  });

  app.post('/admin/approvals/:actionId/reject', async (request) => {
    const { context } = await guard(request, 'admin.approvals.decide');
    const { actionId } = request.params as { actionId: string };
    const body = decisionSchema.parse(request.body ?? {});
    return rejectAdminAction(context, { actionId, nonce: body.nonce, note: body.note ?? '' });
  });

  /** Runs the registered executor; the second approval must already be recorded. */
  app.post('/admin/approvals/:actionId/execute', async (request) => {
    const { context } = await guard(request, 'admin.approvals.decide');
    const { actionId } = request.params as { actionId: string };
    return executeAdminAction(context, { actionId });
  });

  /* ------------------------------------------------------------ design plane */

  app.get('/admin/design/tokens', async (request) => {
    await guard(request, 'cms.read');
    const { category } = request.query as { category?: string };
    return { items: await listDesignTokens(db, category) };
  });

  app.post('/admin/design/tokens', async (request) => {
    const { context } = await guard(request, 'cms.tokens.write');
    const body = designTokenUpdateSchema.parse(request.body ?? {});
    return updateDesignTokens(context, body);
  });

  app.get('/admin/design/assets', async (request) => {
    await guard(request, 'cms.read');
    const query = request.query as { kind?: string; status?: string };
    return { items: await listAssets(db, query) };
  });

  app.post('/admin/design/assets', async (request) => {
    const { context } = await guard(request, 'cms.assets.write');
    const body = assetUpsertSchema.parse(request.body ?? {});
    return createAsset(context, body);
  });

  app.get('/admin/design/themes', async (request) => {
    await guard(request, 'cms.read');
    return { items: await listThemeVersions(db) };
  });

  app.post('/admin/design/themes', async (request) => {
    const { context } = await guard(request, 'cms.theme.draft');
    const body = themeDraftSchema.parse(request.body ?? {});
    return draftThemeVersion(context, body);
  });

  app.get('/admin/design/themes/:themeId/preview', async (request) => {
    await guard(request, 'cms.theme.preview');
    const { themeId } = request.params as { themeId: string };
    return previewThemeVersion(db, themeId);
  });

  /**
   * Publishing reaches every visitor, therefore it is a dual-approved action: the
   * request is filed here and executed through the approval register.
   */
  app.post('/admin/design/themes/publish', async (request) => {
    const { context } = await guard(request, 'cms.theme.publish');
    const body = request.body as { themeId?: string; reason?: string };
    return requestAdminAction(context, {
      actionType: 'THEME_PUBLISH',
      payload: { themeId: body?.themeId },
      reason: String(body?.reason ?? ''),
    });
  });

  /** Rollback is a safety action and stays immediate — it restores a known theme. */
  app.post('/admin/design/themes/rollback', async (request) => {
    const { context } = await guard(request, 'cms.theme.rollback');
    const body = themeRollbackSchema.parse(request.body ?? {});
    return rollbackTheme(context, body);
  });

  /* -------------------------------------------------------------- CMS content */

  app.get('/admin/content/blocks', async (request) => {
    await guard(request, 'cms.read');
    const { kind } = request.query as { kind?: string };
    return { items: await listContentBlocks(db, kind) };
  });

  app.post('/admin/content/blocks', async (request) => {
    const { context } = await guard(request, 'cms.content.write');
    const body = contentBlockSchema.parse(request.body ?? {});
    return upsertContentBlock(context, body);
  });

  app.get('/admin/content/pages', async (request) => {
    await guard(request, 'cms.read');
    return { items: await listPages(db) };
  });

  app.post('/admin/content/pages', async (request) => {
    const { context } = await guard(request, 'cms.pages.write');
    const body = pageSchema.parse(request.body ?? {});
    return upsertPage(context, body);
  });

  app.get('/admin/content/navigation', async (request) => {
    await guard(request, 'cms.read');
    const { location } = request.query as { location?: string };
    return { items: await listNavigation(db, location) };
  });

  app.post('/admin/content/navigation', async (request) => {
    const { context } = await guard(request, 'cms.navigation.write');
    const body = navigationItemSchema.parse(request.body ?? {});
    return upsertNavigationItem(context, body);
  });
}
