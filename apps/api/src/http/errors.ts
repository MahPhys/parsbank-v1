/**
 * BANK PARS — HTTP error translation.
 *
 * One place decides what a client may see. Domain errors carry a stable code and a
 * Persian message; everything else becomes a generic 500 with a request id. No SQL,
 * no stack trace, no internal identifier ever leaves the process.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { DomainError, isDomainError } from '@parsbank/domain';
import { isPgError } from '../db/types.ts';
import { translateDatabaseError } from '../db/index.ts';

export function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  const requestId = String(request.id);

  if (isDomainError(error)) {
    if (error.httpStatus >= 500) {
      request.log.error({ err: error, requestId }, 'domain error');
    } else {
      request.log.info({ code: error.code, requestId }, 'request rejected');
    }
    void reply
      .code(error.httpStatus)
      .send({ error: { code: error.code, messageFa: error.messageFa, fields: error.fields, requestId } });
    return;
  }

  if (error instanceof ZodError) {
    void reply.code(422).send({
      error: {
        code: 'VALIDATION_FAILED',
        messageFa: 'اطلاعات ارسالی نامعتبر است.',
        fields: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
        requestId,
      },
    });
    return;
  }

  if (isPgError(error)) {
    try {
      translateDatabaseError(error);
    } catch (translated) {
      if (isDomainError(translated)) {
        request.log.warn({ code: translated.code, requestId, constraint: error.constraint }, 'database rejected write');
        void reply.code(translated.httpStatus).send({
          error: { code: translated.code, messageFa: translated.messageFa, requestId },
        });
        return;
      }
    }
  }

  const status = (error as { statusCode?: number })?.statusCode;
  if (status && status < 500) {
    void reply.code(status).send({
      error: {
        code: 'VALIDATION_FAILED',
        messageFa: 'درخواست نامعتبر است.',
        requestId,
      },
    });
    return;
  }

  request.log.error({ err: error, requestId }, 'unhandled error');
  void reply.code(500).send({
    error: { code: 'INTERNAL_ERROR', messageFa: 'خطای داخلی سامانه.', requestId },
  });
}

export function notFoundHandler(request: FastifyRequest, reply: FastifyReply): void {
  if (request.url.startsWith('/api/')) {
    void reply.code(404).send({
      error: { code: 'NOT_FOUND', messageFa: 'این نشانی یافت نشد.', requestId: String(request.id) },
    });
    return;
  }
  // SPA routes are handled by the static layer; reaching here means a genuinely
  // missing asset.
  void reply.code(404).send({ error: { code: 'NOT_FOUND', messageFa: 'یافت نشد.' } });
}

export { DomainError };
