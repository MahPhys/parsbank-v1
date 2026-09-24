/**
 * BANK PARS — QR payment.
 *
 * The card's QR code carries an opaque token only. Scanning it:
 *   1. opens a payment session bound to the destination card (see
 *      cards.openSecureCardView) — the page shows branding, card number and expiry,
 *      never a balance, a CVV, an owner profile or a database id;
 *   2. the payer authenticates with their own credentials and supplies amount +
 *      destination card number + CVV + transaction credential;
 *   3. the destination number is compared against the session's card — a mismatch
 *      aborts the flow (so a tampered page cannot redirect the money);
 *   4. the payment is executed as an ordinary TRANSFER posting set: atomic,
 *      idempotent and supply-neutral.
 *
 * The CVV is a card-presence factor here; the credential (PIN or password, with
 * TOTP when enabled) is what authorises the money movement.
 */
import type { QrPaymentSession } from '@parsbank/types';
import { DomainError, assertCardNumber } from '@parsbank/domain';
import type { Database, TransactionContext } from '../db/types.ts';
import { writeAudit } from './audit.service.ts';
import { issueTransactionAuthorization } from './auth.service.ts';
import { verifyCvv } from './cards.service.ts';
import { requireActor, type ServiceContext } from './context.ts';
import { createTransfer } from './transfers.service.ts';

export async function getQrSession(db: Database, sessionRef: string): Promise<QrPaymentSession> {
  const row = await db.one<{
    public_ref: string;
    status: QrPaymentSession['status'];
    amount_minor: string | null;
    expires_at: string;
    destination_card_number: string;
    destination_name: string;
    transaction_id: string | null;
    reference: string | null;
    expired: boolean;
  }>(
    `SELECT s.public_ref, s.status, s.amount_minor::text, s.expires_at,
            c.card_number AS destination_card_number, p.full_name_fa AS destination_name,
            s.transaction_id, t.reference, (s.expires_at <= now()) AS expired
       FROM prs.card_payment_sessions s
       JOIN prs.cards c ON c.id = s.destination_card_id
       JOIN prs.profiles p ON p.id = c.profile_id
       LEFT JOIN prs.transactions t ON t.id = s.transaction_id
      WHERE s.public_ref = $1`,
    [sessionRef],
  );
  if (!row) throw new DomainError('QR_TOKEN_INVALID', { messageEn: 'payment session not found' });

  const status = row.expired && row.status === 'OPEN' ? 'EXPIRED' : row.status;
  return {
    sessionRef: row.public_ref,
    destinationCardNumber: row.destination_card_number,
    destinationCardNumberMasked: `${row.destination_card_number.slice(0, 4)}••••${row.destination_card_number.slice(-4)}`,
    destinationCardholderNameFa: row.destination_name,
    amountMinor: row.amount_minor ? Number(row.amount_minor) : null,
    status,
    expiresAt: new Date(row.expires_at).toISOString(),
    transactionReference: row.reference ?? undefined,
  };
}

export interface QrPaymentInput {
  sessionRef: string;
  walletRef: string;
  amountMinor: number;
  destinationCardNumber: string;
  cvv: string;
  payerCardId?: string | null;
  credential: { kind: 'PIN' | 'PASSWORD'; value: string; totpCode?: string | null };
  memo?: string | null;
  idempotencyKey: string;
}

export async function payQrSession(
  context: ServiceContext,
  input: QrPaymentInput,
): Promise<{ session: QrPaymentSession; transactionReference: string; replayed: boolean }> {
  const actor = requireActor(context);

  // Normalise the presented destination number before any comparison.
  const presented = assertCardNumber(input.destinationCardNumber);

  const session = await context.db.one<{
    id: string;
    public_ref: string;
    status: string;
    expires_at: string;
    destination_card_id: string;
    destination_card_number: string;
  }>(
    `SELECT s.id, s.public_ref, s.status, s.expires_at, s.destination_card_id, c.card_number AS destination_card_number
       FROM prs.card_payment_sessions s
       JOIN prs.cards c ON c.id = s.destination_card_id
      WHERE s.public_ref = $1`,
    [input.sessionRef],
  );
  if (!session) throw new DomainError('QR_TOKEN_INVALID');
  if (session.status === 'COMPLETED') {
    return { session: await getQrSession(context.db, input.sessionRef), transactionReference: '', replayed: true };
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await failSession(context, session.id, 'EXPIRED', 'QR_SESSION_EXPIRED');
    throw new DomainError('QR_SESSION_EXPIRED');
  }
  if (session.status !== 'OPEN' && session.status !== 'AWAITING_AUTHORIZATION') {
    throw new DomainError('QR_SESSION_EXPIRED', { messageEn: `session is ${session.status}` });
  }
  // The destination printed by the QR must be the destination the payer sees.
  if (presented !== session.destination_card_number) {
    await failSession(context, session.id, 'ABORTED', 'QR_DESTINATION_MISMATCH');
    await writeAudit(context.db, {
      actor,
      action: 'qr.payment.destination_mismatch',
      category: 'SECURITY',
      severity: 'WARNING',
      outcome: 'DENIED',
      entityType: 'card_payment_session',
      entityId: session.id,
      entityRef: session.public_ref,
      meta: context.meta,
    });
    throw new DomainError('QR_DESTINATION_MISMATCH');
  }

  // Which card is the payer paying with? Default: their primary active card.
  const payerCard = await context.db.one<{ id: string; wallet_id: string; profile_id: string; status: string }>(
    input.payerCardId
      ? 'SELECT id, wallet_id, profile_id, status FROM prs.cards WHERE id = $1'
      : `SELECT id, wallet_id, profile_id, status FROM prs.cards
          WHERE profile_id = $1 AND status = 'ACTIVE' ORDER BY issued_at DESC LIMIT 1`,
    [input.payerCardId ?? actor.profileId],
  );
  if (!payerCard) throw new DomainError('CARD_NOT_FOUND', { messageFa: 'کارت فعالی برای پرداخت ندارید.' });
  if (payerCard.profile_id !== actor.profileId) {
    throw new DomainError('FORBIDDEN', { messageEn: 'payer card does not belong to the caller' });
  }

  // Card presence (CVV) + transaction credential (PIN/password, +TOTP when enabled)
  await context.db.transaction(async (tx) => {
    await verifyCvv(tx, payerCard.id, input.cvv, actor.profileId);
    await tx.execute(
      `UPDATE prs.card_payment_sessions
          SET payer_profile_id = $2, payer_wallet_id = $3, amount_minor = $4, status = 'AWAITING_AUTHORIZATION'
        WHERE id = $1`,
      [session.id, actor.profileId, payerCard.wallet_id, input.amountMinor],
    );
  });

  const authorization = await issueTransactionAuthorization(context.db, {
    profileId: actor.profileId,
    sessionId: actor.sessionId,
    walletId: payerCard.wallet_id,
    credential: input.credential,
    maxAmountMinor: input.amountMinor,
  });

  const transfer = await createTransfer(context, {
    senderWalletId: payerCard.wallet_id,
    destination: { kind: 'CARD_NUMBER', value: session.destination_card_number },
    amountMinor: input.amountMinor,
    memo: input.memo ?? `QR payment ${session.public_ref}`,
    idempotencyKey: input.idempotencyKey,
    transactionAuthorizationId: authorization.authorizationId,
    channel: 'CARD_QR',
    cardId: payerCard.id,
  });

  if (!transfer.replayed) {
    await context.db.transaction(async (tx) => {
      await tx.execute(
        `UPDATE prs.card_payment_sessions
            SET status = 'COMPLETED', transaction_id = $2, completed_at = now()
          WHERE id = $1 AND status IN ('OPEN','AWAITING_AUTHORIZATION')`,
        [session.id, transfer.transaction.id],
      );
      await tx.execute(
        `INSERT INTO prs.card_events (card_id, event, detail, actor_id) VALUES ($1,'USED_IN_PAYMENT',$2,$3)`,
        [payerCard.id, JSON.stringify({ sessionRef: session.public_ref }), actor.profileId],
      );
      await writeAudit(tx, {
        actor,
        action: 'qr.payment.completed',
        category: 'MONEY',
        severity: 'NOTICE',
        entityType: 'transaction',
        entityRef: transfer.transaction.reference,
        afterState: {
          sessionRef: session.public_ref,
          destinationCardTail: session.destination_card_number.slice(-4),
          amountMinor: input.amountMinor,
        },
        meta: context.meta,
      });
    });
  }

  return {
    session: await getQrSession(context.db, input.sessionRef),
    transactionReference: transfer.transaction.reference,
    replayed: transfer.replayed,
  };
}

async function failSession(
  context: ServiceContext,
  sessionId: string,
  status: 'EXPIRED' | 'ABORTED' | 'FAILED',
  code: string,
): Promise<void> {
  await context.db.execute(
    `UPDATE prs.card_payment_sessions SET status = $2, failure_code = $3
      WHERE id = $1 AND status IN ('OPEN','AWAITING_AUTHORIZATION')`,
    [sessionId, status, code],
  );
}

/** Housekeeping: expires stale sessions. Safe to run repeatedly. */
export async function expireStaleSessions(tx: TransactionContext): Promise<number> {
  return tx.execute(
    `UPDATE prs.card_payment_sessions SET status = 'EXPIRED', failure_code = 'TTL'
      WHERE status IN ('OPEN','AWAITING_AUTHORIZATION') AND expires_at <= now()`,
  );
}
