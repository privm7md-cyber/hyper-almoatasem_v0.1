# BA-3 Inventory — implementation record

> Backend APIs only. No frontend. No BA-4+. No schema/migration changes.
> All behavior verified on scratch (`hyper_almoatasem_scratch`, reused from
> the BA-2 build); production untouched (every test connection is
> allowlisted to scratch names only; the Next server under test pointed at
> scratch).

## 0. Conflict decisions (read first)

### BA-3-C1 — no `held_quantity` column exists (frozen SQL wins)

The BA-3 brief describes `held quantity` as a stored sibling of `quantity`
and `reserved_quantity` with the predicate `quantity − reserved − held`.
The frozen database has **no such column**:

- `db/phase1-schema.sql:231-244` — `inventory` carries exactly
  `quantity`, `reserved_quantity`, and
  `available_quantity GENERATED ALWAYS AS (quantity - reserved_quantity)`.
- `prisma/schema.prisma:131-144` mirrors this (no held field).
- `scripts/verify-scratch.mjs` asserts the GENERATED expression
  `(quantity - reserved_quantity)`.

What the frozen contracts call "held" (`phase2-architecture-proposal.md`
R3/R7, `db/tests/run-tests.js:194-196`) is the **`requested_quantity`
already reserved for one order line** — the hold released inside the
commit (`reserved −= requested`). The R3 predicate is therefore:

```sql
UPDATE inventory
   SET quantity = quantity - $actual,
       reserved_quantity = reserved_quantity - $requested
 WHERE product_variant_id = $1
   AND (quantity - reserved_quantity + $requested) >= $actual
```

`commitStock` implements exactly this. **No holds table, no
`held_quantity` field, and no hold/release-hold endpoints were invented.**
The inventory detail shape is test-guarded to expose no `held*` keys
(`shape-no-held-field` in `scripts/api/t-inventory.mjs`), so a future
schema addition cannot silently drift the contract.

### BA-3-C2 — weighed-barcode price formula stays OPEN

Per BA-0 §4 / BA-2 (deferred): no formula invented. Code `2010106` still
resolves via catalog lookup; inventory exposes the variant's availability
and price basis only — never a computed weighed total
(`barcode-no-computed-total` precedent kept; `barcode-variant-avail-follows`
proves the integration path: lookup → variant → availability).

## 1. Endpoints

Storefront (public, active-only rows, read-only):

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/store/inventory/variants/[id]` | one variant's availability (DB GENERATED value) |
| GET | `/api/store/inventory/products/[id]` | product availability via the frozen `product_stock_status` VIEW + per-variant rows |

Admin (session + RBAC; reads `inventory.view`, all writes `inventory.adjust`
— the only write capability in the frozen 31-key matrix; no separate
reserve/commit permission exists):

| Method | Route | Permission | Purpose |
|---|---|---|---|
| GET | `/api/admin/inventory` | view | list (product/inStock/lowStock filters, cursor pagination) |
| GET | `/api/admin/inventory/[variantId]` | view | detail + taxonomy + stock status |
| PATCH | `/api/admin/inventory/[variantId]` | adjust | `lowStockThreshold` edit only (display-level, no movement) |
| POST | `/api/admin/inventory/adjust` | adjust | quantity delta + paired movement, one tx |
| POST | `/api/admin/inventory/reserve` | adjust | atomic reserved-only bump, NO movement (checkout foundation) |
| POST | `/api/admin/inventory/release` | adjust | atomic reserved-only decrement, NO movement |
| POST | `/api/admin/inventory/commit` | adjust | strict R3 commit + paired SALE movement (picking foundation) |
| GET | `/api/admin/inventory/movements` | view | ledger list (variant/type/reference filters, cursor pagination) |
| GET | `/api/admin/inventory/movements/[id]` | view | single audit row |

`reserveBatch` (multi-line atomic reserve, ASC locks, all-or-nothing) is a
**service-only** primitive for BA-6 checkout — deliberately no HTTP surface
in BA-3 to avoid inventing endpoints. Race E proves its pattern.

## 2. Stock semantics

- One `inventory` row per variant (1:1, created with the variant).
- `quantity` = on hand (pcs or KG). `reserved_quantity` = held for open
  order lines. `available_quantity` = GENERATED (`quantity − reserved`),
  never written, never recomputed in JS (shapes carry the DB value).
- Guards: `quantity ≥ 0`, `reserved ≥ 0`, `reserved ≤ quantity` (CHECKs —
  last line of defense; 23514 maps to 409, never 500, for race losers).
- `stockStatus`: `out_of_stock` iff available ≤ 0; `low_stock` iff a
  threshold is set and 0 < available ≤ threshold; else `in_stock`.
- Product-level truth is the `product_stock_status` VIEW (raw-SQL read, no
  Prisma model); no summed quantity (mixed units would be incoherent).
- Reserve/release create **zero** movements (frozen §J; asserted
  `reserve-no-movement` / `release-no-movement` / `raceA-no-movement`).
  Commit decrements quantity AND reserved and inserts exactly one `SALE`
  movement with the signed negative delta in the same tx.

## 3. Weighted semantics

- `NUMERIC(12,3)` end to end; wire format is decimal **strings**
  (`0.125`, `500`), never floats. All domain math uses integer
  thousandths (`qtyToThousandths` in `src/lib/inventory/quantities.ts`).
- PIECE quantities must be whole packs (`isWholePacks`; `0.500` → 422).
- WEIGHT requesteds must be multiples of `sale_step_grams`
  (`isStepMultiple`; KG thousandths ARE grams, so `t % step === 0`;
  `0.100` on a 125 g step → 422). Stock levels themselves are NOT step
  gated (on-hand `47.350` is not a step multiple — correct).
- Commit actuals are weighed facts: gated by the R7 envelope only, never
  by the step (frozen W1 precedent: `0.500 → 0.475` commits PARTIAL on a
  125 g step). `envelopeAllows` is pure integer math
  (`10·actual ≤ 10·requested + max(10·step, requested)`; PIECE tolerance 0).
- Invalid precision (`0.1234`), zero, negatives, non-string numbers → 400
  at the Zod boundary.

## 4. Reservation lifecycle (no new tables)

1. `reserve` — `reserved += qty` iff `(quantity − reserved) ≥ qty`
   (rowcount-checked). 409 when short (single-winner loser re-reads).
   Domain-gated (sellable variant, whole-pack/step shape) → 404/422.
2. `release` — `reserved −= qty` iff `reserved ≥ qty`. 409 when short.
3. `commit(requested, actual)` — envelope gate (422 on breach) then R3
   atomic update (409 on stock short) + `SALE(−actual)` movement whose
   `previous_quantity` comes from the locked row. Strict primitive: no
   R7 max-fulfillable auto-cap here — BA-6 owns capping policy.
4. `adjust(delta, movementType)` — manual stock ops only
   (`STOCK_IN`/`ADJUSTMENT`/`WASTE`/`RETURN` allowlist;
   `SALE`/`CANCELLED_ORDER`/`REPLACEMENT` rejected at the boundary —
   order-lifecycle owned). Quantity guard
   (`quantity+delta ≥ 0 AND reserved ≤ quantity+delta`) + paired movement
   whose `previous_quantity` comes from the locked row.

## 5. Movement semantics

- Append-only; `quantity ≠ 0` (signed delta); `new = previous + qty`
  (DB CHECK, asserted per movement in tests); `reference_id ⇒
  reference_type` (pair rule mirrored in Zod); `created_by` = acting admin.
- `SALE` deltas are negative (on-hand decrement); `STOCK_IN` positive.
- Reserve/release write no movements; every quantity change writes exactly
  one movement in the same tx (reconciliation: live `quantity` equals the
  latest movement's `new_quantity` for adjusted rows — asserted).

## 6. Concurrency strategy

- READ COMMITTED everywhere; never `SERIALIZABLE`; never
  read-check-write; never application-only locking; never JS availability
  checks (all guards are single-statement `UPDATE … WHERE <predicate>
  RETURNING` with rowcount checks).
- Every mutating tx opens with `SELECT … FOR UPDATE` on the inventory
  row(s); multi-row work locks in deterministic ASC order
  (`orderLockIds`; `reserveBatch` sorts before locking).
- Loser contract: 409 + `retryable: true` + re-read (PG `23514` CHECK
  backstop, `40P01`/`40001` mapped the same way — the nested Prisma 7
  `meta.driverAdapterError.cause.code` shape, proven live).
- Transaction boundaries are explicit per function (no generic wrapper).

## 7. Authorization

- Storefront availability is public (same posture as catalog storefront).
- Every admin route is server-side gated per request (`denyUnless` for
  reads; `checkPermission` inline for writes to capture the actor id).
  Matrix tested: anonymous → 401, roleless → 403, store/owner → 200/201,
  inactive-user login → 401. UI hiding is never authorization.

## 8. Prisma vs raw SQL

- Prisma: inventory/variant/product/movement **reads**, threshold edits
  (no stock guard), taxonomy joins.
- Raw SQL: the `product_stock_status` VIEW (no model exists), and **all**
  stock mutations (`FOR UPDATE` locks, atomic predicates, `RETURNING`,
  paired movement inserts). Prisma can express none of these safely
  (gaps doc §5 + contract §17); `available_quantity` is never in any
  write payload (DB rejects it structurally).

## 9. Error behavior (BA-1 envelopes, no new codes)

400 malformed shape / strict-unknown fields; 401 anonymous (+locked/
inactive via generic login error); 403 no grant; 404 unknown
variant/product/movement/inventory; 409 insufficient stock/availability/
reserved (race loser, retryable); 422 step/piece/envelope/sellable/type
violations (business rule); 500 generic only (no SQL, no secrets).
`z.coerce.boolean()` is never used — query booleans accept only exact
`"true"`/`"false"` (`admin-bool-no-coerce-400`).

## 10. Tests

| Suite | Result |
|---|---|
| `scripts/api/t-inventory-unit.mjs` (pure math + boundary, no DB) | 34/34 |
| `scripts/api/t-inventory.mjs` (HTTP on scratch) | 84/84 |
| `scripts/api/t-inventory-concurrency.mjs` (real PG races A–E) | 18/18 |
| BA-1 `t-foundation.mjs` | 26/26 |
| BA-2 `t-catalog.mjs` (scratch) | 53/53 |
| CC-1 `t-cc1-lockout.mjs` (scratch) | 8/8 |
| `t-password.mjs` | 9/9 |
| Phase 2 `db/tests` functional | 77/77 |
| Phase 4 `db/tests` functional | 65/65 |
| Phase 5 `db/tests` functional | 50/50 |
| `tsc --noEmit` / ESLint (new files) / `npm run build` | PASS |

Races: A (PIECE 1×1 → one 201/one 409, reserved `1.000`, zero
movements); B (WEIGHT `1.000` vs `0.750`×2 → winner `reserved=0.750`);
C (`5.000` vs `3`×2 → `reserved=3.000`, never 6); D (double-commit same
line → one 201/one 409, exactly one SALE, `0/0/0`, never negative); E
(opposing two-row batches → no deadlock, single full winner, no partial).
Skipped with reason: 240+120 frozen embedded-PG batteries (frozen SQL
byte-identical and untouched; contended app paths covered by races A–E;
same skip rationale as BA-2) and the CC-1 TZ rerun (auth code untouched).

## 11. Files

- New: `src/lib/inventory/{validation,serialize,queries,service,quantities}.ts`;
  `src/app/api/store/inventory/variants/[id]/route.ts`;
  `src/app/api/store/inventory/products/[id]/route.ts`;
  `src/app/api/admin/inventory/route.ts`;
  `src/app/api/admin/inventory/[variantId]/route.ts`;
  `src/app/api/admin/inventory/{adjust,reserve,release,commit}/route.ts`;
  `src/app/api/admin/inventory/movements/route.ts`;
  `src/app/api/admin/inventory/movements/[id]/route.ts`;
  `scripts/api/{t-inventory,t-inventory-concurrency,t-inventory-unit}.mjs`;
  this doc.
- Modified: none (beyond pre-existing working-tree entries).
- Untouched/protected: `db/*`, `prisma/*` (schema, config, migrations),
  `src/lib/auth/*`, `src/lib/api/*`, `src/lib/catalog/*`, BA-2 routes,
  `docs/AGENT-HANDOFF.md`.

## 12. Deferred / open (unchanged)

- Weighted-barcode price formula — still OPEN (no formula invented).
- R7 max-fulfillable auto-cap — BA-6 policy (BA-3 primitive is strict 409).
- Guest cart TTL / sweeper, API versioning, password-reset routes,
  retention windows — as before.
