-- =============================================================================
-- BANK PARS — 0011 · design & content plane (CMS)
-- =============================================================================
-- Everything a DESIGN_ADMIN may touch lives here. These tables are pure content:
-- no monetary meaning, no ledger access. The design plane can be rolled back
-- without ever touching financial history.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- design_tokens — every visual value, tokenized
-- ---------------------------------------------------------------------------
CREATE TABLE prs.design_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_key      text NOT NULL UNIQUE CHECK (token_key ~ '^[a-z][a-z0-9.\-]{1,80}$'),
  category       text NOT NULL CHECK (category IN
                   ('color','typography','font_family','font_size','font_weight','line_height',
                    'spacing','border','radius','shadow','icon_size','container_width',
                    'component_dimension','card_style','motion','opacity','z_index')),
  value          text NOT NULL,
  value_type     text NOT NULL DEFAULT 'raw'
                   CHECK (value_type IN ('raw','color','length','number','shadow','font_family','json')),
  description_fa text,
  is_locked      boolean NOT NULL DEFAULT false,          -- locked tokens are protected design invariants
  group_key      text,
  sort_order     int NOT NULL DEFAULT 100,
  updated_by     uuid REFERENCES prs.profiles(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX design_tokens_category_idx ON prs.design_tokens (category, sort_order);

-- ---------------------------------------------------------------------------
-- theme_versions — Draft / Preview / Publish / Rollback
-- ---------------------------------------------------------------------------
CREATE TABLE prs.theme_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_number int NOT NULL UNIQUE,
  name           text NOT NULL,
  status         text NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT','PREVIEW','PUBLISHED','SUPERSEDED','ARCHIVED')),
  tokens         jsonb NOT NULL,                          -- full token map snapshot
  token_count    int NOT NULL DEFAULT 0,
  note_fa        text,
  based_on_version_id uuid REFERENCES prs.theme_versions(id),
  rolled_back_from_id uuid REFERENCES prs.theme_versions(id),
  created_by     uuid REFERENCES prs.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_by   uuid REFERENCES prs.profiles(id),
  published_at   timestamptz,
  superseded_at  timestamptz,
  admin_action_id uuid
);
CREATE UNIQUE INDEX theme_versions_one_published ON prs.theme_versions (status) WHERE status = 'PUBLISHED';
CREATE INDEX theme_versions_status_idx ON prs.theme_versions (status, version_number DESC);

-- ---------------------------------------------------------------------------
-- assets + asset_versions — logos, patterns, imagery, banknote art, card art
-- ---------------------------------------------------------------------------
CREATE TABLE prs.assets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_key      text NOT NULL UNIQUE CHECK (asset_key ~ '^[a-z0-9][a-z0-9.\-]{1,80}$'),
  name_fa        text NOT NULL,
  kind           text NOT NULL CHECK (kind IN
                   ('LOGO','LOGO_VARIANT','ICON','IMAGE','PATTERN','BANKNOTE_ART','CARD_ART',
                    'PORTRAIT','FONT','ILLUSTRATION','SOCIAL')),
  mime_type      text NOT NULL DEFAULT 'image/svg+xml',
  storage_path   text NOT NULL,                           -- relative path under the media root or inline data URL
  alt_fa         text,
  tags           text[] NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED','DRAFT')),
  current_version int NOT NULL DEFAULT 1,
  width          int,
  height         int,
  byte_size      int,
  checksum       prs.hex_hash,
  denomination_minor bigint,                              -- for BANKNOTE_ART: which note
  side           text CHECK (side IS NULL OR side IN ('FRONT','REVERSE')),
  created_by     uuid REFERENCES prs.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assets_denomination_range
    CHECK (denomination_minor IS NULL OR denomination_minor IN (1, 2, 5, 10, 50, 100, 200))
);
CREATE INDEX assets_kind_idx ON prs.assets (kind, status);
CREATE TRIGGER assets_touch BEFORE UPDATE ON prs.assets
  FOR EACH ROW EXECUTE FUNCTION prs.touch_updated_at();

CREATE TABLE prs.asset_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id       uuid NOT NULL REFERENCES prs.assets(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  storage_path   text NOT NULL,
  mime_type      text NOT NULL,
  byte_size      int,
  width          int,
  height         int,
  checksum       prs.hex_hash,
  change_note_fa text,
  created_by     uuid REFERENCES prs.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, version_number)
);
CREATE INDEX asset_versions_asset_idx ON prs.asset_versions (asset_id, version_number DESC);

-- ---------------------------------------------------------------------------
-- content_blocks + versions — copy, announcements, FAQ, legal notes
-- ---------------------------------------------------------------------------
CREATE TABLE prs.content_blocks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_key      text NOT NULL,
  locale         text NOT NULL DEFAULT 'fa-IR',
  kind           text NOT NULL CHECK (kind IN
                   ('TEXT','HERO','ANNOUNCEMENT','BANNER','FAQ','LEGAL','CTA','STAT','FOOTER_NOTE')),
  title_fa       text,
  body_fa        text NOT NULL DEFAULT '',
  body_en        text,
  data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status         text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  current_version int NOT NULL DEFAULT 1,
  requires_dual_approval boolean NOT NULL DEFAULT false,
  published_at   timestamptz,
  created_by     uuid REFERENCES prs.profiles(id),
  updated_by     uuid REFERENCES prs.profiles(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (block_key, locale)
);
CREATE INDEX content_blocks_kind_idx ON prs.content_blocks (kind, status);
CREATE TRIGGER content_blocks_touch BEFORE UPDATE ON prs.content_blocks
  FOR EACH ROW EXECUTE FUNCTION prs.touch_updated_at();

CREATE TABLE prs.content_block_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_block_id uuid NOT NULL REFERENCES prs.content_blocks(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  title_fa       text,
  body_fa        text NOT NULL,
  body_en        text,
  data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status         text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  change_note_fa text,
  created_by     uuid REFERENCES prs.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_block_id, version_number)
);

-- ---------------------------------------------------------------------------
-- pages + page_versions — composed sections of the public site
-- ---------------------------------------------------------------------------
CREATE TABLE prs.pages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9/\-]{0,80}$'),
  title_fa       text NOT NULL,
  title_en       text,
  description_fa text,
  layout         jsonb NOT NULL DEFAULT '[]'::jsonb,      -- ordered section list
  status         text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  theme_version_id uuid REFERENCES prs.theme_versions(id),
  is_system      boolean NOT NULL DEFAULT false,          -- system pages cannot be deleted
  requires_auth  boolean NOT NULL DEFAULT false,
  current_version int NOT NULL DEFAULT 1,
  seo            jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at   timestamptz,
  created_by     uuid REFERENCES prs.profiles(id),
  updated_by     uuid REFERENCES prs.profiles(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER pages_touch BEFORE UPDATE ON prs.pages
  FOR EACH ROW EXECUTE FUNCTION prs.touch_updated_at();

CREATE TABLE prs.page_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id        uuid NOT NULL REFERENCES prs.pages(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  title_fa       text NOT NULL,
  description_fa text,
  layout         jsonb NOT NULL,
  status         text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  change_note_fa text,
  created_by     uuid REFERENCES prs.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, version_number)
);

-- ---------------------------------------------------------------------------
-- navigation_items — header / footer / sidebar structure
-- ---------------------------------------------------------------------------
CREATE TABLE prs.navigation_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location       text NOT NULL CHECK (location IN ('PUBLIC_HEADER','PUBLIC_FOOTER','PUBLIC_APP_NAV','ADMIN_SIDEBAR','ADMIN_HEADER')),
  label_fa       text NOT NULL,
  label_en       text,
  href           text NOT NULL,
  icon_key       text,
  parent_id      uuid REFERENCES prs.navigation_items(id) ON DELETE CASCADE,
  sort_order     int NOT NULL DEFAULT 100,
  required_role  text CHECK (required_role IS NULL OR required_role IN ('USER','DESIGN_ADMIN','AUDITOR','TREASURY_OFFICER','SUPER_ADMIN')),
  required_permission text,
  visible        boolean NOT NULL DEFAULT true,
  badge_key      text,
  created_by     uuid REFERENCES prs.profiles(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX navigation_items_scope_idx ON prs.navigation_items (location, sort_order);
CREATE TRIGGER navigation_items_touch BEFORE UPDATE ON prs.navigation_items
  FOR EACH ROW EXECUTE FUNCTION prs.touch_updated_at();
