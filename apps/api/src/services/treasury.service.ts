/**
 * BANK PARS — treasury: issuance, burning, redemption, reserves.
 *
 * Money creation and destruction are not "endpoints"; they are APPROVED MONETARY
 * EVENTS. Every function here is an executor invoked by the dual-approval
 * workflow, or a read. There is no HTTP handler that can credit or debit the
 * currency-in-existence account directly.
 */
import type { ApprovalActionType } from '@parsbank/types';
import {
  DomainError,
  assertBurnAllowed,
  assertIssuanceAllowed,
  buildBurn,
  buildIssuance,
  coverageHeadroom,
  redemptionSettlementUsdMinor,
} from '@parsbank/domain';
import { claimControlPlane } from '../db/control-plane.ts';
import type { Database, TransactionContext } from '../db/types.ts';
import { burnReference, issuanceReference, redemptionReference } from '../lib/ids.ts';
import { registerApprovalExecutor } from './approval-registry.ts';
import { writeAudit } from './audit.service.ts';
import type { ActorContext, ServiceContext } from './context.ts';
import { requireActor } from './context.ts';
import { markBanknoteDestroyed, markBatchAssignedInCirculation } from './banknotes.service.ts';
import { chart, postPostingSet, walletAccount } from './ledger.service.ts';
import { loadMonetaryInputs, refreshMonetaryState } from './monetary.service.ts';
import {
  booleanSetting,
  isBurningEnabled,
  isIssuanceEnabled,
  isRedemptionEnabled,
  numericSetting,
} from './settings.service.ts';
import { assertCan, buildIssuance as issuanceBuilder } from '@parsbank/domain';

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function treasuryOverview(db: Database): Promise<Record<string, unknown>> {
  const [state, reserves, issuanceStats, burnStats, redemptionStats] = await Promise.all([
    db.one<Record<string, unknown>>(
      `SELECT max_supply_minor, total_issued_minor, circulating_supply_minor, bank_held_minor,
              treasury_reserve_usd_minor, eligible_reserve_nav_usd_minor, reserve_coverage_ratio,
              reference_rate_prs_per_usd, par_value_usd_minor, is_parity_fallback, as_of, version
         FROM prs.monetary_state WHERE id = 1`,
    ),
    db.query(
      `SELECT id, reserve_ref, asset_kind, description_fa, book_value_usd_minor, haircut_bps,
              eligibility, status, custodian, contributed_by, contribution_date, last_valued_at
         FROM prs.treasury_reserves ORDER BY status, contribution_date DESC`,
    ),
    db.one<{ count: string; total: string }>(
      `SELECT count(*)::text AS count, COALESCE(SUM(amount_minor),0)::text AS total FROM prs.issuances`,
    ),
    db.one<{ count: string; total: string }>(
      `SELECT count(*)::text AS count, COALESCE(SUM(amount_minor),0)::text AS total FROM prs.burns`,
    ),
    db.one<{ count: string; total: string }>(
      `SELECT count(*)::text AS count, COALESCE(SUM(amount_minor),0)::text AS total
         FROM prs.redemptions WHERE status = 'SETTLED'`,
    ),
  ]);

  const maxSupply = Number((state?.max_supply_minor as string) ?? 10_000);
  const par = Number((state?.par_value_usd_minor as string) ?? 100);
  const circulating = Number((state?.circulating_supply_minor as string) ?? 0);
  const nav = Number((state?.eligible_reserve_nav_usd_minor as string) ?? 0);
  const headroom = coverageHeadroom(nav, circulating, par, 1);

  return {
    state: state
      ? {
          maxSupplyMinor: maxSupply,
          totalIssuedMinor: Number(state.total_issued_minor as string),
          circulatingSupplyMinor: circulating,
          bankHeldMinor: Number(state.bank_held_minor as string),
          treasuryReserveUsdMinor: Number(state.treasury_reserve_usd_minor as string),
          eligibleReserveNavUsdMinor: nav,
          reserveCoverageRatio: Number(state.reserve_coverage_ratio as string),
          referenceRatePrsPerUsd: Number(state.reference_rate_prs_per_usd as string),
          parValueUsdMinor: par,
          isParityFallback: Boolean(state.is_parity_fallback),
          asOf: new Date(state.as_of as string).toISOString(),
          version: Number(state.version as string),
        }
      : null,
    reserves,
    issuanceHeadroomMinor: Math.max(0, maxSupply - Number((state?.total_issued_minor as string) ?? 0)),
    coverageFloor: { requiredNavUsdMinor: headroom.requiredNavUsdMinor, surplusUsdMinor: headroom.surplusUsdMinor },
    counts: {
      issuances: Number(issuanceStats?.count ?? 0),
      issuedMinor: Number(issuanceStats?.total ?? 0),
      burns: Number(burnStats?.count ?? 0),
      burnedMinor: Number(burnStats?.total ?? 0),
      redemptions: Number(redemptionStats?.count ?? 0),
      redeemedMinor: Number(redemptionStats?.total ?? 0),
    },
  };
}

export async function listIssuances(db: Database, limit = 100): Promise<Record<string, unknown>[]> {
  return db.query(
    `SELECT i.id, i.issuance_ref, i.amount_minor, i.destination_kind, i.reserve_contribution_usd_minor,
            i.reason, i.authorizer_profile_id, a.full_name_fa AS authorizer_name,
            i.second_approver_profile_id, s.full_name_fa AS approver_name, i.approved_at,
            i.ledger_transaction_id, lt.sequence_no AS ledger_sequence,
            i.resulting_supply_minor, i.resulting_circulating_supply_minor,
            i.resulting_coverage_ratio, i.resulting_reference_rate, i.created_at
       FROM prs.issuances i
       JOIN prs.profiles a ON a.id = i.authorizer_profile_id
       JOIN prs.profiles s ON s.id = i.second_approver_profile_id
       JOIN prs.ledger_transactions lt ON lt.id = i.ledger_transaction_id
      ORDER BY i.created_at DESC LIMIT $1`,
    [limit],
  );
}

export async function listBurns(db: Database, limit = 100): Promise<Record<string, unknown>[]> {
  return db.query(
    `SELECT b.id, b.burn_ref, b.kind, b.amount_minor, b.reason, b.destruction_ref,
            b.authorizer_profile_id, a.full_name_fa AS authorizer_name,
            b.second_approver_profile_id, s.full_name_fa AS approver_name,
            b.ledger_transaction_id, lt.sequence_no AS ledger_sequence,
            b.resulting_supply_minor, b.resulting_coverage_ratio, b.created_at
       FROM prs.burns b
       JOIN prs.profiles a ON a.id = b.authorizer_profile_id
       JOIN prs.profiles s ON s.id = b.second_approver_profile_id
       JOIN prs.ledger_transactions lt ON lt.id = b.ledger_transaction_id
      ORDER BY b.created_at DESC LIMIT $1`,
    [limit],
  );
}

export async function listRedemptions(db: Database, limit = 100): Promise<Record<string, unknown>[]> {
  return db.query(
    `SELECT r.id, r.redemption_ref, r.amount_minor, r.fee_minor, r.settlement_value_usd_minor,
            r.status, r.reason, r.created_at, r.decided_at, w.public_ref AS wallet_ref,
            p.full_name_fa AS requester_name
       FROM prs.redemptions r
       JOIN prs.wallets w ON w.id = r.wallet_id
       JOIN prs.profiles p ON p.id = r.requested_by
      ORDER BY r.created_at DESC LIMIT $1`,
    [limit],
  );
}

/* -------------------------------------------------------------------------- */
/* Pre-flight projections (no state change)                                    */
/* -------------------------------------------------------------------------- */

export async function simulateIssuance(
  context: ServiceContext,
  input: { amountMinor: number; reserveContributionUsdMinor: number },
): Promise<Record<string, unknown>> {
  requireActor(context);
  const inputs = await loadMonetaryInputs(context.db);
  const requireReserve = await booleanSetting(context.db, 'policy.issuance_requires_reserve', true);
  const floor = Number(
    (await context.db.one<{ value: unknown }>(
      `SELECT value FROM prs.system_settings WHERE key = 'policy.min_coverage_ratio'`,
    ))?.value ?? 1,
  );

  try {
    const projected = assertIssuanceAllowed(
      { amountMinor: input.amountMinor, reserveContributionUsdMinor: input.reserveContributionUsdMinor },
      {
        maxSupplyMinor: inputs.maxSupplyMinor,
        coverageFloor: floor,
        parValueUsdMinor: inputs.parValueUsdMinor,
        requireReserve,
      },
      inputs,
    );
    return { allowed: true, projected };
  } catch (error) {
    if (error instanceof DomainError) {
      return { allowed: false, code: error.code, messageFa: error.messageFa, context: error.context ?? {} };
    }
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Executors (invoked only after a dual-approved decision)                     */
/* -------------------------------------------------------------------------- */

function payloadMinor(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new DomainError('VALIDATION_FAILED', { messageEn: `payload.${key} must be a number` });
  }
  return Math.trunc(parsed);
}

function payloadString(payload: Record<string, unknown>, key: string, required = true): string | null {
  const value = payload[key];
  if (value === undefined || value === null || value === '') {
    if (required) throw new DomainError('VALIDATION_FAILED', { messageEn: `payload.${key} is required` });
    return null;
  }
  return String(value);
}

registerApprovalExecutor('ISSUANCE', async (tx, { action, actor, meta }) => {
  if (!(await isIssuanceEnabled(tx))) {
    throw new DomainError('FINANCIAL_CONTROLS_DISABLED', { messageFa: 'انتشار در حال حاضر غیرفعال است.' });
  }

  const amountMinor = payloadMinor(action.payload, 'amountMinor');
  const reserveContributionUsdMinor = payloadMinor(action.payload, 'reserveContributionUsdMinor');
  const destinationKind = (payloadString(action.payload, 'destinationKind') ?? 'WALLET') as 'WALLET' | 'PHYSICAL_NOTES';
  const destinationWalletRef = payloadString(action.payload, 'destinationWalletRef', false);
  const reserveId = payloadString(action.payload, 'reserveId', false);
  const reason = action.reason;

  const requireReserve = await booleanSetting(tx, 'policy.issuance_requires_reserve', true);
  const floor = Number(
    (await tx.one<{ value: unknown }>(`SELECT value FROM prs.system_settings WHERE key = 'policy.min_coverage_ratio'`))
      ?.value ?? 1,
  );

  const supplyRow = await tx.one<{
    total_issued_minor: string;
    circulating_supply_minor: string;
    bank_held_minor: string;
  }>('SELECT total_issued_minor::text, circulating_supply_minor::text, bank_held_minor::text FROM prs.supply_summary');
  const maxSupplyMinor = await numericSetting(tx, 'max_supply_minor', 10_000);
  const parValueUsdMinor = await numericSetting(tx, 'policy.par_value_usd_minor', 100);

  const reserves = await tx.query<{
    id: string;
    book_value_usd_minor: string;
    haircut_bps: number;
    eligibility: 'ELIGIBLE' | 'INELIGIBLE' | 'PENDING_REVIEW';
    status: 'ACTIVE' | 'RELEASED' | 'FROZEN' | 'PENDING';
  }>('SELECT id, book_value_usd_minor::text, haircut_bps, eligibility, status FROM prs.treasury_reserves');

  if (reserveId) {
    const exists = reserves.find((reserve) => reserve.id === reserveId);
    if (!exists) throw new DomainError('VALIDATION_FAILED', { messageEn: 'reserve not found' });
    if (exists.eligibility !== 'ELIGIBLE' || exists.status !== 'ACTIVE') {
      throw new DomainError('RESERVE_REQUIRED', { messageFa: 'پشتوانه انتخاب‌شده در وضعیت واجد شرایط نیست.' });
    }
  }

  const projected = assertIssuanceAllowed(
    { amountMinor, reserveContributionUsdMinor },
    { maxSupplyMinor, coverageFloor: floor, parValueUsdMinor, requireReserve },
    {
      maxSupplyMinor,
      totalIssuedMinor: Number(supplyRow?.total_issued_minor ?? 0),
      circulatingSupplyMinor: Number(supplyRow?.circulating_supply_minor ?? 0),
      bankHeldMinor: Number(supplyRow?.bank_held_minor ?? 0),
      parValueUsdMinor,
      reserves: reserves.map((reserve) => ({
        id: reserve.id,
        bookValueUsdMinor: Number(reserve.book_value_usd_minor),
        haircutBps: reserve.haircut_bps,
        eligibility: reserve.eligibility,
        status: reserve.status,
      })),
    },
  );

  const circulationAccount = await chart.currencyInExistence(tx);
  const destination =
    destinationKind === 'PHYSICAL_NOTES'
      ? await chart.physicalNotes(tx)
      : await walletAccount(tx, await resolveWalletId(tx, destinationWalletRef));

  const set = issuanceBuilder({
    circulationAccount,
    destination,
    amountMinor,
    reason,
  });

  const posted = await postPostingSet(tx, {
    set,
    actor,
    reason,
    refreshMonetaryState: true,
    refreshReasons: ['ISSUANCE'],
    metadata: { adminActionRef: action.actionRef },
  });

  // Releasing a printed batch: the notes move from vault stock to outstanding value
  // at exactly the moment the issuance credits account 2300.
  const batchCode = payloadString(action.payload, 'batchCode', false);
  if (batchCode) {
    await markBatchAssignedInCirculation(tx, { batchCode, actorProfileId: actor.profileId });
  }
  // A physical issue usually spans several denominations, each printed as its own
  // batch; they are all released by the same issuance.
  const extraBatches = Array.isArray(action.payload.batchCodes) ? (action.payload.batchCodes as unknown[]) : [];
  for (const code of extraBatches) {
    const value = String(code ?? '');
    if (value && value !== batchCode) {
      await markBatchAssignedInCirculation(tx, { batchCode: value, actorProfileId: actor.profileId });
    }
  }

  const issuanceRef = issuanceReference();
  await tx.execute(
    `INSERT INTO prs.issuances
       (issuance_ref, amount_minor, destination_kind, destination_wallet_id, reserve_id,
        reserve_contribution_usd_minor, reason, authorizer_profile_id, second_approver_profile_id,
        approved_at, ledger_transaction_id, admin_action_id, resulting_supply_minor,
        resulting_circulating_supply_minor, resulting_coverage_ratio, resulting_reference_rate)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), $10, $11, $12, $13, $14, $15)`,
    [
      issuanceRef,
      amountMinor,
      destinationKind,
      destinationKind === 'WALLET' ? await resolveWalletId(tx, destinationWalletRef) : null,
      reserveId,
      reserveContributionUsdMinor,
      reason,
      action.requestedBy,
      action.decidedBy,
      posted.ledgerTransactionId,
      action.adminActionId,
      posted.totalIssuedMinor,
      posted.circulatingSupplyMinor,
      posted.coverageRatio ?? 0,
      posted.referenceRate ?? 0,
    ],
  );

  await writeAudit(tx, {
    actor,
    action: 'treasury.issue',
    category: 'TREASURY',
    severity: 'CRITICAL',
    entityType: 'issuance',
    entityRef: issuanceRef,
    reason,
    afterState: {
      amountMinor,
      resultingSupplyMinor: posted.totalIssuedMinor,
      resultingCoverageRatio: posted.coverageRatio,
      ledgerSequence: posted.sequenceNo,
    },
    adminActionId: action.adminActionId,
    meta,
  });

  void projected;
  return {
    entityRef: issuanceRef,
    result: {
      issuanceRef,
      ledgerTransactionId: posted.ledgerTransactionId,
      ledgerSequence: posted.sequenceNo,
      resultingSupplyMinor: posted.totalIssuedMinor,
      resultingCoverageRatio: posted.coverageRatio,
      resultingReferenceRate: posted.referenceRate,
    },
  };
});

registerApprovalExecutor('BURN', async (tx, { action, actor, meta }) => {
  if (!(await isBurningEnabled(tx))) {
    throw new DomainError('FINANCIAL_CONTROLS_DISABLED', { messageFa: 'امحا در حال حاضر غیرفعال است.' });
  }

  const amountMinor = payloadMinor(action.payload, 'amountMinor');
  const sourceKind = (payloadString(action.payload, 'sourceKind') ?? 'WALLET') as 'WALLET' | 'PHYSICAL_NOTES';
  // A wallet-sourced burn must name its wallet; a note destruction must not.
  const sourceWalletRef = payloadString(action.payload, 'sourceWalletRef', sourceKind === 'WALLET');
  const reason = action.reason;

  const circulationAccount = await chart.currencyInExistence(tx);

  let source;
  let sourceWalletId: string | null = null;
  if (sourceKind === 'PHYSICAL_NOTES') {
    source = await chart.physicalNotes(tx);
    const registry = await tx.one<{ total: string }>(
      'SELECT prs.banknote_registry_outstanding()::text AS total',
    );
    const balance = Number(registry?.total ?? 0);
    assertBurnAllowed(amountMinor, balance, Number.MAX_SAFE_INTEGER);
    if (amountMinor > balance) {
      throw new DomainError('INSUFFICIENT_FUNDS', {
        messageFa: 'ارزش اسکناس‌های در گردش کمتر از مبلغ امحا است.',
      });
    }
  } else {
    sourceWalletId = await resolveWalletId(tx, sourceWalletRef);
    source = await walletAccount(tx, sourceWalletId);
  }

  const set = buildBurn({ circulationAccount, source, amountMinor, reason });
  const posted = await postPostingSet(tx, {
    set,
    actor,
    reason,
    refreshMonetaryState: true,
    refreshReasons: ['BURN'],
    metadata: { adminActionRef: action.actionRef },
  });

  const banknoteSerial = payloadString(action.payload, 'banknoteSerial', false);
  if (banknoteSerial) {
    await markBanknoteDestroyed(tx, {
      serialNumber: banknoteSerial,
      destructionRef: payloadString(action.payload, 'destructionRef', false),
      actorProfileId: actor.profileId,
    });
  }

  const burnRef = burnReference();
  await tx.execute(
    `INSERT INTO prs.burns
       (burn_ref, kind, amount_minor, source_wallet_id, destruction_ref, reason,
        authorizer_profile_id, second_approver_profile_id, approved_at, ledger_transaction_id,
        admin_action_id, resulting_supply_minor, resulting_circulating_supply_minor, resulting_coverage_ratio)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), $9, $10, $11, $12, $13)`,
    [
      burnRef,
      sourceKind === 'PHYSICAL_NOTES' ? 'PHYSICAL_NOTE_DESTRUCTION' : 'LEDGER',
      amountMinor,
      sourceWalletId,
      payloadString(action.payload, 'destructionRef', false),
      reason,
      action.requestedBy,
      action.decidedBy,
      posted.ledgerTransactionId,
      action.adminActionId,
      posted.totalIssuedMinor,
      posted.circulatingSupplyMinor,
      posted.coverageRatio ?? 0,
    ],
  );

  await writeAudit(tx, {
    actor,
    action: 'treasury.burn',
    category: 'TREASURY',
    severity: 'CRITICAL',
    entityType: 'burn',
    entityRef: burnRef,
    reason,
    afterState: { amountMinor, resultingSupplyMinor: posted.totalIssuedMinor, ledgerSequence: posted.sequenceNo },
    adminActionId: action.adminActionId,
    meta,
  });

  return {
    entityRef: burnRef,
    result: {
      burnRef,
      ledgerTransactionId: posted.ledgerTransactionId,
      ledgerSequence: posted.sequenceNo,
      resultingSupplyMinor: posted.totalIssuedMinor,
      resultingCoverageRatio: posted.coverageRatio,
    },
  };
});

registerApprovalExecutor('REDEMPTION', async (tx, { action, actor, meta }) => {
  if (!(await isRedemptionEnabled(tx))) {
    throw new DomainError('FINANCIAL_CONTROLS_DISABLED', { messageFa: 'بازخرید در حال حاضر غیرفعال است.' });
  }

  const amountMinor = payloadMinor(action.payload, 'amountMinor');
  const walletRef = payloadString(action.payload, 'walletRef')!;
  const feeMinor = payloadMinor(action.payload, 'feeMinor') || 0;
  const reserveId = payloadString(action.payload, 'reserveId', false);
  const reason = action.reason;

  const walletId = await resolveWalletId(tx, walletRef);
  const rate = await tx.one<{ id: string; rate_prs_per_usd: string }>(
    'SELECT id, rate_prs_per_usd::text FROM prs.exchange_rates ORDER BY effective_at DESC, id DESC LIMIT 1',
  );
  if (!rate) throw new DomainError('INTERNAL_ERROR', { messageEn: 'no published reference rate' });

  const settlementUsdMinor = redemptionSettlementUsdMinor(amountMinor, Number(rate.rate_prs_per_usd));

  const circulationAccount = await chart.currencyInExistence(tx);
  const walletAccountRef = await walletAccount(tx, walletId);
  const set = buildBurn({
    circulationAccount,
    source: walletAccountRef,
    amountMinor,
    reason: `redemption: ${reason}`,
  });

  const posted = await postPostingSet(tx, {
    set,
    actor,
    reason,
    refreshMonetaryState: true,
    refreshReasons: ['REDEMPTION'],
    metadata: { adminActionRef: action.actionRef, frozenRateId: rate.id },
  });

  const redemptionRef = redemptionReference();
  await tx.execute(
    `INSERT INTO prs.redemptions
       (redemption_ref, requested_by, wallet_id, amount_minor, fee_minor, frozen_rate_id,
        settlement_value_usd_minor, reserve_id, status, authorizer_profile_id, second_approver_profile_id,
        ledger_transaction_id, admin_action_id, reason, decided_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'SETTLED',$9,$10,$11,$12,$13, now())`,
    [
      redemptionRef,
      action.requestedBy,
      walletId,
      amountMinor,
      feeMinor,
      rate.id,
      settlementUsdMinor,
      reserveId,
      action.requestedBy,
      action.decidedBy,
      posted.ledgerTransactionId,
      action.adminActionId,
      reason,
    ],
  );

  await writeAudit(tx, {
    actor,
    action: 'treasury.redemption',
    category: 'TREASURY',
    severity: 'CRITICAL',
    entityType: 'redemption',
    entityRef: redemptionRef,
    reason,
    afterState: { amountMinor, settlementUsdMinor, ledgerSequence: posted.sequenceNo },
    adminActionId: action.adminActionId,
    meta,
  });

  return {
    entityRef: redemptionRef,
    result: { redemptionRef, settlementUsdMinor, ledgerSequence: posted.sequenceNo },
  };
});

registerApprovalExecutor('RESERVE_VALUATION', async (tx, { action, actor, meta }) => {
  const reserveRef = payloadString(action.payload, 'reserveRef')!;
  const assetKind = payloadString(action.payload, 'assetKind')!;
  const descriptionFa = payloadString(action.payload, 'descriptionFa')!;
  const bookValueUsdMinor = payloadMinor(action.payload, 'bookValueUsdMinor');
  const haircutBps = payloadMinor(action.payload, 'haircutBps') || 0;
  const eligibility = (payloadString(action.payload, 'eligibility') ?? 'ELIGIBLE') as
    | 'ELIGIBLE'
    | 'INELIGIBLE'
    | 'PENDING_REVIEW';

  if (bookValueUsdMinor < 0) throw new DomainError('INVALID_AMOUNT', { messageEn: 'reserve value must not be negative' });
  if (haircutBps < 0 || haircutBps > 10_000) {
    throw new DomainError('VALIDATION_FAILED', { messageEn: 'haircut must be between 0 and 10000 bps' });
  }

  await tx.execute(
    `INSERT INTO prs.treasury_reserves
       (reserve_ref, asset_kind, description_fa, book_value_usd_minor, haircut_bps, eligibility,
        status, contributed_by, approved_by, last_valued_at)
     VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7,$8, now())`,
    [reserveRef, assetKind, descriptionFa, bookValueUsdMinor, haircutBps, eligibility, action.requestedBy, action.decidedBy],
  );

  await refreshMonetaryState(tx, actor.profileId, ['RESERVE_VALUATION']);

  await writeAudit(tx, {
    actor,
    action: 'treasury.reserve.valuation',
    category: 'TREASURY',
    severity: 'CRITICAL',
    entityType: 'treasury_reserve',
    entityRef: reserveRef,
    reason: action.reason,
    afterState: { assetKind, bookValueUsdMinor, haircutBps, eligibility },
    adminActionId: action.adminActionId,
    meta,
  });

  return { entityRef: reserveRef, result: { reserveRef, bookValueUsdMinor, eligibility } };
});

registerApprovalExecutor('MAX_SUPPLY_CHANGE', async (tx, { action, actor, meta }) => {
  const newMax = payloadMinor(action.payload, 'maxSupplyMinor');
  const current = await numericSetting(tx, 'max_supply_minor', 10_000);
  const issued = Number(
    (await tx.one<{ total_issued_minor: string }>('SELECT total_issued_minor::text FROM prs.supply_summary'))
      ?.total_issued_minor ?? 0,
  );
  if (newMax < issued) {
    throw new DomainError('SUPPLY_CAP_EXCEEDED', {
      messageFa: 'سقف عرضه نمی‌تواند کمتر از عرضه فعلی باشد.',
      context: { newMax, issued },
    });
  }
  if (newMax <= 0 || newMax > 10_000) {
    throw new DomainError('VALIDATION_FAILED', {
      messageFa: 'سقف عرضه باید بین ۱ و ۱۰٫۰۰۰ پارسه باشد.',
    });
  }

  await claimControlPlane(tx);
  // Parameters must be numbered contiguously from $1: this statement previously used
  // only $2 and $3, so PostgreSQL could not infer $1 and the whole execution failed
  // with 42P18 — the max-supply change could never actually be applied.
  await tx.execute(`UPDATE prs.system_settings SET value = $2, updated_by = $3 WHERE key = $1`, [
    'max_supply_minor',
    String(newMax),
    actor.profileId,
  ]);
  await refreshMonetaryState(tx, actor.profileId, ['MAX_SUPPLY_CHANGE']);

  await writeAudit(tx, {
    actor,
    action: 'treasury.max_supply.change',
    category: 'TREASURY',
    severity: 'CRITICAL',
    entityType: 'system_setting',
    entityRef: 'max_supply_minor',
    reason: action.reason,
    beforeState: { maxSupplyMinor: current },
    afterState: { maxSupplyMinor: newMax },
    adminActionId: action.adminActionId,
    meta,
  });

  return { entityRef: 'max_supply_minor', result: { previous: current, current: newMax } };
});

registerApprovalExecutor('RESERVE_RULE_CHANGE', async (tx, { action, actor, meta }) => {
  const key = payloadString(action.payload, 'key')!;
  const allowed = new Set(['policy.min_coverage_ratio', 'policy.par_value_usd_minor', 'policy.issuance_requires_reserve']);
  if (!allowed.has(key)) {
    throw new DomainError('VALIDATION_FAILED', { messageEn: `${key} is not a reserve rule` });
  }
  const value = action.payload.value;
  await claimControlPlane(tx);
  await tx.execute('UPDATE prs.system_settings SET value = $2, updated_by = $3 WHERE key = $1', [
    key,
    JSON.stringify(value),
    actor.profileId,
  ]);
  await refreshMonetaryState(tx, actor.profileId, ['RESERVE_RULE_CHANGE']);
  await writeAudit(tx, {
    actor,
    action: 'treasury.reserve_rule.change',
    category: 'TREASURY',
    severity: 'CRITICAL',
    entityType: 'system_setting',
    entityRef: key,
    afterState: { value },
    reason: action.reason,
    adminActionId: action.adminActionId,
    meta,
  });
  return { entityRef: key, result: { key, value } };
});

registerApprovalExecutor('REDEMPTION_RULE_CHANGE', async (tx, { action, actor, meta }) => {
  const key = payloadString(action.payload, 'key')!;
  const allowed = new Set(['policy.redemption_fee_minor']);
  if (!allowed.has(key)) {
    throw new DomainError('VALIDATION_FAILED', { messageEn: `${key} is not a redemption rule` });
  }
  await claimControlPlane(tx);
  await tx.execute('UPDATE prs.system_settings SET value = $2, updated_by = $3 WHERE key = $1', [
    key,
    JSON.stringify(action.payload.value),
    actor.profileId,
  ]);
  await writeAudit(tx, {
    actor,
    action: 'treasury.redemption_rule.change',
    category: 'TREASURY',
    severity: 'CRITICAL',
    entityType: 'system_setting',
    entityRef: key,
    afterState: { value: action.payload.value },
    reason: action.reason,
    adminActionId: action.adminActionId,
    meta,
  });
  return { entityRef: key, result: { key, value: action.payload.value } };
});

registerApprovalExecutor('DISABLE_FINANCIAL_CONTROLS', async (tx, { action, actor, meta }) => {
  const key = payloadString(action.payload, 'key')!;
  const enabled = Boolean(action.payload.enabled);
  const allowed = new Set([
    'financial_controls.transfers',
    'financial_controls.issuance',
    'financial_controls.burning',
    'financial_controls.withdrawals',
    'financial_controls.redemptions',
  ]);
  if (!allowed.has(key)) {
    throw new DomainError('VALIDATION_FAILED', { messageEn: `${key} is not a financial control` });
  }
  await claimControlPlane(tx);
  await tx.execute('UPDATE prs.system_settings SET value = $2, updated_by = $3 WHERE key = $1', [
    key,
    JSON.stringify(enabled),
    actor.profileId,
  ]);
  await writeAudit(tx, {
    actor,
    action: 'security.financial_control.change',
    category: 'SECURITY',
    severity: 'CRITICAL',
    entityType: 'system_setting',
    entityRef: key,
    afterState: { enabled },
    reason: action.reason,
    adminActionId: action.adminActionId,
    meta,
  });
  return { entityRef: key, result: { key, enabled } };
});

registerApprovalExecutor('SETTING_CHANGE_CRITICAL', async (tx, { action, actor, meta }) => {
  const key = payloadString(action.payload, 'key')!;
  const setting = await tx.one<{ is_critical: boolean }>(
    'SELECT is_critical FROM prs.system_settings WHERE key = $1',
    [key],
  );
  if (!setting) throw new DomainError('VALIDATION_FAILED', { messageEn: `unknown setting ${key}` });
  await claimControlPlane(tx);
  await tx.execute('UPDATE prs.system_settings SET value = $2, updated_by = $3 WHERE key = $1', [
    key,
    JSON.stringify(action.payload.value),
    actor.profileId,
  ]);
  await refreshMonetaryState(tx, actor.profileId, ['SETTING_CHANGE_CRITICAL']);
  await writeAudit(tx, {
    actor,
    action: 'admin.setting.critical_change',
    category: 'ADMIN',
    severity: 'CRITICAL',
    entityType: 'system_setting',
    entityRef: key,
    afterState: { value: action.payload.value },
    reason: action.reason,
    adminActionId: action.adminActionId,
    meta,
  });
  return { entityRef: key, result: { key, value: action.payload.value } };
});

registerApprovalExecutor('FEATURE_FLAG_CRITICAL', async (tx, { action, actor, meta }) => {
  const key = payloadString(action.payload, 'key')!;
  const enabled = Boolean(action.payload.enabled);
  await claimControlPlane(tx);
  await tx.execute('UPDATE prs.feature_flags SET enabled = $2, updated_by = $3 WHERE key = $1', [
    key,
    enabled,
    actor.profileId,
  ]);
  await tx.execute(
    'INSERT INTO prs.feature_flag_history (key, enabled, rollout_percent, changed_by) VALUES ($1,$2,100,$3)',
    [key, enabled, actor.profileId],
  );
  await writeAudit(tx, {
    actor,
    action: 'admin.feature_flag.critical_change',
    category: 'ADMIN',
    severity: 'CRITICAL',
    entityType: 'feature_flag',
    entityRef: key,
    afterState: { enabled },
    reason: action.reason,
    adminActionId: action.adminActionId,
    meta,
  });
  return { entityRef: key, result: { key, enabled } };
});

async function resolveWalletId(tx: TransactionContext, walletRef: string | null): Promise<string> {
  if (!walletRef) throw new DomainError('WALLET_NOT_FOUND', { messageEn: 'wallet reference is required' });
  const wallet = await tx.one<{ id: string }>('SELECT id FROM prs.wallets WHERE public_ref = $1 OR id::text = $1', [
    walletRef,
  ]);
  if (!wallet) throw new DomainError('WALLET_NOT_FOUND', { context: { walletRef } });
  return wallet.id;
}

export const TREASURY_ACTION_TYPES: ApprovalActionType[] = [
  'ISSUANCE',
  'BURN',
  'REDEMPTION',
  'RESERVE_VALUATION',
  'MAX_SUPPLY_CHANGE',
  'RESERVE_RULE_CHANGE',
  'REDEMPTION_RULE_CHANGE',
  'DISABLE_FINANCIAL_CONTROLS',
  'SETTING_CHANGE_CRITICAL',
  'FEATURE_FLAG_CRITICAL',
];

export function assertTreasurer(role: string): void {
  assertCan(role as never, 'admin.treasury.read');
}

export function issueReferencePreview(): string {
  return issuanceReference();
}

export function actorLabel(actor: ActorContext): string {
  return actor.fullNameFa ?? actor.profileId;
}
