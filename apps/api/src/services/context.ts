/**
 * BANK PARS — service context types.
 *
 * Every service receives an explicit actor + request metadata. There is no
 * ambient "current user": authorization is always an argument, which is why it
 * cannot be forgotten by accident.
 */
import { DomainError } from '@parsbank/domain';
import type { ProfileRole, SessionAudience } from '@parsbank/types';
import type { Database } from '../db/types.ts';

export interface ActorContext {
  profileId: string;
  role: ProfileRole;
  sessionId: string | null;
  audience: SessionAudience;
  mfaSatisfied: boolean;
  fullNameFa?: string;
}

export interface RequestMeta {
  requestId: string;
  ipHash: string | null;
  userAgent: string | null;
}

export interface ServiceContext {
  db: Database;
  actor: ActorContext | null;
  meta: RequestMeta;
}

export function requireActor(context: ServiceContext): ActorContext {
  if (!context.actor) throw new DomainError('AUTHENTICATION_REQUIRED');
  return context.actor;
}
