# BA-7 Replacements — implementation record

> Backend APIs only. No frontend. No BA-8+. No schema/migration changes.
> All behavior verified on scratch (`hyper_almoatasem_scratch`, reused from
> the BA-6 build); production untouched (every test connection is
> allowlisted to scratch names only; the Next server under test pointed at
> scratch).

## 1. Frozen contract (extracted verbatim, Phase 2 SQL + R2/R5/R10)

- Table `order_item_replacements`: original line (RESTRICT), substitute
  variant (RESTRICT), `replacement_quantity > 0`, frozen
  `replacement_unit_price`, signed `price_difference` (no cross-row CHECK
  — service-computed), reason, `PROPOSED` default, proposer `SYSTEM|STAFF`
  (+id), decider NULL-till-decided, `replacement_order_item_id` NULL-till-
  approved. Pair CHECKs (decided/materialized), partial UQ one-PROPOSED
  per line, trigger `PROPOSED → CUSTOMER_APPROVED|CUSTOMER_REJECTED|
  AUTO_ACCEPTED` only. Withdrawal rides REJECTED (R5).
- Originals move `PENDING→REPLACED` (swap) or `UNAVAILABLE→REPLACED`
  (OOS); OOS proposals flip `PENDING→UNAVAILABLE` same-tx; swap proposals
  freeze the PENDING line (R2). Link-never-overwrite: originals keep
  their snapshots; substitutes arrive as NEW lines.
- Approval (R10): lock order→item→inventory(ASC)→replacement, gate
  PROPOSED, conditional reserve substitute, materialize line at the
  proposal-frozen price, link strictly after the line exists, original
  REPLACED, original hold released, one tx, no movements (frozen §J).
- R5 pre-consent: consent + spend within 10% of original estimate AND
  50 EGP (exact integers) → `AUTO_ACCEPTED`/SYSTEM, else explicit
  approval. R2 READY gate: READY ⟺ zero PENDING-pickable AND zero live
  PROPOSED (discipline definition — no BA-7 transition targets READY).

## 2. Endpoints (smallest frozen-covering surface)

Storefront (ownership via `?customerId=`/body customerId — never phone):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/store/orders/[id]/replacements` | list owned order's proposals |
| POST | `/api/store/orders/[id]/replacements/[replacementId]/decide` | explicit approve/reject (CUSTOMER) |

Admin (existing keys only — `orders.view` reads, `orders.update` writes;
no replacement key exists and none invented):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/admin/orders/[id]/items/[itemId]/replacements` | propose (STAFF; OOS flip default, swap flag) |
| GET | `/api/admin/orders/[id]/replacements` | list (visibility for fulfillment) |
| POST | `/api/admin/replacements/[id]/withdraw` | staff withdrawal → REJECTED |
| POST | `/api/admin/replacements/[id]/auto-accept` | R5 evaluation → AUTO_ACCEPTED |

## 3. Lifecycle & guards

- Propose: order `CONFIRMED|PREPARING`, line `PENDING` (flip) or
  `UNAVAILABLE` (re-proposal), unpicked, substitute sellable +
  step/pack discipline; duplicate open proposals → 409 (partial UQ).
- Decide: replacement `PROPOSED` (else 409 — double decisions, replays,
  and approve-vs-reject losers all land here), order still workable,
  original still `PENDING|UNAVAILABLE` unpicked; approve requires a
  CUSTOMER decider (domain-enforced — staff approve rejected 422).
- Cancel interplay: cancel with live PROPOSED is allowed (no frozen bar);
  afterwards approve/re-propose → 409 via order-state gates.
- Picked lines (`actual` set) are refused everywhere in BA-7 (409) —
  fulfillment-gated cancel/restock belongs to picking, not invented here.

## 4. Inventory (BA-3 predicates, one-tx execution)

Reserve-substitute `(quantity−reserved) ≥ qty` + release-original-hold,
zero movements, ASC multi-row locks. BA-3's own functions open their own
tx and cannot nest, so the identical predicate text runs on the ambient
R10 tx (documented in code — atomicity wins, no arithmetic duplicated,
no second implementation). Approval races serialize on order + inventory
locks; losers get 409 with nothing written.

## 5. Pricing & snapshots

- `replacement_unit_price` = live substitute price at PROPOSAL, frozen
  thereafter (approval uses it even if catalog drifted — the proposal is
  the agreement); `price_difference` = signed `repLine − origEst`, exact
  integers. New line `estimated = ROUND(qty×price,2)`; order-level
  estimates/finals untouched (estimates immutable; finals NULL until
  fulfillment — the reference double's refresh is a proven no-op here).
- Catalog moves after the fact never rewrite history (tested live).

## 6. Idempotency

No keys frozen for replacements: the partial UQ (propose) and the
PROPOSED gate (decide) are the arbiters — duplicates/conflicts answer
409, never silent replays, never `ON CONFLICT DO NOTHING`.

## 7. Notable findings (no redesign)

- The frozen test double's AUTO path (`SYSTEM` + NULL decider id) would
  violate `chk_repl_decided` (never executed frozen). BA-7 records
  `SYSTEM` + the executing admin's id — CHECK-legal, intent preserved.
- R5 withdrawal notes have no frozen column (reason belongs to the
  proposal); the transition itself is the record.
- BA-6 `cancelOrder` double-released REPLACED lines' holds (approval
  already released them) — fixed minimally to skip REPLACED lines per
  the R10 invariant; BA-6 suite re-verified green (no REPLACED lines
  there, behavior unchanged).

## 8. Errors (BA-1 envelopes)

400 malformed/strict-unknown; 401 anonymous admin; 403 roleless; 404
unknown order/item/variant/replacement + foreign ownership (never
leaked); 409 decided/duplicate/state-gated losers + picked-line and
PREPARING-cancel boundaries; 422 propose-time semantics + uncovered
auto-accept + staff-approve. 500 generic only.

## 9. Prisma vs raw SQL

- Prisma: reads, proposal INSERT, scoped updates, tx blocks.
- Raw SQL only for: row locks (`FOR UPDATE`, incl. `OF r`), atomic
  reserve/release bumps, materialized-line INSERT, guarded status flips,
  nested-P2010/23505 mapping (BA-3 lesson). Time: no BA-7 time gates
  exist (CC-1 pattern N/A; `now()` only as row timestamps).

## 10. Tests

| Suite | Result |
|---|---|
| `scripts/api/t-replacements-unit.mjs` (states, gate, caps, bounds) | 24/24 |
| `scripts/api/t-replacements.mjs` (HTTP on scratch) | 54/54 |
| `scripts/api/t-replacements-concurrency.mjs` (R1–R4, real PG) | 12/12 |
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
| BA-6 `t-orders-unit.mjs` | 16/16 |
| BA-6 `t-orders.mjs` (scratch) | 54/54 |
| BA-6 `t-orders-concurrency.mjs` | 15/15 |
| CC-1 `t-cc1-lockout.mjs` (scratch) | 8/8 |
| `t-password.mjs` | 9/9 |
| Phase 2 / 4 / 5 functional | 77/77, 65/65, 50/50 |
| `tsc --noEmit` / ESLint (0 warnings) / `npm run build` | PASS |

Races: R1 double-approve (one line, winner + 409); R2 approve-vs-reject
(one terminal, coherent end state); R3 double-propose (one PROPOSED row);
R4 cancel-vs-approve (settles either way, no partial, no deadlock).
Excluded with reason: READY-transition race (no READY operation exists).

## 11. Session findings (honest)

- BA-7 suite crashes during development were a test-authoring bug
  (guest token sent as `cookie` instead of `x-guest-token`), fixed in
  both new suites — no server change needed.
- Back-to-back full-suite runs exhaust the frozen login rate buckets
  (IP 30 / account 10 per 15-min window) — subsequent logins fail closed
  with generic 401 BY DESIGN; suites were scheduled across rollovers.
  Workflow note, not a product issue.
- One Phase-2 run hit the harness's own `Math.random()` order-id
  collision (pre-existing flake, frozen file untouched) — re-run green.
- Skipped with reason: 240+120 frozen embedded-PG batteries
  (SQL byte-identical) and CC-1 TZ rerun (auth untouched).

## 12. Files

- New: `src/lib/replacements/{state-machine,validation,serialize,queries,writes}.ts`;
  store `orders/[id]/replacements[/[replacementId]/decide]` routes;
  admin `orders/[id]/items/[itemId]/replacements`,
  `orders/[id]/replacements`, `replacements/[id]/{withdraw,auto-accept}`
  routes; `scripts/api/{t-replacements,t-replacements-concurrency,
  t-replacements-unit}.mjs`; this doc.
- Modified: `src/lib/orders/writes.ts` (cancel skips REPLACED holds —
  §7), nothing else outside BA-7 scope.
- Untouched/protected: `db/*`, `prisma/*`, auth/API/BA-1..BA-6 behavior,
  `docs/AGENT-HANDOFF.md`, `docs/release-manifest.md`, all frontend.

## 13. Deferred (unchanged + BA-7-specific)

Picking/commit, fulfillment transitions, PREPARING-gated cancel/restock,
promotions/coupons, payments, delivery, OTP/login, rotation, TTL numbers,
versioning, retention, notifications, images, barcode formula — none
invented here.
