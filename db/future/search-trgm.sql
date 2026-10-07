-- BA-B future search support: pg_trgm + Arabic normalization + GIN indexes.
--
-- STATUS (20261006, Phase 3): SUPERSEDED by official migration
-- prisma/migrations/20261006_catalog_media_search (migration.sql +
-- supplement.sql) — same extension, byte-identical function body, same 4
-- indexes. This file remains as the reviewed historical proposal only;
-- do NOT apply it where the official chain has run.
--
-- Original notice (preserved): PROPOSED migration path — reviewed, scratch-verified, NOT applied
-- to production and NOT part of any Prisma/baseline migration chain. It lives
-- under db/future/ (never prisma/migrations/) precisely so no deploy tooling
-- can apply it implicitly. Production application requires a separate explicit
-- authorization + its own go-live step; until applied, /api/store/catalog/search
-- answers 500 (loud missing-dependency, never silent wrong results).
--
-- Why these objects (and nothing else):
-- - pg_trgm: typo-tolerant similarity + % operator + GIN support. PostgreSQL
--   ships no Arabic stemmer, so full-text search would need external dicts;
--   trigram similarity needs no language data and degrades gracefully.
-- - hyper_norm_ar(text): IMMUTABLE grocery-domain Arabic fold so the index
--   and the query see identical text (alef forms→ا, ؤ→و, ة→ه, ى→ي, tatweel +
--   tashkeel stripped, whitespace collapsed). Display values are NEVER
--   rewritten — normalization exists only inside search matching/ranking.
--   ال (al-) is deliberately KEPT (precision over recall; trigram overlap
--   bridges with/without forms — proven by the BA-B search corpus).
-- - Functional GIN indexes on normalized names (products/brands/categories/
--   variants): index-assisted similarity without stored columns, without
--   touching frozen tables (new objects only, fully reversible via DROP).
--
-- SAFETY: creates no tables, alters no frozen tables/columns/constraints,
-- adds no triggers. Revert: DROP INDEX (4x), DROP FUNCTION, (optionally)
-- DROP EXTENSION pg_trgm (only if nothing else uses it).

-- Requires a superuser-privileged role (extensions are cluster-scoped).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Character sets are spelled with chr() codepoints (never Arabic literals
-- in executable positions — immune to editor/RTL reordering):
-- folds: أ(1571) إ(1573) آ(1570) ٱ(1649) → ا(1575); ؤ(1572) → و(1608);
--   ة(1577) → ه(1607); ى(1609) → ي(1610).
-- strips (deleted via over-long translate source): tatweel ـ(1600),
--   tashkeel U+064B–U+065F (1611–1631) + superscript-alef U+0670 (1648).
-- (NOT 1640: that is U+0668 digit-eight — stripping it would corrupt
-- numbers. Verified against the live function body during BA-B.)
-- Definite-article handling: strip a leading ال (alef U+0627 + lam U+0644)
-- per whitespace-separated token when ≥2 letters remain (proven safe on the
-- BA-B corpus: with/without forms converge to the exact tier; short/integral
-- cases like a bare ال never match the guard and stay intact).
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

CREATE INDEX IF NOT EXISTS idx_products_search_trgm
  ON products USING gin (hyper_norm_ar(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_brands_search_trgm
  ON brands USING gin (hyper_norm_ar(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_categories_search_trgm
  ON categories USING gin (hyper_norm_ar(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_variants_search_trgm
  ON product_variants USING gin (hyper_norm_ar(name) gin_trgm_ops);
