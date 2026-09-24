# AGENT HANDOFF — Hyper Al-Moatasem / هايبر المعتصم (canonical, self-contained)

> Read this file first. It is current as of the last verified gate.
> Conversation history is NOT the source of truth — the repository, database,
> and passing tests are. If anything here conflicts with those, stop and investigate.

## 1. Project identity

* **Project:** Hyper Al-Moatasem / هايبر المعتصم — grocery/hypermarket e-commerce (production-oriented)
* **Path:** `D:\Hyper_el-moatasem` · **Stack:** Next.js 16.3.5 + React 19.2.8 + TypeScript 5 + Tailwind + ESLint
* **DB:** PostgreSQL 18.4 GA, local dev database `hyper_almoatasem` (server binaries under `C:\pgprov`, data dir `C:\pgprov\data`)
* **Prisma:** CLI 7.10.0 + `@prisma/client` 7.10.0 (matched stable pair; Prisma 8 RC rejected — §8)
* **Runtime:** Node v24.21.0, npm 11.19.0, Windows 11 · `zod ^4.6.5`, `zustand ^5.0.15`
* **Scope:** 20,000+ products, Arabic-first, EGP, one branch, Matai Center delivery, guest + registered customers

## 2. Source-of-truth hierarchy

```text
1. Actual frozen SQL / verified database structure (db/*.sql + live PG checks)
2. Passing automated tests and live PostgreSQL verification
3. Architecture documents (docs/*-architecture*.md, *-notes.md)
4. Final ERD (docs/final-erd-v1.mmd)
5. AGENT-HANDOFF.md (this file — accurate snapshot, not authority over 1–4)
6. Conversation history (never authoritative)
```

## 3. Gate history (all verified)

* **Phase 1 — COMPLETE/FROZEN/VERIFIED:** 8 tables (catalog + inventory). Invariants: GENERATED `available_quantity`, weight CHECKs, global code UQ, 7 movement types, price history.
* **Phase 2 — COMPLETE/FROZEN/VERIFIED:** 8 tables (customers/cart/orders/replacements). Unified guest model, phone identity, counting-unit quantities, reserve/commit (R7 predicate), order lifecycle + history-first trigger, link-not-overwrite replacements. **77/77 tests.**
* **Phase 4 — COMPLETE/FROZEN/VERIFIED:** 7 tables (promos/targets/rules/buy-get/coupons/usages/order-discounts). Base-price separation, OR-targets + subtree, priority→specificity ordering, sequential stacking, coupon row-lock races, `discount_total` = checkout-estimate (amended R19). **65/65 functional + 120/120 two-session concurrency.**
* **Phase 5 — COMPLETE/FROZEN/VERIFIED:** 8 tables (users/roles/mappings/permissions/grants/audit/settings/notifications). No password_hash, no sessions (auth deferred). **50/50 tests** + Phase 2 (77/77) + Phase 4 (65/65) regressions green.
* **Final ERD V1 — REVIEWED/READY:** 37 tables (31 implemented + 6 designed, §6).
* **Foundation — COMPLETE:** Next.js + TS + ESLint + Tailwind + App Router + Zod + Zustand + Git; dev 200 + build green.
* **Database Gate — PASSED:** hybrid model, PG 18, `hyper_almoatasem`, three roles (owner/migrator/app), least privilege.
* **Provisioning — COMPLETE:** local PG18, DB + roles + pgcrypto + `.env` (gitignored), frozen SQL applied byte-identically (31/1/1 objects verified).
* **Prisma Schema Gate 1 — COMPLETE:** `prisma/schema.prisma`, 31 models, automated COLUMNS-OK.
* **Prisma Schema Review — PASSED** (with one toolchain decision, §8).
* **Migration Planning — PASSED:** dual-artifact prototype proven on scratch (COMPARE-CLEAN).

## 4. Current gate (MOST IMPORTANT)

```text
CURRENT_GATE: MIGRATION IMPLEMENTATION / BASELINE
```

Migration Planning PASSED; implementation NOT done; real DB NOT baselined and must stay
intact. Next agent executes the 13-step procedure in §12 using the prototype at
`prisma/migrations/00000000000000_baseline__PROTOTYPE_DO_NOT_APPLY/` (migration.sql +
supplement.sql + README). No approved implementation prompt file exists in-repo beyond
that prototype + §12 below.

## 5. Database current state

`hyper_almoatasem`: **31 tables, 1 view (`product_stock_status`), 1 sequence
(`order_number_seq`), 39 FKs, ~155 CHECKs, 10 partial indexes (7 unique + 3 plain),
6 trigger functions, 22 triggers, 1 generated column, 1 extension (pgcrypto), 1 INET column.**
Distinguish from Final ERD V1 (37 tables — the extra 6 are design-only, §6).

## 6. Final ERD boundary

Final ERD V1 = 37 tables. These 6 are DESIGNED but NOT IMPLEMENTED and MUST NOT be added
during baseline: `product_images`, `payments`, `payment_transactions`, `delivery_zones`,
`delivery_drivers`, `deliveries`. They belong to future migrations only.

## 7. Frozen phases (see §14 for files)

* **P1:** 8 tables; catalog/inventory; `quantity = available + reserved` (GENERATED);
  single loose variant + `sale_step_grams`; global code UQ; price history.
* **P2:** 8 tables; guest ordering; requested/actual weights; reserve-then-commit;
  NEW→…→DELIVERED + cancellations; replacements link (never overwrite); 77/77.
* **P4:** 7 tables; base price never moves; stacking sequential; weighted promos recompute
  from row snapshots; coupon row-lock + conditional bump races safe; 65/65 + 120 races.
* **P5:** 8 tables; RBAC users→roles→permissions; auth/sessions/passwords DEFERRED
  (no `password_hash`, no sessions table); append-only audit; 50/50.

## 8. Prisma toolchain (final)

CLI 7.10.0 + client 7.10.0 (matched). Prisma 8 RC **rejected**: new `orm-postgres`
runtime + v8 PSL dialect (`Uuid` in type position, no `@db.*`, no `datasource` block)
are incompatible with the classic `prisma/schema.prisma` + `@prisma/client` path —
proven via `contract emit` diagnostics. **Do NOT upgrade to Prisma 8 without a new
architecture decision.** Key files: `prisma/schema.prisma` (31 models),
`prisma.config.ts` (`defineConfig` + `datasource.url = env("DATABASE_URL")`; v8-only
`skills` key removed — it broke `tsc`), `docs/prisma-sql-gaps.md` (gaps + v8 verdict).

## 9. Prisma SQL ownership (dual-artifact rule)

*Prisma-owned:* tables, columns, types, nullability, defaults, PKs, plain uniques/indexes
(Prisma-generated names — accepted rename), FKs, `inet` column shell.
*SQL-owned (supplement):* pgcrypto, all CHECKs, partial indexes, functions, triggers,
GENERATED expression, VIEW, SEQUENCE, INET behavior, money ROUND math, transition
whitelists, row-lock transactions. Raw Prisma DDL alone was **proven inappliable**
(`cannot use column reference in DEFAULT expression`) — it must never be used complete.

## 10. Migration architecture (proven on scratch)

Prototype dir above: `migration.sql` (Prisma output + ONE documented line substitution
for the GENERATED column) + `supplement.sql` (196 statements: ext → seq → 155 CHECKs →
10 partials → 6 functions → 22 triggers → view) + README (prototype warning).
Applied clean on fresh scratch; **COMPARE-CLEAN** (zero unexpected differences across
tables/columns/types/nulls/defaults/PKs/39 FKs+actions/uniques/CHECKs/partials/triggers/
functions/view/sequence/extension; index renames recorded as accepted Prisma ownership).
Targeted battery 7/7 + coupon/inventory races single-winner. Scratch dropped afterward.

## 11. Real database safety

```text
REAL DATABASE: hyper_almoatasem — NEVER recreate or destroy it.
```
No DROP/TRUNCATE/destructive migration/`db push`/`migrate dev` against it — ever.
Baseline adoption marks history WITHOUT re-creating schema. Experiment only on scratch DBs.
Current real state: 31 tables, zero business rows (seeds never applied there by design).

## 12. Migration implementation requirements (next agent: follow exactly)

1. Verify real DB fingerprint (31 tables, zero rows expected, no `_prisma_migrations`).
2. Verify baseline artifacts (prototype dir contents + README).
3. Produce the clean production baseline migration from the prototype (no PROTOTYPE label).
4. Reproduce on a FRESH scratch DB (drop/create → apply → COMPARE-CLEAN).
5. Run targeted + race verification on scratch.
6. Verify migration state tooling (history table handling per Prisma 7 flow, dry-run first).
7. Only on scratch-PASS: adopt baseline on the real DB with **zero schema mutation**
   (history marking only — the schema already matches).
8. Re-verify real DB schema unchanged (object inventory) + `migration status` clean.
9. Re-run Phase 2/4/5 regressions.
10. Regenerate client + `tsc --noEmit` + `npm run build` green.
11. Confirm the 6 future tables are still absent.
12. Document the result (append to `docs/prisma-migration-architecture.md`).
13. STOP — do not proceed to application features.

> The real DB must experience zero schema mutation during baseline adoption.

## 13. Critical decisions (locked)

UUIDv7 app-generated + `gen_random_uuid()` backstop · `NUMERIC(10,2)` money / `(12,3)`
quantities / `(5,2)` percents · sale-step weights, no per-weight variants · availability
derived (no stored copy) · no `orders.payment_status` (state from future payments domain) ·
`discount_total` = checkout-estimate snapshot, finals in allocation rows/mirrors · server-side
promo math · coupon/promo races via row-lock + conditional bump · `quantity = available +
reserved` · unified guest model (phone identity) · NO auth/passwords/sessions yet ·
INET raw-SQL-only (client model blocked — proven) · polymorphic refs relation-less ·
no 6-table implementation during baseline · Prisma 7 stable, classic PSL · transitions
DB-enforced (never middleware) · `updated_at` trigger-owned (no `@updatedAt`).

## 14. File map (authority)

| File | Purpose | Authority | Status |
|---|---|---|---|
| `db/phase{1,2,4,5}-schema.sql` | frozen DDL source of truth | HIGHEST | frozen, byte-verified |
| `db/phase{1,2,4,5}-seed-example.sql` | example fixtures (never applied to real DB) | medium | frozen |
| `prisma/schema.prisma` | 31-model classic PSL representation | high | baseline complete |
| `prisma.config.ts` | datasource-via-env config (v7) | high | minimal, correct |
| `prisma/migrations/00000000000000_baseline__PROTOTYPE_DO_NOT_APPLY/` | prototype dual-artifact | medium (prototype!) | scratch-proven, NOT production history |
| `docs/final-erd-v1.mmd` / `docs/final-database-architecture-v1.md` | 37-table design | high | reviewed |
| `docs/prisma-sql-gaps.md` | gaps + v8 verdict + INET finding | high | current |
| `docs/prisma-migration-architecture.md` | 18-section migration design | high | current |
| `docs/phase*-implementation-notes.md` | per-phase pins/limits | high | current |
| `db/tests/run-{tests,phase4-tests,phase5-tests}.js` | PGlite suites (77/65/50) | high | passing |
| `db/tests/run-{concurrency,phase4-concurrency}.js` | embedded-PG races (240+120) | high | passing |
| `.env` | local URLs (app+migrator) | secret | gitignored, present |
| `.env.example` | empty placeholder | low | present |

## 15. Frozen file rule

`db/phase1-schema.sql`, `db/phase2-schema.sql`, `db/phase4-schema.sql`,
`db/phase5-schema.sql` are immutable without an explicit architecture decision.
Never silently "fix" frozen SQL (nor ERDs, nor architecture docs).

## 16. Not implemented (verified deferred)

Authentication, password management, sessions, payments, payment transactions, delivery
domain (zones/drivers/deliveries), product images, multi-branch, advanced delivery
tracking, the 6 future tables, report views/materializations, audit/notification retention
policies, JSONB GIN indexes, full-text search.

## 17. Machine-readable state

```text
CURRENT_GATE:
MIGRATION IMPLEMENTATION / BASELINE

PREVIOUS_GATE:
PRISMA MIGRATION PLANNING — PASSED

REAL_DATABASE:
hyper_almoatasem

REAL_DATABASE_BASELINED:
NO

MIGRATION_IMPLEMENTATION:
NOT_COMPLETE

NEXT_ACTION:
Execute the approved Migration Implementation / Baseline procedure (§12).

DO_NOT:
- upgrade Prisma
- modify frozen SQL
- add the 6 future tables
- recreate the real DB
- run destructive migrations
- implement application features
```

## 18. Handoff instructions for the next agent

> Start by reading `docs/AGENT-HANDOFF.md`.
>
> Then read the authoritative files referenced by this document.
>
> Do not rely on conversation history as a source of truth.
>
> Verify the current repository state before making changes.
>
> Do not begin a new phase unless the current gate is explicitly passed.
>
> Do not modify frozen architecture silently.
>
> Do not perform destructive database operations.
>
> If the repository state conflicts with this handoff, stop and investigate before changing anything.
