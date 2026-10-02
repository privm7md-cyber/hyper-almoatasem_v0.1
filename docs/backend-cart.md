# BA-5 Cart — implementation record

> Backend APIs only. No frontend. No BA-6+. No schema/migration changes.
> All behavior verified on scratch (`hyper_almoatasem_scratch`, reused from
> the BA-4 build); production untouched (every test connection is
> allowlisted to scratch names only; the Next server under test pointed at
> scratch).

## 1. Scope (frozen)

Draft container only. Carts NEVER reserve inventory (no BA-3 call exists
in the cart module — availability is BA-6 checkout's job). No orders,
checkout, replacements, coupons, payments, delivery, OTP, login, or admin
cart endpoints (none are in the frozen contract, so none were invented).

## 2. Identity & ownership XOR

- Exactly one owner kind per cart (DB `CHECK((customer_id IS NULL) <>
  (session_id IS NULL))` + two ACTIVE partial UQs).
- Guest carts: server-minted 256-bit bearer tokens (`x-guest-token`
  header), stored as SHA-256 hex in `session_id` (fits VARCHAR(64) +
  no-spaces CHECK); raw token returned once at creation, never persisted,
  never logged. Rotation-on-login is deferred with customer login itself.
- Customer carts: `customerId` (query/body), customer must exist (404) and
  be active (422). No customer auth exists — identity as-is after BA-4.
- Per-request exactly-one-side rule (both/neither → 400, except POST
  `/cart` with neither side which mints a fresh guest cart).

## 3. Endpoints (all public storefront; no admin surface exists frozen)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/store/cart` | mint guest cart (201 + token) / resolve ACTIVE by token (200) / get-or-create customer cart (200/201) |
| GET | `/api/store/cart` | read ACTIVE cart + lines + informational subtotal |
| POST | `/api/store/cart/items` | add (re-add aggregates at live price) → 200 cart |
| PATCH | `/api/store/cart/items/[variantId]` | set quantity (qty-only; snapshots kept) → 200 / 404 |
| DELETE | `/api/store/cart/items/[variantId]` | remove line → 200 / 404 |
| DELETE | `/api/store/cart/items` | clear all lines (row + ACTIVE status untouched) → 200 |
| POST | `/api/store/cart/merge` | bind guest cart to customer (explicit R1 trigger) → 200 + report |
| POST | `/api/store/cart/reprice` | **BA-C** — server-side reprice + persist: refresh every live snapshot, repoint dead variants, drop unsellable lines → 200 cart + report (see §5.1) |

### 3.1 `POST /api/store/cart/reprice` (added by BA-C)

| Aspect | Behavior |
|---|---|
| Ownership | same XOR as every other cart write: guest cart via `x-guest-token`, or customer cart via body `customerId`. Both → 400; neither → 400; unknown/foreign/expired/consumed → 404 (never resurrected, no existence leak) |
| Body | `{ customerId? }` — **strict**; any other field (`price`, `quantity`, `discountTotal`, `lines`, …) → 400 |
| Effects | one tx under the existing `SELECT … FOR UPDATE` cart lock, lines processed `id ASC`: for each line re-read the live variant price into `unit_price_snapshot` + `price_checked_at = now()`; if the variant (or its product) is now inactive/deleted the line is **dropped** and reported. Quantities are never touched |
| Never | never invents a price, never trusts a client amount, never reserves/releases inventory, never evaluates promotions or coupons, never bumps coupon usage |
| Response | `{ cart, reprice: { repriced: <count>, dropped: [{ lineId, variantId }] } }` in the canonical `{data,meta}` envelope |
| Idempotency | inherently idempotent — a pure function of live catalog state + cart contents; no `Idempotency-Key` |
| Why explicit | repricing is a **persisted** mutation, not a read: it is deliberately NOT folded into `GET /cart` (reads must not write) nor into add/update (quantity edits must not silently change money). Checkout still re-validates and re-prices independently — the cart snapshot is never the checkout authority (§5) |


## 4. Item semantics

- Validation per line: variant exists (404) + variant sellable
  (variant-liveness only, mirroring the frozen checkout/merge doubles —
  product-level gating lives in listings) + counting-unit pin (PIECE →
  `'PIECE'`, WEIGHT → live `size_unit`) + PIECE whole packs + WEIGHT step
  multiples (integer-thousandths, never float) + quantity > 0 (0/negative
  → 400; removal is DELETE only).
- Quote snapshots: `unit_price_snapshot` = live variant price at write
  time, `price_checked_at` = now(). Drift confirmation stays BA-6's job.
- Single-statement line UPSERT (raw SQL `INSERT … ON CONFLICT DO UPDATE`
  — the frozen merge-statement shape). Rationale, both proven live:
  catching a unique violation *inside* an interactive Postgres tx poisons
  the tx, and Prisma Decimal `increment` rejects string decimals.
- Same-cart writers serialize on `SELECT … FOR UPDATE` of the cart row.

## 5. Price & totals

- Cart table stores no totals. Responses carry an INFORMATIONAL subtotal:
  Σ `ROUND(qty × snapshot, 2)` over priced lines, computed in integer
  thousandths × piastres (exact; `src/lib/cart/totals.ts`, unit-tested
  incl. the frozen `0.125 × 333.33 = 41.67` vector). Authoritative money
  is computed at checkout (BA-6).

## 6. Merge (frozen R1, explicit trigger)

The frozen "on login" hook cannot fire while customer login stays
deferred, so the same 9-step merge runs behind POST `/merge` (guest
bearer + customerId) — semantics verbatim from
`db/tests/run-tests.js:mergeGuest`: lock customer ACTIVE cart (if any) +
guest cart ASC → guest must be ACTIVE + customer-less (unknown token →
404; consumed → 409) → no customer cart: reassign (`customer_id` set,
`session_id`/`expires_at` nulled, stays ACTIVE) → else per-line
sum + live reprice with dead-variant (inactive/deleted) drops reported,
guest → MERGED, lines retained on the merged cart as record. Summed
quantities preserve step validity arithmetically (sums of multiples).

## 7. Inventory relationship

None by design: cart mutations never call reserve/commit, never read
inventory. Asserted live (`add-no-inventory-touch`: reserved stays
`0.000`).

## 8. Idempotency

No `Idempotency-Key`: frozen idempotency attaches to order creation
(BA-6). Cart operations converge naturally (creation reselected,
add aggregated, merge guarded) — documented, nothing invented.

## 9. Concurrency (real PG, READ COMMITTED, never SERIALIZABLE)

- A: concurrent creates (one customer) → one ACTIVE cart, `{201,200}`.
- B: concurrent adds (same variant, 2+3) → one line `5.000`.
- C: concurrent set-qty (3 vs 5) → one valid line (LWW, documented).
- D: remove vs set-qty → consistent end state, no 500s.
- E: concurrent merges → one 200 + one 409, lines materialized once.
- F: distinct guests → distinct carts/tokens.

## 10. Errors (BA-1 envelopes)

400 malformed/strict-unknown/coerced/both-or-neither owner/bad token
shape; 404 unknown cart/variant/line/customer/token; 409 consumed guest
cart on merge; 422 inactive variant/customer, step/pack violations;
500 generic only. No `z.coerce.*` anywhere.

## 11. Permission handling

No admin cart endpoints exist frozen → none built → **no permission
mapping needed and none invented**. `customers.manage` does not exist
and was not created; the RBAC matrix and seeds are untouched. Customer
identity is consumed as-is (BA-4 canonical phones/ids; no OTP/login/
session invented).

## 12. Prisma vs raw SQL

- Prisma: reads, creates, deletes, scoped updates, tx blocks, P2002 →
  convergence (create races) / P2025 → 404.
- Raw SQL only for: cart-row `FOR UPDATE` locks, guest-expiry
  `now() + INTERVAL '30 days'` (SQL clock), conditional customer-cart
  INSERT, line UPSERT, merge upserts + status flips (atomicity +
  insert-vs-sum reporting). Each justified in code comments.

## 13. Tests

| Suite | Result |
|---|---|
| `scripts/api/t-cart-unit.mjs` (math/tokens/owner/schemas, no DB) | 28/28 |
| `scripts/api/t-cart.mjs` (HTTP on scratch) | 50/50 |
| `scripts/api/t-cart-concurrency.mjs` (races A–F, real PG) | 13/13 |
| BA-1 `t-foundation.mjs` | 26/26 |
| BA-2 `t-catalog.mjs` (scratch) | 53/53 |
| BA-3 `t-inventory-unit.mjs` | 34/34 |
| BA-3 `t-inventory.mjs` (scratch) | 84/84 |
| BA-3 `t-inventory-concurrency.mjs` | 18/18 |
| BA-4 `t-customers-unit.mjs` | 40/40 |
| BA-4 `t-customers.mjs` (scratch) | 66/66 |
| BA-4 `t-customers-concurrency.mjs` | 8/8 |
| CC-1 `t-cc1-lockout.mjs` (scratch) | 8/8 |
| `t-password.mjs` | 9/9 |
| Phase 2 functional | 77/77 |
| Phase 4 functional | 65/65 |
| Phase 5 functional | 50/50 |
| `tsc --noEmit` / ESLint (new files, 0 warnings) / `npm run build` | PASS |

Notes: one Phase-2 run hit the harness's own `Math.random()` order-id
`orders_pkey` collision (pre-existing flake in `db/tests/run-tests.js`,
untouched frozen file) — immediate re-run 77/77. Two implementation bugs
found by the suites and fixed in-module (single-statement UPSERTs;
in-tx catch poisoning) — no frozen/previous-BA file touched. Skipped
with reason: 240+120 frozen embedded-PG batteries (SQL byte-identical)
and CC-1 TZ rerun (auth untouched).

## 14. Files

- New: `src/lib/cart/{totals,session,validation,serialize,queries,writes,owner}.ts`;
  `src/app/api/store/cart/route.ts` (POST/GET);
  `src/app/api/store/cart/items/route.ts` (POST/DELETE);
  `src/app/api/store/cart/items/[variantId]/route.ts` (PATCH/DELETE);
  `src/app/api/store/cart/merge/route.ts` (POST);
  `scripts/api/{t-cart,t-cart-concurrency,t-cart-unit}.mjs`; this doc.
- Modified: none (beyond pre-existing working-tree entries).
- Untouched/protected: `db/*`, `prisma/*`, auth/API/BA-1..BA-4 code,
  `docs/AGENT-HANDOFF.md`, `docs/release-manifest.md`, all frontend.

## 15. Deferred / open (unchanged + cart-specific)

- Exact guest TTL number + sweeper cadence (config; `+30d` used as the
  documented default), ABANDONED/EXPIRED transitions (no sweeper in BA-5).
- Token rotation on login (waits on customer login).
- Customer self-service auth/OTP, `customers.manage`, barcode formula,
  R7 auto-cap, versioning — as before.
