# PHASE 2 — ARCHITECTURE PROPOSAL (CUSTOMERS + CART + ORDERS)

> Status: APPROVED FOR IMPLEMENTATION (4-point gate R7–R10 applied in Appendix R2).
> Design only. Phase 1 FROZEN, untouched — zero Phase 1 modifications (conflict analysis §1: none).
> Conventions inherited: UUID PKs (app v7, `gen_random_uuid()` backstop), `NUMERIC(10,2)` money,
> `NUMERIC(12,3)` quantities, soft-delete pattern, append-only ledgers, RESTRICT-by-default FKs.

## §1. Phase 1 conflict analysis — NONE

Reservation touches `reserved_quantity` only; the frozen ledger tracks on-hand `quantity`
(`new = previous + quantity`), so reservation/release correctly create **zero** movement rows —
by design. Reservation audit lives in `order_status_history` (every reserve/release is caused by
exactly one order event). Existing movement types cover commit (`SALE`), post-commit restock
(`CANCELLED_ORDER`), returns (`RETURN`, later-phase mechanics), re-weigh corrections (`ADJUSTMENT`),
picking damage (`WASTE`). `reference_type='ORDER'` already exists. RESTRICT FKs compose with snapshots.

## A. Architecture Decisions

| # | Decision | Approach | Why (rejected alternative) |
|---|---|---|---|
| 1 | Customer identity | Phone = identity; globally UNIQUE normalized (`2010…`) | Delivery runs on phone; prevents guest fragmentation (per-registered-only UQ rejected) |
| 2 | Guest model | Unified row, `is_registered=FALSE`, `password_hash=NULL` | Upgrade = UPDATE, history never splits (separate guests table rejected) |
| 3 | Registered rule | `is_registered ⇒ password_hash NOT NULL` (CHECK); email optional + partial UQ | Phone+password suffices; mandatory email rejected |
| 4 | Password placement | Nullable column on `customers` | Split to credentials table only if MFA ever lands (separate auth tables now rejected) |
| 5 | Addresses | Owner book, hard-deletable (no `deleted_at`); orders use snapshots only | History protected by snapshots, DELETE safe |
| 6 | Default address | Partial UQ `(customer_id) WHERE is_default`; switch in one tx | DB-enforced single default (app-only rejected: raceable) |
| 7 | Cart reservation | Cart NEVER reserves inventory; stock touched only in checkout tx | Reserve-on-add rejected: oversell + stale holds |
| 8 | Active cart | Partial UQs: one ACTIVE per customer, one per session | Deterministic lookup/merge/double-checkout detection |
| 9 | Cart lines | `UQ(cart_id, product_variant_id)`; re-add aggregates | Idempotent adds (row-per-add rejected) |
| 10 | Cart price | `unit_price_snapshot` (quote, display only) + `price_checked_at`; checkout re-fetches live, drift needs confirmation | Cart price is a quote, never a promise |
| 11 | Cart unit safety | `unit_snapshot` NOT NULL (COUNTING unit: `PIECE`=packs for PIECE lines, `size_unit` for WEIGHT); mismatch aborts item at checkout | Prevents silent reinterpretation (e.g. pack-count read as weight) |
| 12 | Quantity semantics | Always in variant's own counting unit: packs (PIECE) / unit-fractions (WEIGHT). One formula: `line = ROUND(qty × price, 2)` | Single meaning cart/inventory/order (GRAM-normalization rejected) |
| 13 | Pricing basis | PIECE = per pack; WEIGHT loose = per 1 sale unit; derivable from snapshotted `product_type` — no column | Uniform formula (extra basis column rejected: derivable) |
| 14 | Checkout atomicity | ONE tx: lock cart → lock inventory ASC → revalidate → reserve → insert order+items+history → CHECKED_OUT → COMMIT | No reservation without order, no order without reservation (split tx rejected) |
| 15 | Idempotency | Client key + `UNIQUE(orders.idempotency_key)` + cart-status guard; retry returns existing order | Key-on-cart rejected (legit re-checkout needs new key) |
| 16 | Order number | `HM-YYYYMMDD-######` from one sequence + app format; gaps OK | Readable, contention-free (daily sequences/counter table rejected) |
| 17 | No derived timestamps | No `confirmed_at/...` columns — derived from history | Denormalization rejected (REVIEW-02 principle) |
| 18 | No `payment_status` | Omitted entirely — payments phase owns it | Placeholder enum rejected (undefined domain, cross-domain writes) |
| 19 | Address snapshot | Option B: dedicated `delivery_*` columns on `orders` | Typed, queryable (JSONB untyped; snapshot-table overkill) |
| 20 | Snapshot scope | Names, brand, code+type, unit, product_type, sale_step, unit_price. NOT category/cost/flags | Snapshot iff renders history, feeds money, or interprets values |
| 21 | Requested vs actual | Both stored; `estimated = ROUND(req×price,2)` + `final = ROUND(actual×price,2)` via DB CHECKs; PIECE actual at pack-confirm | Estimate-only rejected (financially incomplete) |
| 22 | Replacement shape | New `order_item` linked by record; original → REPLACED, excluded from finals | In-place swap rejected (destroys history — forbidden) |
| 23 | Approval | Explicit customer decision; pre-consent → AUTO_ACCEPTED only | Silent auto-substitution rejected |
| 24 | Totals integrity | Same-row arithmetic CHECKs (`total = subtotal − discount + delivery`; final with `LEAST` cap); all ≥ 0 | App-only math rejected |
| 25 | Actor audit | `actor_type + actor_id` + pairing CHECKs; proposer + decider separately | Bare UUID rejected (system vs human indistinguishable) |
| 26 | Transitions | DB-enforced allowed-pair CHECKs/triggers (incl. creation pair) | App-only machine rejected (every bypass corrupts) |
| 27 | Corrections | PREPARING-only + mandatory `ADJUSTMENT` movement for delta (existing type) | Silent UPDATE rejected; extra audit table rejected |
| 28 | Cancel windows | NEW / CONFIRMED / unpicked-PREPARING; post-READY = return flow | Cancel-anytime rejected (contradicts commit) |
| 29 | Merge | Sum same-variant + live reprice; dead lines dropped + reported; guest → MERGED | Keep-guest-price rejected (stale quote ≠ promise) |
| 30 | No Phase 1 changes | Zero modifications (this §1) | Boundary respected |

## B. Final Tables (conceptual)

**`customers`**: id, first_name NOT NULL, last_name NULL, phone UQ normalized (`^[0-9]{8,15}$`),
email NULL (partial UQ + format), password_hash NULL (CHECK registered⇒present), is_registered F,
auto_accept_replacements F, is_active T, created/updated, deleted_at NULL (deleted⇒!active).
**`customer_addresses`**: id, customer_id RESTRICT, label NULL, city NOT NULL (NO governorate),
area/village/street/building/landmark NULL, phone NOT NULL, is_default F (partial UQ per customer),
created/updated. Hard-deletable.
**`carts`**: id, customer_id NULL / session_id NULL (XOR CHECK — R1), status
(ACTIVE, CHECKED_OUT, ABANDONED, EXPIRED, MERGED), expires_at NULL, created/updated;
partial UQs one-ACTIVE per customer and per session.
**`cart_items`**: id, cart_id CASCADE, product_variant_id RESTRICT, quantity (12,3) >0,
unit_snapshot NOT NULL (counting unit), unit_price_snapshot NULL ≥0, price_checked_at NULL,
created/updated, UQ(cart_id, product_variant_id).
**`orders`**: id, order_number UQ `HM-YYYYMMDD-######`, customer_id RESTRICT, cart_id NULL SET NULL,
idempotency_key NULL UQ, status 7-state, subtotal_estimated/discount_total/delivery_fee/total_estimated
(all ≥0; discount ≤ subtotal; total = sub − disc + fee CHECKs), subtotal_final/total_final NULL
(≥0; total_final NULL OR = subtotal_final − LEAST(discount, subtotal_final) + fee),
customer_name/phone snapshots NOT NULL, delivery_city NOT NULL + area/village/street/building/landmark
NULL + delivery_phone NOT NULL (Option B), notes NULL, created/updated. NO status timestamps, NO payment_status.
**`order_items`**: id, order_id RESTRICT, product_variant_id RESTRICT, product/variant name snapshots,
brand NULL, code+type NULL (pair CHECK), unit/product_type/sale_step snapshots (step mirror rule),
unit_price frozen ≥0, requested >0, actual NULL (>0; PREPARING-only writes),
estimated_total = ROUND(req×price,2) CHECK, final_total NULL (= ROUND(actual×price,2) CHECK),
discount_amount 0..estimated, item_status 6-state + pairing CHECKs
(PENDING⇒actual NULL; FULFILLED⇒actual NOT NULL; PARTIAL⇒actual NOT NULL AND ≠ requested).
**`order_status_history`**: append-only; order_id RESTRICT; old NULL (creation) / new NOT NULL;
actor_type (SYSTEM|CUSTOMER|STAFF) + actor_id (pairing CHECK); note NULL; created_at only;
transition-whitelist CHECK incl. `(NULL,'NEW')`.
**`order_item_replacements`**: order_item_id RESTRICT (original, never edited), replacement_variant_id
RESTRICT, replacement_quantity >0, replacement_unit_price frozen, price_difference signed (no cross-row
CHECK possible — service-computed), reason NULL, status (PROPOSED, CUSTOMER_APPROVED, CUSTOMER_REJECTED,
AUTO_ACCEPTED), proposer type/id, decider type/id NULL-till-decided, replacement_order_item_id NULL
(filled on approval); partial UQ one-PROPOSED per line.
NOT created: guests, cart_history, snapshot-table, payments/delivery/staff/auth tables.

## C. Relationships

customers→addresses/carts/orders (RESTRICT); carts→items (**CASCADE**); carts→orders (SET NULL);
variants→cart_items/items/replacements (RESTRICT); orders→items/history (RESTRICT);
items→replacements (RESTRICT); items→items (materialization link).

## D. ERD — `docs/phase2-erd.mmd`

CUSTOMERS ||--o{ ADDRESSES / CARTS / ORDERS; CARTS ||--o{ CART_ITEMS; VARIANTS ||--o{ CART_ITEMS,
ORDER_ITEMS, REPLACEMENTS(substitute); CARTS ||--o{ ORDERS (SET NULL); ORDERS ||--o{ ORDER_ITEMS,
STATUS_HISTORY; ITEMS ||--o{ REPLACEMENTS; ITEMS ||--o{ ITEMS (materialized_as).

## E–N (condensed; full text in the approval record)

**E. Cart**: ACTIVE→CHECKED_OUT (in-tx) / ABANDONED (sweeper, no side effects) / EXPIRED (guest TTL,
terminal) / MERGED (login consume, kept). Never reused.
**F. Checkout (ONE tx, READ COMMITTED + row locks)**: key → BEGIN → lock cart (ACTIVE else replay) →
idempotency pre-check → validate customer/address → lock inventory ASC → revalidate active/unit/price/step
→ atomic reserve (rowcount) → INSERT order+items+history(NULL→NEW) → cart CHECKED_OUT → COMMIT; else ROLLBACK.
Price drift = new terms = new key + confirmation.
**G. Order machine**: NEW→CONFIRMED→PREPARING→READY→OUT→DELIVERED; NEW|CONFIRMED|unpicked-PREPARING→CANCELLED;
terminal DELIVERED/CANCELLED. READY needs zero PENDING-pickable AND zero PROPOSED (R2). Items:
PENDING→FULFILLED|PARTIALLY|UNAVAILABLE|REPLACED|CANCELLED + UNAVAILABLE→REPLACED.
Timestamps derived (`MIN(created_at)` per status).
**H. Weight**: requested→reserved (no movement)→picked→committed (`q−=actual, r−=requested`, free+hold
recheck, SALE(actual))→finals when all terminal. 500→475 / 500→500 / tolerance-over / capped-short per R7.
**I. Replacement**: UNAVAILABLE→PROPOSED (original hold released, substitute reserved AT APPROVAL)→
APPROVED (new line + link, original REPLACED, totals recompute) / REJECTED (partial path) /
AUTO_ACCEPTED (pre-consent, SYSTEM actor). Sequential re-proposals preserved.
**J. Inventory**: reserve/release = reserved-only, no movements (audit = order history); commit =
q+r decrement + SALE; corrections = ADJUSTMENT (PREPARING-only); post-commit cancel restock =
CANCELLED_ORDER; post-delivery = RETURN (later mechanics). No new movement types.
**K. Concurrency**: conditional atomic reserve on ASC-locked rows (READ COMMITTED suffices — guards are
row-local); idempotency UQ + cart guard; merge/checkout serialize on cart locks.
Proven by the two-session gate: 215 contended iterations, zero oversells (see implementation notes).
**L. History**: invoices read order tables ONLY (zero live-catalog JOINs); RESTRICT + permanence +
append-only + transition CHECKs make catalog edits inert.
**M. Risks**: CRITICAL none; HIGH H1 tx-width contention (lock order, lean tx), H2 single-writer discipline
for CHECK-balanced totals; MEDIUM tolerance config, price_difference service-computed, actor_id sans FK;
LOW shared-phone edge, number gaps, sweeper windows, GRAM-basis rarity.
**N. Boundary**: only the 8 tables. No payments/delivery/auth/frontend/APIs/Prisma/SQL-beyond-schema.

## Appendix R — 6-point review amendments (R1–R6, binding)

- **R1 (cart XOR, HIGH)**: `CHECK((customer_id IS NULL) <> (session_id IS NULL))`; merge NULLs losing key
  same-tx; 9-step binding merge (detect guest cart → resolve customer → reassign if no customer cart else
  per-line sum + live reprice, dead lines dropped + reported → guest MERGED; carts locked ASC; checkout
  serializes on same locks). Sessions: ≥128-bit server-random opaque, stored hashed, rotated on login,
  server-side expiry, cart-lines scope only.
- **R2 (READY gate, HIGH)**: READY needs zero PENDING-pickable AND zero PROPOSED; live-proposal lines
  excluded from picking; OOS-proposal flips original to UNAVAILABLE same-tx; swap-proposal freezes PENDING
  line; approvals `UNAVAILABLE→REPLACED` / `PENDING→REPLACED`.
- **R3 (commit predicate, MEDIUM)**: `quantity −= actual; reserved −= requested` banned unless
  `(quantity − reserved + requested_held) ≥ actual` holds atomically (rowcount-checked). Detail in R7.
- **R4 (phone canonical, MEDIUM)**: `2010XXXXXXXX` ladder (strip → 00-drop → 0→20 → bare-1 gets 20 → else
  reject); upgrade structurally single-row via phone UQ; shared phone accepted. Full vectors in R8.
- **R5 (proposal states, LOW)**: no new states; withdrawal = REJECTED with STAFF/SYSTEM actor + note;
  pre-consent covers SPEND with rel+abs caps (defaults 10% / 50 EGP), else explicit approval.
- **R6 (payment boundary, LOW)**: omission correct; single-currency EGP pinned; payments consumes
  id/number/key/frozen prices/estimate-vs-final/deltas/history — no new fields.

## Appendix R2 — 4-point revision gate amendments (R7–R10, binding, no new tables/columns)

### R7 — Fulfillment rule (retires generic "auto-cap")

Envelope: commit ⟺ `actual ≤ requested + tolerance` AND R3 predicate atomically.
Tolerance: WEIGHT = `MAX(1 sale_step in unit, 10% of requested)`; PIECE = `0`.
- **A (actual ≤ requested)**: commit actual + release full hold + SALE(actual) → FULFILLED iff equal else
  PARTIALLY_FULFILLED, final = ROUND(actual×price,2) → APPROVAL NO.
- **B (requested < actual ≤ envelope)**: same commit shape, no extra reservation (predicate proves delta) →
  FULFILLED, actual recorded → APPROVAL NO.
- **C (actual > envelope)**: gate REJECTS (nothing written) → re-cut into envelope (stays PENDING, zero
  commercial trace) or UNAVAILABLE + replacement flow; **same-variant** proposals (variant = original,
  qty = weighed) allowed as the explicit-approval mechanism for excess → charging excess needs YES.
- **Stock shortage (predicate fails)**: commit max-fulfillable `(q − r + held)` (always ≤ attempted),
  movement on committed, note recorded → status follows value (0 → UNAVAILABLE + replacement path) →
  APPROVAL NO.
- Numbers: req 0.500/tol 0.125 → 0.475 auto-PARTIAL; 0.525 auto-FULFILLED; 0.650 reject→re-cut; PIECE 10→11 reject.

### R8 — Phone canonical rule

`RAW → strip non-digits → 00-drop / 0→20 (len11) / prepend-20 (len10, 1…) / keep (len12, 20…) / else REJECT`
→ STORE digits only → APP validates `^201[0125][0-9]{8}$` (identity) → DB `^[0-9]{8,15}$` + UNIQUE (backstop).
Vectors → `201012345678` ✓ for `01012345678`, `+201012345678`, `00201012345678`, `201012345678`.
Identity = Egyptian mobile only; delivery-contact looser (landline OK).

### R9 — Payment boundary wording

Phase 2 stores commercial facts only (estimates, finals, frozen prices, signed deltas, history, idempotency
keys) and MUST NOT contain/assume/name mechanics, providers, methods, payment statuses, paid-at timestamps:
*"Phase 2 exposes immutable estimated and final monetary facts. Phase 3 determines how each payment method
settles, authorizes, captures, adjusts, or refunds those amounts."* est 500 ± replacement deltas → 600/450
classes representable with zero redesign.

### R10 — Replacement materialization (single tx)

Lock order ASC: orders → items → inventory(variant) → replacement row. Gate PROPOSED (replay-safe) →
conditional reserve substitute (no pre-reserve at proposal) → INSERT new line (frozen price, DB-verified
estimated) → link + APPROVE (original never edited) → original REPLACED strictly after line exists (+ hold
release; post-commit-damage restocks via CANCELLED_ORDER same-tx) → recompute finals (NULL till terminal) →
COMMIT. **Failed approval never mutates proposal state** (remains PROPOSED; in-tx holds dissolve on ROLLBACK).
