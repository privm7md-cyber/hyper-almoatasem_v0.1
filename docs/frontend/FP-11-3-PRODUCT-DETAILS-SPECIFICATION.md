# FP-11.3 — Product Details Page Specification

> Classification: `VERIFIED` (repo/openapi evidence below) · `LOCKED` (existing approved decision) ·
> `RECOMMENDATION` (proposed, needs owner review) · `NEEDS OWNER DECISION` · `BLOCKED`/`UNSUPPORTED`
> (capability absent) · `NOT VERIFIED`. Specification only — no implementation claimed.

## 1. Executive summary and verdict

**Verdict: `SPECIFICATION COMPLETE — OWNER APPROVALS RECORDED (D21, D22, D23)`.** The
product-details contract is fully specified from verified endpoints: UUID-addressed detail + variants
+ images + inventory reads, PIECE/WEIGHT flows gated by sellable-variant and step rules, server-owned
pricing with estimate-only previews, honest availability/OOS handling, guarded add-to-cart with
confirmed feedback, full state matrix, and dependency mapping. Owner-approved via delegation
2026-10-09: weight-preset presentation, compare-at prominence, no-reviews display. Nothing
fabricated; every data-driven behavior traces to a verified endpoint or is explicitly conditional.

## 2. Scope and non-goals

In scope: PDP information architecture, variant selection, PIECE/WEIGHT UX, price/availability display,
promotion honesty, add-to-cart flow, gallery behavior, 26-state matrix, responsive/RTL/a11y, request
orchestration, decision register, acceptance criteria. Non-goals: implementation, CSS/components,
backend changes, data seeding, barcode-scanner hardware flows, reviews/ratings system, FP-11.4+,
deploy, commit.

## 3. Verified repository/API evidence

| # | Capability | Evidence | Status | Constraint |
|---|---|---|---|---|
| E1 | Product detail | `GET catalog/products/{id}` → list fields + `description`; 404 unknown id | VERIFIED | UUID path only; no slug lookup endpoint |
| E2 | Variants | `GET products/{id}/variants` (active list); `GET variants/{id}` (live price basis); 404 unknown | VERIFIED | Price lives only on variants |
| E3 | Variant fields | `VariantShape`: id/productId/name/sizeValue/sizeUnit/price/compareAtPrice/isActive (`serialize.ts:113-135`) | VERIFIED | `compareAtPrice` nullable; never computed |
| E4 | List fields | `ProductListItem`: id/name/slug/productType/unit/saleStepGrams/isActive/category/brand — no price/stock/image | VERIFIED | Cards need enrichment calls |
| E5 | Images | `GET products/{id}/images` → `{primary, gallery}`; empty array when none; 404 unknown product | VERIFIED | Per-product call; may be empty |
| E6 | Availability | `GET inventory/products\|variants/{id}` → quantity/reserved/available strings; status `in_stock/low_stock/out_of_stock` (available≤0 ⇒ out) | VERIFIED | Per-product/variant call |
| E7 | Cart ops | `POST cart/items` {productVariantId, quantity}; 422 step/unit/price violation; re-add aggregates; full-cart mutation responses | VERIFIED | Variant ID required; whole-pack/step rules enforced server-side |
| E8 | Step rules | PIECE whole packs; WEIGHT multiples of `saleStepGrams` (`cart/writes.ts:99-117`); quantity wire `NUMERIC(12,3)` text > 0 | VERIFIED | Free decimals rejected (400/422) |
| E9 | Pricing authority | Estimate dry-run (`POST orders/estimate`, lines+couponCode, no locks/rows); live variant price basis | VERIFIED | Frontend estimates never final |
| E10 | Promotions display | No storefront promotions/offers/coupons-list endpoints (route inventory) | VERIFIED ABSENT | Discounts only from returned payloads |
| E11 | Errors | `{error:{code,message,details}}`; VALIDATION 400 … RATE_LIMITED 429, GONE 410 | VERIFIED | Map codes, never raw codes |
| E12 | Deps | Next 16.3.8, React 19, zod, zustand, Tailwind v4; RSC default; no fetch lib | VERIFIED | RSC fetch + handlers |

## 4. Product information architecture

PDP sections, each conditional on its source: breadcrumbs (category trail where resolvable, else
back-to-listing) · name (full, wrapped) · gallery (primary ?? first ?? neutral fallback) ·
description (only when backend returns non-null) · brand/category links (only when present) ·
sale-type + unit label (from variant/product fields) · variant selector (iff >1 sellable variant;
single sellable variant preselected and shown) · price block (current + struck compare-at ONLY when
variant returns non-null) · availability line (icon + text, never color-only) · promotion note
(only backend-proven benefit) · quantity/weight selector · add-to-cart · related links: none
(no related-products endpoint — must not be invented). Required vs optional vs conditional vs
unavailable marked per field above; no placeholder business claims.

## 5. Piece-based products

Sellable unit = variant's pack (`PIECE` counting unit); price maps 1:1 to the chosen variant's live
`price`. Quantity: positive integers in whole packs (server rejects fractions); minimum 1 pack; no
invented maximum (stock-bounded at checkout). Stepper ±1 pack; direct entry validated client-side to
integers before send. Variant change re-resolves price/unit/availability from that variant only.
Availability change ⇒ disable + «غير متوفر», preserve selection for comparison. Server rejection
(422/404/409) ⇒ mapped message + preserved selection, never silent drop.

## 6. Weight-based products

Sale type `WEIGHT` from product/variant fields. Weight selection maps to request quantities that
must satisfy the product's `saleStepGrams` multiple — practical presets (125g/250g/500g/1kg/1.25kg)
offered ONLY where they satisfy that product's step (FP-05 D03, closed); free-form decimals
rejected with message. Unit price displayed per the variant's `sizeUnit` with per-kg equivalence
where it aids clarity (display-only, exact conversion). Selected weight shown with estimated total
explicitly labeled non-final; checkout/fulfillment authoritative amounts surface later per FP-06.
Unavailable weight/variant ⇒ disabled option with reason, never removable silently. Server weight
rejection ⇒ mapped error + preserved selection. No scale simulation, no barcode scanner hardware
flow (codes/lookup is a cashier aid, not PDP input). Fulfillment may deliver a different actual
weight/total — PDP must never promise finality.

## 7. Variants and sellable-unit selection

Product = grouping entity; variant = the purchasable entity (own id/price/unit/stock). Price
attaches to the variant, never the product. Explicit selection required whenever >1 sellable
variant exists; single sellable variant may preselect (shown, changeable only if alternatives
exist). Selection change re-resolves price, unit, availability, images (gallery is product-level),
and quantity options from the newly selected variant. Stale/invalid variant IDs (unknown/inactive)
⇒ 404-mapped state + fall back to first sellable variant with notice, never silent substitution.
Zero sellable variants ⇒ product-level «غير متوفر», add disabled, page still renders truthfully.
No synthetic grouping by name/image/size; no arbitrary default that could mislead.

## 8. Price presentation and calculation authority

Current unit price (variant `price`) + unit label always paired; compare-at struck only when
variant returns non-null `compareAtPrice` (never computed, never a discount claim alone).
Server totals/discounts shown only from server-computed responses (estimate/cart). Loading price =
skeleton, never stale-as-final; failed price fetch = explicit unknown + retry. Display estimate vs
authoritative amount always distinguished. Rounding/decimals/taxes/fees: backend-owned; no invented
rules. Stale-price guard: revalidate variant price before add-to-cart submit on PDP open age or
after any price-change signal; never present an unverified price as authoritative.

## 9. Promotions and offers

No product-level active-promotion read endpoint exists (E10). PDP shows promotion content ONLY from:
(a) `compareAtPrice` present in the fetched variant (struck reference, not a discount claim), or
(b) estimate-computed discount rows for the current cart context. Eligibility/conditions/windows
are server-evaluated; expired/ineligible/malformed promo data ⇒ no badge, totals as computed.
BXGY/percentage semantics are never described beyond what responses prove. No promotion endpoint,
rule, or feed invented.

## 10. Availability and stale-data behavior

Available (sellable + available>0) ⇒ purchasable. Unavailable variant ⇒ «غير متوفر», disabled add,
page intact. Missing/failed inventory read ⇒ explicit unknown + retry — never labeled out-of-stock
and never assumed buyable. Availability change after load ⇒ re-check on submit; rejection maps to
message + preserved selection. Product/variant turning invalid (404/inactive) ⇒ not-found/disabled
path. No realtime sync claimed; no restock alerts (unsupported).

## 11. Add-to-cart flow

1. Preconditions: sellable variant selected, quantity valid per §5/§6, availability not known-bad.
2. Payload: `{productVariantId, quantity}` for guest (token header) or session identity.
3. Pending: disabled controls + spinner, duplicate-submit guard (in-flight flag).
4. Success only on confirmed response: update indicator from confirmed cart, transient success
   feedback, keep PDP state.
5. Failure: mapped message (400 validation / 422 step-unit-price / 404 cart-or-variant /
   401 session / 409 conflict), selection preserved, retry allowed.
6. Availability/price conflicts: re-resolve variant data, surface change, require re-confirm.
7. Retry safety: add/merge mutations are single-effect server-side; ambiguous timeout ⇒ re-read
   cart before re-adding (never blind duplicate POST loops).
8. Selection retained after any failed request.

## 12. Complete page state matrix

Initial loading (skeletons, layout-stable) · loaded · not-found (bad/unknown/inactive id) ·
available · unavailable («غير متوفر», disabled) · variant-selection-required · variant-available ·
variant-unavailable · price-loading · price-failed (unknown + retry) · image-loading · image
missing/failed (fallback) · description-absent (section omitted) · promotion-present (proven only) ·
promotion-absent (nothing shown) · eligibility-unknown (no claim) · quantity-invalid · weight-invalid ·
add-pending · add-success (confirmed only) · add-validation-failure · stock-conflict · price-conflict ·
session-failure (re-login, preserve selection) · network/server error + retry · recovery (re-read,
resume). Each: trigger, UI, action, recovery, authoritative source. No state implying unsupported
backend capability.

## 13. Navigation and user experience

Breadcrumbs (category trail or back-to-listing fallback) · return-to-catalog preserves listing/search
context where the listing page supports it · search/category context is listing-owned, not PDP-stored ·
post-add success feedback + indicator, no forced redirect · errors explain cause + next step, never
leak internals · no favorites control (no favorites API — reference images with one must not be copied).

## 14. Responsive layout and RTL

Mobile-first: stacked gallery → title → price → variant/qty → sticky add-to-cart bar (non-occluding,
keyboard-safe); tablet two-column; desktop gallery rail + info column. Breakpoints per Tailwind v4
defaults at build (behavior specified, no px invented here). Long Arabic names wrap; prices/numbers/
units isolated LTR-safe (`bdi`); directional icons mirrored, brand/technical symbols never;
44px touch targets; keyboard focus visible + logical order; form/error association; skeletons for
loading shifts.

## 15. Request orchestration and performance

Initial: product detail + variants + images + inventory concurrently (independent); variant switch
re-fetches variant + inventory only. Dedupe per render (no duplicate variant/inventory/images calls
per product); cache within page lifetime; price/stock revalidated pre-submit (never served stale as
authoritative); optional data may fail independently (page renders, inline retry); sequence-guard
variant switches (stale responses discarded); duplicate-submit guard. No batch endpoint invented;
no measured performance claims (no baseline approved).

## 16. Accessibility and content rules

Semantic headings/controls; labeled quantity/weight/add controls; selected/disabled/loading/error
announced; keyboard-operable stepper/selector/CTA with visible focus; RTL-first Arabic; unit price
vs total explicitly distinguished; honest errors; no urgency/scarcity fabrication; no misleading
sale labels; no WCAG conformance claimed without testing.

## 17. Acceptance criteria (specification-level; none executed)

- AC-P1: PDP renders name/variant/unit/price/availability/add solely from verified payloads.
- AC-P2: multi-variant products require explicit selection; single sellable variant preselects shown.
- AC-P3: PIECE accepts whole packs only; fractions rejected pre-send with message.
- AC-P4: WEIGHT presets offered only where step-valid; free decimals rejected; estimate labeled non-final.
- AC-P5: compare-at shown only when backend non-null; never a standalone discount claim.
- AC-P6: OOS renders «غير متوفر» + disabled add; page otherwise intact.
- AC-P7: missing/failed images fall back neutrally, never broken.
- AC-P8: add-to-cart success only post-confirmation; failures preserve selection with mapped retry.
- AC-P9: unknown/inactive product ⇒ not-found path, no crash.
- AC-P10: stale variant/price/inventory re-resolved before submit; conflicts mapped.
- AC-P11: responsive/RTL/keyboard/skeleton/error behaviors per §§12–14.
- AC-P12: zero invented endpoints/fields/rules; unsupported states marked, never mocked.

## 18. Owner decisions and unresolved questions

| ID | Question | Evidence | Recommended default | Alternatives | Impact | Status |
|---|---|---|---|---|---|---|
| FP11-D21 | Weight-preset presentation per product family (chips vs stepper vs list)? | Step rules verified; no layout mandate exists | Preset chips where valid + stepper within step | Free entry (rejected: contract) | Usability | OWNER-APPROVED (delegated, 2026-10-09) |
| FP11-D22 | Compare-at prominence (inline vs badge)? | compareAt nullable; no promo feed | Inline struck reference, badge only on proven benefit | Prominent badge always (rejected: misleading) | Trust | OWNER-APPROVED (delegated, 2026-10-09) |
| FP11-D23 | Review/rating display? | No source exists | Omit entirely until sourced | Placeholder stars (rejected: fabrication) | Honesty | OWNER-APPROVED (delegated, 2026-10-09) |

Approval provenance: the owner explicitly delegated these three presentation decisions; the assistant
selected the recommended options on the owner's behalf on 2026-10-09. Technical content, constraints,
and alternatives above are unchanged. Locked respected: brand/VI-01, FP-03 nav, FP-04 journey/checkout,
FP-05 commerce rules, FP-09 IA, guest-no-account, price/stock authority, EGP, no-governorate.

## 19. Dependencies, risks, and completion verdict

Depends on: catalog/variant/images/inventory/cart/estimate contracts (§3). UX limited by: no
batch fetch (N+1 per enriched card), no offers feed, no reviews source, no restock alerts.
Price/availability drift risk handled by revalidation rules. No ambiguity needing follow-up beyond
§18. No contract contradiction found.

```text
SPECIFICATION COMPLETE — OWNER APPROVALS RECORDED (D21, D22, D23)
```

(D21–D23 recorded owner-approved via delegation 2026-10-09; zero contract impact; implementation,
FP-11.4, and later work untouched.)
