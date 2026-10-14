# FP-11.8.4 — Admin Promotions & Discounts UX Specification

> Classification: `SUPPORTED` / `UNSUPPORTED` / `UNVERIFIED`. Specification-only — no implementation,
> no backend change, no approval claimed. Backend authoritative for math, eligibility, and outcomes.

## 1. Promotion list screen

- **Row fields (all server-returned):** name · `type` (PERCENTAGE/FIXED_AMOUNT/BUY_X_GET_Y/FIXED_PRICE —
  verified `promotionTypeSchema`) · `scope` (LINE/ORDER) · targets summary (VARIANT/PRODUCT/BRAND/
  CATEGORY links — counts/summaries from contracted rows, never inferred coverage) · rule values
  (minimums/caps as stored) · `startAt/endAt` window (nullable = unbounded side) · `status`
  (DRAFT/ACTIVE/DISABLED). **Active ≠ temporally-valid:** status is an admin lifecycle flag; time
  windows are evaluated server-side at checkout — UI never equates `ACTIVE` with "currently applying".
- Status filter (`status/type/scope/search` per `promotionListQuerySchema`) + keyset pages; no counts.
- Actions: view/edit/rules/targets/BXGY config + disable — each permission-gated
  (`promotions.view/update/disable`), D45 hide-by-default.

## 2. Supported promotion types (verified — not open-ended)

| Type | Required fields | Rules/conditions | Status |
|---|---|---|---|
| PERCENTAGE | `discountPercent` (0,100] 2dp | min qty/amount, `maximumDiscount` cap, stackability, priority→specificity order | SUPPORTED |
| FIXED_AMOUNT | `discountAmount` (2dp) | Same rule family as above | SUPPORTED |
| BUY_X_GET_Y | `buyQuantity/getQuantity/discountPercent` + optional `freeVariantId` | Free-line materialization server-side; UI configures, never computes outcomes | SUPPORTED |
| FIXED_PRICE | `fixedPrice` (2dp) | Same rule family | SUPPORTED |

Commercial examples (buy-2-get-1, 20%-off, struck compare-at) are demand illustrations, NOT proof of
extra types. Struck `compareAtPrice` on storefront renders ONLY from variant-returned non-null values
(FP-05 rule) — admin config never manufactures a storefront badge. No analytics, scheduling
automation, preview endpoints, or unsupported rule types (all UNSUPPORTED — never rendered).

## 3. Create/edit form

- **Fields per contract:** name* (1–160), description (≤4000), type*, scope*, status (default DRAFT
  unless contracted otherwise), startAt/endAt (ISO with offset), discount value per type, priority int,
  `isStackable`, `usageLimit` positive int; targets (type+id rows, add/remove); rules
  (minimumQuantity 3dp / minimumAmount 2dp / maximumDiscount 2dp); BXGY (buy/get qty 3dp + percent +
  free variant). Client mirrors shapes/lengths/enums (400-avoidance); server authoritative.
- Each field: type, required/optional, limits, validation message (Arabic), final server source.
- Mutations: create (`promotions.create`) → 201; patch (`update`); disable (`disable` — lifecycle,
  not physical delete; deleted promotions are not a contracted state — no "deleted" filter invented);
  rules/targets/BXGY PUT/POST/DELETE per route. 400/404/409/403 mapped; single-flight; re-read on success.
- Coupons (same screen family, separate entity): create/update/disable + read-only usages ledger
  (`coupons.view` — viewing never bumps counters); per-customer limits/minimums/windows per
  `couponInputSchema`; coupon failures are checkout-422 family (surfaced, not redefined).

## 4. Consistency across storefront (prices/discounts authority)

- Product card/PDP: price from variant payload; compare-at struck ONLY when returned non-null; promo
  badges ONLY from backend-proven benefit (FP-11.1/11.3 rules).
- Cart: NO discount rows in cart payload (FP-11.4) — cart never shows promotion outcomes.
- Checkout review: estimate-computed discounts labeled estimate; final totals from creation response
  only (FP-11.5). Never double-apply (estimate preview + order absorption are distinct, sequential —
  UI never sums them).
- Post-creation details: snapshot discount rows as returned.
- Expired/ineligible promo data → badge/row omitted silently (no phantom benefit); no frontend
  re-price retention policy invented — stale estimate rules (FP-11.4 D30) govern; undocumented behavior
  recorded as gap (G-P1: no contracted "promotion changed mid-cart" event stream — UI learns via
  reprice/estimate/creation responses only).

## 5. Acceptance criteria (DEFINED — NOT EXECUTED)

- List shows contracted fields; ACTIVE≠valid distinction honored; filters server-side.
- All 4 types with per-type required fields/rules; no invented types/scheduling/analytics/preview.
- Create/patch/disable + rules/targets/BXGY + coupon CRUD + usages-read-only per contract.
- Storefront consistency per §4 (no double-apply, no invented badges, stale via reprice/estimate).
- D45 visibility; Arabic RTL/a11y; confirmed-success-only.

---

*End of FP-11.8.4 — specification-only.*
