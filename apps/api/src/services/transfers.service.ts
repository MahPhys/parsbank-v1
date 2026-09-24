/**
 * BANK PARS — transfers.
 *
 * The transfer is the reference implementation of the atomic contract:
 *
 *   • authorization is resolved server-side (ownership, status, limits, flags);
 *   • the request is claimed against its idempotency key BEFORE any money moves;
 *   • the posting set is a single balanced TRANSFER inside one SERIALIZABLE
 *     transaction with deterministic account locking;
 *   • the business row and the ledger rows commit together, or neither exists;
 *   • a replay returns the original result instead of creating new money.
 */
import { HEADERS } from '@parsbank/config/constants';
import type { TransactionDto } from '@parsbank/types';
import {
  DomainError,
  assertCan,
  assertIdempotencyKey,
  assertPositiveAmount,
  buildTransfer,
  fingerprintPayload,
  isCardExpired,
  maskCardNumber,
  formatTransactionReference,
} from '@parsbank/domain';
import type { Database, TransactionContext } from '../db/types.ts';
import { isPgError, PG_ERRORS } from '../db/types.ts';
import { hashToken } from '../lib/crypto.ts';
import { transactionReference } from '../lib/ids.ts';
import { writeAudit } from './audit.service.ts';
import { requireActor, type ServiceContext } from './context.ts';
import { chart, postPostingSet, walletAccount } from './ledger.service.ts';
import { assertWalletOperable, dailyTransferred } from './wallets.service.ts';
import { consumeTransactionAuthorization } from './auth.service.ts';
import { isTransfersEnabled, numericSetting } from './settings.service.ts';

export type TransferDestination =
  | { kind: 'CARD_NUMBER'; value: string }
  | { kind: 'WALLET_REF'; value: string };

export interface TransferInput {
  senderWalletId: string;
  destination: TransferDestination;
  amountMinor: number;
  memo?: string | null;
  idempotencyKey: string;
  transactionAuthorizationId: string;
  channel?: 'WEB' | 'CARD_QR';
  cardId?: string | null;
}

export interface TransferResult {
  transaction: TransactionDto;
  replayed: boolean;
  rate: number | null;
}

interface ExistingTransaction {
  id: string;
  reference: string;
  status: string;
  amount_minor: string;
  fee_minor: string;
  request_fingerprint: string | null;
  created_at: string;
  completed_at: string | null;
  type: string;
  sender_wallet_id: string | null;
  receiver_wallet_id: string | null;
}

async function findByIdempotencyKey(
  db: Database,
  profileId: string,
  key: string,
): Promise<ExistingTransaction | null> {
  return db.one<ExistingTransaction>(
    `SELECT id, reference, status, amount_minor::text, fee_minor::text, request_fingerprint,
            created_at, completed_at, type, sender_wallet_id, receiver_wallet_id
       FROM prs.transactions
      WHERE initiated_by_profile_id = $1 AND idempotency_key = $2`,
    [profileId, key],
  );
}

async function resolveDestination(
  tx: TransactionContext,
  destination: TransferDestination,
): Promise<{ walletId: string; cardId: string | null; profileId: string; cardNumber: string | null }> {
  if (destination.kind === 'CARD_NUMBER') {
    const card = await tx.one<{
      id: string;
      wallet_id: string;
      profile_id: string;
      status: string;
      card_number: string;
      expiry_month: number;
      expiry_year: number;
    }>(
      `SELECT c.id, c.wallet_id, c.profile_id, c.status, c.card_number, c.expiry_month, c.expiry_year
         FROM prs.cards c WHERE c.card_number = $1`,
      [destination.value],
    );
    if (!card) throw new DomainError('CARD_NOT_FOUND');
    if (card.status === 'FROZEN' || card.status === 'CANCELLED') throw new DomainError('CARD_FROZEN');
    if (card.status === 'EXPIRED') throw new DomainError('CARD_EXPIRED');
    const expiryEnd = new Date(Date.UTC(card.expiry_year, card.expiry_month, 0, 23, 59, 59));
    if (expiryEnd.getTime() < Date.now()) throw new DomainError('CARD_EXPIRED');
    return { walletId: card.wallet_id, cardId: card.id, profileId: card.profile_id, cardNumber: card.card_number };
  }

  const wallet = await tx.one<{ id: string; profile_id: string }>(
    'SELECT id, profile_id FROM prs.wallets WHERE public_ref = $1',
    [destination.value],
  );
  if (!wallet) throw new DomainError('WALLET_NOT_FOUND');
  return { walletId: wallet.id, cardId: null, profileId: wallet.profile_id, cardNumber: null };
}


/**
 * Read-only destination check used by the "verify the recipient before you send"
 * step. It performs exactly the same status/expiry checks as the transfer itself,
 * so a verified destination cannot fail later for a reason the user already saw.
 */
export interface DestinationPreview {
  kind: 'CARD_NUMBER' | 'WALLET_REF';
  destinationNameFa: string;
  cardNumberMasked: string | null;
  walletRef: string | null;
  payable: boolean;
  reasonFa?: string;
}

export async function previewTransferDestination(
  db: Database,
  destination: TransferDestination,
): Promise<DestinationPreview> {
  if (destination.kind === 'CARD_NUMBER') {
    const row = await db.one<{
      card_number: string;
      card_status: string;
      wallet_status: string;
      profile_status: string;
      expiry_month: number;
      expiry_year: number;
      name_fa: string;
    }>(
      `SELECT c.card_number, c.status AS card_status, w.status AS wallet_status, p.status AS profile_status,
              c.expiry_month, c.expiry_year, p.full_name_fa AS name_fa
         FROM prs.cards c
         JOIN prs.wallets w ON w.id = c.wallet_id
         JOIN prs.profiles p ON p.id = c.profile_id
        WHERE c.card_number = $1`,
      [destination.value],
    );
    if (!row) throw new DomainError('CARD_NOT_FOUND', { messageFa: 'کارت مقصد یافت نشد.' });

    const payable =
      row.card_status === 'ACTIVE' &&
      row.wallet_status === 'ACTIVE' &&
      row.profile_status === 'ACTIVE' &&
      !isCardExpired(row.expiry_month, row.expiry_year);

    return {
      kind: 'CARD_NUMBER',
      destinationNameFa: row.name_fa,
      cardNumberMasked: maskCardNumber(row.card_number),
      walletRef: null,
      payable,
      reasonFa: payable ? undefined : 'کارت مقصد در حال حاضر قابل دریافت نیست.',
    };
  }

  const row = await db.one<{ public_ref: string; wallet_status: string; profile_status: string; name_fa: string }>(
    `SELECT w.public_ref, w.status AS wallet_status, p.status AS profile_status, p.full_name_fa AS name_fa
       FROM prs.wallets w
       JOIN prs.profiles p ON p.id = w.profile_id
      WHERE w.public_ref = $1 AND w.kind = 'STANDARD'`,
    [destination.value],
  );
  if (!row) throw new DomainError('WALLET_NOT_FOUND', { messageFa: 'کیف پول مقصد یافت نشد.' });

  const payable = row.wallet_status === 'ACTIVE' && row.profile_status === 'ACTIVE';
  return {
    kind: 'WALLET_REF',
    destinationNameFa: row.name_fa,
    cardNumberMasked: null,
    walletRef: row.public_ref,
    payable,
    reasonFa: payable ? undefined : 'کیف پول مقصد در حال حاضر قابل دریافت نیست.',
  };
}

export async function createTransfer(context: ServiceContext, input: TransferInput): Promise<TransferResult> {
  const actor = requireActor(context);
  assertCan(actor.role, 'wallet.transfer.own');

  const amount = assertPositiveAmount(input.amountMinor, 'مبلغ انتقال');
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  if (!input.transactionAuthorizationId) {
    throw new DomainError('TRANSACTION_AUTHORIZATION_REQUIRED');
  }

  // The canonical string is never stored: the database holds only a hex digest
  // (prs.hex_hash), the same convention approvals use for payloads.
  const fingerprint = hashToken(
    fingerprintPayload('transfer', {
      senderWalletId: input.senderWalletId,
      destination: input.destination,
      amountMinor: amount,
      memo: input.memo ?? null,
    }),
  );

  // Fast path: an identical request that already succeeded returns its own result.
  const existing = await findByIdempotencyKey(context.db, actor.profileId, idempotencyKey);
  if (existing) {
    if (existing.request_fingerprint && existing.request_fingerprint !== fingerprint) {
      throw new DomainError('IDEMPOTENCY_KEY_REUSED');
    }
    return { transaction: await replayDto(context.db, existing, actor.profileId), replayed: true, rate: null };
  }

  try {
    return await context.db.transaction(async (tx) => {
      if (!(await isTransfersEnabled(tx))) {
        throw new DomainError('FINANCIAL_CONTROLS_DISABLED', {
          messageFa: 'انتقال‌ها در حال حاضر غیرفعال است.',
        });
      }

      const sender = await tx.one<{ id: string; status: string; profile_id: string; public_ref: string }>(
        'SELECT id, status, profile_id, public_ref FROM prs.wallets WHERE id = $1',
        [input.senderWalletId],
      );
      if (!sender) throw new DomainError('WALLET_NOT_FOUND');
      if (sender.profile_id !== actor.profileId) {
        throw new DomainError('WALLET_NOT_OWNED', { context: { walletId: input.senderWalletId } });
      }
      await assertWalletOperable(tx, sender.id);

      const destination = await resolveDestination(tx, input.destination);
      if (destination.walletId === sender.id) throw new DomainError('SELF_TRANSFER_NOT_ALLOWED');
      await assertWalletOperable(tx, destination.walletId);

      const maxTransfer = await numericSetting(tx, 'policy.max_transfer_minor', 10_000);
      const dailyLimit = await numericSetting(tx, 'policy.daily_transfer_limit_minor', 10_000);
      if (amount > maxTransfer) {
        throw new DomainError('LIMIT_EXCEEDED', {
          messageFa: `سقف هر انتقال ${maxTransfer.toLocaleString('fa-IR')} پارسه است.`,
          context: { amount, maxTransfer },
        });
      }
      const alreadyToday = await dailyTransferred(tx, sender.id);
      if (alreadyToday + amount > dailyLimit) {
        throw new DomainError('LIMIT_EXCEEDED', {
          messageFa: 'سقف انتقال روزانه شما تکمیل شده است.',
          context: { alreadyToday, dailyLimit, amount },
        });
      }

      const fee = await numericSetting(tx, 'fees.transfer_fee_minor', 0);

      // Transaction authorization is a SEPARATE credential from login.
      await consumeTransactionAuthorization(tx, {
        profileId: actor.profileId,
        sessionId: actor.sessionId,
        authorizationId: input.transactionAuthorizationId,
      walletId: sender.id,
        maxAmountMinor: amount + fee,
      });

      const reference = transactionReference();
      const claim = await tx.one<{ id: string }>(
        `INSERT INTO prs.transactions
           (reference, type, status, channel, amount_minor, fee_minor, sender_wallet_id, receiver_wallet_id,
            receiver_card_id, initiated_by_profile_id, idempotency_key, request_fingerprint, memo)
         VALUES ($1,$2,'PENDING',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          reference,
          input.channel === 'CARD_QR' ? 'QR_PAYMENT' : 'TRANSFER',
          input.channel ?? 'WEB',
          amount,
          fee,
          sender.id,
          destination.walletId,
          destination.cardId,
          actor.profileId,
          idempotencyKey,
          fingerprint,
          input.memo ?? null,
        ],
      );
      if (!claim) throw new DomainError('INTERNAL_ERROR', { messageEn: 'transaction claim failed' });

      const senderAccount = await walletAccount(tx, sender.id);
      const receiverAccount = await walletAccount(tx, destination.walletId);
      const feeAccount = fee > 0 ? await chart.feeRevenue(tx) : undefined;

      const set = buildTransfer({
        sender: senderAccount,
        receiver: receiverAccount,
        amountMinor: amount,
        feeMinor: fee,
        feeAccount,
        memo: input.memo ?? undefined,
      });

      const posted = await postPostingSet(tx, {
        set,
        actor,
        memo: input.memo ?? null,
        idempotencyKey,
        requestFingerprint: fingerprint,
        metadata: { transactionReference: reference, channel: input.channel ?? 'WEB' },
      });

      await tx.execute(
        `UPDATE prs.transactions
            SET status = 'COMPLETED', completed_at = now(), ledger_transaction_id = $2
          WHERE id = $1 AND status = 'PENDING'`,
        [claim.id, posted.ledgerTransactionId],
      );

      await writeAudit(tx, {
        actor,
        action: 'transfer.create',
        category: 'MONEY',
        severity: 'NOTICE',
        entityType: 'transaction',
        entityId: claim.id,
        entityRef: reference,
        afterState: {
          amountMinor: amount,
          feeMinor: fee,
          senderWalletRef: sender.public_ref,
          receiverWalletRef: destination.walletId,
          ledgerTransactionId: posted.ledgerTransactionId,
          ledgerSequence: posted.sequenceNo,
        },
        metadata: { idempotencyKey },
        meta: context.meta,
      });

      const dto: TransactionDto = {
        id: claim.id,
        reference,
        type: input.channel === 'CARD_QR' ? 'QR_PAYMENT' : 'TRANSFER',
        status: 'COMPLETED',
        direction: 'OUT',
        amountMinor: amount,
        feeMinor: fee,
        currency: 'PRS',
        senderWalletRef: sender.public_ref,
        receiverWalletRef: null,
        counterpartyNameFa: null,
        counterpartyCardMasked: destination.cardNumber
          ? `${destination.cardNumber.slice(0, 4)}••••${destination.cardNumber.slice(-4)}`
          : null,
        memo: input.memo ?? null,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        replayed: false,
      };

      return { transaction: dto, replayed: false, rate: posted.referenceRate };
    });
  } catch (error) {
    // A concurrent duplicate won the race: return the winner's result, unchanged.
    if (isPgError(error) && error.code === PG_ERRORS.UNIQUE_VIOLATION && error.constraint?.includes('idempotency')) {
      const winner = await findByIdempotencyKey(context.db, actor.profileId, idempotencyKey);
      if (winner) {
        if (winner.request_fingerprint && winner.request_fingerprint !== fingerprint) {
          throw new DomainError('IDEMPOTENCY_KEY_REUSED');
        }
        return { transaction: await replayDto(context.db, winner, actor.profileId), replayed: true, rate: null };
      }
    }
    throw error;
  }
}

async function replayDto(db: Database, row: ExistingTransaction, profileId: string): Promise<TransactionDto> {
  const wallets = await db.query<{ id: string }>('SELECT id FROM prs.wallets WHERE profile_id = $1', [profileId]);
  const own = new Set(wallets.map((wallet) => wallet.id));
  const isOutgoing = row.sender_wallet_id ? own.has(row.sender_wallet_id) : true;
  return {
    id: row.id,
    reference: row.reference,
    type: row.type as TransactionDto['type'],
    status: row.status as TransactionDto['status'],
    direction: isOutgoing ? 'OUT' : 'IN',
    amountMinor: Number(row.amount_minor),
    feeMinor: Number(row.fee_minor),
    currency: 'PRS',
    senderWalletRef: null,
    receiverWalletRef: null,
    counterpartyNameFa: null,
    counterpartyCardMasked: null,
    memo: null,
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    replayed: true,
  };
}

/** Validates an incoming idempotency header presence early in the HTTP layer. */
export function requireIdempotencyHeader(headers: Record<string, unknown>): string {
  const value = headers[HEADERS.idempotencyKey.toLowerCase()] ?? headers[HEADERS.idempotencyKey];
  return assertIdempotencyKey(typeof value === 'string' ? value : undefined);
}

export function transferReference(): string {
  return formatTransactionReference(transactionReference().replace('PRS-TRX-', ''));
}
