# PHASE 2 — IMPLEMENTATION NOTES

> What was built, what was pinned during implementation, and what remains limited.
> No architectural rule was changed. Two implementation-level precisions were pinned
> (counting-unit semantics; EXISTS audit trigger) — both inside the approved contracts.

## Migrations (raw SQL, ordered — repo convention)

| # | File | Purpose |
|---|---|---|
| 1 | `db/phase1-schema.sql` | (frozen, untouched) catalog + inventory + ledgers |
| 2 | `db/phase1-seed-example.sql` | (frozen, untouched) catalog fixtures incl. Romi KG + Pepsi variants |
| 3 | `db/phase2-schema.sql` | **NEW** — 8 tables + `order_number_seq` + 4 transition/audit trigger functions |
| 4 | `db/phase2-seed-example.sql` | **NEW** — 1 guest + 1 registered customer, 3 addresses, 1 ACTIVE guest cart + 2 lines |

Apply strictly in order; `phase2-schema.sql` requires Phase 1's `set_updated_at()`.

## Implementation notes (no arch change)

1. **Counting-unit pin (`unit_snapshot`).** For PIECE lines the stored counting unit is
   `'PIECE'` (packs), validated at checkout against live `product_type` (not `size_unit`);
   for WEIGHT lines it is the live `size_unit`, validated by equality. Rationale: quantity
   `2` on a `330 ML` variant means 2 packs — storing `'ML'` would misread as milliliters.
   The column CHECK domain already permits both; no contract changed. Operational corollary
   (not DB-enforced): never mutate `size_value/size_unit` on a live variant — create a new
   variant; history renders from `variant_name_snapshot` regardless.
2. **Audit trigger uses EXISTS, not latest-row.** `check_order_status_audited()` proves a
   matching history row EXISTS for the new status. Rationale: rows in one tx share `now()`
   timestamps, so latest-row detection is unreliable intra-tx; the transition CHECK on the
   history row already proves the step legal. Corollary for future readers: never order
   same-tx history by `created_at` alone.
3. **Failed-checkout carts stay ACTIVE by design.** A rolled-back checkout writes nothing —
   the cart keeps its lines for the next attempt. Retire via sweeper (ABANDONED/EXPIRED) or
   reuse; the suite retires such carts explicitly between scenarios.
4. **Grants/roles intentionally absent.** Append-only tables (`order_status_history`, Phase 1
   ledgers) rely on convention + review until roles exist (same posture as Phase 1).
5. **Checkout/confirm/merge/pick/approve flows in `db/tests/run-tests.js` are TEST DOUBLES**
   encoding frozen rules R1–R10 for verification — not product backend code.

## Test results

* Engine: real PostgreSQL 18.3 via PGlite (shipped SQL targets PG 15+; every construct
  used exists since PG ≤ 15; `uuidv7()` builtin deliberately uncalled).
* `db/tests`: `npm install && npm test` → **77 passed, 0 failed** (exit 0), verified from repo path.
* Coverage: §28 full list (customer/address/cart/checkout/weighted/replacement) + §29
  invariant battery (V1–V7). Test-only shims: pgcrypto line neutralised in-memory + stub
  `gen_random_uuid()` (explicit UUIDs everywhere; stub never fires). Shipped bytes untouched.

## Concurrency gate — CLOSED (two-session verification, real PostgreSQL 18.4)

* Harness: `db/tests/run-concurrency.js` (+ `overlap-probe.js`), embedded PostgreSQL,
  two independent sessions per race, READ COMMITTED (verified default, set per tx —
  no isolation change), shipped files loaded pristine (pgcrypto present, zero shims).
* S1 unit race ×100 (locked §F path): exactly 1 winner/iter, `reserved=1.000`, no movements on reserve.
* S1b naked conditional-UPDATE race ×25: exactly 1 winner/iter — the UPDATE itself is the atomic guard.
* S2 weighted race ×25 (0.600+0.600 on 1.000 KG): exactly 1 winner/iter, `reserved=0.600`.
* S3 same-idempotency-key race ×25: exactly 1 logical order (UQ backstop + replay path).
* S4 same-cart race ×25: exactly 1 order, cart CHECKED_OUT once (loser replays).
* S5 double-approve race ×20: 1 materialization, substitute held exactly once.
* S5b double-propose race ×20: exactly 1 live PROPOSED (partial UQ holds).
* Overlap proof: reservation-point latch forces both workers to the contended statement
  (a non-overlapping run would deadlock, not pass); asserted explicitly 10/10
  (dual latch arrival AND loser.begin < winner.commit).
* Invariants held in every iteration: `quantity = available + reserved`, all ≥ 0,
  no reserve-created movements, no double orders.
* Total: **240 contended iterations, zero oversells.**

## Known limitations (honest, no workaround invented)

* **L1 — RETIRED by the gate above.** (Was: single-connection engine limit.)
* **L2 — phone normalization lives app-side** (R8 reference implementation in harness).
  DB constrains shape (`^[0-9]{8,15}$`) + uniqueness on the stored canonical; the invariant
  "every stored value is canonical" depends on the single normalizing writer path.
* **L3 — `price_difference` has no cross-row CHECK** (inexpressible in-row); service must
  compute-and-verify, covered by V3 reconciliation pattern (SUM over effective lines).
* **L4 — PGlite has no `pgcrypto`**; production PG 15+ provides it (backstop default).
  When the fleet is PG 18+, DEFAULTs may switch to `uuidv7()` with zero migration.
