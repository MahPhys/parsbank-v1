/**
 * BANK PARS — design & content plane (CMS).
 *
 * Draft → Preview → Publish → Rollback, with full version history.
 *
 * This module touches ONLY content tables. It has no import of the ledger, the
 * treasury or the wallet services — by construction a design administrator cannot
 * influence a monetary value, and the tests assert that the design role holds no
 * monetary permission and no monetary database grant.
 */
import { DomainError, assertCan } from '@parsbank/domain';
import type { Database, TransactionContext } from '../db/types.ts';
import { registerApprovalExecutor } from './approval-registry.ts';
import { writeAudit } from './audit.service.ts';
import type { ServiceContext } from './context.ts';
import { requireActor } from './context.ts';

/* -------------------------------------------------------------------------- */
/* Tokens                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Installs the baseline token catalogue shipped with @parsbank/design-system.
 *
 * Idempotent and non-destructive: a token that already exists keeps whatever value
 * the CMS gave it, so re-running the seed never overwrites a published design.
 * New tokens added to the catalogue in a later release are inserted.
 */
/**
 * The design-system package speaks in a friendlier vocabulary than the database
 * (one `font` family, one `typography` family) so the catalogue stays readable.
 * This maps it onto the constrained column values; anything unrecognised fails
 * loudly rather than being stored under a made-up category.
 */
const CATEGORY_MAP: Record<string, string> = {
  font: 'font_family',
  typography: 'typography',
  icon: 'icon_size',
  container: 'container_width',
  component: 'component_dimension',
  card: 'card_style',
};

function normalizeCategory(category: string, groupKey?: string): string {
  if (category === 'typography' && groupKey) {
    if (groupKey === 'size') return 'font_size';
    if (groupKey === 'weight') return 'font_weight';
    if (groupKey === 'line') return 'line_height';
  }
  return CATEGORY_MAP[category] ?? category;
}

function normalizeValueType(valueType: string): string {
  if (valueType === 'font') return 'font_family';
  return valueType;
}

export async function installDesignTokens(
  context: ServiceContext,
  entries: Array<{
    key: string;
    category: string;
    value: string;
    valueType: string;
    descriptionFa: string;
    groupKey?: string;
    sortOrder?: number;
    isLocked?: boolean;
  }>,
): Promise<{ inserted: number; existing: number }> {
  const actor = requireActor(context);
  assertCan(actor.role, 'cms.tokens.write');

  return context.db.transaction(async (tx) => {
    let inserted = 0;
    let existing = 0;
    for (const entry of entries) {
      const found = await tx.one<{ token_key: string }>(
        'SELECT token_key FROM prs.design_tokens WHERE token_key = $1',
        [entry.key],
      );
      if (found) {
        existing += 1;
        continue;
      }
      await tx.execute(
        `INSERT INTO prs.design_tokens
           (token_key, category, value, value_type, description_fa, group_key, sort_order, is_locked, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          entry.key,
          normalizeCategory(entry.category, entry.groupKey),
          entry.value,
          normalizeValueType(entry.valueType),
          entry.descriptionFa,
          entry.groupKey ?? null,
          entry.sortOrder ?? 100,
          entry.isLocked ?? false,
          actor.profileId,
        ],
      );
      inserted += 1;
    }
    await writeAudit(tx, {
      actor,
      action: 'cms.tokens.install',
      category: 'CONTENT',
      severity: 'INFO',
      entityType: 'design_tokens',
      afterState: { inserted, existing },
      meta: context.meta,
    });
    return { inserted, existing };
  });
}

export async function listDesignTokens(db: Database, category?: string): Promise<Record<string, unknown>[]> {
  return db.query(
    `SELECT token_key AS key, category, value, value_type, description_fa, is_locked, group_key, sort_order
       FROM prs.design_tokens
      ${category ? 'WHERE category = $1' : ''}
      ORDER BY category, sort_order, token_key`,
    category ? [category] : [],
  );
}

/**
 * Persists a token set as the "working draft" of a theme. Publishing a theme
 * version is what makes tokens visible to the applications — a design
 * administrator edits drafts, and nothing reaches users until publish.
 */
export async function updateDesignTokens(
  context: ServiceContext,
  input: { updates: Array<{ key: string; value: string }> },
): Promise<{ updated: number; skippedLocked: string[] }> {
  const actor = requireActor(context);
  assertCan(actor.role, 'cms.tokens.write');

  return context.db.transaction(async (tx) => {
    const skippedLocked: string[] = [];
    let updated = 0;
    for (const update of input.updates) {
      const existing = await tx.one<{ is_locked: boolean; value: string }>(
        'SELECT is_locked, value FROM prs.design_tokens WHERE token_key = $1',
        [update.key],
      );
      if (!existing) continue;
      if (existing.is_locked) {
        skippedLocked.push(update.key);
        continue;
      }
      await tx.execute(
        'UPDATE prs.design_tokens SET value = $2, updated_by = $3, updated_at = now() WHERE token_key = $1',
        [update.key, update.value, actor.profileId],
      );
      updated += 1;
    }
    await writeAudit(tx, {
      actor,
      action: 'cms.tokens.update',
      category: 'CONTENT',
      severity: 'NOTICE',
      entityType: 'design_tokens',
      afterState: { updated, skippedLocked },
      meta: context.meta,
    });
    return { updated, skippedLocked };
  });
}

export async function createAsset(
  context: ServiceContext,
  input: {
    assetKey: string;
    nameFa: string;
    kind: string;
    mimeType: string;
    storagePath: string;
    altFa?: string | null;
    tags?: string[];
    denominationMinor?: number | null;
    side?: 'FRONT' | 'REVERSE' | null;
    width?: number | null;
    height?: number | null;
    byteSize?: number | null;
    checksum?: string | null;
  },
): Promise<{ assetId: string }> {
  const actor = requireActor(context);
  assertCan(actor.role, 'cms.assets.write');
  return context.db.transaction(async (tx) => {
    const asset = await tx.one<{ id: string }>(
      `INSERT INTO prs.assets
         (asset_key, name_fa, kind, mime_type, storage_path, alt_fa, tags, denomination_minor, side,
          width, height, byte_size, checksum, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (asset_key) DO UPDATE
         SET name_fa = EXCLUDED.name_fa, storage_path = EXCLUDED.storage_path,
             mime_type = EXCLUDED.mime_type, alt_fa = EXCLUDED.alt_fa, tags = EXCLUDED.tags,
             denomination_minor = EXCLUDED.denomination_minor, side = EXCLUDED.side,
             current_version = prs.assets.current_version + 1, updated_at = now()
       RETURNING id`,
      [
        input.assetKey,
        input.nameFa,
        input.kind,
        input.mimeType,
        input.storagePath,
        input.altFa ?? null,
        input.tags ?? [],
        input.denominationMinor ?? null,
        input.side ?? null,
        input.width ?? null,
        input.height ?? null,
        input.byteSize ?? null,
        input.checksum ?? null,
        actor.profileId,
      ],
    );
    if (!asset) throw new DomainError('INTERNAL_ERROR', { messageEn: 'asset could not be stored' });

    await tx.execute(
      `INSERT INTO prs.asset_versions
         (asset_id, version_number, storage_path, mime_type, byte_size, width, height, checksum, change_note_fa, created_by)
       SELECT a.id, a.current_version, $2, $3, $4, $5, $6, $7, $8, $9
         FROM prs.assets a WHERE a.id = $1`,
      [
        asset.id,
        input.storagePath,
        input.mimeType,
        input.byteSize ?? null,
        input.width ?? null,
        input.height ?? null,
        input.checksum ?? null,
        input.nameFa,
        actor.profileId,
      ],
    );

    await writeAudit(tx, {
      actor,
      action: 'cms.asset.upsert',
      category: 'CONTENT',
      severity: 'INFO',
      entityType: 'asset',
      entityId: asset.id,
      entityRef: input.assetKey,
      afterState: { kind: input.kind, storagePath: input.storagePath },
      meta: context.meta,
    });
    return { assetId: asset.id };
  });
}

export async function listAssets(db: Database, filter: { kind?: string; status?: string } = {}) {
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (filter.kind) {
    params.push(filter.kind);
    conditions.push(`kind = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.query(
    `SELECT id, asset_key, name_fa, kind, mime_type, storage_path, denomination_minor, side,
            current_version, status, tags, alt_fa, created_at
       FROM prs.assets ${where} ORDER BY kind, denomination_minor NULLS LAST, asset_key`,
    params,
  );
}

/* -------------------------------------------------------------------------- */
/* Theme versions                                                              */
/* -------------------------------------------------------------------------- */

async function currentTokensMap(tx: TransactionContext): Promise<Record<string, string>> {
  const rows = await tx.query<{ token_key: string; value: string }>('SELECT token_key, value FROM prs.design_tokens');
  return Object.fromEntries(rows.map((row) => [row.token_key, row.value]));
}

export async function draftThemeVersion(
  context: ServiceContext,
  input: { name: string; noteFa?: string | null },
): Promise<{ themeId: string; versionNumber: number }> {
  const actor = requireActor(context);
  assertCan(actor.role, 'cms.theme.draft');

  return context.db.transaction(async (tx) => {
    const tokens = await currentTokensMap(tx);
    const next = await tx.one<{ next: string }>(
      'SELECT (COALESCE(MAX(version_number), 0) + 1)::text AS next FROM prs.theme_versions',
    );
    const created = await tx.one<{ id: string; version_number: number }>(
      `INSERT INTO prs.theme_versions (version_number, name, status, tokens, token_count, note_fa, created_by)
       VALUES ($1,$2,'DRAFT',$3,$4,$5,$6)
       RETURNING id, version_number`,
      [
        Number(next?.next ?? 1),
        input.name,
        JSON.stringify(tokens),
        Object.keys(tokens).length,
        input.noteFa ?? null,
        actor.profileId,
      ],
    );
    await writeAudit(tx, {
      actor,
      action: 'cms.theme.draft',
      category: 'CONTENT',
      severity: 'INFO',
      entityType: 'theme_version',
      entityId: created!.id,
      afterState: { versionNumber: created!.version_number, tokenCount: Object.keys(tokens).length },
      meta: context.meta,
    });
    return { themeId: created!.id, versionNumber: created!.version_number };
  });
}

export async function listThemeVersions(db: Database): Promise<Record<string, unknown>[]> {
  return db.query(
    `SELECT t.id, t.version_number, t.name, t.status, t.token_count, t.created_at, t.published_at,
            t.note_fa, p.full_name_fa AS created_by_name
       FROM prs.theme_versions t
       LEFT JOIN prs.profiles p ON p.id = t.created_by
      ORDER BY t.version_number DESC`,
  );
}

export async function previewThemeVersion(db: Database, themeId: string): Promise<Record<string, unknown>> {
  const row = await db.one<{ id: string; version_number: number; name: string; status: string; tokens: Record<string, string> }>(
    'SELECT id, version_number, name, status, tokens FROM prs.theme_versions WHERE id = $1',
    [themeId],
  );
  if (!row) throw new DomainError('VALIDATION_FAILED', { messageEn: 'theme version not found' });
  return { id: row.id, versionNumber: row.version_number, name: row.name, status: row.status, tokens: row.tokens, preview: true };
}

/**
 * Publishing is a THEME_PUBLISH admin action (single-approver for design, but still
 * recorded, expiring and auditable so the change history is complete).
 */
registerApprovalExecutor('THEME_PUBLISH', async (tx, { action, actor, meta }) => {
  const themeId = String(action.payload.themeId ?? '');
  const theme = await tx.one<{ id: string; version_number: number; status: string; tokens: Record<string, string> }>(
    'SELECT id, version_number, status, tokens FROM prs.theme_versions WHERE id = $1 FOR UPDATE',
    [themeId],
  );
  if (!theme) throw new DomainError('VALIDATION_FAILED', { messageEn: 'theme version not found' });
  if (theme.status !== 'DRAFT' && theme.status !== 'PREVIEW' && theme.status !== 'SUPERSEDED') {
    throw new DomainError('VALIDATION_FAILED', {
      messageFa: 'فقط نسخه‌های پیش‌نویس یا پیش‌نمایش قابل انتشار هستند.',
    });
  }

  // The published token set becomes the live values used by the token table.
  for (const [key, value] of Object.entries(theme.tokens)) {
    await tx.execute(
      `UPDATE prs.design_tokens SET value = $2, updated_by = $3, updated_at = now()
        WHERE token_key = $1 AND is_locked = false`,
      [key, value, actor.profileId],
    );
  }

  await tx.execute(
    `UPDATE prs.theme_versions SET status = 'SUPERSEDED', superseded_at = now()
      WHERE status = 'PUBLISHED' AND id <> $1`,
    [theme.id],
  );
  await tx.execute(
    `UPDATE prs.theme_versions SET status = 'PUBLISHED', published_at = now(), published_by = $2, admin_action_id = $3
      WHERE id = $1`,
    [theme.id, actor.profileId, action.adminActionId],
  );

  await writeAudit(tx, {
    actor,
    action: 'cms.theme.publish',
    category: 'CONTENT',
    severity: 'NOTICE',
    entityType: 'theme_version',
    entityId: theme.id,
    afterState: { versionNumber: theme.version_number, tokenCount: Object.keys(theme.tokens).length },
    reason: action.reason,
    adminActionId: action.adminActionId,
    meta,
  });

  return { entityRef: `theme-v${theme.version_number}`, result: { versionNumber: theme.version_number } };
});

/** Rollback = publish an earlier version again. Nothing is deleted; history grows. */
export async function rollbackTheme(
  context: ServiceContext,
  input: { targetThemeId: string; noteFa: string },
): Promise<{ themeId: string; versionNumber: number }> {
  const actor = requireActor(context);
  assertCan(actor.role, 'cms.theme.rollback');

  return context.db.transaction(async (tx) => {
    const target = await tx.one<{ id: string; version_number: number; tokens: Record<string, string>; name: string }>(
      'SELECT id, version_number, tokens, name FROM prs.theme_versions WHERE id = $1',
      [input.targetThemeId],
    );
    if (!target) throw new DomainError('VALIDATION_FAILED', { messageEn: 'target theme not found' });

    const next = await tx.one<{ next: string }>(
      'SELECT (COALESCE(MAX(version_number), 0) + 1)::text AS next FROM prs.theme_versions',
    );

    // A rollback is recorded as a NEW version derived from the old one, so the
    // timeline stays append-only and both directions are auditable.
    const created = await tx.one<{ id: string; version_number: number }>(
      `INSERT INTO prs.theme_versions
         (version_number, name, status, tokens, token_count, note_fa, based_on_version_id, rolled_back_from_id, created_by)
       SELECT $1, $2, 'PUBLISHED', tokens, token_count, $3, id, id, $4
         FROM prs.theme_versions WHERE id = $5
       RETURNING id, version_number`,
      [Number(next?.next ?? 1), `${target.name} (بازگردانی)`, input.noteFa, actor.profileId, target.id],
    );

    await tx.execute(
      `UPDATE prs.theme_versions SET status = 'SUPERSEDED', superseded_at = now()
        WHERE status = 'PUBLISHED' AND id <> $1`,
      [created!.id],
    );
    await tx.execute(
      `UPDATE prs.theme_versions SET published_at = now(), published_by = $2 WHERE id = $1`,
      [created!.id, actor.profileId],
    );
    for (const [key, value] of Object.entries(target.tokens)) {
      await tx.execute(
        `UPDATE prs.design_tokens SET value = $2, updated_by = $3, updated_at = now()
          WHERE token_key = $1 AND is_locked = false`,
        [key, value, actor.profileId],
      );
    }

    await writeAudit(tx, {
      actor,
      action: 'cms.theme.rollback',
      category: 'CONTENT',
      severity: 'NOTICE',
      entityType: 'theme_version',
      entityId: created!.id,
      beforeState: { publishedBefore: target.version_number },
      afterState: { newVersionNumber: created!.version_number },
      reason: input.noteFa,
      meta: context.meta,
    });

    return { themeId: created!.id, versionNumber: created!.version_number };
  });
}

/** The payload the public app fetches: published tokens only. */
export async function publicTheme(db: Database): Promise<{ versionNumber: number; name: string; tokens: Record<string, string>; publishedAt: string | null }> {
  const published = await db.one<{ version_number: number; name: string; tokens: Record<string, string>; published_at: string | null }>(
    `SELECT version_number, name, tokens, published_at FROM prs.theme_versions WHERE status = 'PUBLISHED' LIMIT 1`,
  );
  if (published) {
    return {
      versionNumber: published.version_number,
      name: published.name,
      tokens: published.tokens,
      publishedAt: published.published_at ? new Date(published.published_at).toISOString() : null,
    };
  }
  const rows = await db.query<{ token_key: string; value: string }>('SELECT token_key, value FROM prs.design_tokens');
  return {
    versionNumber: 0,
    name: 'Default',
    tokens: Object.fromEntries(rows.map((row) => [row.token_key, row.value])),
    publishedAt: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Content blocks, pages, navigation                                           */
/* -------------------------------------------------------------------------- */

export async function upsertContentBlock(
  context: ServiceContext,
  input: {
    blockKey: string;
    kind: string;
    titleFa?: string | null;
    bodyFa: string;
    bodyEn?: string | null;
    data?: Record<string, unknown>;
    publish?: boolean;
  },
): Promise<{ contentBlockId: string; versionNumber: number }> {
  const actor = requireActor(context);
  assertCan(actor.role, 'cms.content.write');

  return context.db.transaction(async (tx) => {
    const existing = await tx.one<{ id: string; current_version: number }>(
      'SELECT id, current_version FROM prs.content_blocks WHERE block_key = $1 AND locale = $2',
      [input.blockKey, 'fa-IR'],
    );

    let blockId: string;
    let versionNumber: number;

    if (existing) {
      versionNumber = existing.current_version + 1;
      blockId = existing.id;
      await tx.execute(
        `UPDATE prs.content_blocks
            SET title_fa = $2, body_fa = $3, body_en = $4, data = $5, kind = $6,
                status = CASE WHEN $7 THEN 'PUBLISHED' ELSE status END,
                published_at = CASE WHEN $7 THEN now() ELSE published_at END,
                current_version = $8, updated_by = $9, updated_at = now()
          WHERE id = $1`,
        [
          blockId,
          input.titleFa ?? null,
          input.bodyFa,
          input.bodyEn ?? null,
          JSON.stringify(input.data ?? {}),
          input.kind,
          input.publish ?? false,
          versionNumber,
          actor.profileId,
        ],
      );
    } else {
      const created = await tx.one<{ id: string }>(
        `INSERT INTO prs.content_blocks
           (block_key, kind, title_fa, body_fa, body_en, data, status, published_at, current_version, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $7::text = 'PUBLISHED' THEN now() END, 1, $8, $8)
         RETURNING id`,
        [
          input.blockKey,
          input.kind,
          input.titleFa ?? null,
          input.bodyFa,
          input.bodyEn ?? null,
          JSON.stringify(input.data ?? {}),
          input.publish ? 'PUBLISHED' : 'DRAFT',
          actor.profileId,
        ],
      );
      blockId = created!.id;
      versionNumber = 1;
    }

    await tx.execute(
      `INSERT INTO prs.content_block_versions
         (content_block_id, version_number, title_fa, body_fa, body_en, data, status, change_note_fa, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        blockId,
        versionNumber,
        input.titleFa ?? null,
        input.bodyFa,
        input.bodyEn ?? null,
        JSON.stringify(input.data ?? {}),
        input.publish ? 'PUBLISHED' : 'DRAFT',
        input.titleFa ?? null,
        actor.profileId,
      ],
    );

    await writeAudit(tx, {
      actor,
      action: 'cms.content.upsert',
      category: 'CONTENT',
      severity: 'INFO',
      entityType: 'content_block',
      entityId: blockId,
      entityRef: input.blockKey,
      afterState: { versionNumber, published: input.publish ?? false },
      meta: context.meta,
    });

    return { contentBlockId: blockId, versionNumber };
  });
}

export async function listContentBlocks(db: Database, kind?: string): Promise<Record<string, unknown>[]> {
  return db.query(
    `SELECT id, block_key, kind, title_fa, body_fa, body_en, status, current_version, published_at, updated_at
       FROM prs.content_blocks ${kind ? 'WHERE kind = $1' : ''}
      ORDER BY kind, block_key`,
    kind ? [kind] : [],
  );
}

export async function listPublishedContent(db: Database, kind?: string): Promise<Record<string, unknown>[]> {
  return db.query(
    `SELECT block_key, kind, title_fa, body_fa, body_en, data
       FROM prs.content_blocks
      WHERE status = 'PUBLISHED' ${kind ? 'AND kind = $1' : ''}
      ORDER BY block_key`,
    kind ? [kind] : [],
  );
}

export async function upsertPage(
  context: ServiceContext,
  input: {
    slug: string;
    titleFa: string;
    descriptionFa?: string | null;
    layout: unknown[];
    publish?: boolean;
    isSystem?: boolean;
  },
): Promise<{ pageId: string; versionNumber: number }> {
  const actor = requireActor(context);
  assertCan(actor.role, 'cms.pages.write');

  return context.db.transaction(async (tx) => {
    const existing = await tx.one<{ id: string; current_version: number }>(
      'SELECT id, current_version FROM prs.pages WHERE slug = $1',
      [input.slug],
    );

    let pageId: string;
    let versionNumber: number;
    if (existing) {
      versionNumber = existing.current_version + 1;
      pageId = existing.id;
      await tx.execute(
        `UPDATE prs.pages
            SET title_fa = $2, description_fa = $3, layout = $4,
                status = CASE WHEN $5 THEN 'PUBLISHED' ELSE status END,
                published_at = CASE WHEN $5 THEN now() ELSE published_at END,
                current_version = $6, updated_by = $7, updated_at = now()
          WHERE id = $1`,
        [
          pageId,
          input.titleFa,
          input.descriptionFa ?? null,
          JSON.stringify(input.layout),
          input.publish ?? false,
          versionNumber,
          actor.profileId,
        ],
      );
    } else {
      const created = await tx.one<{ id: string }>(
        `INSERT INTO prs.pages
           (slug, title_fa, description_fa, layout, status, published_at, is_system, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5, CASE WHEN $5 = 'PUBLISHED' THEN now() END, $6, $7, $7)
         RETURNING id`,
        [
          input.slug,
          input.titleFa,
          input.descriptionFa ?? null,
          JSON.stringify(input.layout),
          input.publish ? 'PUBLISHED' : 'DRAFT',
          input.isSystem ?? false,
          actor.profileId,
        ],
      );
      pageId = created!.id;
      versionNumber = 1;
    }

    await tx.execute(
      `INSERT INTO prs.page_versions (page_id, version_number, title_fa, description_fa, layout, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        pageId,
        versionNumber,
        input.titleFa,
        input.descriptionFa ?? null,
        JSON.stringify(input.layout),
        input.publish ? 'PUBLISHED' : 'DRAFT',
        actor.profileId,
      ],
    );
    await writeAudit(tx, {
      actor,
      action: 'cms.page.upsert',
      category: 'CONTENT',
      severity: 'INFO',
      entityType: 'page',
      entityId: pageId,
      entityRef: input.slug,
      afterState: { versionNumber, published: input.publish ?? false },
      meta: context.meta,
    });

    return { pageId, versionNumber };
  });
}

export async function listPages(db: Database): Promise<Record<string, unknown>[]> {
  return db.query(
    `SELECT id, slug, title_fa, status, current_version, is_system, updated_at, published_at
       FROM prs.pages ORDER BY slug`,
  );
}

export async function getPublishedPage(db: Database, slug: string): Promise<Record<string, unknown> | null> {
  return db.one(
    `SELECT slug, title_fa, title_en, description_fa, layout, seo, published_at
       FROM prs.pages WHERE slug = $1 AND status = 'PUBLISHED'`,
    [slug],
  );
}

export async function upsertNavigationItem(
  context: ServiceContext,
  input: {
    id?: string | null;
    location: string;
    labelFa: string;
    labelEn?: string | null;
    href: string;
    iconKey?: string | null;
    sortOrder?: number;
    requiredRole?: string | null;
    requiredPermission?: string | null;
    visible?: boolean;
  },
): Promise<{ id: string }> {
  const actor = requireActor(context);
  assertCan(actor.role, 'cms.navigation.write');

  return context.db.transaction(async (tx) => {
    const row = input.id
      ? await tx.one<{ id: string }>(
          `UPDATE prs.navigation_items
              SET label_fa = $2, label_en = $3, href = $4, icon_key = $5, sort_order = $6,
                  required_role = $7, required_permission = $8, visible = $9, updated_at = now()
            WHERE id = $1 RETURNING id`,
          [
            input.id,
            input.labelFa,
            input.labelEn ?? null,
            input.href,
            input.iconKey ?? null,
            input.sortOrder ?? 100,
            input.requiredRole ?? null,
            input.requiredPermission ?? null,
            input.visible ?? true,
          ],
        )
      : await tx.one<{ id: string }>(
          `INSERT INTO prs.navigation_items
             (location, label_fa, label_en, href, icon_key, sort_order, required_role, required_permission, visible, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [
            input.location,
            input.labelFa,
            input.labelEn ?? null,
            input.href,
            input.iconKey ?? null,
            input.sortOrder ?? 100,
            input.requiredRole ?? null,
            input.requiredPermission ?? null,
            input.visible ?? true,
            actor.profileId,
          ],
        );
    await writeAudit(tx, {
      actor,
      action: 'cms.navigation.upsert',
      category: 'CONTENT',
      severity: 'INFO',
      entityType: 'navigation_item',
      entityId: row!.id,
      afterState: { location: input.location, href: input.href, labelFa: input.labelFa },
      meta: context.meta,
    });
    return { id: row!.id };
  });
}

export async function listNavigation(db: Database, location?: string): Promise<Record<string, unknown>[]> {
  return db.query(
    `SELECT id, location, label_fa, label_en, href, icon_key, sort_order, required_role, visible
       FROM prs.navigation_items ${location ? 'WHERE location = $1' : ''}
      ORDER BY location, sort_order`,
    location ? [location] : [],
  );
}
