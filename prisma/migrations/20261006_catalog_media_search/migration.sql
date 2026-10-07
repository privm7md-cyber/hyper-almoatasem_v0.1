-- CATALOG MEDIA + SEARCH migration (Prisma-owned relational structure).
-- Applies AFTER 20261006_customer_auth (migration.sql + supplement.sql).
-- Prisma-owned only: extension enablement, table, columns, types,
-- nullability, defaults, PK, plain UNIQUEs/indexes (frozen-style names via
-- Prisma `map:`), FK with exact actions, and the least-privilege runtime
-- grants the endpoints require (mirrors the frozen role split — a fresh
-- database must serve the media/search APIs with zero manual steps).
-- Everything Prisma cannot own (the IMMUTABLE search fold, functional GIN
-- indexes, CHECKs) lives in supplement.sql in this directory.
-- No secrets. No business data. Additive only: no frozen object is altered.
-- All statements are idempotent (IF NOT EXISTS / OR REPLACE) so the
-- migration also converges databases where the former db/future proposal
-- files were already applied on scratch.

-- ============================ pg_trgm extension ============================
-- Typo-tolerant similarity + % operator + GIN support. pg_trgm is a
-- TRUSTED extension: roles with CREATE privilege install it without
-- superuser. IF NOT EXISTS keeps re-application a no-op.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================ product_images ===============================
-- Product-level gallery, metadata/reference ONLY (url/key, mime, bytes,
-- dimensions, alt text, sort order, primary flag). NO binary content in
-- PostgreSQL, ever. Exactly one primary per product (partial UNIQUE WHERE
-- is_primary). Deterministic gallery order (sort_order, id). Hard delete
-- of metadata rows (physical object lifecycle belongs to a future storage
-- provider — none wired). No updated_at/deleted_at (registry rows are
-- added/revoked, not edited). Matches src/lib/catalog/media.ts exactly.
CREATE TABLE IF NOT EXISTS product_images (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id     UUID NOT NULL REFERENCES products (id)
                     ON DELETE CASCADE
                     ON UPDATE CASCADE,
    url            TEXT NOT NULL,
    alt_text       VARCHAR(200) NULL,
    mime_type      VARCHAR(100) NULL,
    byte_size      INTEGER NULL,
    width          INTEGER NULL,
    height         INTEGER NULL,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_primary     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CreateIndex (exactly-one-primary guard; partial predicates must be
-- IMMUTABLE so this plain partial UNIQUE lives in the Prisma artifact).
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_images_one_primary
  ON product_images (product_id) WHERE is_primary;

-- CreateIndex (gallery read order).
CREATE INDEX IF NOT EXISTS idx_product_images_product_order
  ON product_images (product_id, sort_order, id);

-- NOTE (ownership convention, mirrors admin-auth): runtime GRANTs are NOT
-- part of migration content — they are applied AS the database/table owner
-- via scripts/staging-app-grants.sql (same statements, owner context).
-- Tables created by this migration are migrator-owned, so the owner grant
-- step succeeds deterministically on any database built from this chain.
