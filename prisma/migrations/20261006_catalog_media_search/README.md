# CATALOG MEDIA + SEARCH MIGRATION — Hyper Al-Moatasem (PREPARATION ONLY)

Promotes the reviewed `db/future/` proposals (search trigram support +
product media) into the official migration chain. Applies ONLY after
`20261006_customer_auth` (migration.sql + supplement.sql).

## Dual-artifact layout

* `migration.sql` — Prisma-owned relational structure: `pg_trgm`
  extension enablement, `product_images` table (columns, PK, FK with
  RESTRICT/CASCADE, defaults), the partial one-primary UNIQUE and the
  gallery-order index. All statements idempotent (`IF NOT EXISTS` /
  `OR REPLACE`) so databases where the former future proposal was
  already applied converge cleanly. Runtime grants are NOT migration
  content — they live in `scripts/staging-app-grants.sql`, applied AS the
  database/table owner (same convention as every prior round).
* `supplement.sql` — SQL-owned objects: `hyper_norm_ar()` (immutable
  Arabic fold, byte-identical to the reviewed proposal), the 4 functional
  GIN trigram indexes the search arms ride, and the 6 media CHECKs
  (guarded DO blocks — PostgreSQL has no `ADD CONSTRAINT IF NOT EXISTS`).

## Rules

* Additive only: no frozen object is altered; no business table touched.
* The search query layer (`src/lib/catalog/search.ts`) and the media
  layer (`src/lib/catalog/media.ts`) are unchanged — they already target
  exactly these objects; this migration only makes the objects official.
* `db/future/search-trgm.sql` and `db/future/product-images.sql` remain
  as the reviewed historical proposals (marked superseded in-file).
* Never against production without explicit approval. No secrets here.
