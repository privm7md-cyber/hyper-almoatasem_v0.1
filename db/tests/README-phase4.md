# Phase 4 — database test harness

## Functional suite (embedded-engine compatible)

```text
cd db/tests
npm install
npm test            # run-phase4-tests.js on PGlite (real PostgreSQL, single connection)
```

`run-phase4-tests.js` loads the shipped files **byte-identical**
(`phase1-schema → phase1-seed → phase2-schema → phase2-seed → phase4-schema → phase4-seed`;
only the Phase 1 `CREATE EXTENSION pgcrypto` line is neutralised in-memory plus a stub
`gen_random_uuid()`, because PGlite bundles no contrib modules — every test sends explicit
UUIDs so the stub never fires) and executes the §40/§42 matrix:

* promotion CRUD CHECKs (type/scope/value gating, percent bounds, windows, 1:1 rules,
  target uniqueness, code normalization)
* targeting (variant/product/brand/category/subtree/OR/specificity)
* percentage (incl. decimals, cap with ordered accumulation, line rounding)
* fixed amount (per-line cap, no negatives) · fixed price (below/equal/above base, per-KG)
* BXGY (2+1, 3+1@50%, same/cross-variant, weighted, partials, floor multiples)
* stacking (exclusive, sequential compounding, priority, specificity)
* coupons (valid/minimum/disabled/expired/before-start/per-customer/global-limit/
  dup-order-usage/parent-disabled/normalization)
* weighted (estimate + finalize recompute from row snapshots, rounding)
* order (application/allocation rows, mirrors, discount_total balance, est-vs-final)
* inventory (taken-qty reserves incl. free units, no over-reserve)
* idempotency (UNIQUE key backstop)
* invariant battery (inventory identity, discount bounds, counter caps,
  discount_total = Σ applications, mirror = Σ line rows, base prices untouched)

The promotion *evaluation* inside the harness is a TEST DOUBLE of the frozen rules
(R1–R10, Appendix R/R2) — not product backend code.

## Concurrency gate (real multi-session PostgreSQL)

```text
npm run test:concurrency   # run-phase4-concurrency.js via embedded-postgres
```

Needs a **non-admin OS user** (PostgreSQL refuses to run as administrator).
Spins up real PostgreSQL 18, loads shipped files **pristine** (pgcrypto present,
zero shims), and races two independent sessions with barrier-forced contention
(READ COMMITTED, no isolation change):

* A global coupon limit ×20 · B per-customer double-submit ×20 ·
  C promo limit ×20 (exhaustion skips, never fails/overshoots) ·
  D same-idempotency-key ×20 · E same-cart ×20 · F BXGY + limited stock ×20.

Recorded result: **120/120 single-winner / no-overshoot, all invariants held.**

## Environment notes

* Target is PostgreSQL 15+; every construct used exists since PG ≤ 15
  (`uuidv7()` builtin deliberately uncalled — backstop is `gen_random_uuid()`).
* On slow disks, embedded-server checkpoints can stall wall-clock time;
  this affects test duration only, never transaction semantics.
