/** Which parameter-numbering forms PostgreSQL can actually infer. */
import { createMigratedDatabase } from '../helpers/database.ts';

const db = await createMigratedDatabase();
const run = async (label: string, sql: string, params: unknown[]) => {
  try {
    await db.execute(sql, params);
    console.log(`  OK      ${label}`);
  } catch (e) {
    const err = e as Error & { code?: string };
    console.log(`  FAILED  ${label} → [${err.code}] ${err.message.split('\n')[0]}`);
  }
};

console.log('');
await run("A  literal key, parameters $2/$3", `UPDATE prs.system_settings SET value = $2, updated_by = $3 WHERE key = 'max_supply_minor'`, ['9000', null]);
await run('B  key bound as $1 (contiguous)', `UPDATE prs.system_settings SET value = $2, updated_by = $3 WHERE key = $1`, ['max_supply_minor', '9000', null]);
await db.destroy();
console.log('');
