/** Reproduce the masked first error in an approval execution, on a fresh database. */
import { createMigratedDatabase, seedMinimal } from '../helpers/database.ts';
import '../../apps/api/src/services/treasury.service.ts';
import { getApprovalExecutor } from '../../apps/api/src/services/approval-registry.ts';

const db = await createMigratedDatabase();
const ids = await seedMinimal(db);

const executor = getApprovalExecutor('MAX_SUPPLY_CHANGE');
if (!executor) throw new Error('no executor registered');

const actor = {
  profileId: ids.treasurerId,
  role: 'TREASURY_OFFICER',
  audience: 'ADMIN',
  labelFa: 'افسر خزانه',
  sessionId: null,
};

try {
  await db.transaction(async (tx) => {
    await executor(tx as never, {
      action: {
        id: '00000000-0000-0000-0000-000000000001',
        actionRef: 'PRS-ACT-PROBE',
        actionType: 'MAX_SUPPLY_CHANGE',
        payload: { maxSupplyMinor: 9500 },
        reason: 'probe',
        requestedBy: ids.adminId,
        decidedBy: ids.adminId,
        adminActionId: '00000000-0000-0000-0000-000000000001',
      },
      actor: actor as never,
      meta: {},
    } as never);
  });
  console.log('\n  executor succeeded');
} catch (error) {
  const e = error as Error & { code?: string };
  console.log(`\n  executor failed: [${e.code ?? 'no-code'}] ${e.message.split('\n')[0]}`);
  if (e.code === '25P02') {
    console.log('  (25P02 means an EARLIER statement failed; the first error is still hidden)');
  }
}

await db.destroy();
console.log('');
