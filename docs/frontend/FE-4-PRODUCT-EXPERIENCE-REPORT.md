# FE-4 — Product Experience Report (2026-10-13)

> Production frontend work (reads + contract-conformant cart writes in tests only via mocks).
> No backend/contract/seed change, no commit/push, no handoff edit. Local PG started/stopped for
> read-only verification (baseline restored); local dev DB is EMPTY (verified) — data-paths below
> account for that honestly. No production-data writes anywhere (unit add-flows are mocked; e2e never
> submits a real cart mutation).

## A. Repository Safety

- `D:\Hyper_el-moatasem` · `master` · `83253fe9…` == `origin/master` (before/after).
- Added: `src/app/p/[id]/[slug]/page.tsx`, `src/components/store/{product-gallery,purchase-panel,guest-cart-token}.tsx`,
  `src/lib/frontend/cart-qty.ts`, 3 test files, `e2e/fe4-product.spec.ts`, this report.
- Evolved: `storefront-reads.ts` (+PDP dataset), `api-client.ts` (+explicit `headers` for cart bearer),
  `product-card.tsx` (links to approved PDP route), axe test (+purchase island).
- Untouched: backend/openapi/schema/admin/prototype/FE-1 shell/contracts.

## B. Product Details

- Route `/p/[id]/[slug]` (FP-09 D01): UUID fetch, display-only slug + canonical 301, unknown/inactive/
  malformed → Arabic not-found (never a substitute). Metadata: live name + description-or-fallback title.
- Live dataset: detail fields + ≤50 active variants (price/compareAt/stock each) + deterministic gallery
  (primary-first; single ⇒ no fake gallery; null ⇒ neutral fallback) + description-or-omitted.
- No invented: origin/ingredients/ratings/reviews/numeric-stock/claims. Related section OMITTED
  (no relation endpoint — verified absence, documented).

## C. Variant & Weight Behavior

- Variant = sale authority (id/unit/price/stock per variant; stale selection impossible — id travels).
- PIECE: whole-pack gate; WEIGHT: step-filtered presets (125–1250g) + custom grams, KG-decimal vs GRAM-
  integer wire shapes per `assertLineShape`; invalid blocked pre-send with reason; server re-validates.
- Estimate display-only (integer piastres, labeled non-final); requested≠actual never confused (actuals
  surface only post-fulfillment per FP-06 — not on PDP).

## D. Pricing / Promotions / Availability

- Price from selected variant; compareAt struck ONLY when backend non-null (reference, not offer proof).
- No discount math/badges on PDP (no per-variant promo endpoint — promos evaluate at estimate/checkout).
- Availability per variant (in/oos/unknown from live reads); OOS selectable-visible but add-blocked;
  unknown-stock never labeled OOS; missing images never imply unavailability.

## E. Add to Cart (real contract, mocked transport in tests)

- `POST /api/store/cart/items {productVariantId, quantity}` + owner (stored `x-guest-token` XOR
  auto-sent session cookie); mint-once-then-retry on no-identity 400; 200 = success only.
- Guest bearer in namespaced localStorage (FP-11.4 posture; cart-only — grep-proven absence of any
  order-credential touch); single-flight (no StrictMode/effect/double sends); selection preserved on
  failure; 404/409/422/401 mapped to recovery messages (no false success, no stale-price submit).
- Proven by 6 mocked-flow unit tests (payload/headers/mint-retry/conflict/OOS-block/step-block/single-
  flight); live execution impossible here (empty DB + write policy) — stated, not implied.

## F. Tests (all executed)

- `npx vitest run`: **48/48** (37 prior + 11 FE-4: qty-math ×4, purchase flows ×6, axe island ×1).
  Caught & fixed: Button dropping `onClick` (rest never spread); `aria-label` on role-less toast viewport.
- `npx playwright test e2e/fe4-product.spec.ts`: **4/4** (unknown-id 404 honesty, card-link shapes,
  malformed-id 404, cross-area regression). PDP 404 captured at 390 + 1280 (clean, no overflow).
- Regression: fe2 (6/6) + fe3 (8/8) + foundation (4/4) green. `tsc`/`eslint` clean · `npm run build` PASS.
- Not executed: live PDP/add against real rows (empty DB + no-write policy — documented limitation).

## G. Limitations

- Related Products omitted (no backend relation). Live data-paths await seeded env (re-run suites there).
- AT manual audit + field metrics remain process-deferred. PDP enrichment fans out per variant (bounded;
  flagged for future batching if catalogs grow).

## H. Final Status — `COMPLETE WITH EXPLICIT LIMITATIONS`

Acceptance A–E hold with evidence: real PDP route/data/states, contract-true variants/weights/pricing/
availability, honest add-to-cart mapping (mock-proven), full regression green. Limitations in §G.

---

*End of FE-4 report — product experience only; no cart page/checkout built.*
