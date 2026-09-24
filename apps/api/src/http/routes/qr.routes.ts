/**
 * BANK PARS — card QR routes.
 *
 * Two halves, deliberately asymmetric:
 *
 *   GET  /secure/card/:token   unauthenticated, returns branding + card number +
 *                              expiry ONLY. No balance, no name, no CVV, no PIN,
 *                              no internal identifier. The token is opaque and
 *                              carries no data of its own.
 *   POST /qr/:sessionRef/pay   authenticated payer; the amount, the destination
 *                              card, the CVV and a transaction credential are all
 *                              supplied by the sender, never read from the QR.
 */
import type { FastifyInstance } from 'fastify';
import { env } from '@parsbank/config';
import { HEADERS } from '@parsbank/config/constants';
import { DomainError } from '@parsbank/domain';
import { banknoteVerifySchema, qrPaySchema } from '@parsbank/validation';
import type { Database } from '../../db/types.ts';
import { openSecureCardView } from '../../services/cards.service.ts';
import { getQrSession, payQrSession } from '../../services/qr.service.ts';
import { verifyBanknote } from '../../services/banknotes.service.ts';
import { requireIdempotencyHeader } from '../../services/transfers.service.ts';
import { hashIp } from '../../lib/crypto.ts';
import { authed } from './helpers.ts';
import { requestMeta } from '../session.ts';

export async function registerQrRoutes(app: FastifyInstance, db: Database): Promise<void> {
  const publicLimit = { rateLimit: { max: env().rateLimitPublicMax, timeWindow: '1 minute' } };

  /** The page behind the QR on the back of a physical card. Public by design. */
  app.get('/secure/card/:token', { config: publicLimit }, async (request) => {
    const { token } = request.params as { token: string };
    const view = await openSecureCardView(db, {
      token,
      ipHash: hashIp(request.ip),
      userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
    });
    // Already contains only public fields; the DTO is the contract.
    return view;
  });

  /** Session state for the payer's confirmation screen. */
  app.get('/qr/session/:sessionRef', { config: publicLimit }, async (request) => {
    const { sessionRef } = request.params as { sessionRef: string };
    return getQrSession(db, sessionRef);
  });

  app.post('/qr/:sessionRef/pay', async (request) => {
    const { session } = await authed(db, request, { audience: 'USER' });
    const { sessionRef } = request.params as { sessionRef: string };
    const body = qrPaySchema.parse(request.body ?? {});
    const idempotencyKey = requireIdempotencyHeader(request.headers as Record<string, unknown>);

    const result = await payQrSession(
      { db, actor: {
        profileId: session.profileId,
        role: session.role,
        sessionId: session.sessionId,
        audience: session.audience,
        mfaSatisfied: session.mfaSatisfied,
        fullNameFa: session.fullNameFa,
      }, meta: requestMeta(request) },
      {
        sessionRef,
        walletRef: body.walletRef,
        amountMinor: body.amountMinor,
        destinationCardNumber: body.destinationCardNumber,
        cvv: body.cvv,
        payerCardId: body.payerCardId ?? null,
        credential: body.credential,
        memo: body.memo ?? null,
        idempotencyKey,
      },
    );

    return {
      session: result.session,
      transactionReference: result.transactionReference,
      replayed: result.replayed,
      idempotencyHeader: HEADERS.idempotencyKey,
    };
  });

  /**
   * Physical note verification. Anyone holding a note may check it; the response
   * never reveals the holder, the wallet, or any amount other than the note's own
   * printed denomination.
   */
  app.post('/banknotes/verify', { config: publicLimit }, async (request) => {
    const body = banknoteVerifySchema.parse(request.body ?? {});
    let verifierProfileId: string | null = null;
    try {
      const { session } = await authed(db, request, { audience: 'USER' });
      verifierProfileId = session.profileId;
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== 'AUTHENTICATION_REQUIRED') throw error;
    }

    return verifyBanknote(db, {
      serialNumber: body.serialNumber,
      claimedDenominationMinor: body.claimedDenominationMinor ?? null,
      verifierProfileId,
      ipHash: hashIp(request.ip),
      channel: verifierProfileId ? 'PUBLIC_APP' : 'API',
    });
  });
}
