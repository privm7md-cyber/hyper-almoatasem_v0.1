# Prisma ↔ SQL Representation Gaps (Gate 1 — descriptive, nothing removed)

> Rule: the frozen SQL remains authoritative for everything below. Prisma adapts;
> nothing here justifies altering the database. Each gap lists preservation strategy + risk.

## 1. CHECK constraints (~155, all tables)

Prisma PSL has no CHECK support.
**Preserved by:** frozen `db/phase{1,2,4,5}-schema.sql` (sole enforcer). Critical input
shapes (slug format, phone digits, code format, qty > 0) are *mirrored* in Zod/service
validation for UX — mirroring is not enforcement and never replaces the DB.
**Risk:** LOW — proven live by 77 + 65 + 50 + 240-race suites. Drift only if someone
hand-edits SQL without review (gated by repo process, not tooling).

## 2. Partial unique indexes (7)

`customers.email` · `users.phone` · `customer_addresses` one-default ·
`carts` one-ACTIVE ×2 (`customer_id`, `session_id`) · `product_codes` one-primary ·
`order_item_replacements` one-PROPOSED. Prisma `@@unique` cannot express `WHERE`.
**Preserved by:** SQL only (never faked as plain `@@unique` — that would wrongly forbid
multiple NULL/inactive rows). **Risk:** LOW.

## 3. Triggers (22)

`set_updated_at` ×(users, roles, settings, customers, addresses, carts, cart_items,
orders, order_items, categories, brands, products, variants, codes, inventory, coupons,
promotions) · transition guards (carts, order_items, replacements, orders-audit) ·
category anti-cycle. No Prisma middleware equivalents — triggers stay the writers.
Consequence: `updated_at` fields are mapped WITHOUT `@updatedAt` on purpose.
**Risk:** LOW.

## 4. VIEW + SEQUENCE

`product_stock_status` VIEW → read via raw SQL (`$queryRaw`), no model.
`order_number_seq` → `nextval` via raw SQL + app formatting. **Risk:** NONE.

## 5. GENERATED column

`inventory.available_quantity` → `Decimal @default(dbgenerated(...))`: Prisma omits it
on writes (DB computes), returns it on reads. NEVER include it in create/update data.
**Risk:** NONE (DB rejects writes structurally).

## 6. Special type: INET

`audit_logs.ip_address` → `Unsupported("inet")?`: keeps migrate-diff clean; reads via raw
SQL. (Alternative — future migrate to VARCHAR — NOT chosen silently; deferred to schema gate.)
**Risk:** LOW.

## 7. Polymorphic references (no fake FKs, no fake relations)

`promotion_targets.target_id` · `audit_logs.entity_type/entity_id` ·
`actor_id`/`created_by`/`changed_by`/`assigned_by`/`granted_by`/`proposed_by`/`decided_by`
UUIDs, `updated_by`. Mapped as bare `String? @db.Uuid`. Existence/liveness enforced at
activation/service time + reconciliation reports (frozen rule). **Risk:** NONE (by design).

## 8. Money ROUND math + ledger self-checks + transition whitelists

`estimated_total = ROUND(qty×price,2)`, `new = prev + qty`, `(old,new)` transition pairs:
SQL CHECKs/triggers enforce; services compute identically (verified by suites).
**Risk:** LOW.

## 9. Representable items (mapped, no gap)

PKs · plain + composite UNIQUEs · ordinary indexes (`@@index`, incl. sort orders) ·
FKs with exact Restrict/Cascade/SetNull (31/7/1 — verified identical distribution) ·
`DEFAULT now()/TRUE/0` · `gen_random_uuid()` backstop via `dbgenerated` (app sends v7) ·
`Decimal/DateTime/Json` mappings · soft-delete columns (no global middleware — deliberate).

## 10. Config wiring required (next gate, NOT applied here)

`prisma.config.ts` currently has no `orm` section (`contract.format` reports
CONFIG.FILE_NOT_FOUND — observed, not worked around). Harness evidence (temp-only
probe, zero repo impact) shows the required shape is:
`orm: ormConfig({ contract: "<path-to-psl>", db: { connection: process.env.DATABASE_URL } })`
via `@prisma/orm-postgres/config`, contract file conventionally at
`src/prisma/contract.prisma`, runtime bootstrap `db.ts` via
`@prisma/orm-postgres/runtime` + emitted `contract.json`/`.d.ts`.
Apply at migration gate, not silently.

## 11. Prisma 8 dialect verdict (verified via `contract emit` diagnostics, temp copy only)

Classic v7 PSL in `prisma/schema.prisma` is NOT consumable by the v8 contract pipeline
as written. Exhaustive diagnostic census on an exact copy (278 + 6 + 2 + 1):
- `generator` + `datasource` top-level blocks: UNSUPPORTED (v8 uses config-file `orm` section).
- ALL `@db.*` native attributes (×278): UNSUPPORTED — v8 requires type-position natives
  (`Uuid`, `VarChar(n)`, `Decimal(p,s)`, `Timestamptz(n)`).
- `sort: Desc` inside `@@index` (×6): unsupported syntax.
- `Unsupported("inet")` field type (×1): unsupported type constructor.
Everything else parsed clean: 31 models, all fields, relations incl. onDelete/onUpdate
actions, `@id/@unique/@@unique/@@index` (plain), `@default(now()/true/0/dbgenerated())`,
`@map/@@map`, Json, optional markers. `contract format` passes; `contract emit` blocks
until the above are resolved.
Remediation paths (decision required, nothing applied): (A) pin Prisma 7 stable CLI+client
and keep classic PSL (recommended: smallest delta, stable toolchain); (B) adopt v8
`orm-postgres` (mechanical dialect rewrite + new runtime API + RC instability).
`@prisma/client` 7.10.0 has NO generation path under CLI 8 RC — client round-trip is
unprovable until (A) or (B) lands.

## 12. Gate-2 verification record (Prisma 7.10.0 pinned, 2026-09-22)

- `prisma validate`: PASS on `prisma/schema.prisma` as authored (incl. `Unsupported("inet")`).
- `prisma generate`: PASS — all 31 models present in generated client.
- `tsc --noEmit`: PASS (project-wide, incl. a 31-delegate typed probe, temp file removed).
  Collateral fix: removed v8-only `skills` key from `prisma.config.ts` (failed v7 typecheck,
  would break `npm run build`); config now `defineConfig + datasource.url = env(...)`.
- Round-trip on scratch PG18 (frozen SQL applied, then dropped): 15/15 — read/write/read-back/delete,
  UUID/Decimal/DateTime/Json, GENERATED read + overwrite-rejected, least-privilege app role.
- INET finding (stronger than §6): `Unsupported("inet")` doesn't merely omit the field — in
  @prisma/client 7.10 it poisons the WHOLE `AuditLog` model (reads AND writes fail at query-build).
  `audit_logs` is therefore raw-SQL-only (reads + writes), proven working via raw SQL.
  DB type stays INET (no silent migration); alternative (VARCHAR) deferred, never applied silently.
- `migrate diff --from-empty --to-schema` (read-only, computational): 31 CREATE TABLE,
  39 ADD-FOREIGN-KEY (actions rendered exactly), 0 DROP/ALTER-destructive — and ZERO CHECKs,
  partial indexes, triggers, GENERATED expressions, VIEW, or SEQUENCE content. This output alone
  would LOSE the frozen integrity layer: migrations MUST ship the frozen SQL supplements
  alongside any Prisma-generated DDL. This is now proven, not just asserted.
