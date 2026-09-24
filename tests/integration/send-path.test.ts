/**
 * BANK PARS — the member money path, end to end, over real HTTP.
 *
 * This suite exists because of a defect found during the security audit: the API
 * handed the client a wallet *public reference* (`PRS-W-000123`) and then passed
 * that same string into a `uuid` column when the client used it, so every send
 * failed with a 500 from `invalid input syntax for type uuid`. Nothing caught it,
 * because no test ever drove the public app's own request shape.
 *
 * The rule this suite enforces: the API must accept the identifiers it issues,
 * and a malformed identifier is a refusal — never a 500.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestServer, Client, type TestServer } from '../helpers/http-server.ts';
import { provisionPersona, type Persona } from '../helpers/provision.ts';

let server: TestServer;
let sender: Persona;
let receiver: Persona;

beforeAll(async () => {
  server = await bootTestServer();
  sender = await provisionPersona(server.db, {
    fullNameFa: 'فرستندهٔ آزمون',
    fullNameEn: 'Sender Test',
    role: 'USER',
    password: 'Pars!1404-sender',
  });
  receiver = await provisionPersona(server.db, {
    fullNameFa: 'گیرندهٔ آزمون',
    fullNameEn: 'Receiver Test',
    role: 'USER',
    password: 'Pars!1404-receiver',
  });
}, 120_000);

afterAll(async () => {
  await server?.close();
});

/**
 * An eligible pledged reserve. A reserve-backed currency cannot price itself
 * without one — see the finding recorded in docs/SECURITY-AUDIT.md about the first
 * issuance into a book with no eligible reserve.
 */
async function pledgeReserve(usdMinor: number): Promise<void> {
  await server.db.execute(
    `INSERT INTO prs.treasury_reserves (reserve_ref, asset_kind, description_fa, book_value_usd_minor,
                                        haircut_bps, eligibility, status, custodian)
     VALUES ($1, 'CASH_USD', 'پشتوانه آزمایشی آزمون پذیرش', $2, 0, 'ELIGIBLE', 'ACTIVE', 'TEST CUSTODIAN')`,
    [`PRS-RSV-TEST-${Date.now()}`, usdMinor],
  );
}

/**
 * Gives the sender a starting balance through the ledger writer — the same
 * function the issuance approval executor uses, so the funding is a real balanced
 * posting and not an inserted balance.
 */
async function fund(walletId: string, amountMinor: number): Promise<void> {
  const { postPostingSet, accountByCode, walletAccount } = await import('../../apps/api/src/services/ledger.service.ts');
  await server.db.transaction(async (tx) => {
    const treasury = await accountByCode(tx, '1100');
    const wallet = await walletAccount(tx, walletId);
    await postPostingSet(tx, {
      set: {
        type: 'ISSUANCE',
        lines: [
          { account: treasury, direction: 'DEBIT', amountMinor },
          { account: wallet, direction: 'CREDIT', amountMinor },
        ],
        memo: 'acceptance funding',
      },
      actor: null,
    });
  });
}

async function memberClient(persona: Persona): Promise<Client> {
  const client = new Client(server, 'USER');
  const login = await client.loginMember(persona.cardNumber, persona.password);
  expect(login.status).toBe(200);
  return client;
}

async function balanceOf(client: Client, walletRef: string): Promise<number> {
  const wallets = await client.get<{ items: Array<{ publicRef: string; balanceMinor: number }> }>('/me/wallets');
  return wallets.body.items.find((wallet) => wallet.publicRef === walletRef)?.balanceMinor ?? -1;
}

describe('member send path', () => {
  it('accepts the public wallet reference the API itself issued', async () => {
    await pledgeReserve(500_000);
    await fund(sender.walletId, 500);
    const client = await memberClient(sender);

    const authorization = await client.post<{ authorizationId: string }>('/auth/transaction-authorization', {
      walletRef: sender.walletRef,
      credential: { kind: 'PIN', value: sender.pin },
      maxAmountMinor: 50,
    });

    expect(authorization.status).toBe(200);
    expect(authorization.body.authorizationId).toBeTruthy();
  });

  it('moves money exactly once and balances the ledger', async () => {
    const client = await memberClient(sender);
    const before = await balanceOf(client, sender.walletRef);

    const authorization = await client.post<{ authorizationId: string }>('/auth/transaction-authorization', {
      walletRef: sender.walletRef,
      credential: { kind: 'PIN', value: sender.pin },
      maxAmountMinor: 20,
    });

    const transfer = await client.post<{ transaction: { reference: string; status: string } }>(
      '/transfers',
      {
        senderWalletRef: sender.walletRef,
        receiverCardNumber: receiver.cardNumber,
        amountMinor: 20,
        transactionAuthorizationId: authorization.body.authorizationId,
      },
      { 'idempotency-key': `acceptance-send-${Date.now()}0000` },
    );

    expect(transfer.status, JSON.stringify(transfer.body)).toBe(200);
    expect(transfer.body.transaction.status).toBe('COMPLETED');
    expect(await balanceOf(client, sender.walletRef)).toBe(before - 20);

    const audit = await server.db.one<{ debits: string; credits: string }>(
      `SELECT COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount_minor END),0)::text AS debits,
              COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_minor END),0)::text AS credits
         FROM prs.ledger_entries`,
    );
    expect(audit?.debits).toBe(audit?.credits);
  });

  it('refuses a malformed identifier as a validation failure, never a server error', async () => {
    const client = await memberClient(sender);
    const response = await client.get<{ error?: { code: string } }>('/transactions/not-a-uuid');
    expect(response.status).toBeLessThan(500);
    expect(response.status).toBe(404);
  });

  it('refuses a wallet reference the caller does not own', async () => {
    const client = await memberClient(sender);
    const response = await client.post<{ error?: { code: string } }>('/auth/transaction-authorization', {
      walletRef: receiver.walletRef,
      credential: { kind: 'PIN', value: sender.pin },
    });
    // A wallet the caller does not own is invisible, not "read-only": the refusal
    // is indistinguishable from a wallet that does not exist.
    expect(response.status).toBe(404);
    expect(response.body.error?.code).toBe('WALLET_NOT_FOUND');
  });
});
