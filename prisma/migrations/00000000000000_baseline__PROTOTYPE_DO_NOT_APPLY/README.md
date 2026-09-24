# PROTOTYPE — DO NOT APPLY AS A PRODUCTION MIGRATION

This directory is a **migration-planning prototype** produced by the
PRISMA MIGRATION PLANNING gate for scratch-only experiments. It is NOT
production migration history:

* `migration.sql` — Prisma-generated relational structure (`migrate diff
  --from-empty --to-schema`), plus exactly ONE documented line substitution:
  `inventory.available_quantity` is rendered by Prisma as an illegal
  `DEFAULT (quantity - reserved_quantity)` (PostgreSQL rejects column references
  in DEFAULT expressions — proven live); the line carries the exact frozen
  `GENERATED ALWAYS AS (quantity - reserved_quantity) STORED` definition instead.
* `supplement.sql` — every SQL-only integrity feature Prisma cannot own,
  extracted verbatim from the frozen schemas in dependency order:
  extension → sequence → 155 CHECKs → 10 partial indexes → 6 functions →
  22 triggers → 1 view.

Application order on an EMPTY database: `migration.sql` then `supplement.sql`.
Never against `hyper_almoatasem`. Never marked applied. The future production
baseline will be authored from this prototype only after explicit approval.
