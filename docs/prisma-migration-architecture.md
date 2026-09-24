# PRISMA MIGRATION ARCHITECTURE (PROPOSAL — verified on scratch, never deployed)

> Status: PLANNING GATE output. No migration applied to any real database.
> Dual-artifact rule (binding): every migration = Prisma-managed relational structure
> + SQL supplement with everything Prisma cannot own. Raw Prisma DDL alone is PROVEN
> incomplete AND inappliable (`cannot use column reference in DEFAULT expression` on a
> live server) — it must never be used as a complete migration.

## 1. Toolchain

Prisma CLI 7.10.0 + `@prisma/client` 7.10.0 (pinned pair) · PostgreSQL 18 · commands used:
`migrate diff --from-empty --to-schema --script` (read-only generation),
future `migration plan` / `db verify` / `db migrate` (never run here).

## 2. Baseline strategy

The database already exists with the complete frozen schema. Baseline = a migration whose
net effect on an EMPTY database equals the frozen architecture exactly:
`migration.sql` (Prisma relational structure, one documented line substitution) +
`supplement.sql` (all SQL-only integrity, extracted verbatim). Proven on scratch
(`hyper_almoatasem_migration_scratch`, dropped after): automated comparison
COMPARE-CLEAN, zero unexpected differences. The real-DB baseline step (future gate) is:
provision empty DB → apply both files in order → `migration resolve --applied` equivalent
per Prisma 7 flow — designed here, NOT executed here.

## 3. Prisma-owned objects

31 tables · columns/types/nullability · PKs · plain UNIQUEs (as unique indexes) ·
ordinary indexes (Prisma-generated names — accepted rename, recorded) · 39 FKs with exact
actions · scalar defaults (`TRUE/0/now()/gen_random_uuid()`-equivalent) · `INET` column
shell (values managed via raw SQL; client model blocked, documented).

## 4. SQL-owned objects

~155 CHECKs (143 named + 12 inline, latter under deterministic `{table}_{column}_check`
names) · 10 partial indexes (7 unique + 3 plain, exact predicates) · 6 trigger functions ·
22 triggers · GENERATED expression · `product_stock_status` VIEW · `order_number_seq` ·
`pgcrypto` extension. Full inventory: `sqlonly.json` generator (temp) + §7 below.

## 5. Dual-artifact rule

`prisma/migrations/<stamp>_<name>/migration.sql` (Prisma output + documented substitutions
only) + `supplement.sql` (SQL-owned objects only — never duplicates a Prisma-owned
definition). Review gate for every future migration: both files together, plus the
reconciliation query for mirrors/counters.

## 6. Migration ordering (dependency-derived, frozen)

extension → sequence → tables (+PKs, inline defaults) → plain uniques/indexes → FKs →
CHECKs (`ALTER TABLE ADD CONSTRAINT`) → partial indexes → functions → triggers → view.
Rationale: functions before their triggers; view after base tables; CHECKs/partials any
time post-table; sequence independent (nothing references it in DDL — app calls `nextval`).

## 7. Trigger/function dependencies

`set_updated_at` ← 17 `trg_*_updated_at` · `prevent_category_cycle` ← `trg_categories_no_cycle` ·
`check_cart_transition` ← `trg_carts_transition` · `check_order_item_transition` ← `trg_order_items_transition` ·
`check_replacement_transition` ← `trg_replacements_transition` ·
`check_order_status_audited` ← `trg_orders_status_audited`. Verified present + timing/function match.

## 8. CHECK strategy

Named CHECKs keep frozen names (`ADD CONSTRAINT <name>`); inline originals get deterministic
`{table}_{column}_check` (PG convention). Comparison is semantic (normalized expressions),
so PG rewrites (`IN`→`= ANY`, casts, parens, implicit `ELSE NULL`, transition OR-chains via
pair-set comparison) cannot produce false drift.

## 9. Partial-index strategy

Stored verbatim with predicates (7 unique: single-primary, customer-email, one-default,
2× one-active-cart, one-proposed, user-phone; 3 plain storefront/sellable). Never converted
to `@@unique` (would forbid legitimate NULL/inactive duplicates).

## 10. Generated-column strategy

The single sanctioned DDL substitution: Prisma's illegal
`DEFAULT (quantity - reserved_quantity)` line is replaced by the exact frozen
`GENERATED ALWAYS AS (quantity - reserved_quantity) STORED`. Application never writes it
(`dbgenerated` mapping + DB rejection proven).

## 11. View strategy

`product_stock_status` created AFTER base tables, definition byte-faithful (verified
normalized-equal). Read via raw SQL / future view support; never a table.

## 12. Sequence strategy

`CREATE SEQUENCE order_number_seq` (defaults: start 1, increment 1) early in supplement;
app formats `HM-YYYYMMDD-######` via `nextval` (verified working). No min/max (none frozen).

## 13. INET strategy

Column created by Prisma part as `inet` (verified rendered); client model blocked whole
(`Unsupported` poisons queries in client 7.10 — proven) so audit rows go via raw SQL.
Never migrated to VARCHAR without explicit approval.

## 14. Extension strategy

`CREATE EXTENSION IF NOT EXISTS pgcrypto` first (supplement head); backstop for
`gen_random_uuid()` defaults. Only extension ever needed. No others introduced.

## 15. Drift detection (reproducible)

Two-layer, both automated: (a) `migrate diff --from-empty --to-schema` must stay
structurally stable (31 CREATE + 39 ADD-FK, zero destructive) — any new DROP/ALTER is a
red flag; (b) catalog-vs-frozen-text comparison (`compare.js` pattern: normalized
tables/columns/defaults/PKs/FKs/uniques/indexes/CHECKs/triggers/functions/view/sequence —
COMPARE-CLEAN gate). Cadence: every migration PR + nightly against staging.

## 16. Scratch validation (this gate, completed)

Fresh scratch → `migration.sql` clean → `supplement.sql` 196/196 statements clean →
COMPARE-CLEAN (tables/columns/types/nulls/defaults/generated/PKs/39 FKs+actions/plain
UQs/155 CHECKs incl. pair-set transitions/10 partials+predicates/22 triggers/6 bodies+signatures/
view/sequence/extension; index renames recorded as accepted Prisma ownership) →
targeted battery 7/7 (CHECK fires, transition guard, partial UQ, GENERATED=5.000, view read,
nextval, INET) → races (coupon ×10 + inventory ×10 single-winner, invariants) → scratch dropped.

## 17. Future migration workflow

1. Edit `schema.prisma` + (if touching SQL-owned surface) hand-write the supplement delta.
2. `migration plan` → review BOTH files (no Prisma-only shipments on SQL-owned surface).
3. Apply to scratch → run comparison + targeted + race subset → COMPARE-CLEAN required.
4. `migration resolve`/deploy ONLY against empty-then-built or staged DBs with approval;
   NEVER reinterpret frozen semantics; NEVER `db push` to a populated DB.

## 18. Deployment safety rules

- `hyper_almoatasem` receives NOTHING in this gate (proven: 31 tables, zero rows, no history table).
- No `migrate deploy/dev`, no `db push/execute`, no `resolve`, no seed, no TRUNCATE/DROP/ALTER/CREATE/INSERT/UPDATE/DELETE against it — verified by design (all harnesses target scratch/namespaced DBs) and by final state audit.
- Migration files run ONCE, in order, on empty databases; no blanket `IF NOT EXISTS`
  (hides drift) except the frozen extension line.
- Secrets never in migration files; roles follow the three-role model (owner applies DDL).
