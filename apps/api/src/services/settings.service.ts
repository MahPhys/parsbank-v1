/**
 * BANK PARS — runtime settings and feature flags.
 *
 * Critical settings (supply cap, reserve rules, redemption rules, kill switches)
 * can only be changed through `requestCriticalSettingChange`, which creates a
 * dual-approval admin action. There is no code path that writes a critical setting
 * directly from an HTTP handler.
 */
import type { TransactionContext, Database } from '../db/types.ts';
import { DomainError } from '@parsbank/domain';
import type { ActorContext } from './context.ts';

export async function stringSetting(
  db: Database | TransactionContext,
  key: string,
  fallback: string,
): Promise<string> {
  const row = await db.one<{ value: unknown }>('SELECT value FROM prs.system_settings WHERE key = $1', [key]);
  if (!row) return fallback;
  const raw = row.value;
  return typeof raw === 'string' ? raw : String(raw);
}

export async function numericSetting(
  db: Database | TransactionContext,
  key: string,
  fallback: number,
): Promise<number> {
  const row = await db.one<{ value: unknown }>('SELECT value FROM prs.system_settings WHERE key = $1', [key]);
  if (!row) return fallback;
  const raw = row.value;
  const parsed = typeof raw === 'number' ? raw : Number(typeof raw === 'string' ? raw : String(raw));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function booleanSetting(
  db: Database | TransactionContext,
  key: string,
  fallback: boolean,
): Promise<boolean> {
  const row = await db.one<{ value: unknown }>('SELECT value FROM prs.system_settings WHERE key = $1', [key]);
  if (!row) return fallback;
  const raw = row.value;
  return typeof raw === 'boolean' ? raw : String(raw) === 'true';
}

export async function flagEnabled(db: Database | TransactionContext, key: string): Promise<boolean> {
  const row = await db.one<{ enabled: boolean }>('SELECT enabled FROM prs.feature_flags WHERE key = $1', [key]);
  return row?.enabled ?? false;
}

/**
 * The financial kill switches. Both the setting AND the feature flag must be on:
 * two independent switches, so a single mistake cannot silently disable a control.
 */
export async function isTransfersEnabled(tx: TransactionContext): Promise<boolean> {
  const [setting, flag] = await Promise.all([
    booleanSetting(tx, 'financial_controls.transfers', true),
    flagEnabled(tx, 'public.transfers'),
  ]);
  return setting && flag;
}

export async function isIssuanceEnabled(tx: TransactionContext): Promise<boolean> {
  const [setting, flag] = await Promise.all([
    booleanSetting(tx, 'financial_controls.issuance', true),
    flagEnabled(tx, 'admin.issuance'),
  ]);
  return setting && flag;
}

export async function isBurningEnabled(tx: TransactionContext): Promise<boolean> {
  const [setting, flag] = await Promise.all([
    booleanSetting(tx, 'financial_controls.burning', true),
    flagEnabled(tx, 'admin.burning'),
  ]);
  return setting && flag;
}

export async function isRedemptionEnabled(tx: TransactionContext): Promise<boolean> {
  const [setting, flag] = await Promise.all([
    booleanSetting(tx, 'financial_controls.redemptions', true),
    flagEnabled(tx, 'admin.redemption'),
  ]);
  return setting && flag;
}

export async function isWithdrawalEnabled(tx: TransactionContext): Promise<boolean> {
  return booleanSetting(tx, 'financial_controls.withdrawals', true);
}

export interface SettingRow {
  key: string;
  value: unknown;
  value_type: string;
  category: string;
  label_fa: string;
  description_fa: string | null;
  is_critical: boolean;
  updated_at: string;
  updated_by_name: string | null;
}

export async function listSettings(db: Database): Promise<SettingRow[]> {
  return db.query<SettingRow>(
    `SELECT s.key, s.value, s.value_type, s.category, s.label_fa, s.description_fa, s.is_critical,
            s.updated_at, p.full_name_fa AS updated_by_name
       FROM prs.system_settings s
       LEFT JOIN prs.profiles p ON p.id = s.updated_by
      ORDER BY s.category, s.key`,
  );
}

export async function listFeatureFlags(db: Database): Promise<Record<string, unknown>[]> {
  return db.query(
    `SELECT key, enabled, scope, rollout_percent, description_fa, requires_dual_approval, updated_at
       FROM prs.feature_flags ORDER BY scope, key`,
  );
}

/** Non-critical setting write (still audited by the caller). */
export async function writeSetting(
  tx: TransactionContext,
  input: { key: string; value: unknown; actor: ActorContext },
): Promise<void> {
  const existing = await tx.one<{ is_critical: boolean }>(
    'SELECT is_critical FROM prs.system_settings WHERE key = $1',
    [input.key],
  );
  if (!existing) throw new DomainError('VALIDATION_FAILED', { messageEn: `unknown setting ${input.key}` });
  if (existing.is_critical) {
    throw new DomainError('DUAL_APPROVAL_REQUIRED', {
      messageEn: 'critical settings require a two-person approval',
      context: { key: input.key },
    });
  }
  await tx.execute('UPDATE prs.system_settings SET value = $2, updated_by = $3 WHERE key = $1', [
    input.key,
    JSON.stringify(input.value),
    input.actor.profileId,
  ]);
}

export async function writeFeatureFlag(
  tx: TransactionContext,
  input: { key: string; enabled: boolean; rolloutPercent?: number; actor: ActorContext },
): Promise<void> {
  const existing = await tx.one<{ requires_dual_approval: boolean }>(
    'SELECT requires_dual_approval FROM prs.feature_flags WHERE key = $1',
    [input.key],
  );
  if (!existing) throw new DomainError('VALIDATION_FAILED', { messageEn: `unknown feature flag ${input.key}` });
  if (existing.requires_dual_approval) {
    throw new DomainError('DUAL_APPROVAL_REQUIRED', { context: { key: input.key } });
  }
  await tx.execute(
    'UPDATE prs.feature_flags SET enabled = $2, rollout_percent = COALESCE($3, rollout_percent), updated_by = $4 WHERE key = $1',
    [input.key, input.enabled, input.rolloutPercent ?? null, input.actor.profileId],
  );
  await tx.execute(
    'INSERT INTO prs.feature_flag_history (key, enabled, rollout_percent, changed_by) VALUES ($1,$2,$3,$4)',
    [input.key, input.enabled, input.rolloutPercent ?? 100, input.actor.profileId],
  );
}

/** Executed only from an approved dual-control admin action. */
export async function applyCriticalSettingChange(
  tx: TransactionContext,
  input: { key: string; value: unknown; actorProfileId: string },
): Promise<void> {
  await tx.execute('UPDATE prs.system_settings SET value = $2, updated_by = $3 WHERE key = $1', [
    input.key,
    JSON.stringify(input.value),
    input.actorProfileId,
  ]);
}
