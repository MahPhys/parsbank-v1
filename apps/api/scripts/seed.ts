/**
 * BANK PARS — institutional seed.
 *
 * This is not a fixture dump. The seed founds the institution the way the system
 * insists it must be founded:
 *
 *   1. migration to the current schema;
 *   2. the token catalogue is installed and the first theme version is published
 *      through the approval register (dual control applies to design changes too);
 *   3. staff accounts are created with real credentials, and their cards are issued;
 *   4. reserve assets enter the books through RESERVE_VALUATION approvals;
 *   5. money enters the world only through ISSUANCE approvals, each one requested
 *      by one treasury officer and approved by another — including the note issue
 *      whose serials are registered in the banknote registry;
 *   6. the treasury distributes money to members with ordinary, authorised
 *      transfers (login → transaction authorization → transfer), so the ledger
 *      invariants are exercised by the seed itself;
 *   7. physical notes are assigned to a member, which moves value out of the note
 *      account and into that member's wallet.
 *
 * Credentials are printed once to the console and stored only as hashes.
 *
 *   npm run db:seed              refuse to run on a non-empty database
 *   npm run db:seed -- --fresh   drop and rebuild everything (destructive)
 */
import { loadEnv } from '@parsbank/config';
import { DENOMINATIONS, DENOMINATION_THEMES } from '@parsbank/config/constants';
import { DESIGN_TOKENS } from '@parsbank/design-system';
import type { Database } from '../src/db/types.ts';
import { getDatabase, closeDatabase } from '../src/db/index.ts';
import { applyMigrations } from '../src/db/migrate.ts';
import { registerProfile } from '../src/services/users.service.ts';
import { login, issueTransactionAuthorization } from '../src/services/auth.service.ts';
import { issueCard } from '../src/services/cards.service.ts';
import { createTransfer } from '../src/services/transfers.service.ts';
import { assignBanknote, depositBanknote, registerBatch } from '../src/services/banknotes.service.ts';
import {
  approveAdminAction,
  executeAdminAction,
  issueApprovalNonce,
  requestAdminAction,
} from '../src/services/approvals.service.ts';
import {
  draftThemeVersion,
  installDesignTokens,
  upsertContentBlock,
  upsertNavigationItem,
  upsertPage,
} from '../src/services/design.service.ts';
import type { ActorContext, ServiceContext } from '../src/services/context.ts';
import { assertExecutorCoverage } from '../src/services/executors.ts';
import type { AdminRole, ProfileRole } from '@parsbank/types';

const DEMO_PASSWORD_BASE = 'Pars!1404';
const SEED_META = { requestId: 'seed', ipHash: null, userAgent: 'seed-script' };

interface SeededPerson {
  label: string;
  role: ProfileRole;
  profileId: string;
  publicRef: string;
  walletId: string;
  walletRef: string;
  cardNumber: string;
  cvv: string;
  pin: string;
  password: string;
  sessionId: string | null;
}

const people: SeededPerson[] = [];

function contextFor(db: Database, actor: ActorContext): ServiceContext {
  return { db, actor, meta: SEED_META };
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const config = loadEnv();
  const db = await getDatabase(config);

  console.log('BANK PARS · seed');
  console.log(`  ${await db.serverVersion()}`);
  console.log(`  target: ${config.databaseUrl ? 'DATABASE_URL' : config.pgliteDir}`);

  await applyMigrations(db, { fresh: args.has('--fresh') });
  const coverage = assertExecutorCoverage();
  console.log(`  approval executors: ${coverage.registered.length} action types`);

  const existing = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM prs.profiles');
  if (Number(existing?.count ?? 0) > 0) {
    console.log(
      `\n• database already holds ${existing?.count} profile(s). Nothing was changed.\n` +
        '  Re-run with --fresh to drop and rebuild the schema (destructive).',
    );
    await closeDatabase();
    return;
  }

  /* ------------------------------------------------------------------ staff */

  const staff = [
    {
      label: 'رئیس هیئت',
      fullNameFa: 'آرمان مهرابی',
      fullNameEn: 'Arman Mehrabi',
      role: 'SUPER_ADMIN' as ProfileRole,
      email: 'mehrabi@pars.local',
      password: `${DEMO_PASSWORD_BASE}-director`,
    },
    {
      label: 'افسر خزانه ۱',
      fullNameFa: 'نگار تهرانی',
      fullNameEn: 'Negar Tehrani',
      role: 'TREASURY_OFFICER' as ProfileRole,
      email: 'tehrani@pars.local',
      password: `${DEMO_PASSWORD_BASE}-treasury1`,
    },
    {
      label: 'افسر خزانه ۲',
      fullNameFa: 'سیاوش کاویانی',
      fullNameEn: 'Siavash Kaviani',
      role: 'TREASURY_OFFICER' as ProfileRole,
      email: 'kaviani@pars.local',
      password: `${DEMO_PASSWORD_BASE}-treasury2`,
    },
    {
      label: 'حسابرس',
      fullNameFa: 'لیلا رستمی',
      fullNameEn: 'Leila Rostami',
      role: 'AUDITOR' as ProfileRole,
      email: 'rostami@pars.local',
      password: `${DEMO_PASSWORD_BASE}-audit`,
    },
    {
      label: 'مدیر طراحی',
      fullNameFa: 'هومن صادقی',
      fullNameEn: 'Hooman Sadeghi',
      role: 'DESIGN_ADMIN' as ProfileRole,
      email: 'sadeghi@pars.local',
      password: `${DEMO_PASSWORD_BASE}-design`,
    },
  ];

  for (const person of staff) {
    const created = await registerProfile(db, {
      fullNameFa: person.fullNameFa,
      fullNameEn: person.fullNameEn,
      email: person.email,
      phone: null,
      password: person.password,
      role: person.role,
      auditActor: null,
    });
    const card = await issueCardFor(db, created.walletId, created.profileId, person.fullNameFa);
    people.push({
      label: person.label,
      role: person.role,
      profileId: created.profileId,
      publicRef: created.publicRef,
      walletId: created.walletId,
      walletRef: created.walletRef,
      cardNumber: card.cardNumber,
      cvv: card.cvv,
      pin: card.pin,
      password: person.password,
      sessionId: null,
    });
  }

  /* --------------------------------------------------------------- members */

  const members = [
    { label: 'عضو — مریم دانشور', fullNameFa: 'مریم دانشور', fullNameEn: 'Maryam Daneshvar', email: 'daneshvar@pars.local', password: `${DEMO_PASSWORD_BASE}-member1` },
    { label: 'عضو — کاوه امینی', fullNameFa: 'کاوه امینی', fullNameEn: 'Kaveh Amini', email: 'amini@pars.local', password: `${DEMO_PASSWORD_BASE}-member2` },
    { label: 'عضو — شیرین پارسا', fullNameFa: 'شیرین پارسا', fullNameEn: 'Shirin Parsa', email: 'parsa@pars.local', password: `${DEMO_PASSWORD_BASE}-member3` },
  ];

  for (const person of members) {
    const created = await registerProfile(db, {
      fullNameFa: person.fullNameFa,
      fullNameEn: person.fullNameEn,
      email: person.email,
      phone: null,
      password: person.password,
      role: 'USER',
      auditActor: null,
    });
    const card = await issueCardFor(db, created.walletId, created.profileId, person.fullNameFa);
    people.push({
      label: person.label,
      role: 'USER',
      profileId: created.profileId,
      publicRef: created.publicRef,
      walletId: created.walletId,
      walletRef: created.walletRef,
      cardNumber: card.cardNumber,
      cvv: card.cvv,
      pin: card.pin,
      password: person.password,
      sessionId: null,
    });
  }

  /* ---------------------------------------------------- distribution account */

  // The institution's distribution fund. It is deliberately an ordinary account:
  // staff roles carry no personal-banking permission, so a treasury officer cannot
  // move money as a side effect of being an officer — the fund itself is a member.
  const distribution = await registerProfile(db, {
    fullNameFa: 'صندوق توزیع پارس',
    fullNameEn: 'PARS Distribution Fund',
    email: 'operations@pars.local',
    phone: null,
    password: `${DEMO_PASSWORD_BASE}-operations`,
    role: 'USER',
    auditActor: null,
  });
  const operatorCard = await issueCardFor(
    db,
    distribution.walletId,
    distribution.profileId,
    'صندوق توزیع پارس',
  );
  const operator: SeededPerson = {
    label: 'صندوق توزیع',
    role: 'USER',
    profileId: distribution.profileId,
    publicRef: distribution.publicRef,
    walletId: distribution.walletId,
    walletRef: distribution.walletRef,
    cardNumber: operatorCard.cardNumber,
    cvv: operatorCard.cvv,
    pin: operatorCard.pin,
    password: `${DEMO_PASSWORD_BASE}-operations`,
    sessionId: null,
  };
  people.push(operator);

  /* ------------------------------------------------------------ sessions */

  // Real logins: the seed must prove that the front door works before it can use
  // privileged operations. Staff additionally need an ADMIN-audience session.
  const byLabel = new Map(people.map((person) => [person.label, person]));
  const director = byLabel.get('رئیس هیئت')!;
  const officer1 = byLabel.get('افسر خزانه ۱')!;
  const officer2 = byLabel.get('افسر خزانه ۲')!;
  const designAdmin = byLabel.get('مدیر طراحی')!;

  for (const person of people) {
    const audience = person.role === 'USER' ? 'USER' : 'ADMIN';
    const session = await login(db, {
      cardNumber: person.cardNumber,
      password: person.password,
      audience,
      meta: SEED_META,
      userAgent: 'seed-script',
    });
    person.sessionId = session.sessionId;
  }

  // Staff-created accounts are issued a password that must be rotated (`must_rotate`
  // is set by registerProfile). The seed simulates that rotation having happened,
  // so the demo accounts can be used immediately; production never seeds accounts.
  await db.execute('UPDATE prs.account_credentials SET must_rotate = false');

  const adminActor = (person: SeededPerson): ActorContext => ({
    profileId: person.profileId,
    role: person.role as AdminRole,
    sessionId: person.sessionId,
    audience: 'ADMIN',
    mfaSatisfied: true,
    fullNameFa: person.label,
  });

  /* ---------------------------------------------------------------- design */

  // 1. install the token catalogue, 2. draft a version, 3. publish it through the
  // approval register, because that is the only way a theme reaches visitors.
  const tokensInstalled = await installDesignTokens(
    contextFor(db, adminActor(designAdmin)),
    DESIGN_TOKENS.map((token) => ({
      key: token.key,
      category: token.category,
      value: token.value,
      valueType: token.valueType,
      descriptionFa: token.descriptionFa,
      groupKey: token.groupKey,
      sortOrder: token.sortOrder,
      isLocked: token.isLocked,
    })),
  );

  const theme = await draftThemeVersion(contextFor(db, adminActor(designAdmin)), {
    name: 'پوسته پایه پارس — نسخه ۱',
    noteFa: 'نسخه بنیادین: آبی نهادی، سرخ تأکیدی، هندسه گره‌چینی.',
  });
  await approveAndExecute(db, adminActor(designAdmin), adminActor(director), {
    actionType: 'THEME_PUBLISH',
    payload: { themeId: theme.themeId },
    reason: 'انتشار پوسته پایه سامانه در زمان راه‌اندازی',
    approveReason: 'پوسته پایه بازبینی شد و با هویت بصری بانک پارس هم‌خوان است.',
  });

  await seedContent(db, adminActor(designAdmin));

  /* --------------------------------------------------------------- reserve */

  const reserves = [
    {
      reserveRef: 'PRS-RSV-CASH-01',
      assetKind: 'CASH_USD',
      descriptionFa: 'حساب نقدی دلاری نزد خزانه — وجه نقد',
      bookValueUsdMinor: 50_000,
      haircutBps: 0,
    },
    {
      reserveRef: 'PRS-RSV-CUST-01',
      assetKind: 'CUSTODY_DEPOSIT',
      descriptionFa: 'سپرده امانی دلاری نزد خزانه‌دار',
      bookValueUsdMinor: 180_000,
      haircutBps: 0,
    },
    {
      reserveRef: 'PRS-RSV-GOLD-01',
      assetKind: 'GOLD',
      descriptionFa: 'شمش طلا — ارزش‌گذاری‌شده با کسر موی',
      bookValueUsdMinor: 40_000,
      haircutBps: 1500,
    },
  ];

  for (const reserve of reserves) {
    await approveAndExecute(db, adminActor(officer1), adminActor(officer2), {
      actionType: 'RESERVE_VALUATION',
      payload: { ...reserve, eligibility: 'ELIGIBLE' },
      reason: `ثبت و ارزش‌گذاری پشتوانه ${reserve.reserveRef} در زمان راه‌اندازی`,
      approveReason: 'اسناد پشتوانه بررسی و ارزش‌گذاری تأیید شد.',
    });
  }

  // Which reserve backs the issuances below (the largest pledged asset).
  const custodyReserve = await db.one<{ id: string }>(
    `SELECT id FROM prs.treasury_reserves WHERE reserve_ref = 'PRS-RSV-CUST-01'`,
  );
  const custodyReserveId = custodyReserve?.id ?? null;

  /* -------------------------------------------------------- note issue */

  // A physical issue: 1,300 parsee printed across the seven denominations, so every
  // series is represented in the registry and in the vault.
  const plan: Array<{ denomination: number; quantity: number }> = [
    { denomination: 1, quantity: 50 },
    { denomination: 2, quantity: 25 },
    { denomination: 5, quantity: 20 },
    { denomination: 10, quantity: 20 },
    { denomination: 50, quantity: 4 },
    { denomination: 100, quantity: 3 },
    { denomination: 200, quantity: 2 },
  ];
  const printedValue = plan.reduce((total, entry) => total + entry.denomination * entry.quantity, 0);
  const parValue = 100; // USD minor per PRS, matching policy.par_value_usd_minor

  const batchByDenomination = new Map<number, string>();
  for (const entry of plan) {
    const batch = await registerBatch(contextFor(db, adminActor(officer1)), {
      seriesLabel: `${DENOMINATION_THEMES[entry.denomination]?.portraitFa ?? 'پارس'} — سری ۱`,
      denominationMinor: entry.denomination,
      quantity: entry.quantity,
      designVersion: 'series-1',
      artworkKey: `banknote-front-${entry.denomination}`,
      notes: `سری نخست، ${entry.quantity} برگ`,
    });
    batchByDenomination.set(entry.denomination, batch.batchCode);
  }

  // One issuance releases the whole printed issue: the note account is credited
  // once, and every batch's serials become accountable outstanding notes.
  const firstBatchCode = batchByDenomination.get(1)!;

  // ISSUANCE #1 — the printed note issue (deposited into the note account).
  await approveAndExecute(db, adminActor(officer1), adminActor(officer2), {
    actionType: 'ISSUANCE',
    payload: {
      amountMinor: printedValue,
      // Every issuance must carry a pledge of reserve value: amount × par.
      reserveContributionUsdMinor: printedValue * parValue,
      reserveId: custodyReserveId,
      destinationKind: 'PHYSICAL_NOTES',
      batchCode: firstBatchCode,
      batchCodes: [...batchByDenomination.values()],
    },
    reason: `انتشار ${printedValue} پارسه به شکل اسکناس فیزیکی (سری ۱)`,
    approveReason: 'طرح و تعداد برگ‌ها بازبینی و موجودی پشتوانه کنترل شد.',
  });

  // ISSUANCE #2 — the treasury's working balance in the operational wallet.
  await approveAndExecute(db, adminActor(officer1), adminActor(officer2), {
    actionType: 'ISSUANCE',
    payload: {
      amountMinor: 900,
      reserveContributionUsdMinor: 900 * parValue,
      reserveId: custodyReserveId,
      destinationKind: 'WALLET',
      destinationWalletRef: operator.walletRef,
    },
    reason: 'تأمین موجودی صندوق توزیع برای پرداخت به اعضا',
    approveReason: 'نسبت پوشش پس از انتشار کنترل شد و مورد تأیید است.',
  });

  /* --------------------------------------------------------- distribution */

  // Ordinary transfers, authorised exactly as a member would authorise them.
  const payouts: Array<{ to: string; amount: number; memo: string }> = [
    { to: 'عضو — مریم دانشور', amount: 320, memo: 'توزیع سهمیه عضو' },
    { to: 'عضو — کاوه امینی', amount: 260, memo: 'توزیع سهمیه عضو' },
    { to: 'عضو — شیرین پارسا', amount: 180, memo: 'توزیع سهمیه عضو' },
  ];

  const operatorContext = contextFor(db, {
    profileId: operator.profileId,
    role: 'USER' as ProfileRole,
    sessionId: operator.sessionId,
    audience: 'USER',
    mfaSatisfied: true,
    fullNameFa: operator.label,
  });

  for (const payout of payouts) {
    const target = people.find((person) => person.label === payout.to)!;
    const authorization = await issueTransactionAuthorization(db, {
      profileId: operator.profileId,
      sessionId: operator.sessionId,
      walletId: operator.walletId,
      credential: { kind: 'PASSWORD', value: operator.password },
      maxAmountMinor: payout.amount,
    });
    await createTransfer(operatorContext, {
      senderWalletId: operator.walletId,
      destination: { kind: 'WALLET_REF', value: target.walletRef },
      amountMinor: payout.amount,
      memo: payout.memo,
      idempotencyKey: `seed-payout-${target.publicRef}`,
      transactionAuthorizationId: authorization.authorizationId,
      channel: 'WEB',
    });
  }

  // A member-to-member payment, including one replay of the same idempotency key,
  // which must return the original transaction instead of moving money twice.
  const maryam = people.find((person) => person.label === 'عضو — مریم دانشور')!;
  const kaveh = people.find((person) => person.label === 'عضو — کاوه امینی')!;
  const memberContext = contextFor(db, {
    profileId: maryam.profileId,
    role: 'USER',
    sessionId: maryam.sessionId,
    audience: 'USER',
    mfaSatisfied: true,
    fullNameFa: maryam.label,
  });

  const memberAuthorization = await issueTransactionAuthorization(db, {
    profileId: maryam.profileId,
    sessionId: maryam.sessionId,
    walletId: maryam.walletId,
    credential: { kind: 'PASSWORD', value: maryam.password },
    maxAmountMinor: 40,
  });
  const memberTransfer = await createTransfer(memberContext, {
    senderWalletId: maryam.walletId,
    destination: { kind: 'CARD_NUMBER', value: kaveh.cardNumber },
    amountMinor: 40,
    memo: 'بازپرداخت هزینه کتابخانه',
    idempotencyKey: 'seed-member-transfer-1',
    transactionAuthorizationId: memberAuthorization.authorizationId,
    channel: 'WEB',
  });
  await createTransfer(memberContext, {
    senderWalletId: maryam.walletId,
    destination: { kind: 'CARD_NUMBER', value: kaveh.cardNumber },
    amountMinor: 40,
    memo: 'بازپرداخت هزینه کتابخانه',
    idempotencyKey: 'seed-member-transfer-1',
    transactionAuthorizationId: memberAuthorization.authorizationId,
    channel: 'WEB',
  });

  /* -------------------------------------------------------- physical notes */

  // (a) A note in the vault is handed to a member: the registry records the holder,
  // and no value moves — the note was already outstanding.
  const heldNote = await db.one<{ serial_number: string }>(
    `SELECT serial_number FROM prs.banknotes WHERE denomination_minor = 50 AND status = 'ASSIGNED' ORDER BY serial_number LIMIT 1`,
  );
  if (heldNote) {
    await assignBanknote(contextFor(db, adminActor(officer2)), {
      serialNumber: heldNote.serial_number,
      holderWalletRef: maryam.walletRef,
    });
  }

  // (b) A member deposits a note into their wallet: value leaves the note account
  // and arrives in the wallet, and the serial stops being outstanding. This is the
  // 2300 ↔ wallet posting pair, exercised exactly as a holder would trigger it.
  const depositNote = await db.one<{ serial_number: string }>(
    `SELECT serial_number FROM prs.banknotes
      WHERE denomination_minor = 5 AND status = 'ASSIGNED' AND holder_profile_id IS NULL
      ORDER BY serial_number LIMIT 1`,
  );
  if (depositNote) {
    await assignBanknote(contextFor(db, adminActor(officer2)), {
      serialNumber: depositNote.serial_number,
      holderWalletRef: maryam.walletRef,
    });
    await depositBanknote(
      contextFor(db, {
        profileId: maryam.profileId,
        role: 'USER',
        sessionId: maryam.sessionId,
        audience: 'USER',
        mfaSatisfied: true,
        fullNameFa: maryam.label,
      }),
      { serialNumber: depositNote.serial_number, walletRef: maryam.walletRef },
    );
  }

  /* -------------------------------------------------------------- summary */

  const summary = await db.one<{
    total_issued_minor: string;
    circulating_supply_minor: string;
    bank_held_minor: string;
    note_outstanding_minor: string;
  }>(
    `SELECT total_issued_minor::text, circulating_supply_minor::text, bank_held_minor::text,
            prs.banknote_registry_outstanding()::text AS note_outstanding_minor
       FROM prs.supply_summary`,
  );
  const monetary = await db.one<Record<string, string>>(
    `SELECT total_issued_minor::text, circulating_supply_minor::text, eligible_reserve_nav_usd_minor::text,
            reserve_coverage_ratio::text, reference_rate_prs_per_usd::text
       FROM prs.monetary_state LIMIT 1`,
  );
  const findings = await db.one<{ count: string }>(
    'SELECT count(*)::text AS count FROM prs.check_monetary_integrity()',
  );

  console.log('\n── institution founded ─────────────────────────────────────────────');
  console.log(`  tokens installed        ${tokensInstalled.inserted} (existing ${tokensInstalled.existing})`);
  console.log(`  theme published         version ${theme.versionNumber}`);
  console.log(`  reserve assets          ${reserves.length}`);
  console.log(`  notes registered        ${plan.reduce((total, entry) => total + entry.quantity, 0)} (${printedValue} PRS)`);
  console.log(`  total issued            ${summary?.total_issued_minor} PRS`);
  console.log(`  circulating             ${summary?.circulating_supply_minor} PRS`);
  console.log(`  notes outstanding       ${summary?.note_outstanding_minor} PRS`);
  console.log(`  eligible reserve NAV    ${monetary?.eligible_reserve_nav_usd_minor} (USD minor)`);
  console.log(`  coverage ratio          ${monetary?.reserve_coverage_ratio}`);
  console.log(`  reference rate          ${monetary?.reference_rate_prs_per_usd} USD per PRS`);
  console.log(`  member transfer         ${memberTransfer.transaction.reference}`);
  console.log(`  integrity findings      ${findings?.count}`);
  console.log(`  denominations           ${DENOMINATIONS.join(' / ')}`);

  console.log('\n── credentials (printed once) ──────────────────────────────────────');
  const width = Math.max(...people.map((person) => person.label.length));
  for (const person of people) {
    console.log(
      `  ${person.label.padEnd(width)}  ${String(person.role).padEnd(16)}  ${person.cardNumber}  ${person.password}  CVV ${person.cvv}  PIN ${person.pin}`,
    );
  }
  console.log('\n  These are development credentials. Production deployments never');
  console.log('  seed accounts; the first administrator is provisioned out of band.\n');

  await closeDatabase();
}

async function issueCardFor(db: Database, walletId: string, profileId: string, nameFa: string) {
  return db.transaction(async (tx) =>
    issueCard(tx, {
      profileId,
      walletId,
      cardholderNameFa: nameFa,
      actorProfileId: profileId,
      contactless: true,
    }),
  );
}

/**
 * Files a request, takes the approval nonce, approves it as a second person and
 * executes it. If any of the three steps fails the seed fails: there is no side
 * door around dual control, not even for the founding of the bank.
 */
async function approveAndExecute(
  db: Database,
  requester: ActorContext,
  approver: ActorContext,
  input: {
    actionType: Parameters<typeof requestAdminAction>[1]['actionType'];
    payload: Record<string, unknown>;
    reason: string;
    approveReason: string;
  },
): Promise<void> {
  if (requester.profileId === approver.profileId) {
    throw new Error('seed error: a request and its approval must come from different people');
  }
  const request = await requestAdminAction(contextFor(db, requester), {
    actionType: input.actionType,
    payload: input.payload,
    reason: input.reason,
  });
  const approverContext = contextFor(db, approver);
  const nonce = await issueApprovalNonce(approverContext, { actionId: request.id, purpose: 'APPROVE' });
  await approveAdminAction(approverContext, { actionId: request.id, nonce: nonce.nonce, note: input.approveReason });
  await executeAdminAction(approverContext, { actionId: request.id });
}

/** The public site's initial content: blocks, pages and navigation. */
async function seedContent(db: Database, designActor: ActorContext): Promise<void> {
  const context = contextFor(db, designActor);

  const blocks = [
    {
      blockKey: 'landing.hero',
      kind: 'HERO' as const,
      titleFa: 'بانک پارس — سامانه مالی بسته و خصوصی',
      bodyFa:
        'پارسه واحد درونی این شبکه خصوصی است. هیچ اتصالی به سامانه بانکی یا پرداخت واقعی وجود ندارد. پشتوانه، عرضه و نرخ مرجع تنها در سرور محاسبه و ثبت می‌شود.',
      data: { primaryCta: { labelFa: 'ورود به حساب', href: '/login' }, secondaryCta: { labelFa: 'مبانی پولی', href: '/monetary' } },
      publish: true,
    },
    {
      blockKey: 'landing.pillars',
      kind: 'STAT' as const,
      titleFa: 'چهار ستون سامانه',
      bodyFa: 'دفترداری دوطرفه، خزانه پشتوانه‌محور، کارت و اسکناس دارای ثبت، و تفکیک کامل طراحی از منطق پولی.',
      data: {
        items: [
          { labelFa: 'دفترداری دوطرفه', valueFa: 'هر ریال بدهکار، یک ریال بستانکار' },
          { labelFa: 'سقف عرضه', valueFa: '۱۰٬۰۰۰ پارسه' },
          { labelFa: 'پشتوانه', valueFa: 'دارایی‌های واجد شرایط خزانه' },
          { labelFa: 'کنترل دو‌نفره', valueFa: 'انتشار، امحا و تغییر خط‌مشی' },
        ],
      },
      publish: true,
    },
    {
      blockKey: 'landing.notice',
      kind: 'LEGAL' as const,
      titleFa: 'یادآوری حقوقی',
      bodyFa:
        'پارسه پول قانونی نیست و بانک پارس یک نهاد قانونی ثبت‌شده نیست. این سامانه برای گروهی محدود از افراد مورد اعتماد ساخته شده است.',
      publish: true,
    },
    {
      blockKey: 'app.disclaimer',
      kind: 'FOOTER_NOTE' as const,
      titleFa: 'واحد پولی',
      bodyFa: 'واحد: پارسه (PRS) — کسری از یک پارسه پشتیبانی نمی‌شود.',
      publish: true,
    },
  ];

  for (const block of blocks) {
    await upsertContentBlock(context, block);
  }

  const pages = [
    {
      slug: 'home',
      titleFa: 'بانک پارس',
      descriptionFa: 'سامانه مالی بسته و خصوصی پارس',
      layout: [
        { type: 'HERO', blockKey: 'landing.hero' },
        { type: 'STATS', blockKey: 'landing.pillars' },
        { type: 'MONETARY', titleFa: 'وضعیت پولی' },
        { type: 'LEGAL', blockKey: 'landing.notice' },
      ],
      publish: true,
      isSystem: true,
    },
    {
      slug: 'monetary',
      titleFa: 'مبانی پولی',
      descriptionFa: 'عرضه، پشتوانه و نرخ مرجع',
      layout: [
        { type: 'MONETARY', titleFa: 'عرضه و پشتوانه' },
        { type: 'DENOMINATIONS', titleFa: 'اسکناس‌های سری اول' },
        { type: 'LEGAL', blockKey: 'landing.notice' },
      ],
      publish: true,
      isSystem: false,
    },
  ];

  for (const page of pages) {
    await upsertPage(context, page);
  }

  const navigation = [
    { location: 'PUBLIC_HEADER' as const, labelFa: 'خانه', labelEn: 'Home', href: '/', sortOrder: 10 },
    { location: 'PUBLIC_HEADER' as const, labelFa: 'مبانی پولی', labelEn: 'Monetary', href: '/monetary', sortOrder: 20 },
    { location: 'PUBLIC_HEADER' as const, labelFa: 'اعتبارسنجی اسکناس', labelEn: 'Verify', href: '/verify', sortOrder: 30 },
    { location: 'PUBLIC_HEADER' as const, labelFa: 'ورود', labelEn: 'Sign in', href: '/login', sortOrder: 40 },
    { location: 'PUBLIC_FOOTER' as const, labelFa: 'شرایط کاربرد', labelEn: 'Terms', href: '/terms', sortOrder: 10 },
    { location: 'PUBLIC_FOOTER' as const, labelFa: 'حریم خصوصی', labelEn: 'Privacy', href: '/privacy', sortOrder: 20 },
    { location: 'PUBLIC_APP_NAV' as const, labelFa: 'داشبورد', labelEn: 'Dashboard', href: '/app', iconKey: 'dashboard', sortOrder: 10 },
    { location: 'PUBLIC_APP_NAV' as const, labelFa: 'کیف پول', labelEn: 'Wallets', href: '/app/wallets', iconKey: 'wallet', sortOrder: 20 },
    { location: 'PUBLIC_APP_NAV' as const, labelFa: 'کارت‌ها', labelEn: 'Cards', href: '/app/cards', iconKey: 'card', sortOrder: 30 },
    { location: 'PUBLIC_APP_NAV' as const, labelFa: 'انتقال', labelEn: 'Transfer', href: '/app/send', iconKey: 'send', sortOrder: 40 },
    { location: 'PUBLIC_APP_NAV' as const, labelFa: 'اسکن و پرداخت', labelEn: 'Scan', href: '/app/scan', iconKey: 'scan', sortOrder: 50 },
    { location: 'PUBLIC_APP_NAV' as const, labelFa: 'دریافت', labelEn: 'Receive', href: '/app/receive', iconKey: 'receive', sortOrder: 60 },
    { location: 'PUBLIC_APP_NAV' as const, labelFa: 'تاریخچه', labelEn: 'History', href: '/app/history', iconKey: 'history', sortOrder: 70 },
    { location: 'PUBLIC_APP_NAV' as const, labelFa: 'اسکناس‌ها', labelEn: 'Banknotes', href: '/app/notes', iconKey: 'notes', sortOrder: 80 },
    { location: 'PUBLIC_APP_NAV' as const, labelFa: 'تنظیمات امنیتی', labelEn: 'Security', href: '/app/security', iconKey: 'security', sortOrder: 90 },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'نمای کلی', labelEn: 'Overview', href: '/admin', iconKey: 'overview', sortOrder: 10 },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'کاربران', labelEn: 'Users', href: '/admin/users', iconKey: 'users', sortOrder: 20, requiredPermission: 'admin.users.read' },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'کیف پول‌ها', labelEn: 'Wallets', href: '/admin/wallets', iconKey: 'wallet', sortOrder: 30, requiredPermission: 'admin.wallets.read' },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'کارت‌ها', labelEn: 'Cards', href: '/admin/cards', iconKey: 'card', sortOrder: 40, requiredPermission: 'admin.cards.read' },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'تراکنش‌ها', labelEn: 'Transactions', href: '/admin/transactions', iconKey: 'transactions', sortOrder: 50, requiredPermission: 'admin.transactions.read' },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'خزانه', labelEn: 'Treasury', href: '/admin/treasury', iconKey: 'treasury', sortOrder: 60, requiredPermission: 'admin.treasury.read' },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'انتشار', labelEn: 'Issuance', href: '/admin/issuance', iconKey: 'issuance', sortOrder: 70, requiredPermission: 'admin.issuance.read' },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'امحا', labelEn: 'Burning', href: '/admin/burning', iconKey: 'burning', sortOrder: 80, requiredPermission: 'admin.burning.read' },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'اسکناس‌ها', labelEn: 'Banknotes', href: '/admin/banknotes', iconKey: 'notes', sortOrder: 90, requiredPermission: 'admin.banknotes.read' },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'نرخ مرجع', labelEn: 'Rates', href: '/admin/rates', iconKey: 'rates', sortOrder: 100, requiredPermission: 'admin.rates.read' },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'پشتوانه', labelEn: 'Reserve', href: '/admin/reserve', iconKey: 'reserve', sortOrder: 110, requiredPermission: 'admin.reserve.read' },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'حسابرسی', labelEn: 'Audit', href: '/admin/audit', iconKey: 'audit', sortOrder: 120, requiredPermission: 'admin.audit.read' },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'تأییدهای دو‌نفره', labelEn: 'Approvals', href: '/admin/approvals', iconKey: 'approvals', sortOrder: 130, requiredPermission: 'admin.approvals.request' },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'محتوا', labelEn: 'CMS', href: '/admin/content', iconKey: 'content', sortOrder: 140, requiredPermission: 'cms.read' },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'سامانه طراحی', labelEn: 'Design', href: '/admin/design', iconKey: 'design', sortOrder: 150, requiredPermission: 'cms.read' },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'دارایی‌های بصری', labelEn: 'Assets', href: '/admin/assets', iconKey: 'assets', sortOrder: 160, requiredPermission: 'cms.read' },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'کلیدهای ویژگی', labelEn: 'Feature flags', href: '/admin/flags', iconKey: 'flags', sortOrder: 170, requiredPermission: 'admin.treasury.read' },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'امنیت', labelEn: 'Security', href: '/admin/security', iconKey: 'security', sortOrder: 180, requiredPermission: 'admin.security.read' },
    { location: 'ADMIN_SIDEBAR' as const, labelFa: 'سلامت سامانه', labelEn: 'Health', href: '/admin/health', iconKey: 'health', sortOrder: 190, requiredPermission: 'admin.health.read' },
  ];

  for (const item of navigation) {
    await upsertNavigationItem(context, item);
  }
}

main().catch(async (error) => {
  console.error(`\n✗ seed failed: ${error instanceof Error ? error.message : String(error)}`);
  const statement = (error as { statement?: string })?.statement;
  if (statement) console.error(`  statement: ${statement}`);
  if (error instanceof Error && error.stack) console.error(error.stack.split('\n').slice(1, 4).join('\n'));
  process.exitCode = 1;
  await closeDatabase();
});
