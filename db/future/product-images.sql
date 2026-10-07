-- BA-B4 product media: product_images table (proposal from
-- docs/final-database-architecture-v1.md, implemented here).
--
-- STATUS (20261006, Phase 3): SUPERSEDED by official migration
-- prisma/migrations/20261006_catalog_media_search (migration.sql +
-- supplement.sql) — same table shape, CHECKs, and indexes. This file
-- remains as the reviewed historical proposal only; do NOT apply it where
-- the official chain has run.
--
-- Original notice (preserved): PROPOSED migration path — reviewed,
-- STATUS: PROPOSED migration path — reviewed, scratch-verified, NOT applied
-- to production and NOT part of any Prisma/baseline migration chain. It lives
-- under db/future/ (never prisma/migrations/) precisely so no deploy tooling
-- can apply it implicitly. Production application requires a separate explicit
-- authorization + its own go-live step; until applied, the media endpoints
-- fail LOUD (500 undefined-table, never silent wrong results).
--
-- Design (matches the frozen-adjacent proposal):
-- - product-level gallery (variants fall back to the product gallery —
--   variant-level rows are a documented future extension, not this table).
-- - metadata/reference ONLY (url/key, mime, bytes, dimensions, alt text,
--   sort order, primary flag). NO binary content in PostgreSQL, ever.
-- - exactly one primary per product (partial UNIQUE WHERE is_primary).
-- - deterministic gallery order (sort_order, id tiebreak enforced by readers).
-- - hard delete of metadata rows (physical object lifecycle belongs to the
--   future storage provider; no provider wired in BA-B — see docs).
-- - no updated_at/deleted_at (registry rows are added/revoked, not edited).
--
-- SAFETY: new table only; alters no frozen table/column/constraint/trigger.
-- Revert: DROP TABLE product_images (CASCADE only if dependents exist —
-- none exist by design).

CREATE TABLE IF NOT EXISTS product_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products (id)
                ON DELETE CASCADE
                ON UPDATE CASCADE,
  url         TEXT NOT NULL
                CONSTRAINT chk_product_images_url CHECK (
                  url <> '' AND position(' ' IN url) = 0),
  alt_text    VARCHAR(200) NULL,
  mime_type   VARCHAR(100) NULL
                CONSTRAINT chk_product_images_mime CHECK (
                  mime_type IS NULL OR mime_type IN (
                    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
                    'image/avif')),
  -- NOTE: image/svg+xml deliberately EXCLUDED (fail-closed — inline SVG
  -- is script-capable; allow only with a sanitization policy + decision).
  byte_size   INTEGER NULL
                CONSTRAINT chk_product_images_bytes CHECK (
                  byte_size IS NULL OR byte_size > 0),
  width       INTEGER NULL
                CONSTRAINT chk_product_images_width CHECK (
                  width IS NULL OR width > 0),
  height      INTEGER NULL
                CONSTRAINT chk_product_images_height CHECK (
                  height IS NULL OR height > 0),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_product_images_dims_pair CHECK (
    (width IS NULL AND height IS NULL) OR (width IS NOT NULL AND height IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_images_one_primary
  ON product_images (product_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS idx_product_images_product_order
  ON product_images (product_id, sort_order, id);

-- Least-privilege application access (mirrors the frozen role split:
-- hyper_app runs CRUD; hyper_migrator holds the full set the frozen tables
-- carry (incl. TRUNCATE/TRIGGER for maintenance); DDL stays with the owner.
-- Without these grants the media endpoints fail LOUD on permission-denied,
-- never silently).
GRANT SELECT, INSERT, UPDATE, DELETE ON product_images TO hyper_app;
GRANT ALL ON product_images TO hyper_migrator;
