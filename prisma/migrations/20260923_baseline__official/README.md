# OFFICIAL BASELINE MIGRATION — Hyper Al-Moatasem (PREPARATION ONLY)

This directory is the **official baseline migration**. It was authored ONLY from
the scratch-proven prototype
(`prisma/migrations/00000000000000_baseline__PROTOTYPE_DO_NOT_APPLY/`),
which passed the full Scratch test on PostgreSQL 18.4
(31 tables / 39 FKs / 155 CHECKs / 10 partial indexes / 22 triggers /
6 trigger functions / view / sequence / pgcrypto / GENERATED column / inet
verified, plus the 7/7 functional battery).

## Dual-artifact layout

* `migration.sql` — Prisma-owned relational structure (tables, columns, types,
  nullability, defaults, PKs, plain uniques/indexes, FKs, `inet` column shell),
  including the single documented substitution: `inventory.available_quantity`
  is `GENERATED ALWAYS AS (quantity - reserved_quantity) STORED`, never a
  `DEFAULT` expression (raw Prisma output is proven inapplicable on a live
  server: `cannot use column reference in DEFAULT expression`).
* `supplement.sql` — SQL-owned structures Prisma cannot own (pgcrypto,
  sequence, all CHECKs, partial indexes, functions, triggers, view), extracted
  verbatim from the frozen `db/phase{1,2,4,5}-schema.sql`.

## Application rules

* On an EMPTY database, apply explicitly in order: `migration.sql` first,
  then `supplement.sql`. The supplement must be run explicitly — Prisma does
  not apply it automatically.
* This migration exists to adopt history for a database that ALREADY matches
  the frozen architecture. It must NEVER be used to re-create the production
  database `hyper_almoatasem`.
* It is NOT executed automatically against production in this phase. Any future
  adoption on the live database is history-marking only (resolve), with zero
  schema mutation, and requires explicit approval.
* This directory contains no secrets (connection strings live in `.env`,
  which is gitignored).
