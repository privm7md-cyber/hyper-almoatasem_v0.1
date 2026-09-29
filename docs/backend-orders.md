# BA-6 Orders — implementation record

> Backend APIs only. No frontend. No BA-7+. No schema/migration changes.
> All behavior verified on scratch (`hyper_almoatasem_scratch`, reused from
> the BA-5 build); production untouched (every test connection is
> allowlisted to scratch names only; the Next server under test pointed at
> scratch).

## 1. Scope (frozen)

Order creation (reserve-then-commit foundation: creation + reservation),
snapshot reads, unpicked-only cancel, idempotent creation. No
replacements, coupons/promotions, payments, delivery mechanics, OTP/login,
notifications, or barcode formulas. Picking/fulfillment transitions
(PREPARING and beyond) belong to later phases — BA-6 lands new orders at
CONFIRMED and declines picked-state cancels loudly (409, documented).

## 2. Creation flow (one authoritative tx)

Transactionally equivalent to the frozen checkout (§F): lock cart row
(`FOR UPDATE`; ACTIVE else replay path) → validate customer (404/422) +
owned address (404) → revalidate lines against LIVE variants (liveness,
counting unit, live price, step) → lock inventory ASC → atomic conditional
reserves (rowcount, all-or-nothing) → server-read delivery fee →
exact-integer money → `nextval` order number (SQL clock) → INSERT order +
snapshot items + history (`NULL→NEW`, `NEW→CONFIRMED`) → order CONFIRMED
(history-first trigger satisfied in-tx) → cart CHECKED_OUT → COMMIT.
Any failure rolls back everything: no partial order, no leaked
reservation, cart stays ACTIVE.

## 3. Pricing snapshot

- Re-priced from live variant prices at creation; cart subtotal is
  informational and never authoritative.
- Drift (snapshot ≠ live) always rejects with 409 (new terms = new key +
  confirmation — BA-6 offers no confirm flag; cart untouched for retry).
- Snapshotted per item: names, brand, primary code+type (NULL pair when
  none), counting unit, product type, sale step, live unit price,
  requested qty, `ROUND(qty×price,2)` estimate. Customer + full address
  snapshots on the order row. Post-creation catalog edits never move
  history (proven live: price 15→17→15 leaves `30.00`/`190.00` frozen).
- Money: integer thousandths × piastres (BA-5 helpers reused), DB CHECKs
  verify (`estimated_total`, totals); `discount_total = 0` (no promos).
- `delivery_fee` is server-read from `store_settings.delivery.default_fee`
  (the only frozen source; client never supplies money) — corrupt/missing
  fails closed (500, never silent 0).

## 4. Inventory reservation (BA-3 semantics, reused not reinvented)

- READ COMMITTED, ASC lock order, `(quantity − reserved) ≥ qty`
  predicates, 409 losers, no `SERIALIZABLE`/mutex/read-check-write.
- No `held_quantity` anywhere (BA-3-C1 stands); R7 commit predicates
  belong to picking (later phase), not creation.
- Carts never reserve; orders do — reserve rows pair with no movements
  (frozen §J, asserted: movement counts unchanged by creation/cancel).

## 5. State machine (exact frozen names)

`NEW→CONFIRMED|CANCELLED`, `CONFIRMED→PREPARING|CANCELLED`,
`PREPARING→READY_FOR_DELIVERY|CANCELLED`,
`READY_FOR_DELIVERY→OUT_FOR_DELIVERY`, `OUT_FOR_DELIVERY→DELIVERED`,
terminals closed. Pure matrix module (`canTransition`, `isTerminal`,
`canCancelInBa6`) with the DB triggers/CHECKs authoritative. No
`PENDING/PROCESSING/COMPLETED/STOCK_FAILED` invented (unit-guarded).
Cancel = NEW|CONFIRMED (+ unpicked assertion) → release-all-reserved +
`CANCELLED` history row + flip, one tx, zero movements.

## 6. Idempotency (no fingerprint column — none frozen)

Terms-identity = cart identity (immutable post-commit): same key +
same cart → replay 200 (`meta.replay`, no duplicate reservation);
same key + different cart → 409. Same-cart double submit replays via the
cart-CHECKED_OUT guard. Lost INSERT races (23505 incl. P2010-nested) are
caught OUTSIDE the rolled-back tx → reselect → same rule (never a
poisoned tx, never `ON CONFLICT DO NOTHING`).

## 7. Identity & authorization (no OTP/login invented)

- Creation: guest-token cart or customer's ACTIVE cart; ordering
  customer + owned address validated; cart/customer crossover follows the
  frozen double's parameter shape (token proves guest side).
- Reads: `?customerId=` must equal `order.customer_id` (guests use their
  BA-4 customer id — never phone lookup); foreign/unknown → 404.
- Cancel: owner-scoped storefront + admin (`orders.cancel`); reads:
  storefront-owned + admin (`orders.view`). No `customers.manage`, no new
  permission, matrix/seeds untouched. Advance transitions deferred.

## 8. Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/store/orders` | guest token xor customer cart + ids | create (201) / replay (200) |
| GET | `/api/store/orders` | `?customerId=` (own) | list own, newest first |
| GET | `/api/store/orders/[id]` | `?customerId=` (own) | snapshot detail + history |
| POST | `/api/store/orders/[id]/cancel` | `{customerId}` (own) | unpicked cancel |
| GET | `/api/admin/orders` | `orders.view` | list + status/customer/number filters |
| GET | `/api/admin/orders/[id]` | `orders.view` | full detail |
| POST | `/api/admin/orders/[id]/cancel` | `orders.cancel` | staff cancel (same policy) |

## 9. Errors (BA-1 envelopes)

400 malformed/strict-unknown/bad key; 401 anonymous admin; 403 roleless;
404 unknown cart/variant/customer/address/order + foreign ownership;
409 price drift, insufficient stock, key-reuse-across-carts, consumed
cart (replay resolves), double cancel, PREPARING cancel; 422 empty cart,
dead variant, unit/step mismatch, inactive customer; 500 generic only.

## 10. Prisma vs raw SQL

- Prisma: reads, customer/address/cart fetches, tx blocks, P2002→replay
  mapping outside txs.
- Raw SQL only for: cart/inventory/order row locks, conditional reserve/
  release bumps, `nextval`+date, order/item/history INSERTs (snapshot
  columns), guarded status flips, upgrade-style conditional updates.
  Each justified in code comments; `available_quantity` never computed
  in JS; order-number date from SQL (CC-1 rule).

## 11. Tests

| Suite | Result |
|---|---|
| `scripts/api/t-orders-unit.mjs` (matrix, numbers, boundaries) | 16/16 |
| `scripts/api/t-orders.mjs` (HTTP on scratch) | 54/54 |
| `scripts/api/t-orders-concurrency.mjs` (races A–D, real PG) | 15/15 |
| BA-1 `t-foundation.mjs` | 26/26 |
| BA-2 `t-catalog.mjs` (scratch) | 53/53 |
| BA-3 `t-inventory-unit.mjs` | 34/34 |
| BA-3 `t-inventory.mjs` (scratch) | 84/84 |
| BA-3 `t-inventory-concurrency.mjs` | 18/18 |
| BA-4 `t-customers-unit.mjs` | 40/40 |
| BA-4 `t-customers.mjs` (scratch) | 66/66 |
| BA-4 `t-customers-concurrency.mjs` | 8/8 |
| BA-5 `t-cart-unit.mjs` | 28/28 |
| BA-5 `t-cart.mjs` (scratch) | 50/50 |
| BA-5 `t-cart-concurrency.mjs` | 13/13 |
| CC-1 `t-cc1-lockout.mjs` (scratch) | 8/8 |
| `t-password.mjs` | 9/9 |
| Phase 2 / 4 / 5 functional | 77/77, 65/65, 50/50 |
| `tsc --noEmit` / ESLint (0 warnings) / `npm run build` | PASS |

Races: A (1 unit × 2 carts → 201+409, reserved 1, no loser row); B
(reversed 2-line orders → no deadlock; tight stock → one complete winner,
no partial); C (same key → one id `{201,200}`, counted once); D (same
cart → one id `{201,200}`, CHECKED_OUT once, counted once).

## 12. Session findings (honest)

- Cart P2010/23505: concurrent create-race losers surfaced as P2010 (raw
  SQL nests PG codes) — fixed in `src/lib/cart/writes.ts` to map nested
  23505 → reselect (same BA-3 lesson); verified over repeated race rounds.
  No frozen/previous-BA semantics changed (convergence behavior only).
- One Phase-2 run hit the harness's own `Math.random()` order-id
  `orders_pkey` collision (pre-existing flake, frozen file untouched) —
  immediate re-run 77/77.
- Back-to-back full-suite runs can exhaust the frozen login rate buckets
  (IP 30 / account 10 per 15-min window) — logins then fail closed with
  generic 401 BY DESIGN; suites were scheduled across the window
  rollover. Workflow note, not a product issue.
- Skipped with reason: 240+120 frozen embedded-PG batteries
  (SQL byte-identical) and CC-1 TZ rerun (auth untouched).

## 13. Files

- New: `src/lib/orders/{state-machine,validation,serialize,queries,writes}.ts`;
  `src/app/api/store/orders/route.ts` (POST/GET);
  `src/app/api/store/orders/[id]/route.ts` (GET);
  `src/app/api/store/orders/[id]/cancel/route.ts` (POST);
  `src/app/api/admin/orders/route.ts` (GET);
  `src/app/api/admin/orders/[id]/route.ts` (GET);
  `src/app/api/admin/orders/[id]/cancel/route.ts` (POST);
  `scripts/api/{t-orders,t-orders-concurrency,t-orders-unit}.mjs`; this doc.
- Modified: `src/lib/cart/writes.ts` (P2010/23505 convergence fix only —
  §12), nothing else outside BA-6 scope.
- Untouched/protected: `db/*`, `prisma/*`, auth/API/BA-1..BA-5 behavior,
  `docs/AGENT-HANDOFF.md`, `docs/release-manifest.md`, all frontend.

## 14. Deferred

Picking/commit (R7), fulfillment transitions, PREPARING-gated cancel,
promotions/coupons, payments, delivery mechanics, OTP/login,
token rotation, TTL numbers, versioning, retention, notifications,
barcode formula — all as before, none invented here.
