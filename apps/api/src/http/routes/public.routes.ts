/**
 * BANK PARS — public application API (the account holder's own money).
 *
 * Contract enforced here, not in the browser:
 *   • every route resolves the session server-side and scopes queries by the
 *     profile id in that session — there is no "profileId" request parameter
 *     anywhere in this file;
 *   • state-changing routes pass the CSRF check and an idempotency key;
 *   • balances and reference values are read from the ledger/monetary views, so
 *     the client can never influence them.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '@parsbank/config';
import { HEADERS } from '@parsbank/config/constants';
import { DomainError, assertCan } from '@parsbank/domain';
import {
  banknoteMoveSchema,
  setPinSchema,
  transactionQuerySchema,
  transferSchema,
  resolveDestinationSchema,
} from '@parsbank/validation';
import type { Database } from '../../db/types.ts';
import { getMonetarySnapshot, latestReferenceRate, rateHistory, valuationHistory } from '../../services/monetary.service.ts';
import { getWalletForProfile, walletSummaries } from '../../services/wallets.service.ts';
import { listTransactions, buildReceipt, getTransactionByReference, toTransactionDto } from '../../services/transactions.service.ts';
import { createTransfer, previewTransferDestination, requireIdempotencyHeader } from '../../services/transfers.service.ts';
import { listCardsForProfile, rotateCardQr, setPin } from '../../services/cards.service.ts';
import { banknotesForProfile, depositBanknote, withdrawBanknote } from '../../services/banknotes.service.ts';
import { revokeSession } from '../../services/auth.service.ts';
import { verifyReceiptCode } from '../../lib/receipt.ts';
import { authed } from './helpers.ts';
import { requestMeta } from '../session.ts';

export async function registerPublicRoutes(app: FastifyInstance, db: Database): Promise<void> {
  const publicLimit = { rateLimit: { max: env().rateLimitPublicMax, timeWindow: '1 minute' } };

  /* ------------------------------------------------------------ monetary state */

  /** Public reference figures: supply, reserve coverage, reference PRS/USD rate. */
  app.get('/monetary/snapshot', { config: publicLimit }, async () => {
    const snapshot = await getMonetarySnapshot(db);
    if (!snapshot) throw new DomainError('INTERNAL_ERROR', { messageEn: 'monetary state not initialised' });
    return snapshot;
  });

  app.get('/monetary/history', { config: publicLimit }, async () => ({
    valuations: await valuationHistory(db, 60),
    rates: await rateHistory(db, 60),
  }));

  /* ------------------------------------------------------------------- profile */

  app.get('/me', async (request) => {
    const { session } = await authed(db, request, { audience: 'USER' });
    const [profile, wallets, cards, snapshot] = await Promise.all([
      db.one<{
        id: string;
        public_ref: string;
        full_name_fa: string;
        full_name_en: string;
        role: string;
        status: string;
        email: string | null;
        phone: string | null;
        locale: string;
        theme_preference: string;
        mfa_enabled: boolean;
        password_changed_at: string | null;
        must_rotate: boolean | null;
        last_login_at: string | null;
        created_at: string;
      }>(
        // The credential columns live on prs.account_credentials, never on the profile.
        `SELECT p.id, p.public_ref, p.full_name_fa, p.full_name_en, p.role, p.status, p.email, p.phone,
                p.locale, p.theme_preference, p.mfa_enabled, c.password_updated_at AS password_changed_at,
                c.must_rotate, p.last_login_at, p.created_at
           FROM prs.profiles p
           LEFT JOIN prs.account_credentials c ON c.profile_id = p.id
          WHERE p.id = $1`,
        [session.profileId],
      ),
      walletSummaries(db, session.profileId),
      listCardsForProfile(db, session.profileId),
      getMonetarySnapshot(db),
    ]);

    return {
      profile: profile
        ? {
            profileId: profile.id,
            publicRef: profile.public_ref,
            fullNameFa: profile.full_name_fa,
            fullNameEn: profile.full_name_en,
            role: profile.role,
            status: profile.status,
            email: profile.email,
            phone: profile.phone,
            locale: profile.locale,
            themePreference: profile.theme_preference,
            mfaEnabled: profile.mfa_enabled,
            passwordChangedAt: profile.password_changed_at,
            mustRotatePassword: profile.must_rotate ?? false,
            lastLoginAt: profile.last_login_at,
            createdAt: profile.created_at,
          }
        : null,
      wallets,
      cards,
      monetary: snapshot,
    };
  });

  /* ------------------------------------------------------------------- wallets */

  app.get('/me/wallets', async (request) => {
    const { session } = await authed(db, request, { audience: 'USER' });
    return { items: await walletSummaries(db, session.profileId) };
  });

  app.get('/me/wallets/:walletRef', async (request) => {
    const { session } = await authed(db, request, { audience: 'USER' });
    const { walletRef } = request.params as { walletRef: string };
    const wallet = await findOwnWallet(db, walletRef, session.profileId);
    const rate = await latestReferenceRate(db);
    const [{ rows }, snapshot] = await Promise.all([
      listTransactions(db, { profileId: session.profileId, walletId: wallet.wallet_id, pageSize: 50 }),
      getMonetarySnapshot(db),
    ]);

    return {
      wallet: {
        walletId: wallet.wallet_id,
        publicRef: wallet.public_ref,
        labelFa: wallet.label_fa,
        status: wallet.status,
        isPrimary: wallet.is_primary,
        balanceMinor: Number(wallet.balance_minor),
        openedAt: wallet.opened_at,
      },
      referenceRate: rate,
      monetary: snapshot,
      recentTransactions: rows,
    };
  });

  /* -------------------------------------------------------------- transactions */

  app.get('/me/transactions', async (request) => {
    const { session } = await authed(db, request, { audience: 'USER' });
    const query = transactionQuerySchema.parse(request.query ?? {});
    const result = await listTransactions(db, {
      profileId: session.profileId,
      type: query.type ?? null,
      status: query.status ?? null,
      search: query.search ?? null,
      from: query.from ?? null,
      to: query.to ?? null,
      page: query.page,
      pageSize: query.pageSize,
    });
    return { items: result.rows, page: query.page, pageSize: query.pageSize, total: result.total };
  });

  app.get('/transactions/:reference', async (request) => {
    const { session } = await authed(db, request, { audience: 'USER' });
    const { reference } = request.params as { reference: string };
    return loadOwnTransaction(db, reference, session.profileId);
  });

  app.get('/transactions/:reference/receipt', async (request) => {
    const { session } = await authed(db, request, { audience: 'USER' });
    const { reference } = request.params as { reference: string };
    await loadOwnTransaction(db, reference, session.profileId);
    return buildReceipt(db, reference);
  });

  /** Public receipt verification: the code is an HMAC, so only the bank can mint it. */
  app.post('/receipts/verify', { config: publicLimit }, async (request) => {
    const { reference, code } = (request.body ?? {}) as { reference?: string; code?: string };
    if (!reference || !code) throw new DomainError('VALIDATION_FAILED', { messageFa: 'شناسه و کد رسید الزامی است.' });
    const valid = verifyReceiptCode(reference, code);
    if (!valid) return { valid: false, reference };
    const row = await getTransactionByReference(db, reference);
    return {
      valid: true,
      reference,
      status: row?.status ?? null,
      amountMinor: row ? Number(row.amount_minor) : null,
      completedAt: row?.completed_at ?? null,
    };
  });

  /* ----------------------------------------------------------------- transfers */

  app.post('/transfers/preview', async (request) => {
    await authed(db, request, { audience: 'USER' });
    const body = resolveDestinationSchema.parse(request.body ?? {});
    return previewTransferDestination(
      db,
      body.receiverCardNumber
        ? { kind: 'CARD_NUMBER', value: body.receiverCardNumber }
        : { kind: 'WALLET_REF', value: body.receiverWalletRef! },
    );
  });

  app.post('/transfers', async (request) => {
    const { session, context } = await authed(db, request, { audience: 'USER' });
    assertCan(session.role, 'wallet.transfer.own');

    const body = transferSchema.parse(request.body ?? {});
    const idempotencyKey = requireIdempotencyHeader(request.headers as Record<string, unknown>);
    const sender = await findOwnWallet(db, body.senderWalletRef, session.profileId);

    const result = await createTransfer(context, {
      senderWalletId: sender.wallet_id,
      destination: body.receiverCardNumber
        ? { kind: 'CARD_NUMBER', value: body.receiverCardNumber }
        : { kind: 'WALLET_REF', value: body.receiverWalletRef! },
      amountMinor: body.amountMinor,
      memo: body.memo ?? null,
      idempotencyKey,
      transactionAuthorizationId: body.transactionAuthorizationId,
      channel: 'WEB',
    });

    return {
      transaction: result.transaction,
      replayed: result.replayed,
      idempotencyHeader: HEADERS.idempotencyKey,
    };
  });

  /* --------------------------------------------------------------------- cards */

  app.get('/me/cards', async (request) => {
    const { session } = await authed(db, request, { audience: 'USER' });
    return { items: await listCardsForProfile(db, session.profileId) };
  });

  /**
   * Returns the QR payload for a card the caller owns. The token is the only
   * secret in the payload and is stored hashed server-side; the payload contains
   * no credentials of any kind.
   */
  app.post('/me/cards/:cardId/qr/rotate', async (request) => {
    const { session, context } = await authed(db, request, { audience: 'USER' });
    const { cardId } = request.params as { cardId: string };
    const result = await rotateCardQr(context, { cardId, profileId: session.profileId });
    return {
      qrPayload: result.qrPayload,
      securePath: result.securePath,
      tokenPrefix: result.tokenPrefix,
      warningFa: 'این رمز فقط یک بار نمایش داده می‌شود؛ با چرخش، رمز پیشین باطل می‌شود.',
    };
  });

  app.post('/me/cards/:cardId/pin', async (request) => {
    const { session, context } = await authed(db, request, { audience: 'USER' });
    const { cardId } = request.params as { cardId: string };
    const body = setPinSchema.parse(request.body ?? {});
    await setPin(context, {
      cardId,
      profileId: session.profileId,
      currentPin: body.currentPin ?? null,
      newPin: body.newPin,
    });
    return { ok: true };
  });

  /* ----------------------------------------------------------------- banknotes */

  app.get('/me/banknotes', async (request) => {
    const { session } = await authed(db, request, { audience: 'USER' });
    return { items: await banknotesForProfile(db, session.profileId) };
  });

  app.post('/me/banknotes/deposit', async (request) => {
    const { context } = await authed(db, request, { audience: 'USER' });
    const body = banknoteMoveSchema.parse(request.body ?? {});
    return depositBanknote(context, { serialNumber: body.serialNumber, walletRef: body.walletRef });
  });

  app.post('/me/banknotes/withdraw', async (request) => {
    const { context } = await authed(db, request, { audience: 'USER' });
    const body = banknoteMoveSchema.parse(request.body ?? {});
    return withdrawBanknote(context, { serialNumber: body.serialNumber, walletRef: body.walletRef });
  });

  /* ------------------------------------------------------------------ security */

  app.get('/me/security', async (request) => {
    const { session } = await authed(db, request, { audience: 'USER' });
    const [sessions, attempts, mfa] = await Promise.all([
      db.query<{ id: string; audience: string; issued_at: string; last_seen_at: string; absolute_expires_at: string; revoked_at: string | null; ip_hash: string | null; user_agent: string | null }>(
        `SELECT id, audience, issued_at, last_seen_at, absolute_expires_at, revoked_at, ip_hash, user_agent
           FROM prs.sessions WHERE profile_id = $1 ORDER BY issued_at DESC LIMIT 20`,
        [session.profileId],
      ),
      db.query<{ outcome: string; occurred_at: string; user_agent: string | null }>(
        `SELECT outcome, occurred_at, user_agent FROM prs.login_attempts
          WHERE profile_id = $1 ORDER BY occurred_at DESC LIMIT 20`,
        [session.profileId],
      ),
      db.one<{ mfa_enabled: boolean; password_changed_at: string | null }>(
        `SELECT p.mfa_enabled, c.password_updated_at AS password_changed_at
           FROM prs.profiles p
           LEFT JOIN prs.account_credentials c ON c.profile_id = p.id
          WHERE p.id = $1`,
        [session.profileId],
      ),
    ]);

    return {
      currentSessionId: session.sessionId,
      sessions: sessions.map((row) => ({
        id: row.id,
        audience: row.audience,
        createdAt: row.issued_at,
        lastSeenAt: row.last_seen_at,
        expiresAt: row.absolute_expires_at,
        revoked: Boolean(row.revoked_at),
        current: row.id === session.sessionId,
        device: row.user_agent ?? null,
        location: row.ip_hash ? 'شناسه شبکه ثبت‌شده' : null,
      })),
      loginAttempts: attempts,
      mfaEnabled: mfa?.mfa_enabled ?? false,
      passwordChangedAt: mfa?.password_changed_at ?? null,
    };
  });

  app.post('/me/security/sessions/:sessionId/revoke', async (request) => {
    const { session } = await authed(db, request, { audience: 'USER' });
    const { sessionId } = request.params as { sessionId: string };
    const owned = await db.one<{ id: string }>(
      'SELECT id FROM prs.sessions WHERE id = $1 AND profile_id = $2',
      [sessionId, session.profileId],
    );
    if (!owned) throw new DomainError('SESSION_NOT_FOUND');
    await revokeSession(db, sessionId, 'user_revoked_session');
    return { ok: true };
  });

  app.get('/me/notifications', async (request) => {
    const { session } = await authed(db, request, { audience: 'USER' });
    const rows = await db.query<{ id: string; title_fa: string; body_fa: string; severity: string; read_at: string | null; created_at: string }>(
      `SELECT id, title_fa, body_fa, severity, read_at, created_at
         FROM prs.notifications WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [session.profileId],
    );
    return { items: rows };
  });
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Resolves a wallet reference to a wallet the caller owns. Any other profile's
 * wallet is invisible (404-style refusal), never merely "read-only".
 */
async function findOwnWallet(db: Database, walletRef: string, profileId: string) {
  const row = await db.one<{ id: string }>(
    `SELECT id FROM prs.wallets WHERE public_ref = $1 OR id::text = $1`,
    [walletRef],
  );
  if (!row) throw new DomainError('WALLET_NOT_FOUND');
  return getWalletForProfile(db, row.id, profileId);
}

/**
 * Loads a transaction only if the caller is a party to it. Uses the same DTO
 * builder as the list endpoint so a foreign transaction looks exactly like a
 * missing one.
 */
async function loadOwnTransaction(db: Database, reference: string, profileId: string) {
  const row = await getTransactionByReference(db, reference);
  if (!row) throw new DomainError('TRANSACTION_NOT_FOUND');

  const ownWalletIds = new Set(
    (await db.query<{ id: string }>('SELECT id FROM prs.wallets WHERE profile_id = $1', [profileId])).map((w) => w.id),
  );
  const involved =
    ownWalletIds.has(row.sender_wallet_id ?? '') ||
    ownWalletIds.has(row.receiver_wallet_id ?? '') ||
    row.initiated_by_profile_id === profileId;
  if (!involved) throw new DomainError('TRANSACTION_NOT_FOUND');

  return toTransactionDto(row, ownWalletIds);
}
