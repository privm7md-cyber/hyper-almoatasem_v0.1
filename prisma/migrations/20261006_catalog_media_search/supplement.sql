-- CATALOG MEDIA + SEARCH supplement (official): SQL-only integrity the Prisma
-- part cannot own. Order: function -> functional indexes -> CHECKs.
-- No new trigger functions; no new sequence/view behavior.

-- ============================ hyper_norm_ar ===============================
-- BA-B grocery Arabic search fold (immutable, index-safe): alef forms→ا,
-- ؤ→و, ة→ه, ى→ي, tatweel + tashkeel stripped, whitespace collapsed, ال
-- handling per-token. Display text is NEVER rewritten — normalization
-- exists only inside search matching/ranking. ال (al-) deliberately KEPT.
-- Character sets are spelled with chr() codepoints (never Arabic literals
-- in executable positions — immune to editor/RTL reordering).
-- Verified identical to the reviewed db/future/search-trgm.sql proposal.
CREATE OR REPLACE FUNCTION hyper_norm_ar(input_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT nullif(btrim(regexp_replace(
    regexp_replace(
      translate(
        lower(coalesce(input_text, '')),
        chr(1571) || chr(1573) || chr(1570) || chr(1649) || chr(1572) || chr(1577) || chr(1609)
        || chr(1600) || chr(1611) || chr(1612) || chr(1613) || chr(1614) || chr(1615) || chr(1616)
        || chr(1617) || chr(1618) || chr(1619) || chr(1620) || chr(1621) || chr(1622) || chr(1623)
      || chr(1624) || chr(1625) || chr(1626) || chr(1627) || chr(1628) || chr(1629) || chr(1630)
      || chr(1631) || chr(1648),
        chr(1575) || chr(1575) || chr(1575) || chr(1575) || chr(1608) || chr(1607) || chr(1610)
      ),
      '(^| )(' || chr(1575) || chr(1604) || ')(\S{2})', '\1\3', 'g'
    ),
    '\s+', ' ', 'g'
  )), '')
$$;

COMMENT ON FUNCTION hyper_norm_ar(TEXT) IS
  'BA-B grocery Arabic search fold (immutable, index-safe). Display text untouched.';

-- ============================ Functional GIN indexes =======================
-- Index-assisted similarity on normalized names without stored columns and
-- without touching frozen tables. The relevance arms in
-- src/lib/catalog/search.ts ride exactly these four indexes.
CREATE INDEX IF NOT EXISTS idx_products_search_trgm
  ON products USING gin (hyper_norm_ar(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_brands_search_trgm
  ON brands USING gin (hyper_norm_ar(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_categories_search_trgm
  ON categories USING gin (hyper_norm_ar(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_variants_search_trgm
  ON product_variants USING gin (hyper_norm_ar(name) gin_trgm_ops);

-- ============================ CHECK constraints ============================
-- Mirrors the reviewed product-images proposal: https-only-friendly URL
-- shape (non-empty, no spaces), closed mime allowlist (SVG excluded
-- fail-closed), positive sizes, width/height paired.
-- Guarded DO blocks (no ADD CONSTRAINT IF NOT EXISTS in PostgreSQL): the
-- migration converges databases where the former db/future proposal was
-- already applied, and is a plain CREATE on fresh databases.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_product_images_url') THEN
    ALTER TABLE product_images ADD CONSTRAINT chk_product_images_url CHECK (
      url <> '' AND position(' ' IN url) = 0);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_product_images_mime') THEN
    ALTER TABLE product_images ADD CONSTRAINT chk_product_images_mime CHECK (
      mime_type IS NULL OR mime_type IN (
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'image/avif'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_product_images_bytes') THEN
    ALTER TABLE product_images ADD CONSTRAINT chk_product_images_bytes CHECK (
      byte_size IS NULL OR byte_size > 0);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_product_images_width') THEN
    ALTER TABLE product_images ADD CONSTRAINT chk_product_images_width CHECK (
      width IS NULL OR width > 0);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_product_images_height') THEN
    ALTER TABLE product_images ADD CONSTRAINT chk_product_images_height CHECK (
      height IS NULL OR height > 0);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_product_images_dims_pair') THEN
    ALTER TABLE product_images ADD CONSTRAINT chk_product_images_dims_pair CHECK (
      (width IS NULL AND height IS NULL) OR (width IS NOT NULL AND height IS NOT NULL));
  END IF;
END $$;
