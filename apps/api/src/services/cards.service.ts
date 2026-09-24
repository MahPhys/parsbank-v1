/**
 * BANK PARS — cards.
 *
 * A card is the payment face of a wallet. The card NUMBER is public (printed on the
 * card, shown by the secure page); the CVV, the PIN and the QR token are secrets:
 *   • CVV/PIN  → scrypt hashes, printed/returned exactly once at issuance
 *   • QR token → 130-bit random value, stored only as sha256; the clear value
 *                exists inside the QR image and nowhere else
 *
 * The QR payload contains an opaque token and nothing else — no PIN, no CVV, no
 * balance, no owner profile, no database identifier.
 */
import { CARD } from '@parsbank/config/constants';
import type { CardSummary, SecureCardPublicView } from '@parsbank/types';
import {
  DomainError,
  assertPin,
  buildQrPayload,
  isCardExpired,
  normalizeDigits,
  qrSecurePath,
} from '@parsbank/domain';
import type { Database, TransactionContext } from '../db/types.ts';
import {
  createCardQrToken,
  generateCardNumber,
  generateCvv,
  generatePin,
  hashSecret,
  hashToken,
  verifySecret,
} from '../lib/crypto.ts';

/** Persian/Arabic digits → ASCII digits (users type ۱۲۳۴ as often as 1234). */
const normalizeDigitsPublic = normalizeDigits;
import { registerApprovalExecutor } from './approval-registry.ts';
import { writeAudit } from './audit.service.ts';
import type { ServiceContext } from './context.ts';
import { requireActor } from './context.ts';
import { paymentSessionReference } from '../lib/ids.ts';
import { numericSetting } from './settings.service.ts';

export interface IssuedCardMaterial {
  cardId: string;
  cardNumber: string;
  cardholderNameFa: string;
  expiryMonth: number;
  expiryYear: number;
  /** Returned exactly once. Never logged, never retrievable. */
  cvv: string;
  pin: string;
  qrToken: string;
  qrPayload: string;
  qrSecurePath: string;
  qrTokenPrefix: string;
}

const CARD_VALIDITY_YEARS = 3;

export async function issueCard(
  tx: TransactionContext,
  input: {
    profileId: string;
    walletId: string;
    cardholderNameFa: string;
    actorProfileId: string;
    contactless?: boolean;
  },
): Promise<IssuedCardMaterial> {
  // One wallet may carry at most one ACTIVE card (enforced by a partial unique index).
  // Checking here turns that rule into a sentence an operator can act on, instead of a
  // generic validation error produced by the index.
  const existing = await tx.one<{ card_number: string }>(
    `SELECT card_number FROM prs.cards WHERE wallet_id = $1 AND status = 'ACTIVE'`,
    [input.walletId],
  );
  if (existing) {
    throw new DomainError('VALIDATION_FAILED', {
      messageFa: `این کیف پول یک کارت فعال دارد (پایان ${existing.card_number.slice(-4)}). برای صدور کارت تازه، ابتدا کارت کنونی را باطل یا منقضی کنید.`,
    });
  }

  const cardNumber = await uniqueCardNumber(tx);
  const now = new Date();
  const expiryMonth = now.getUTCMonth() + 1;
  const expiryYear = now.getUTCFullYear() + CARD_VALIDITY_YEARS;

  const card = await tx.one<{ id: string }>(
    `INSERT INTO prs.cards
       (wallet_id, profile_id, card_number, cardholder_name_fa, expiry_month, expiry_year,
        status, contactless, activated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7, now())
     RETURNING id`,
    [input.walletId, input.profileId, cardNumber, input.cardholderNameFa, expiryMonth, expiryYear, input.contactless ?? true],
  );
  if (!card) throw new DomainError('INTERNAL_ERROR', { messageEn: 'card insert failed' });

  const cvv = generateCvv();
  const pin = generatePin();
  await tx.execute(
    `INSERT INTO prs.card_credentials (card_id, pin_hash, cvv_hash)
     VALUES ($1,$2,$3)`,
    [card.id, await hashSecret(pin), await hashSecret(cvv)],
  );

  const qr = await issueQrToken(tx, card.id, input.actorProfileId);

  await tx.execute(
    `INSERT INTO prs.card_events (card_id, event, detail, actor_id)
     VALUES ($1,'ISSUED',$2,$3), ($1,'PIN_SET',$4,$3), ($1,'QR_ISSUED',$5,$3)`,
    [
      card.id,
      JSON.stringify({ cardNumberTail: cardNumber.slice(-4), expiryMonth, expiryYear }),
      input.actorProfileId,
      JSON.stringify({ initial: true }),
      JSON.stringify({ tokenPrefix: qr.prefix }),
    ],
  );

  return {
    cardId: card.id,
    cardNumber,
    cardholderNameFa: input.cardholderNameFa,
    expiryMonth,
    expiryYear,
    cvv,
    pin,
    qrToken: qr.raw,
    qrPayload: buildQrPayload(qr.raw),
    qrSecurePath: qrSecurePath(qr.raw),
    qrTokenPrefix: qr.prefix,
  };
}

async function uniqueCardNumber(tx: TransactionContext): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = generateCardNumber();
    const taken = await tx.one<{ id: string }>('SELECT id FROM prs.cards WHERE card_number = $1', [candidate]);
    if (!taken) return candidate;
  }
  throw new DomainError('INTERNAL_ERROR', { messageEn: 'could not allocate a unique card number' });
}

/** Issues (or rotates) the card's QR token. Returns the raw token ONCE. */
export async function issueQrToken(
  tx: TransactionContext,
  cardId: string,
  actorProfileId: string,
): Promise<{ raw: string; prefix: string; tokenId: string }> {
  const token = createCardQrToken();

  /*
   * `card_qr_tokens_one_active` is a PARTIAL UNIQUE INDEX over (card_id) WHERE
   * status = 'ACTIVE', so a card may hold exactly one live token. The previous
   * token therefore has to be retired BEFORE the new row is inserted — inserting
   * first raises 23505, which the driver translates into VALIDATION_FAILED and
   * which looks deceptively like a malformed request.
   */
  const previous = await tx.one<{ id: string }>(
    `UPDATE prs.card_qr_tokens
        SET status = 'ROTATED', rotated_at = now()
      WHERE card_id = $1 AND status = 'ACTIVE'
      RETURNING id`,
    [cardId],
  );

  const created = await tx.one<{ id: string }>(
    `INSERT INTO prs.card_qr_tokens (card_id, token_hash, token_prefix, status)
     VALUES ($1,$2,$3,'ACTIVE') RETURNING id`,
    [cardId, token.hash, token.prefix],
  );
  if (!created) throw new DomainError('INTERNAL_ERROR', { messageEn: 'qr token insert failed' });

  if (previous) {
    // Chain the audit trail only once both rows exist.
    await tx.execute(
      `UPDATE prs.card_qr_tokens SET replaced_by_token_id = $2 WHERE id = $1`,
      [previous.id, created.id],
    );
    // Sessions opened against the old token can no longer complete.
    await tx.execute(
      `UPDATE prs.card_payment_sessions SET status = 'ABORTED', failure_code = 'QR_ROTATED'
        WHERE qr_token_id = $1 AND status IN ('OPEN','AWAITING_AUTHORIZATION')`,
      [previous.id],
    );
  }

  const config = await tx.one<{ value: unknown }>(
    `SELECT value FROM prs.system_settings WHERE key = 'security.qr_session_ttl_seconds'`,
  );
  void config;
  void actorProfileId;
  return { raw: token.raw, prefix: token.prefix, tokenId: created.id };
}

export async function rotateCardQr(
  context: ServiceContext,
  input: { cardId: string; profileId: string },
): Promise<{ qrToken: string; qrPayload: string; securePath: string; tokenPrefix: string }> {
  const actor = requireActor(context);
  const card = await context.db.one<{ id: string; profile_id: string; status: string }>(
    'SELECT id, profile_id, status FROM prs.cards WHERE id = $1',
    [input.cardId],
  );
  if (!card) throw new DomainError('CARD_NOT_FOUND');
  if (card.profile_id !== input.profileId && actor.role !== 'SUPER_ADMIN') {
    throw new DomainError('FORBIDDEN', { messageEn: 'card does not belong to the caller' });
  }
  if (card.status === 'CANCELLED') throw new DomainError('CARD_FROZEN');

  const result = await context.db.transaction(async (tx) => {
    const issued = await issueQrToken(tx, card.id, actor.profileId);
    await tx.execute(
      `INSERT INTO prs.card_events (card_id, event, detail, actor_id) VALUES ($1,'QR_ROTATED',$2,$3)`,
      [card.id, JSON.stringify({ tokenPrefix: issued.prefix }), actor.profileId],
    );
    await writeAudit(tx, {
      actor,
      action: 'card.qr.rotate',
      category: 'CARD',
      severity: 'NOTICE',
      entityType: 'card',
      entityId: card.id,
      meta: context.meta,
    });
    return issued;
  });

  return {
    qrToken: result.raw,
    qrPayload: buildQrPayload(result.raw),
    securePath: qrSecurePath(result.raw),
    tokenPrefix: result.prefix,
  };
}

export async function listCardsForProfile(db: Database, profileId: string): Promise<CardSummary[]> {
  const rows = await db.query<{
    id: string;
    card_number: string;
    cardholder_name_fa: string;
    expiry_month: number;
    expiry_year: number;
    status: string;
    scheme: string;
    network_label: string;
    contactless: boolean;
    issued_at: string;
    token_prefix: string | null;
    qr_issued_at: string | null;
  }>(
    `SELECT c.id, c.card_number, c.cardholder_name_fa, c.expiry_month, c.expiry_year, c.status,
            c.scheme, c.network_label, c.contactless, c.issued_at,
            q.token_prefix, q.issued_at AS qr_issued_at
       FROM prs.cards c
       LEFT JOIN prs.card_qr_tokens q ON q.card_id = c.id AND q.status = 'ACTIVE'
      WHERE c.profile_id = $1
      ORDER BY c.issued_at DESC`,
    [profileId],
  );

  return rows.map((row) => ({
    cardId: row.id,
    cardNumber: row.card_number,
    cardholderNameFa: row.cardholder_name_fa,
    expiryMonth: row.expiry_month,
    expiryYear: row.expiry_year,
    status: isCardExpired(row.expiry_month, row.expiry_year) && row.status === 'ACTIVE'
      ? 'EXPIRED'
      : (row.status as CardSummary['status']),
    scheme: row.scheme,
    networkLabel: row.network_label,
    contactless: row.contactless,
    issuedAt: new Date(row.issued_at).toISOString(),
    qrTokenPrefix: row.token_prefix,
    qrTokenIssuedAt: row.qr_issued_at ? new Date(row.qr_issued_at).toISOString() : null,
  }));
}

/** Verifies the CVV of a card. Used as a card-presence factor, never alone. */
export async function verifyCvv(
  tx: TransactionContext,
  cardId: string,
  cvv: string,
  actorProfileId: string | null,
): Promise<void> {
  const row = await tx.one<{ cvv_hash: string; failed_cvv_attempts: number; status: string }>(
    `SELECT cc.cvv_hash, cc.failed_cvv_attempts, c.status
       FROM prs.card_credentials cc JOIN prs.cards c ON c.id = cc.card_id
      WHERE cc.card_id = $1`,
    [cardId],
  );
  if (!row) throw new DomainError('CREDENTIAL_NOT_CONFIGURED');
  if (row.status !== 'ACTIVE') throw new DomainError('CARD_FROZEN');

  const ok = await verifySecret(normalizeDigitsPublic(cvv), row.cvv_hash);
  await tx.execute(
    `INSERT INTO prs.card_events (card_id, event, detail, actor_id) VALUES ($1,$2,$3,$4)`,
    [cardId, ok ? 'CVV_VERIFIED' : 'CVV_FAILED', JSON.stringify({}), actorProfileId],
  );
  if (!ok) {
    await tx.execute('UPDATE prs.card_credentials SET failed_cvv_attempts = failed_cvv_attempts + 1 WHERE card_id = $1', [
      cardId,
    ]);
    throw new DomainError('CVV_INVALID');
  }
  await tx.execute('UPDATE prs.card_credentials SET failed_cvv_attempts = 0 WHERE card_id = $1', [cardId]);
}

export async function setPin(
  context: ServiceContext,
  input: { cardId: string; profileId: string; currentPin?: string | null; newPin: string },
): Promise<void> {
  const actor = requireActor(context);
  const digits = assertPin(input.newPin);
  await context.db.transaction(async (tx) => {
    const card = await tx.one<{ id: string; profile_id: string; pin_hash: string }>(
      `SELECT c.id, c.profile_id, cc.pin_hash
         FROM prs.cards c JOIN prs.card_credentials cc ON cc.card_id = c.id
        WHERE c.id = $1`,
      [input.cardId],
    );
    if (!card) throw new DomainError('CARD_NOT_FOUND');
    if (card.profile_id !== input.profileId) throw new DomainError('FORBIDDEN', { messageEn: 'not the card owner' });

    if (input.currentPin) {
      if (!(await verifySecret(normalizeDigitsPublic(input.currentPin), card.pin_hash))) {
        throw new DomainError('PIN_INVALID');
      }
    }

    await tx.execute('UPDATE prs.card_credentials SET pin_hash = $2, pin_updated_at = now(), failed_pin_attempts = 0 WHERE card_id = $1', [
      input.cardId,
      await hashSecret(digits),
    ]);
    await tx.execute(
      `INSERT INTO prs.card_events (card_id, event, detail, actor_id) VALUES ($1,'PIN_CHANGED','{}',$2)`,
      [input.cardId, actor.profileId],
    );
    await writeAudit(tx, {
      actor,
      action: 'card.pin.change',
      category: 'SECURITY',
      severity: 'NOTICE',
      entityType: 'card',
      entityId: input.cardId,
      meta: context.meta,
    });
  });
}

/**
 * ADMINISTRATIVE PIN RESET.
 *
 * A member who still knows their PIN resets it themselves (`setPin`). When they have
 * forgotten it, an operator must issue a fresh one — which means an operator mints a
 * credential for somebody else's card. That is a privileged act, so it is:
 *   • permission-gated (`admin.users.write`, the same power that issues cards),
 *   • audited as a SECURITY event with the card and the actor,
 *   • returned in cleartext exactly once and never stored anywhere readable,
 *   • accompanied by a card event so the register shows the full credential history.
 *
 * The old PIN stops working the moment the new hash is written.
 */
export async function resetCardPin(
  context: ServiceContext,
  input: { cardId: string },
): Promise<{ cardId: string; pin: string; pinIssuedAt: string }> {
  const actor = requireActor(context);

  return context.db.transaction(async (tx) => {
    const card = await tx.one<{ id: string; card_number: string; profile_id: string; status: string }>(
      `SELECT id, card_number, profile_id, status FROM prs.cards WHERE id = $1 FOR UPDATE`,
      [input.cardId],
    );
    if (!card) throw new DomainError('CARD_NOT_FOUND');
    if (card.status === 'CANCELLED' || card.status === 'EXPIRED') {
      throw new DomainError('VALIDATION_FAILED', {
        messageFa: 'کارت باطل یا منقضی است؛ برای دارنده باید کارت تازه صادر شود.',
      });
    }

    const pin = generatePin();
    await tx.execute(
      `UPDATE prs.card_credentials
          SET pin_hash = $2, pin_updated_at = now(), failed_pin_attempts = 0, pin_locked_until = NULL
        WHERE card_id = $1`,
      [card.id, await hashSecret(pin)],
    );
    await tx.execute(
      `INSERT INTO prs.card_events (card_id, event, detail, actor_id)
       VALUES ($1,'PIN_RESET',$2,$3)`,
      [card.id, JSON.stringify({ byOperator: true }), actor.profileId],
    );
    await writeAudit(tx, {
      actor,
      action: 'card.pin.reset_by_operator',
      category: 'SECURITY',
      severity: 'WARNING',
      entityType: 'card',
      entityId: card.id,
      entityRef: card.card_number.slice(-4).padStart(card.card_number.length, '*'),
      metadata: { holderProfileId: card.profile_id },
      meta: context.meta,
    });

    return { cardId: card.id, pin, pinIssuedAt: new Date().toISOString() };
  });
}

/* -------------------------------------------------------------------------- */
/* The secure public page — deliberately minimal                               */
/* -------------------------------------------------------------------------- */

/**
 * Resolves an opaque QR token into the ONLY information the secure page may show:
 * the brand, the card number and the expiry date. No balance, no CVV, no owner,
 * no history — and a payment session is opened in the same step.
 */
export async function openSecureCardView(
  db: Database,
  input: { token: string; ipHash: string | null; userAgent: string | null },
): Promise<SecureCardPublicView> {
  const tokenHash = hashToken(input.token);

  const row = await db.one<{
    token_id: string;
    token_prefix: string;
    card_id: string;
    card_number: string;
    expiry_month: number;
    expiry_year: number;
    card_status: string;
    scheme: string;
    network_label: string;
    wallet_status: string;
    profile_status: string;
  }>(
    `SELECT q.id AS token_id, q.token_prefix, c.id AS card_id, c.card_number, c.expiry_month, c.expiry_year,
            c.status AS card_status, c.scheme, c.network_label, w.status AS wallet_status, p.status AS profile_status
       FROM prs.card_qr_tokens q
       JOIN prs.cards c ON c.id = q.card_id
       JOIN prs.wallets w ON w.id = c.wallet_id
       JOIN prs.profiles p ON p.id = c.profile_id
      WHERE q.token_hash = $1 AND q.status = 'ACTIVE'`,
    [tokenHash],
  );

  if (!row) throw new DomainError('QR_TOKEN_INVALID');
  if (isCardExpired(row.expiry_month, row.expiry_year)) throw new DomainError('CARD_EXPIRED');

  const payable = row.card_status === 'ACTIVE' && row.wallet_status === 'ACTIVE' && row.profile_status === 'ACTIVE';
  const ttlSeconds = await numericSetting(db, 'security.qr_session_ttl_seconds', 600);

  const session = await db.transaction(async (tx) => {
    await tx.execute(
      `UPDATE prs.card_qr_tokens
          SET verification_count = verification_count + 1, last_verified_at = now()
        WHERE id = $1`,
      [row.token_id],
    );
    const created = await tx.one<{ public_ref: string; expires_at: string }>(
      `INSERT INTO prs.card_payment_sessions
         (public_ref, qr_token_id, destination_card_id, scan_ip_hash, user_agent, expires_at)
       VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' seconds')::interval)
       RETURNING public_ref, expires_at`,
      [
        paymentSessionReference(),
        row.token_id,
        row.card_id,
        input.ipHash,
        input.userAgent,
        String(ttlSeconds),
      ],
    );
    await tx.execute(
      `INSERT INTO prs.card_events (card_id, event, detail) VALUES ($1,'QR_VERIFIED',$2)`,
      [row.card_id, JSON.stringify({ sessionRef: created!.public_ref })],
    );
    return created!;
  });

  return {
    brandNameFa: 'بانک پارس',
    brandNameEn: 'BANK PARS',
    cardNumber: row.card_number,
    cardNumberMaskedGrouped: row.card_number.replace(/(\d{4})(?=\d)/g, '$1 '),
    expiryMonth: row.expiry_month,
    expiryYear: row.expiry_year,
    networkLabel: row.network_label,
    scheme: row.scheme,
    tokenPrefix: row.token_prefix,
    sessionRef: session.public_ref,
    sessionExpiresAt: new Date(session.expires_at).toISOString(),
    payable,
    payableReasonFa: payable ? undefined : 'این کارت در حال حاضر برای پرداخت فعال نیست.',
  };
}

/* -------------------------------------------------------------------------- */
/* Administrative control                                                      */
/* -------------------------------------------------------------------------- */

registerApprovalExecutor('CARD_FREEZE', async (tx, { action, actor, meta }) => {
  const cardRef = action.payload.cardId as string;
  const frozen = action.payload.freeze !== false;
  const card = await tx.one<{ id: string; status: string }>(
    'SELECT id, status FROM prs.cards WHERE id = $1 OR card_number = $1',
    [cardRef],
  );
  if (!card) throw new DomainError('CARD_NOT_FOUND');
  const nextStatus = frozen ? 'FROZEN' : 'ACTIVE';
  await tx.execute(
    `UPDATE prs.cards SET status = $2, frozen_at = CASE WHEN $2 = 'FROZEN' THEN now() ELSE NULL END WHERE id = $1`,
    [card.id, nextStatus],
  );
  await tx.execute(
    `INSERT INTO prs.card_events (card_id, event, detail, actor_id) VALUES ($1,$2,$3,$4)`,
    [card.id, frozen ? 'FROZEN' : 'UNFROZEN', JSON.stringify({ reason: action.reason }), actor.profileId],
  );
  await writeAudit(tx, {
    actor,
    action: 'card.freeze',
    category: 'CARD',
    severity: 'CRITICAL',
    entityType: 'card',
    entityId: card.id,
    reason: action.reason,
    beforeState: { status: card.status },
    afterState: { status: nextStatus },
    adminActionId: action.adminActionId,
    meta,
  });
  return { entityRef: card.id, result: { status: nextStatus } };
});
