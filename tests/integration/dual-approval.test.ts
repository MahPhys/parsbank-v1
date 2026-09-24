/**
 * BANK PARS — critical treasury operations require two people (audit finding and
 * acceptance test 14).
 *
 * Written after the audit found that the MAX_SUPPLY_CHANGE executor had never been
 * able to run at all: its statement bound `$2`/`$3` with a literal key and no `$1`,
 * so PostgreSQL could not infer the first parameter and every execution died with
 * 42P18 — which the API reported as a 500. This suite drives the real HTTP approval
 * flow and asserts the money-adjacent outcome, not just the status code.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestServer, Client, type TestServer } from '../helpers/http-server.ts';
import { provisionPersona, type Persona } from '../helpers/provision.ts';

let server: TestServer;
let officer: Persona;
let director: Persona;

beforeAll(async () => {
  server = await bootTestServer();
  officer = await provisionPersona(server.db, {
    fullNameFa: 'افسر خزانه آزمون',
    fullNameEn: 'Test Treasury Officer',
    role: 'TREASURY_OFFICER',
    password: 'Pars!1404-officer',
  });
  director = await provisionPersona(server.db, {
    fullNameFa: 'مدیر ارشد آزمون',
    fullNameEn: 'Test Director',
    role: 'SUPER_ADMIN',
    password: 'Pars!1404-director',
  });
}, 120_000);

afterAll(async () => {
  await server?.close();
});

async function adminClient(persona: Persona): Promise<Client> {
  const client = new Client(server, 'ADMIN');
  const login = await client.loginAdmin(persona.cardNumber, persona.password);
  expect(login.status).toBe(200);
  return client;
}

interface ActionBody {
  id: string;
  status: string;
  requiresSecondApprover: boolean;
}

async function requestChange(client: Client, maxSupplyMinor: number): Promise<ActionBody> {
  const response = await client.post<ActionBody>('/admin/approvals', {
    actionType: 'MAX_SUPPLY_CHANGE',
    payload: { maxSupplyMinor },
    reason: 'آزمون پذیرش تغییر سقف عرضه',
  });
  expect(response.status).toBe(200);
  return response.body;
}

async function nonceFor(client: Client, actionId: string, purpose: 'APPROVE' | 'EXECUTE'): Promise<string> {
  const response = await client.post<{ nonce: string }>(`/admin/approvals/${actionId}/nonce`, { purpose });
  expect(response.status).toBe(200);
  return response.body.nonce;
}

async function maxSupply(): Promise<number> {
  const row = await server.db.one<{ value: unknown }>(`SELECT value FROM prs.system_settings WHERE key = 'max_supply_minor'`);
  return Number(String(row?.value).replace(/"/g, ''));
}

describe('critical treasury operations', () => {
  it('refuses to let the requester approve their own action', async () => {
    const officerClient = await adminClient(officer);
    const action = await requestChange(officerClient, 9500);

    const nonce = await officerClient.post<{ nonce?: string }>(`/admin/approvals/${action.id}/nonce`, {
      purpose: 'APPROVE',
    });
    expect(nonce.status).toBe(403);
    expect((nonce.body as { error?: { code?: string } }).error?.code).toBe('SELF_APPROVAL_FORBIDDEN');
  });

  it('refuses to execute an action that has only been requested', async () => {
    const officerClient = await adminClient(officer);
    const directorClient = await adminClient(director);
    const action = await requestChange(officerClient, 9500);

    const nonce = await nonceFor(directorClient, action.id, 'EXECUTE');
    const executed = await directorClient.post<{ error?: { code?: string } }>(`/admin/approvals/${action.id}/execute`, { nonce });
    expect(executed.status).toBe(409);
    expect(executed.body.error?.code).toBe('DUAL_APPROVAL_REQUIRED');
    expect(await maxSupply()).toBe(10_000);
  });

  it('applies the change only after a second person approves, and only once', async () => {
    const officerClient = await adminClient(officer);
    const directorClient = await adminClient(director);

    const action = await requestChange(officerClient, 9500);
    expect(action.requiresSecondApprover).toBe(true);

    const approvalNonce = await nonceFor(directorClient, action.id, 'APPROVE');
    const approved = await directorClient.post<ActionBody>(`/admin/approvals/${action.id}/approve`, {
      nonce: approvalNonce,
    });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('APPROVED');
    // Approved is not executed: the supply must not have moved yet.
    expect(await maxSupply()).toBe(10_000);

    const executeNonce = await nonceFor(directorClient, action.id, 'EXECUTE');
    const executed = await directorClient.post<ActionBody>(`/admin/approvals/${action.id}/execute`, {
      nonce: executeNonce,
    });
    expect(executed.status).toBe(200);
    expect(executed.body.status).toBe('EXECUTED');
    expect(await maxSupply()).toBe(9500);

    // Replaying the approval must not apply it a second time.
    const replay = await directorClient.post<{ error?: { code?: string } }>(`/admin/approvals/${action.id}/execute`, {
      nonce: executeNonce,
    });
    expect(replay.status).toBeGreaterThanOrEqual(400);
    expect(await maxSupply()).toBe(9500);
  });

  it('records both people and the outcome in the audit trail', async () => {
    const rows = await server.db.query<{ action: string; actor_profile_id: string }>(
      `SELECT action, actor_profile_id FROM prs.audit_logs
        WHERE action LIKE 'approval.%' OR action LIKE 'treasury.max_supply%'
        ORDER BY occurred_at DESC LIMIT 10`,
    );
    const actors = new Set(rows.map((row) => row.actor_profile_id));
    expect(rows.length).toBeGreaterThan(0);
    // The request and the execution are attributable, and they are different people.
    expect(actors.has(officer.profileId)).toBe(true);
    expect(actors.has(director.profileId)).toBe(true);
  });
});
