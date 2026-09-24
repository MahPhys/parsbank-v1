/**
 * BANK PARS — the control plane.
 *
 * Monetary policy rows (`system_settings`, `feature_flags`), wallet ownership and
 * the derived balance cache are guarded by database triggers that refuse to change
 * unless the transaction has declared itself the control plane. Declaring it is the
 * code's way of saying "this change went through an authorization path" — an
 * ad-hoc UPDATE, a stray migration or a forgotten code path cannot say it.
 *
 * Migration: db/migrations/0017_database_authority.sql
 */
import type { Database, TransactionContext } from './types.ts';

/** Works with either a pooled database handle or the transaction in progress. */
type Runner = Pick<Database, 'execute'> | Pick<TransactionContext, 'execute'>;

export async function claimControlPlane(runner: Runner): Promise<void> {
  await runner.execute(`SELECT set_config('prs.control_plane', 'on', true)`);
}
