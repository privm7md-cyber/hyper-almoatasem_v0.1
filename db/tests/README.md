# Phase 2 — database test harness

Runs the shipped SQL files (`db/phase1-schema.sql`, `db/phase1-seed-example.sql`,
`db/phase2-schema.sql`, `db/phase2-seed-example.sql`) against **real PostgreSQL**
(PGlite embed, currently PG 18) and executes ~77 database-level tests covering:

* customers (phone normalization/identity, guest vs registered, email, soft-delete)
* addresses (single default, hard-delete, snapshot independence)
* carts (XOR ownership, single-ACTIVE, line uniqueness, unit safety, price drift)
* checkout (success, drift, insufficient stock, oversell, idempotency/replay)
* weighted fulfillment R7 (under / exact / tolerance-over / out-of-tolerance /
  stock-shortage cap / PIECE tolerance 0 / rounding)
* replacements R10 (propose → approve → materialize, failure rollback, reject,
  withdrawal, transition guards)
* transitions + audit trigger (illegal order/item/cart/replacement transitions,
  history-first status updates)
* guest-cart merge (reassign + sum paths, dead-variant drop)
* §29 invariant battery (inventory identity, money, no double-count, ownership, idempotency)

## Run

```text
cd db/tests
npm install
npm test
```

Expected: `RESULT: 77 passed, 0 failed` (exit code 0).

## Concurrency gate (two independent PostgreSQL sessions)

`run-concurrency.js` (+ `overlap-probe.js`) boots **real PostgreSQL** via
`embedded-postgres` (needs a non-admin OS user — PostgreSQL refuses to run as
administrator; see gate header comments) and runs genuine overlapping transactions
(entry barrier + reservation-point latch, READ COMMITTED, no isolation change):

* S1 unit race ×100 (locked §F path): 1 winner/iter, `reserved=1.000`, invariants hold
* S1b naked conditional-UPDATE race ×25: 1 winner/iter (UPDATE itself is the guard)
* S2 weighted race ×25 (0.6+0.6 on 1.000 KG): 1 winner/iter, `reserved=0.600`
* S3 same-idempotency-key race ×25: exactly 1 logical order (UQ backstop + replay)
* S4 same-cart race ×25: exactly 1 order, cart CHECKED_OUT once
* S5 double-approve race ×20: 1 materialization, substitute held once
* S5b double-propose race ×20: exactly 1 live PROPOSED (partial UQ holds)
* `overlap-probe.js` ×10: asserts dual latch arrival AND loser.begin < winner.commit

```text
npm run test:concurrency
```

Result recorded: **215 contended iterations, zero oversells, all invariants held.**
Note: the gate's per-iteration overlap counter in early output revisions undercounted
(it required both sides to commit); overlap is proven structurally by the reservation
latch (a run that did not overlap in any iteration would deadlock, not pass) and
asserted explicitly 10/10 by `overlap-probe.js`.

## Environment notes (read before interpreting results)

* **Target is PostgreSQL 15+**; the harness runs PGlite (PG 18 WASM). All SQL used
  exists since PG ≤ 15 except the `uuidv7()` builtin, which the shipped schema
  deliberately does **not** call (backstop is `gen_random_uuid()`).
* **pgcrypto shim (test-only, never shipped):** PGlite bundles no contrib modules,
  so the harness neutralises the shipped `CREATE EXTENSION pgcrypto` line
  **in memory only** and defines a stub `gen_random_uuid()` for DDL parsing.
  Every test sends explicit UUIDs, so the stub never fires. Shipped file bytes are untouched.
* **True multi-session concurrency** (two simultaneous checkouts) cannot run on the
  single-connection embedded engine; the suite verifies the mechanism instead
  (conditional atomic reserve + rowcount, idempotency UQ, partial-UQ guards,
  deterministic lock order in the reference transactions) plus a sequential
  oversell test (150 reserved OK, +1 fails). Re-run on multi-connection
  staging PG for the two-plunger test before go-live.
