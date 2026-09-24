-- 0014_design_token_vocabulary.sql
--
-- The design catalogue needs three token families the first schema did not
-- anticipate: the banknote artwork palette (banknote), the logo variants (logo) and
-- the image/asset registry keys (asset). Two value types are added as well:
-- gradients (card faces) and plain strings (asset keys, easings).
--
-- Constraint widening only: no column, no row and no grant changes, so nothing
-- downstream of 0011 has to move.

ALTER TABLE prs.design_tokens
  DROP CONSTRAINT IF EXISTS design_tokens_category_check;

ALTER TABLE prs.design_tokens
  ADD CONSTRAINT design_tokens_category_check CHECK (category IN
    ('color','typography','font_family','font_size','font_weight','line_height',
     'spacing','border','radius','shadow','icon_size','container_width',
     'component_dimension','card_style','banknote','logo','asset','motion','opacity','z_index'));

ALTER TABLE prs.design_tokens
  DROP CONSTRAINT IF EXISTS design_tokens_value_type_check;

ALTER TABLE prs.design_tokens
  ADD CONSTRAINT design_tokens_value_type_check CHECK (value_type IN
    ('raw','string','color','length','number','shadow','gradient','font_family','json'));

COMMENT ON COLUMN prs.design_tokens.category IS
  'Token family. Colour, typography (four sub-families), space/surfaces, layout, and the artwork families (card_style, banknote, logo, asset).';
