/**
 * BANK PARS — acceptance-test provisioning.
 *
 * Creates real people through the real services: profile, password credential,
 * wallet, and a card issued with a hashed CVV/PIN. Nothing is inserted by hand, so
 * the objects the acceptance suite attacks are exactly the objects production
 * creates.
 */
import { issueCard } from '../../apps/api/src/services/cards.service.ts';
import { registerProfile } from '../../apps/api/src/services/users.service.ts';
import type { ProfileRole } from '@parsbank/types';
import type { Database } from '../../apps/api/src/db/types.ts';

export interface Persona {
  profileId: string;
  publicRef: string;
  role: ProfileRole;
  fullNameFa: string;
  password: string;
  walletId: string;
  walletRef: string;
  cardId: string;
  cardNumber: string;
  cvv: string;
  pin: string;
  qrToken: string;
}

export interface PersonaInput {
  fullNameFa: string;
  fullNameEn: string;
  role: ProfileRole;
  password: string;
}

export async function provisionPersona(db: Database, input: PersonaInput, actorProfileId?: string): Promise<Persona> {
  const registered = await registerProfile(db, {
    fullNameFa: input.fullNameFa,
    fullNameEn: input.fullNameEn,
    password: input.password,
    role: input.role,
  });

  const issued = await db.transaction(async (tx) =>
    issueCard(tx, {
      profileId: registered.profileId,
      walletId: registered.walletId,
      cardholderNameFa: input.fullNameFa,
      actorProfileId: actorProfileId ?? registered.profileId,
    }),
  );

  return {
    profileId: registered.profileId,
    publicRef: registered.publicRef,
    role: input.role,
    fullNameFa: input.fullNameFa,
    password: input.password,
    walletId: registered.walletId,
    walletRef: registered.walletRef,
    cardId: issued.cardId,
    cardNumber: issued.cardNumber,
    cvv: issued.cvv,
    pin: issued.pin,
    qrToken: issued.qrToken,
  };
}

export const ACCEPTANCE_PASSWORD = 'Pars!Acceptance-1404';
