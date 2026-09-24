/**
 * BANK PARS — physical banknote registry.
 *
 * The registry is a real book, connected to the monetary ledger through account
 * 2300 PHYSICAL_NOTES_OUTSTANDING:
 *
 *   • notes sitting in the vault (REGISTERED) are stock, not money;
 *   • a batch is released for circulation ONLY by an approved issuance whose
 *     destination is PHYSICAL_NOTES — that is the moment value appears on 2300;
 *   • assigning a note to a holder is a custody record, not a money movement;
 *   • depositing a note into a wallet moves value 2300 → wallet;
 *   • withdrawing a note moves value wallet → 2300;
 *   • destroying an outstanding note requires a burn: value leaves 2300 forever.
 *
 * Invariant: Σ face value of notes with `carries_outstanding_value` must equal
 * balance(2300). It is asserted by prs.check_monetary_integrity() and by the tests.
 */
import type { BanknoteDto, BanknoteVerificationResult } from '@parsbank/types';
import {
  DomainError,
  assertTransition,
  assertValidSerial,
  buildNoteDeposit,
  buildNoteWithdrawal,
  carriesOutstandingValue,
  formatSerial,
  parseSerial,
  type BanknoteStatus,
} from '@parsbank/domain';
import type { Database, TransactionContext } from '../db/types.ts';
import { batchCode as padBatchCode } from '../lib/ids.ts';
import { registerApprovalExecutor } from './approval-registry.ts';
import { writeAudit } from './audit.service.ts';
import type { ServiceContext } from './context.ts';
import { requireActor } from './context.ts';
import { chart, postPostingSet, walletAccount } from './ledger.service.ts';
import { isWithdrawalEnabled } from './settings.service.ts';

/* -------------------------------------------------------------------------- */
/* Registration & batches                                                      */
/* -------------------------------------------------------------------------- */

export interface IssuedBatch {
  batchId: string;
  batchCode: string;
  denominationMinor: number;
  quantity: number;
  firstSerial: string;
  lastSerial: string;
  faceValueMinor: number;
}

/**
 * Prints a batch of notes into the vault. This is a REGISTRY operation: no ledger
 * entry is created, because stock in the vault is not outstanding money. Value is
 * created later, by an approved issuance to PHYSICAL_NOTES.
 */
export async function registerBatch(
  context: ServiceContext,
  input: {
    seriesLabel: string;
    denominationMinor: number;
    quantity: number;
    designVersion?: string | null;
    artworkKey?: string | null;
    notes?: string | null;
  },
): Promise<IssuedBatch> {
  const actor = requireActor(context);
  if (input.quantity < 1 || input.quantity > 5_000) {
    throw new DomainError('VALIDATION_FAILED', { messageFa: 'تعداد برگ باید بین ۱ و ۵۰۰۰ باشد.' });
  }
  if (input.denominationMinor <= 0) throw new DomainError('INVALID_AMOUNT');

  return context.db.transaction(async (tx) => {
    const nextBatch = await tx.one<{ next: string }>(
      `SELECT lpad((COALESCE(MAX(batch_code::int), 0) + 1)::text, 4, '0') AS next FROM prs.banknote_batches`,
    );
    const code = padBatchCode(Number(nextBatch?.next ?? '0001'));

    const batch = await tx.one<{ id: string }>(
      `INSERT INTO prs.banknote_batches
         (batch_code, series_label, denomination_minor, quantity, printed_at, authorised_by, design_version, notes)
       VALUES ($1,$2,$3,$4, now(), $5, $6, $7)
       RETURNING id`,
      [code, input.seriesLabel, input.denominationMinor, input.quantity, actor.profileId, input.designVersion ?? null, input.notes ?? null],
    );

    let firstSerial = '';
    let lastSerial = '';
    for (let sequence = 1; sequence <= input.quantity; sequence += 1) {
      const serial = formatSerial(input.denominationMinor, code, sequence);
      if (sequence === 1) firstSerial = serial;
      lastSerial = serial;
      const inserted = await tx.one<{ id: string }>(
        `INSERT INTO prs.banknotes
           (serial_number, denomination_minor, batch_id, batch_code, series_label, status, custodian,
            carries_outstanding_value, design_version, artwork_key, created_by)
         VALUES ($1,$2,$3,$4,$5,'REGISTERED','VAULT', false, $6, $7, $8)
         RETURNING id`,
        [
          serial,
          input.denominationMinor,
          batch!.id,
          code,
          input.seriesLabel,
          input.designVersion ?? null,
          input.artworkKey ?? null,
          actor.profileId,
        ],
      );
      await tx.execute(
        `INSERT INTO prs.banknote_events (banknote_id, event, to_status, detail, actor_id)
         VALUES ($1,'REGISTERED','REGISTERED',$2,$3)`,
        [inserted!.id, JSON.stringify({ batchCode: code, denomination: input.denominationMinor }), actor.profileId],
      );
    }

    await writeAudit(tx, {
      actor,
      action: 'banknote.batch.register',
      category: 'BANKNOTE',
      severity: 'NOTICE',
      entityType: 'banknote_batch',
      entityRef: code,
      afterState: {
        denominationMinor: input.denominationMinor,
        quantity: input.quantity,
        firstSerial,
        lastSerial,
      },
      meta: context.meta,
    });

    return {
      batchId: batch!.id,
      batchCode: code,
      denominationMinor: input.denominationMinor,
      quantity: input.quantity,
      firstSerial,
      lastSerial,
      faceValueMinor: input.denominationMinor * input.quantity,
    };
  });
}

/** Called by the ISSUANCE executor when a batch is released for circulation. */
export async function markBatchAssignedInCirculation(
  tx: TransactionContext,
  input: { batchCode: string; actorProfileId: string },
): Promise<number> {
  const notes = await tx.query<{ id: string; serial_number: string; status: BanknoteStatus }>(
    `SELECT id, serial_number, status FROM prs.banknotes WHERE batch_code = $1 AND status = 'REGISTERED'`,
    [input.batchCode],
  );
  for (const note of notes) {
    assertTransition(note.status, 'ASSIGNED');
    await tx.execute(
      `UPDATE prs.banknotes
          SET status = 'ASSIGNED', carries_outstanding_value = true, custodian = 'TREASURY',
              issued_at = COALESCE(issued_at, now()), last_event_at = now()
        WHERE id = $1`,
      [note.id],
    );
    await tx.execute(
      `INSERT INTO prs.banknote_events (banknote_id, event, from_status, to_status, detail, actor_id)
       VALUES ($1,'ASSIGNED','REGISTERED','ASSIGNED',$2,$3)`,
      [note.id, JSON.stringify({ batchCode: input.batchCode }), input.actorProfileId],
    );
  }
  return notes.length;
}

/** Called by the BURN executor when a specific outstanding note is destroyed. */
export async function markBanknoteDestroyed(
  tx: TransactionContext,
  input: { serialNumber: string; destructionRef: string | null; actorProfileId: string },
): Promise<string> {
  const note = await tx.one<{ id: string; status: BanknoteStatus; carries_outstanding_value: boolean }>(
    'SELECT id, status, carries_outstanding_value FROM prs.banknotes WHERE serial_number = $1',
    [input.serialNumber],
  );
  if (!note) throw new DomainError('BANKNOTE_NOT_FOUND');
  if (!note.carries_outstanding_value) {
    throw new DomainError('BANKNOTE_STATUS_CONFLICT', {
      messageFa: 'این اسکناس ارزش در گردش ندارد و امحای دفتری لازم نیست.',
    });
  }
  assertTransition(note.status, 'DESTROYED');
  await tx.execute(
    `UPDATE prs.banknotes
        SET status = 'DESTROYED', carries_outstanding_value = false, custodian = 'VAULT',
            destroyed_at = now(), last_event_at = now(), holder_profile_id = NULL
      WHERE id = $1`,
    [note.id],
  );
  await tx.execute(
    `INSERT INTO prs.banknote_events (banknote_id, event, from_status, to_status, detail, actor_id)
     VALUES ($1,'DESTROYED',$2,'DESTROYED',$3,$4)`,
    [note.id, note.status, JSON.stringify({ destructionRef: input.destructionRef }), input.actorProfileId],
  );
  return note.id;
}

/* -------------------------------------------------------------------------- */
/* Custody operations                                                          */
/* -------------------------------------------------------------------------- */

export async function assignBanknote(
  context: ServiceContext,
  input: { serialNumber: string; holderWalletRef: string },
): Promise<BanknoteDto> {
  const actor = requireActor(context);
  const parsed = assertValidSerial(input.serialNumber);

  return context.db.transaction(async (tx) => {
    const note = await tx.one<{
      id: string;
      status: BanknoteStatus;
      denomination_minor: string;
      series_label: string;
      carries_outstanding_value: boolean;
    }>(
      `SELECT id, status, denomination_minor::text, series_label, carries_outstanding_value
         FROM prs.banknotes WHERE serial_number = $1 FOR UPDATE`,
      [parsed.serial],
    );
    if (!note) throw new DomainError('BANKNOTE_NOT_FOUND', { messageFa: 'این شماره سریال در دفتر ثبت نشده است.' });
    if (!note.carries_outstanding_value) {
      throw new DomainError('BANKNOTE_STATUS_CONFLICT', {
        messageFa: 'این اسکناس در گردش نیست؛ ابتدا باید از خزانه آزاد شود.',
      });
    }
    if (note.status === 'LOST' || note.status === 'STOLEN') {
      throw new DomainError('BANKNOTE_STATUS_CONFLICT', { messageFa: 'این اسکناس گم‌شده یا مسروقه اعلام شده است.' });
    }

    const wallet = await tx.one<{ id: string; profile_id: string }>(
      'SELECT id, profile_id FROM prs.wallets WHERE public_ref = $1 OR id::text = $1',
      [input.holderWalletRef],
    );
    if (!wallet) throw new DomainError('WALLET_NOT_FOUND');

    await tx.execute(
      `UPDATE prs.banknotes
          SET holder_profile_id = $2, holder_wallet_id = $3, custodian = 'HOLDER', last_event_at = now()
        WHERE id = $1`,
      [note.id, wallet.profile_id, wallet.id],
    );
    await tx.execute(
      `INSERT INTO prs.banknote_events (banknote_id, event, from_status, to_status, to_holder, detail, actor_id)
       VALUES ($1,'ASSIGNED',$2,$2,$3,$4,$5)`,
      [note.id, note.status, wallet.profile_id, JSON.stringify({ walletId: wallet.id }), actor.profileId],
    );
    await tx.execute(
      `INSERT INTO prs.banknote_transfers
         (banknote_id, transfer_type, to_profile_id, to_wallet_id, memo, created_by)
       VALUES ($1,'ISSUE_TO_HOLDER',$2,$3,$4,$5)`,
      [note.id, wallet.profile_id, wallet.id, 'assign from treasury', actor.profileId],
    );
    await writeAudit(tx, {
      actor,
      action: 'banknote.assign',
      category: 'BANKNOTE',
      severity: 'NOTICE',
      entityType: 'banknote',
      entityId: note.id,
      entityRef: parsed.serial,
      afterState: { holderProfileId: wallet.profile_id },
      meta: context.meta,
    });

    return await loadBanknoteDto(tx, note.id);
  });
}

/** Deposit a physical note held by the caller into their wallet (value 2300 → wallet). */
export async function depositBanknote(
  context: ServiceContext,
  input: { serialNumber: string; walletRef: string },
): Promise<{ banknote: BanknoteDto; ledgerSequence: number }> {
  const actor = requireActor(context);
  const parsed = assertValidSerial(input.serialNumber);

  return context.db.transaction(async (tx) => {
    const note = await tx.one<{
      id: string;
      status: BanknoteStatus;
      denomination_minor: string;
      carries_outstanding_value: boolean;
      holder_profile_id: string | null;
    }>(
      `SELECT id, status, denomination_minor::text, carries_outstanding_value, holder_profile_id
         FROM prs.banknotes WHERE serial_number = $1 FOR UPDATE`,
      [parsed.serial],
    );
    if (!note) throw new DomainError('BANKNOTE_NOT_FOUND');
    if (!note.carries_outstanding_value) {
      throw new DomainError('BANKNOTE_STATUS_CONFLICT', { messageFa: 'این اسکناس ارزش در گردش ندارد.' });
    }
    if (note.status === 'LOST' || note.status === 'STOLEN') {
      throw new DomainError('BANKNOTE_STATUS_CONFLICT', { messageFa: 'اسکناس گم‌شده یا مسروقه قابل واریز نیست.' });
    }

    const wallet = await tx.one<{ id: string; profile_id: string; status: string }>(
      'SELECT id, profile_id, status FROM prs.wallets WHERE public_ref = $1 OR id::text = $1',
      [input.walletRef],
    );
    if (!wallet) throw new DomainError('WALLET_NOT_FOUND');
    if (wallet.profile_id !== actor.profileId) {
      throw new DomainError('WALLET_NOT_OWNED', { messageFa: 'این کیف پول به شما تعلق ندارد.' });
    }
    if (wallet.status === 'FROZEN' || wallet.status === 'CLOSED') throw new DomainError('ACCOUNT_FROZEN');
    if (note.holder_profile_id && note.holder_profile_id !== actor.profileId) {
      throw new DomainError('BANKNOTE_STATUS_CONFLICT', {
        messageFa: 'این اسکناس در اختیار شما ثبت نشده است.',
      });
    }

    assertTransition(note.status, 'DEPOSITED');
    const amountMinor = Number(note.denomination_minor);
    const noteAccount = await chart.physicalNotes(tx);
    const walletAccountRef = await walletAccount(tx, wallet.id);

    const posted = await postPostingSet(tx, {
      set: buildNoteDeposit({
        noteAccount,
        walletAccount: walletAccountRef,
        amountMinor,
        memo: `واریز اسکناس ${parsed.serial}`,
      }),
      actor,
      reason: `physical note deposit ${parsed.serial}`,
      refreshMonetaryState: false,
      metadata: { serialNumber: parsed.serial },
    });

    await tx.execute(
      `UPDATE prs.banknotes
          SET status = 'DEPOSITED', carries_outstanding_value = false, custodian = 'TREASURY',
              holder_wallet_id = $2, last_event_at = now()
        WHERE id = $1`,
      [note.id, wallet.id],
    );
    await tx.execute(
      `INSERT INTO prs.banknote_events (banknote_id, event, from_status, to_status, from_holder, ledger_transaction_id, detail, actor_id)
       VALUES ($1,'DEPOSITED',$2,'DEPOSITED',$3,$4,$5,$3)`,
      [
        note.id,
        note.status,
        actor.profileId,
        posted.ledgerTransactionId,
        JSON.stringify({ walletId: wallet.id, amountMinor }),
      ],
    );
    await tx.execute(
      `INSERT INTO prs.banknote_transfers
         (banknote_id, transfer_type, from_profile_id, to_wallet_id, ledger_transaction_id, created_by)
       VALUES ($1,'HOLDER_TO_VAULT',$2,$3,$4,$2)`,
      [note.id, actor.profileId, wallet.id, posted.ledgerTransactionId],
    );
    await writeAudit(tx, {
      actor,
      action: 'banknote.deposit',
      category: 'MONEY',
      severity: 'NOTICE',
      entityType: 'banknote',
      entityId: note.id,
      entityRef: parsed.serial,
      afterState: { amountMinor, walletId: wallet.id, ledgerSequence: posted.sequenceNo },
      meta: context.meta,
    });

    return { banknote: await loadBanknoteDto(tx, note.id), ledgerSequence: posted.sequenceNo };
  });
}

/** Withdraw a note that is in the vault (value wallet → 2300). */
export async function withdrawBanknote(
  context: ServiceContext,
  input: { serialNumber: string; walletRef: string },
): Promise<{ banknote: BanknoteDto; ledgerSequence: number }> {
  const actor = requireActor(context);
  const parsed = assertValidSerial(input.serialNumber);

  return context.db.transaction(async (tx) => {
    if (!(await isWithdrawalEnabled(tx))) {
      throw new DomainError('FINANCIAL_CONTROLS_DISABLED', { messageFa: 'برداشت در حال حاضر غیرفعال است.' });
    }

    const note = await tx.one<{ id: string; status: BanknoteStatus; denomination_minor: string }>(
      `SELECT id, status, denomination_minor::text FROM prs.banknotes WHERE serial_number = $1 FOR UPDATE`,
      [parsed.serial],
    );
    if (!note) throw new DomainError('BANKNOTE_NOT_FOUND');
    if (note.status !== 'IN_VAULT' && note.status !== 'REGISTERED') {
      throw new DomainError('BANKNOTE_STATUS_CONFLICT', {
        messageFa: 'این اسکناس در خزانه نیست و قابل برداشت نیست.',
      });
    }

    const wallet = await tx.one<{ id: string; profile_id: string; status: string }>(
      'SELECT id, profile_id, status FROM prs.wallets WHERE public_ref = $1 OR id::text = $1',
      [input.walletRef],
    );
    if (!wallet) throw new DomainError('WALLET_NOT_FOUND');
    if (wallet.profile_id !== actor.profileId) throw new DomainError('WALLET_NOT_OWNED');
    if (wallet.status !== 'ACTIVE') throw new DomainError('ACCOUNT_FROZEN');

    assertTransition(note.status, 'ASSIGNED');
    const amountMinor = Number(note.denomination_minor);
    const noteAccount = await chart.physicalNotes(tx);
    const walletAccountRef = await walletAccount(tx, wallet.id);

    const posted = await postPostingSet(tx, {
      set: buildNoteWithdrawal({
        noteAccount,
        walletAccount: walletAccountRef,
        amountMinor,
        memo: `برداشت اسکناس ${parsed.serial}`,
      }),
      actor,
      reason: `physical note withdrawal ${parsed.serial}`,
      refreshMonetaryState: false,
      metadata: { serialNumber: parsed.serial },
    });

    await tx.execute(
      `UPDATE prs.banknotes
          SET status = 'ASSIGNED', carries_outstanding_value = true, custodian = 'HOLDER',
              holder_profile_id = $2, holder_wallet_id = $3, issued_at = COALESCE(issued_at, now()),
              last_event_at = now()
        WHERE id = $1`,
      [note.id, actor.profileId, wallet.id],
    );
    await tx.execute(
      `INSERT INTO prs.banknote_events (banknote_id, event, from_status, to_status, to_holder, ledger_transaction_id, detail, actor_id)
       VALUES ($1,'WITHDRAWN',$2,'ASSIGNED',$3,$4,$5,$3)`,
      [note.id, note.status, actor.profileId, posted.ledgerTransactionId, JSON.stringify({ amountMinor, walletId: wallet.id })],
    );
    await tx.execute(
      `INSERT INTO prs.banknote_transfers
         (banknote_id, transfer_type, to_profile_id, to_wallet_id, ledger_transaction_id, created_by)
       VALUES ($1,'VAULT_TO_HOLDER',$2,$3,$4,$2)`,
      [note.id, actor.profileId, wallet.id, posted.ledgerTransactionId],
    );
    await writeAudit(tx, {
      actor,
      action: 'banknote.withdraw',
      category: 'MONEY',
      severity: 'NOTICE',
      entityType: 'banknote',
      entityId: note.id,
      entityRef: parsed.serial,
      afterState: { amountMinor, ledgerSequence: posted.sequenceNo },
      meta: context.meta,
    });

    return { banknote: await loadBanknoteDto(tx, note.id), ledgerSequence: posted.sequenceNo };
  });
}

/* -------------------------------------------------------------------------- */
/* Verification                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Verifies a serial. Always answers — an unknown or mistyped serial is a result,
 * not an error — and records the check in the note's verification history.
 */
export async function verifyBanknote(
  db: Database,
  input: {
    serialNumber: string;
    claimedDenominationMinor?: number | null;
    verifierProfileId: string | null;
    ipHash: string | null;
    channel: 'PUBLIC_APP' | 'ADMIN_APP' | 'API';
  },
): Promise<BanknoteVerificationResult> {
  const parsed = parseSerial(input.serialNumber);
  const now = new Date().toISOString();

  const note = parsed.valid
    ? await db.one<{
        id: string;
        status: BanknoteStatus;
        denomination_minor: string;
        series_label: string;
        holder_profile_id: string | null;
      }>(
        `SELECT id, status, denomination_minor::text, series_label, holder_profile_id
           FROM prs.banknotes WHERE serial_number = $1`,
        [parsed.serial],
      )
    : null;

  let outcome: BanknoteVerificationResult['outcome'];
  let messageFa: string;

  if (!parsed.valid) {
    outcome = parsed.reason === 'CHECKSUM' || parsed.reason === 'FORMAT' ? 'INVALID_CHECKSUM' : 'UNKNOWN_SERIAL';
    messageFa =
      parsed.reason === 'DENOMINATION'
        ? 'ارقام سریال با سری ارزش‌های مجاز هم‌خوانی ندارد.'
        : 'قالب شماره سریال معتبر نیست.';
  } else if (!note) {
    outcome = 'UNKNOWN_SERIAL';
    messageFa = 'این شماره سریال در دفتر اسکناس ثبت نشده است.';
  } else if (note.status === 'LOST') {
    outcome = 'REPORTED_LOST';
    messageFa = 'این اسکناس در سامانه «گم‌شده» ثبت شده است.';
  } else if (note.status === 'STOLEN') {
    outcome = 'REPORTED_STOLEN';
    messageFa = 'این اسکناس در سامانه «مسروقه» ثبت شده است.';
  } else if (note.status === 'FROZEN') {
    outcome = 'FROZEN';
    messageFa = 'این اسکناس در وضعیت انجماد است.';
  } else if (note.status === 'DESTROYED' || note.status === 'RETIRED') {
    outcome = 'DESTROYED';
    messageFa = 'این اسکناس امحا یا باطل شده است.';
  } else if (
    input.claimedDenominationMinor &&
    Number(note.denomination_minor) !== input.claimedDenominationMinor
  ) {
    outcome = 'DENOMINATION_MISMATCH';
    messageFa = 'ارزش اعلام‌شده با ارزش ثبت‌شده این اسکناس هم‌خوانی ندارد.';
  } else {
    outcome = 'GENUINE';
    messageFa = 'این اسکناس معتبر و در دفتر بانک پارس ثبت است.';
  }

  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO prs.banknote_verifications
         (banknote_id, submitted_serial, checksum_valid, found, reported_status, outcome,
          denomination_claimed, denomination_actual, verifier_profile_id, ip_hash, channel, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        note?.id ?? null,
        parsed.serial,
        parsed.valid,
        Boolean(note),
        note?.status ?? null,
        outcome,
        input.claimedDenominationMinor ?? null,
        note ? Number(note.denomination_minor) : null,
        input.verifierProfileId,
        input.ipHash,
        input.channel,
        JSON.stringify({ reason: parsed.reason ?? null }),
      ],
    );
    if (note) {
      await tx.execute(
        `INSERT INTO prs.banknote_events (banknote_id, event, to_status, detail, actor_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          note.id,
          outcome === 'GENUINE' ? 'VERIFIED' : 'VERIFICATION_FAILED',
          note.status,
          JSON.stringify({ outcome, channel: input.channel }),
          input.verifierProfileId,
        ],
      );
    }
  });

  return {
    outcome,
    found: Boolean(note),
    checksumValid: parsed.valid,
    serialNumber: parsed.serial,
    denominationMinor: note ? Number(note.denomination_minor) : parsed.denomination || null,
    status: note?.status ?? null,
    seriesLabel: note?.series_label ?? null,
    messageFa,
    verifiedAt: now,
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function loadBanknoteDto(db: Database | TransactionContext, id: string): Promise<BanknoteDto> {
  const row = await db.one<{
    id: string;
    serial_number: string;
    denomination_minor: string;
    status: string;
    series_label: string;
    holder_name: string | null;
    carries_outstanding_value: boolean;
    issued_at: string | null;
    last_event_at: string | null;
    artwork_key: string | null;
  }>(
    `SELECT b.id, b.serial_number, b.denomination_minor::text, b.status, b.series_label,
            p.full_name_fa AS holder_name, b.carries_outstanding_value, b.issued_at, b.last_event_at,
            b.artwork_key
       FROM prs.banknotes b
       LEFT JOIN prs.profiles p ON p.id = b.holder_profile_id
      WHERE b.id = $1`,
    [id],
  );
  if (!row) throw new DomainError('BANKNOTE_NOT_FOUND');
  return {
    id: row.id,
    serialNumber: row.serial_number,
    denominationMinor: Number(row.denomination_minor),
    status: row.status,
    seriesLabel: row.series_label,
    holderNameFa: row.holder_name,
    carriesOutstandingValue: row.carries_outstanding_value,
    issuedAt: row.issued_at ? new Date(row.issued_at).toISOString() : null,
    lastEventAt: row.last_event_at ? new Date(row.last_event_at).toISOString() : null,
    artworkKey: row.artwork_key,
  };
}

export async function listBanknotes(
  db: Database,
  query: { status?: string; denomination?: number; holderProfileId?: string; batchCode?: string; search?: string; page?: number; pageSize?: number },
): Promise<{ items: BanknoteDto[]; total: number }> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
  const params: unknown[] = [];
  const conditions: string[] = [];

  const add = (clause: string, value: unknown) => {
    params.push(value);
    conditions.push(clause.replaceAll('?', `$${params.length}`));
  };
  if (query.status) add('b.status = ?', query.status);
  if (query.denomination) add('b.denomination_minor = ?', query.denomination);
  if (query.holderProfileId) add('b.holder_profile_id = ?', query.holderProfileId);
  if (query.batchCode) add('b.batch_code = ?', query.batchCode);
  if (query.search) add('b.serial_number ILIKE ?', `%${query.search.replace(/[%_]/g, '')}%`);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = await db.one<{ count: string }>(`SELECT count(*)::text AS count FROM prs.banknotes b ${where}`, params);
  params.push(pageSize, (page - 1) * pageSize);

  const rows = await db.query<{
    id: string;
    serial_number: string;
    denomination_minor: string;
    status: string;
    series_label: string;
    holder_name: string | null;
    carries_outstanding_value: boolean;
    issued_at: string | null;
    last_event_at: string | null;
    artwork_key: string | null;
  }>(
    `SELECT b.id, b.serial_number, b.denomination_minor::text, b.status, b.series_label,
            p.full_name_fa AS holder_name, b.carries_outstanding_value, b.issued_at, b.last_event_at, b.artwork_key
       FROM prs.banknotes b
       LEFT JOIN prs.profiles p ON p.id = b.holder_profile_id
       ${where}
      ORDER BY b.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return {
    total: Number(total?.count ?? 0),
    items: rows.map((row) => ({
      id: row.id,
      serialNumber: row.serial_number,
      denominationMinor: Number(row.denomination_minor),
      status: row.status,
      seriesLabel: row.series_label,
      holderNameFa: row.holder_name,
      carriesOutstandingValue: row.carries_outstanding_value,
      issuedAt: row.issued_at ? new Date(row.issued_at).toISOString() : null,
      lastEventAt: row.last_event_at ? new Date(row.last_event_at).toISOString() : null,
      artworkKey: row.artwork_key,
    })),
  };
}

export async function banknoteRegistrySummary(db: Database): Promise<Record<string, unknown>> {
  const byStatus = await db.query<{ status: string; count: string; face_value: string }>(
    `SELECT status, count(*)::text AS count, COALESCE(SUM(denomination_minor),0)::text AS face_value
       FROM prs.banknotes GROUP BY status ORDER BY status`,
  );
  const byDenomination = await db.query<{ denomination_minor: string; count: string }>(
    `SELECT denomination_minor::text, count(*)::text AS count FROM prs.banknotes GROUP BY denomination_minor ORDER BY denomination_minor::int`,
  );
  const outstanding = await db.one<{ total: string }>('SELECT prs.banknote_registry_outstanding()::text AS total');
  const ledger = await db.one<{ balance: string }>(
    `SELECT prs.account_balance_by_code('2300')::text AS balance`,
  );
  return {
    byStatus: byStatus.map((row) => ({ status: row.status, count: Number(row.count), faceValueMinor: Number(row.face_value) })),
    byDenomination: byDenomination.map((row) => ({ denominationMinor: Number(row.denomination_minor), count: Number(row.count) })),
    registryOutstandingMinor: Number(outstanding?.total ?? 0),
    ledgerNotesOutstandingMinor: Number(ledger?.balance ?? 0),
    reconciled: Number(outstanding?.total ?? 0) === Number(ledger?.balance ?? 0),
  };
}

/** Held notes of one member, for the public app "physical notes" screen. */
export async function banknotesForProfile(db: Database, profileId: string): Promise<BanknoteDto[]> {
  const result = await listBanknotes(db, { holderProfileId: profileId, pageSize: 100 });
  return result.items.filter((note) => carriesOutstandingValue(note.status as BanknoteStatus));
}

/* -------------------------------------------------------------------------- */
/* Status governance (dual approved for the sensitive transitions)             */
/* -------------------------------------------------------------------------- */

registerApprovalExecutor('BANKNOTE_STATUS_CHANGE', async (tx, { action, actor, meta }) => {
  const serialNumber = String(action.payload.serialNumber ?? '');
  const nextStatus = String(action.payload.status ?? '') as BanknoteStatus;
  const parsed = assertValidSerial(serialNumber);

  const note = await tx.one<{ id: string; status: BanknoteStatus; carries_outstanding_value: boolean }>(
    'SELECT id, status, carries_outstanding_value FROM prs.banknotes WHERE serial_number = $1 FOR UPDATE',
    [parsed.serial],
  );
  if (!note) throw new DomainError('BANKNOTE_NOT_FOUND');
  assertTransition(note.status, nextStatus);

  const allowed: BanknoteStatus[] = ['FROZEN', 'LOST', 'STOLEN', 'IN_VAULT', 'DEPOSITED', 'RETIRED'];
  if (!allowed.includes(nextStatus)) {
    throw new DomainError('VALIDATION_FAILED', {
      messageFa: 'این تغییر وضعیت باید از مسیر امحا یا انتشار انجام شود.',
    });
  }

  await tx.execute(
    `UPDATE prs.banknotes
        SET status = $2,
            carries_outstanding_value = $3,
            custodian = CASE WHEN $2 = 'IN_VAULT' THEN 'VAULT' WHEN $2 = 'DEPOSITED' THEN 'TREASURY' ELSE custodian END,
            last_event_at = now()
      WHERE id = $1`,
    [note.id, nextStatus, carriesOutstandingValue(nextStatus)],
  );
  await tx.execute(
    `INSERT INTO prs.banknote_events (banknote_id, event, from_status, to_status, detail, actor_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      note.id,
      nextStatus === 'LOST' ? 'MARKED_LOST' : nextStatus === 'STOLEN' ? 'MARKED_STOLEN' : nextStatus === 'FROZEN' ? 'FROZEN' : 'RECOVERED',
      note.status,
      nextStatus,
      JSON.stringify({ reason: action.reason }),
      actor.profileId,
    ],
  );
  await writeAudit(tx, {
    actor,
    action: 'banknote.status.change',
    category: 'BANKNOTE',
    severity: 'CRITICAL',
    entityType: 'banknote',
    entityId: note.id,
    entityRef: parsed.serial,
    reason: action.reason,
    beforeState: { status: note.status, carriesOutstandingValue: note.carries_outstanding_value },
    afterState: { status: nextStatus, carriesOutstandingValue: carriesOutstandingValue(nextStatus) },
    adminActionId: action.adminActionId,
    meta,
  });

  return { entityRef: parsed.serial, result: { status: nextStatus } };
});
