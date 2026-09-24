# PHASE 4 — IMPLEMENTATION NOTES

> What was built, what was pinned during implementation, and one genuine conflict
> requiring a decision (see §CONFLICT). No frozen (Phase 1/2) file was modified.

## Migrations (raw SQL, ordered — repo convention)

| # | File | Purpose |
|---|---|---|
| 5 | `db/phase4-schema.sql` | **NEW** — 7 tables + gated CHECKs + indexes + updated_at triggers (reuses frozen `set_updated_at()`) |
| 6 | `db/phase4-seed-example.sql` | **NEW** — 13 promos (percent/fixed/BXGY/fixed-price/weighted/scheduled) + 3 coupons |
| — | `db/tests/run-phase4-tests.js` | **NEW** — 64-test functional suite (PGlite, real PG) |
| — | `db/tests/run-phase4-concurrency.js` | **NEW** — 120-race two-session gate (embedded PG 18.4) |
| — | `db/tests/README-phase4.md` | **NEW** — how to run + environment notes |

Apply strictly in order after files 1–4; `phase4-schema.sql` requires Phase 1/2 objects.

## Implementation pins (inside approved contracts, no arch change)

1. **ALLOCATION rows carry no applied values** (found via failing test, fixed in DDL):
   `chk_od_applied_shape` exempts `kind='ALLOCATION'` (and forces its applied/cap NULL).
   The parent application row owns the snapshot — single source, no duplication.
2. **Counting-unit validation for PIECE lines** (`'PIECE'` = packs vs live `product_type`,
   not `size_unit`) — same pin as Phase 2 notes §1, applied to promo eligibility math.
3. **Cross-variant BXGY wires as**: no buy-line discount + dedicated free order line
   (live price snapshot, full/partial discount row) + `discount_total` absorbing the free
   application in the same tx. Same-variant BXGY discounts the buy line in place.
4. **Auto-promo exhaustion at checkout = SKIP** (proceed undiscounted); **coupon
   exhaustion/limit = FAIL** the checkout. Rationale: a presented code is an explicit
   customer expectation; an automatic benefit is not. (Concurrency suite §C proves both.)
5. **Coupon own-window validated alongside parent-effective** (a test caught the harness
   double skipping `coupons.start_at/end_at`; DDL already had the columns).
6. Test-only shims (never shipped): PGlite `pgcrypto` line neutralised in-memory +
   stub `gen_random_uuid()` (explicit UUIDs everywhere); embedded-PG runs pristine files.
   Non-admin OS user required (PostgreSQL refuses administrator); slow-disk checkpoints
   affect wall-clock only, never semantics.

## Test results

* Functional: **63/64 PASS** (PGlite, real PG). The single failure is the §CONFLICT
  reproducer below — everything else green, including all §40 categories and the §42
  invariant battery (V-INV/V-DISC/V-COUPON/V-PROMO/V-TOT/V-MIR/V-BASE).
* Concurrency: **120/120 PASS** — A global coupon limit ×20 · B per-customer
  double-submit ×20 · C promo limit ×20 · D same-key ×20 · E same-cart ×20 ·
  F BXGY + limited stock ×20. Single-winner/no-overshoot every iteration,
  inventory + counter + allocation invariants held, READ COMMITTED unchanged.

## §CONFLICT — `orders.discount_total` at finalize (RESOLVED per approved decision)

Reproduction (was deterministic `WEIGHTED final` failure, now passing):
checkout writes `discount_total = 16.00` / `total_estimated = 144.00`; finalize recomputes
`0.475 KG → gross 152.00, discount 15.20` into detailed rows only. Frozen
`chk_orders_total_estimated` (`160 − 15.20 + 0 = 144.80 ≠ 144.00`) is never violated because
`discount_total` is no longer rewritten — it remains the checkout-agreed estimate; final
truth lives in `order_discounts.discount_final` + item mirrors + `usages.final` +
`subtotal_final`/`total_final` (latter via the frozen formula with frozen discount).
Two meanings documented in architecture (checkout snapshot vs final allocation) with a
deterministic reconciliation test (16.00 − 15.20 = 0.80 from qty delta; Σ mirrors = Σ finals).

## Known limitations

* L1 — two-plunger wall-clock on slow disks (see above); semantics unaffected.
* L2 — promotion `value/target/rule` immutability once referenced, `applied_shape`
  cross-row rules (no nesting), and reconciliation queries remain writer-discipline +
  review (inexpressible same-row; same posture as frozen `price_difference`).
* L3 — PGlite has no `pgcrypto`; production PG 15+ provides it. PG 18+ fleets may
  switch DEFAULTs to `uuidv7()` with zero migration.
