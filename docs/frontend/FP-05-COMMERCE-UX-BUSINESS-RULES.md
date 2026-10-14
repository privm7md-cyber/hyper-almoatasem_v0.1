# FP-05 — Commerce UX & Business Rules (Specification Only)

> Status labels: `VERIFIED` (source evidence below) · `LOCKED` (existing approved decision) ·
> `RECOMMENDATION` (proposed, needs owner approval) · `BACKEND-CONSTRAINED` (capability absent) ·
> `NEEDS OWNER DECISION` · `NOT VERIFIED` · `OUT OF SCOPE`. No implementation, runtime testing,
> backend, migration, dependency, commit, or deploy in this phase. Source inspection only.

## 1. Purpose and scope

Define customer-facing behavior of products, variants, pricing, weighted items, cart, promotions,
coupons, and availability before any Product Card or cart UI is designed. Locked context preserved:
FP-03 final bottom nav (Home/Categories/Cart/Orders/Account + prominent header search, FP03-C1), FP-04 single-page
sequential checkout, guest purchase without account, server price/stock/total authority, PIECE vs
WEIGHT types, EGP, no governorate field, Brand Strategy v1 + VI-01 (colors/personality/copy intact),
FP-09 unchanged, backend offers-feed/profile gaps as documented.

## 2. Relationship to locked FP-03 and FP-04

This spec consumes them, never restates them as its own decisions. FP-03 governs nav order and
destinations (Offers entry in desktop header/contextual surfaces per FP-00-D007, no bottom-tab slot, FP03-C1 final). FP-04 governs journey, single-page
checkout, idempotency semantics, guest-access security, and replacement rules. Where FP-05 needs a
UX choice FP-04 left open (e.g. sticky CTA visuals, empty-offers copy), it is marked RECOMMENDATION.
No FP-03/FP-04/FP-09/Brand/VI-01 decision is reopened or altered.

## 3. Source-of-truth and terminology

Server owns: accepted prices, inventory/availability, promotion/coupon outcomes, order totals,
order state. Client owns: interaction state only. Money: integer thousandths quantities
(`NUMERIC(12,3)` text, strictly > 0) and integer-piastres math, never float
(`src/lib/cart/totals.ts:3-6`, `cart/validation.ts:10-15`). Display units (g/kg/pack) are
presentation; API units are exact decimal strings. `compareAtPrice` is an admin-set reference field,
not proof of an active offer. “Discount” on screen means backend-computed discount rows only.

## 3b. Source-of-truth table (the 16 required items; STATIC-VERIFIED)

| Item | Authoritative source | Via operation | Local copies are |
|---|---|---|---|
| Product availability | Inventory reads | `GET inventory/products\|variants/[id]` | Display quotes, revalidated |
| Variant availability | Same + liveness gating | Same + cart/checkout validation | Same |
| Variant price | Live variant `price` | Product/variant reads, re-read at each commit point | Quotes, never authority |
| Promotion eligibility | Engine evaluation | Estimate/checkout recompute | Never stored as fact |
| Promotion discount | Discount rows from evaluation | Estimate/checkout responses | Display only |
| Coupon eligibility | Coupon evaluation | Estimate (`applicable`+reason) / checkout enforcement | Re-evaluated every mutation |
| Coupon discount | Same | Same (`amount`) | Same |
| Cart quantity validity | Cart writes | Add/set responses | Server-confirmed replace |
| Cart totals | Cart echo + estimate | `cart/*`, reprice, estimate | Quotes until checkout |
| Checkout totals | Estimate preview | `POST estimate` | Preview, never final |
| Order totals | Checkout tx | `POST orders` 201 frozen snapshots | History (immutable) |
| Weighted requested qty | Cart/order snapshots | Cart writes, order create | Frozen at commit |
| Weighted estimated price | Live unit price × qty | Variant + cart/estimate | Labeled estimate |
| Weighted final price | Fulfillment actuals | Post-PREPARING order reads (`actualQuantity`) | Null until written |
| Inventory availability | `availableQuantity` GENERATED | Inventory reads, checkout conditional reserve | Revalidated, never cached-as-reserved |
| Order status | Frozen state machine | Order reads | Display, transitions server-side |

Revalidation triggers: qty/variant change, coupon change, cart mutation, checkout entry, post-failure retry,
visibility-regain on tracking. No client caching overrides a server rejection; no extra revalidation loops beyond these.

## 4. Product-card contract

Per card, each value traced to its supplier (all VERIFIED):

| Element | Supplier | Rule |
|---|---|---|
| Image + fallback | `products/[id]/images` gallery; product-level `image` nullable (`catalog/writes.ts:122`) | Missing/invalid ⇒ neutral placeholder, never presented as the real photo |
| Name (+long-name wrap) | product `name` | Full name shown; truncation wraps (RTL), never clips meaning |
| Variant/size/unit/package | `products/[id]/variants`, `variants/[id]` (`VariantShape`: productId, name, sizeValue, sizeUnit, price) | Variant must be explicit before add whenever choice exists |
| Current price | variant `price` (decimal string) | Server value only |
| Previous price | variant `compareAtPrice` (nullable; invariant `compare_at >= price`, `catalog/writes.ts:101`) | Show struck-through ONLY when backend returns non-null value; never computed, never a discount claim by itself |
| Promotion badge | Backend-computed discount rows (estimate/checkout) | Only when trustworthy data proves an active benefit; never from `compareAtPrice` alone |
| Availability | `inventory/products|variants/[id]` → `availableQuantity` (GENERATED `quantity - reserved`) + derived status (`out_of_stock` iff available ≤ 0; `low_stock` iff threshold set and 0 < available ≤ threshold — `inventory/serialize.ts:5-19`) | Unknown on network failure (never labeled out-of-stock); purchasable only when sellable |
| Add-to-cart | `POST cart/items` (variantId + quantity) | Disabled with «غير متوفر» when backend blocks; loading/disabled/error states required |
| Post-add quantity | `PATCH items/[variantId]` (set), re-add aggregates | Stepper bound to §5/§6 rules |
| RTL/a11y | — | Full Arabic names, logical order, accessible add/quantity names |

PIECE vs WEIGHT cards differ only in: unit line (pack vs size_unit + per-kg price), quantity control
(integer packs vs validated gram presets), estimate note (WEIGHT shows “estimated, final at fulfillment”).

## 4b. Product-states matrix (the six required states; BACKEND-CONFIRMED unless noted)

Source of truth is always the latest server response; stored display values are quotes, never authority.

| State | Commercial definition | Trigger (code/contract) | Scope | Backend representation | Card display | PDP display | CTA | Variant effect | Cart effect | Revalidation | AR message (approved §19/D14 or COPY-PROPOSAL) | Mid-page change | Reload/back | Evidence + acceptance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Available | Sellable now at shown price | variant active + product active + step/unit valid + available > 0 | Variant | sellable + `availableQuantity` > 0 | Normal card + price + add | Full detail + selector + add | Enabled | Selectable | Addable | On add/set/reprice/estimate | — (normal) | Live update | State restored from URL/server | `catalog` + `inventory/serialize.ts:5-19` · AC-01 |
| Unavailable | Live sellable variant, zero availability | available ≤ 0 (`out_of_stock`) | Variant | `stockStatus: out_of_stock` | «غير متوفر», price shown, add disabled | Same + disabled add | Disabled | Selectable but not purchasable | Existing line kept visible, flagged | On reprice/estimate | «غير متوفر» (approved) | Row flips live | Same | inventory serialize · AC-07 |
| Inactive | Not commercially offered | `isActive=false` or deleted (product or variant) | Product or Variant | excluded/unpurchasable (never buyable-with-zero-stock) | Disabled or hidden per context (never buyable) | Not-found if directly linked and backend refuses | Disabled/absent | Unselectable | Line dropped + reported on reprice/merge | On reprice/merge | Contextual (COPY-PROPOSAL: «هذا المنتج غير متاح حاليًا.») | Removed/flagged | Not-found path | writes liveness gating · AC-07 |
| Variant unavailable | One variant OOS while product lives | Per-variant availability ≤ 0 | Variant | Per-variant `out_of_stock` | Affected option disabled | Selector shows A «غير متوفر» + B purchasable | Per-variant | Other variants unaffected | Line for dead variant flagged | On reprice | «غير متوفر» (approved) | Option flips | Same | §8 · AC-07 |
| Price changed | Live price ≠ displayed quote | Reprice/estimate/checkout returns new `price` | Variant price | New snapshot (quote history, not authority) | Badge/notice old→new | Same + re-confirm gate | Gated on re-confirm | Selector kept | Submit blocked until re-confirm | Immediate re-read | «اتغيّر السعر/الكمية — راجع القيمة المحدّثة قبل المتابعة.» (approved FP-04) | Disclosure + lock submit | Fresh read | FP05-D06/D07 · AC-08 |
| Promotion changed | Benefit differs (expiry/removal/recompute) | Estimate/checkout recompute drops or alters discount rows | Promotion | Fresh discount rows (no stale benefit kept) | Badge removed/updated silently (no phantom) | Same | Unchanged (price authority decides) | Kept | Totals from fresh responses | On reprice/estimate | Silent update (no false claim); notice only if user-facing total moved | Silent | Fresh read | engine recompute · AC-11 |

Backend does not distinguish expiry vs removal vs recompute in one signal — the frontend MUST NOT invent
separate technical causes; the three stay one display behavior (benefit omitted without phantom badge).

## 5. PIECE and WEIGHT behavior

- Quantity wire shape everywhere: decimal text ≤3dp, strictly > 0 (`cartQuantitySchema`).
- PIECE: whole packs only (`qtyThousandths % 1000 == 0`, else “Piece quantity must be whole packs” —
  `cart/writes.ts:104-106`). No invented minimum beyond > 0; no maximum except available stock.
- API accepts variant IDs on cart lines (`productVariantId`); product IDs are NOT line keys.
- Variant turned unsellable (inactive/deleted): line dropped + reported on reprice/merge; add rejected.
- Quantity exceeding stock: server-side conditional reserve fails ⇒ 409 loser path at checkout;
  cart itself is draft-only (never reserves).
- Quantity edits are server-validated and persisted (`setLineQuantity`, last-writer-wins per row).

WEIGHT rules (all VERIFIED):
- API quantity unit = the variant's live `sizeUnit`; stored precision `NUMERIC(12,3)`.
- Quantity must be an exact multiple of the product's `saleStepGrams` (else “Weight quantity violates
  the sale step” — `cart/writes.ts:110-117`); missing/invalid step ⇒ variant unsellable, never guessed.
- Planned presets (125g/250g/500g/1kg/1.25kg) are usable examples, NOT a universal rule: a preset is
  offered only where it satisfies that product's step multiple. Free-form decimals (e.g. 0.137kg)
  are forbidden unless they satisfy the step (they virtually never do).
- Unit price = live variant `price` per `sizeUnit`; estimate = integer-exact `ROUND(qty × price, 2)`
  (`lineTotalPiastres`), display-labeled estimate; server revalidates/normalizes at checkout —
  frontend estimate is never the confirmed charge.
- Unavailable weighted variant: same OOS contract (§8); fulfilled actual weight/final price surface
  only from confirmed order data (actuals are PREPARING-only writes).

## 5b. FP-05-WEIGHTED-PRODUCTS — Weighted Commerce UX Specification (standalone section)

Sale units PIECE/KG/GRAM only (`productUnitSchema` boundary; LITER/ML are package-size metadata, never sale units —
FP-11.8.2 L3 Direction A). Quantity wire unit = the variant's live `sizeUnit`; `NUMERIC(12,3)` decimal strings;
WEIGHT minimum quantities gram-denominated (`engine.ts:106-111,216-222`). Order lines expose requested quantity plus
`actualQuantity: string | null` (`orders/serialize.ts:23,43`) — null until fulfillment writes it.

### A. Selection
Presets (125g/250g/500g/1kg/1.25kg) offered only where each satisfies that product's `saleStepGrams` multiple
(`cart/writes.ts:110-117`); free decimals (0.137kg) rejected pre-send; show sizeUnit + per-unit price + stock;
variant switch may change unit/price/options (re-read per variant); invalid choice = field error, nothing sent;
selection persists across back via draft state, revalidated on reload.

### B. Price Preview
Unit price (per sizeUnit) + requested weight + estimate (`ROUND(qty × price, 2)` integer-exact) come from live data;
the frontend shows but never confirms: labels always "تقديري" (COPY-PROPOSAL where no approved string exists).
No local rounding rule invented; no preview endpoint assumed beyond live variant + cart/estimate responses.

### C. Unit
sizeUnit shown verbatim (g vs kg never auto-converted in transmission; KG↔g display conversion exact 1 kg = 1000 g
only); cart → review → order → post-fulfillment all restate the same unit; Arabic: «جم»/«كجم» consistently.

### D. Estimated Price
Every WEIGHT surface labels the amount estimate vs final: cart shows estimate; checkout review shows estimate +
"final at fulfillment" note; confirmation shows estimate until actuals exist. Never show estimate as final.

### E. Requested Quantity
Line `productVariantId` + decimal qty (step-multiple enforced server-side: whole packs for PIECE
`% 1000 == 0`, step multiples for WEIGHT); editing revalidates; requested ≠ actual (see H).

### F. Stock
Availability in weight terms per `availableQuantity`; insufficient stock for requested weight ⇒ 409 loser at checkout
(no auto-cap, no silent lower); stock moves ⇒ reprice/revalidate; no restock promises; no tolerance policy invented.

### G. Cart & Checkout Display
Line shows variant + requested weight + unit + unit price + estimate + stock + applicable discount; weight edits that
change commercial outcome require explicit re-confirm (FP05-D06/D07); reprice refreshes all WEIGHT lines; drift ⇒
old→new disclosure, submit locked.

### H. Order Display
Requested (frozen snapshot) vs actual (`actualQuantity`, null pre-fulfillment) vs estimate vs final (post-actual
computation) — shown side-by-side once actuals exist; before that, estimate-labeled only. No invented actual/final,
no settlement/payment-difference mechanics (unsupported).

### Weighted lifecycle matrix

| Stage | Input | Authoritative source | User-facing result | Failure state | Recovery | Backend evidence |
|---|---|---|---|---|---|---|
| Select weight | Preset choice | Variant `sizeUnit` + `saleStepGrams` | Validated choice + estimate | Invalid step ⇒ field error | Pick valid preset | `cart/writes.ts:110-117` |
| Preview | Weight + unit price | Live variant price | Labeled estimate | Stale price ⇒ re-read | Reprice | `lineTotalPiastres` |
| Add to cart | Variant + qty | Cart write validation | Server-confirmed line | 400 step / 409 stock | Fix qty / adjust | cart routes + writes |
| Edit qty | New qty | Server set (last-writer-wins) | Confirmed line | Step/stock reject | Revert to confirmed | `setLineQuantity` |
| Reprice | Cart | Live prices/stock | Refreshed echo, dead dropped | Transport fail ⇒ unknown | Retry | `POST cart/reprice` |
| Review (checkout) | Cart + coupon | Estimate (read-only) | Preview totals | Drift ⇒ re-confirm | Re-confirm | estimate route |
| Create | Address/coupon/key | Checkout tx (sole committer) | 201 + frozen snapshots | 409 drift/short | Same-key resolve | `orders/writes.ts` |
| Fulfill | Pick/actuals | PREPARING writes | `actualQuantity` set | Short ⇒ short-ship shown | None (terminal truth) | fulfillment + serialize |
| Post-order view | Order id | Order reads | Requested vs actual vs final | 401/410/404 per identity | Per matrix | orders reads |

### Weighted acceptance
125g/250g valid-when-step-allows; 500g/1kg/1.25kg only where supported; invalid steps rejected pre-send; no stale local
price in totals; unit-price moves handled via re-confirm; stock-short via 409 path; requested≠actual never confused;
estimate never shown as final; no invented actuals/finals; no unit conversion altering commercial qty; OOS WEIGHT shown
not sold (AC-02/03/07/08/09 + §4b row).

## 6. Product/variant rules

- Explicit parent-child: variant rows carry `productId` (`serialize.ts:115`); `listVariantsByProduct`
  exists; `variants/[id]` supports direct variant retrieval. Grouping uses ONLY these links —
  never name/image/size similarity, never synthetic frontend relationships. RECOMMENDATION (needs
  owner approval): catalog cards group by product, PDP selects variant; same product never assumed
  to share sale type/unit across variants (verify per variant from its own fields).
- A variant is purchasable iff: variant active + not deleted + product active + (for cart ops)
  step/unit valid. Prices and stock are per-variant (independent).
- Direct variant detail is supported (`variants/[id]`), so deep links and quick-view may target
  variants as well as products.

## 7. Pricing and price-change policy

- Authoritative current price: live variant `price`, re-read at cart-write, reprice, estimate, and
  checkout time. Cart snapshots (`unit_price_snapshot`) are quotes, never authority.
- `compareAtPrice` meaning: admin-maintained reference with invariant `>= price`; price updates that
  would exceed it are rejected server-side (`writes.ts:412`). It is NOT an offer proof.
- Recalculation points: add/set-line (live price snapshot), `POST cart/reprice` (refresh + drop dead
  lines), `POST estimate` (read-only — “checkout remains the sole committer”, no locks/rows),
  checkout (final authoritative computation). No price-change acknowledgement mechanism exists:
  drift is rejected or recomputed, never silently transacted — client must surface and re-confirm.
- Totals = merchandise − discounts + server-read delivery fee (`delivery.default_fee`; fail-closed
  on misconfiguration — `orders/writes.ts:160-165`); no invented fees.
- Rounding/currency: integer-piastres math; EGP display; no float anywhere.
- Three distinct concepts (never mixed): (1) last server-confirmed display price, (2) informational
  estimate, (3) latest server-calculated cart/order total.
- RECOMMENDATION (needs owner approval): on any drift, UI shows old→new with explicit customer
  re-confirmation before submit; silent auto-accept is forbidden. No new endpoint/field/token invented.

## 8. Availability and inventory conflict handling

- Availability signal: per-variant `availableQuantity` (GENERATED, never written) + derived
  `stockStatus`; list/search `inStock` filter semantics (sellable + available > 0).
- Inactive (product/variant `isActive=false` or deleted) ≠ out-of-stock: inactive is not purchasable
  and must not be shown as buyable-with-zero-stock; OOS (`غير متوفر`) is a live sellable variant at
  zero availability.
- No reservation during cart ops (draft only); atomic conditional reserve happens in the checkout
  transaction (available ≥ qty, rowcount-checked; loser ⇒ 409 single-winner).
- Stock change between page/cart/submit ⇒ revalidate; adjust/remove per server response; a product
  may display while unpurchasable (visible + disabled, never hidden silently).
- Availability-check failure (network/server) ⇒ explicit unknown state, retry path; never labeled OOS.
- Never silently lower requested quantity; never promise restock alerts (unsupported).

## 9. Promotions and offers

- Types that actually exist: `PERCENTAGE | FIXED_AMOUNT | BUY_X_GET_Y | FIXED_PRICE`
  (`engine.ts:71`, `validation.ts:10`); scopes LINE/ORDER (BXGY/FIXED_PRICE LINE-only per checkout
  gating); priority DESC → specificity → created order; stacking gate (first wins unless incoming
  stackable AND all accepted stackable; sequential compounding).
- Eligibility/targets/caps/windows/minimums evaluated server-side; cart totals include promotion
  effects as computed; mid-cart offer changes recompute (no stale benefit kept).
- No storefront offers-feed endpoint exists (store API has cart/catalog/customers/inventory/orders
  only — VERIFIED by route inventory). Compare-at alone never proves an active discount.
- FP-03 Offers entry is kept in desktop header/contextual surfaces (no bottom-tab slot, FP03-C1 final); its content state is BACKEND-CONSTRAINED: honest empty (no fake
percentages/savings/eligibility), loading vs failure distinguished, exactly as FP-04 specifies.
Card-level promotion badges allowed only from backend-computed discount rows.

## 9b. Promotion-type matrix (BACKEND-CONFIRMED from `engine.ts`/`validation.ts`/`checkout.ts`)

Engine order: priority DESC → specificity DESC → created ASC; stacking gate = first wins unless incoming stackable
AND all accepted stackable; sequential compounding on running nets; per-promo cap `maximumDiscountC`; thresholds
over ALL eligible lines; targets VARIANT/PRODUCT/BRAND/CATEGORY (OR across targets); windows startAt/endAt + status
DRAFT/ACTIVE/DISABLED; minimums `minimumQuantity` (gram-denominated for WEIGHT lines) / `minimumAmount`. ONE coupon
maximum; coupon bases read running nets after autos; coupon-gated promos never auto-apply. No "best-discount-wins"
or "one-coupon-only-because-UI-says-so" rule is invented — the above IS the rule.

| Type (backend) | Commercial name | Mechanics (exact) | Scope | Eligibility signal | Response fields | Card | PDP | Cart | Checkout | Post-order | Savings display | Qty/stock/eligibility change | Expiry/removal/change | AR message | Limits + acceptance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PERCENTAGE | نسبة % (e.g. 20% OFF is one value of this type, not a separate type) | `base × discountPercentH / 10000` on running net | LINE or ORDER | Targets + minimums + window + ACTIVE | Discount rows + nets | Badge only on proven row | Same | Line/order discount | Same | Frozen rows | Backend amount only (never local 20% math as truth) | Recompute | Benefit omitted | Proven totals | Cap applies · AC-11 |
| FIXED_AMOUNT | مبلغ ثابت | `min(discountAmountC, base)` — never negative price | LINE or ORDER | Same | Same | Same | Same | Same | Same | Frozen rows | Backend amount | Recompute | Benefit omitted | Proven totals | Floor at zero · AC-11 |
| FIXED_PRICE | سعر ثابت | Discount = `(unitPrice − fixedPrice) × qty`; fixedPrice ≥ unitPrice ⇒ skipped | LINE-only | Same | Same | Same | Same | Same | Same | Frozen rows | Backend amount | Recompute | Benefit omitted | Proven totals | Not a "fixed discount" · AC-11 |
| BUY_X_GET_Y | اشترِ X واحصل على Y | sets = `floor(bought / buyQty)`; free = sets × getQty; cross-variant (`freeVariantId`) ⇒ materialized free line (amount 0 on bought line); same-variant ⇒ discount = `min(freeGross × buyPctH / 10000, base)` (free iff buyPctH = 10000); remainder earns nothing | LINE-only | Same + qty thresholds | Discount rows + `freeQtyT`/`freeLine` | Badge only on proven row | Same + qualifying-qty hint from live data | Free line shown as its own line | Same | Frozen incl. free lines | Backend amount | Qty drop ⇒ sets recompute (free line shrinks/vanishes) | Benefit omitted | Proven totals | Dead/short free lines SKIP on commit · AC-11 |
| Promotion expired / removed / changed | — | Single display behavior (backend sends no distinct cause) | — | Windows/status/targets edit | Absent/altered rows | Badge removed | Same | Totals recomputed | Same | N/A | Nothing shown | Re-read | Omitted, never faked | Silent (notice only if total moved) | No cause invented · AC-11/12 |

## 10. Coupons

- Entry via `couponCode` in estimate and order-create (no separate apply endpoint).
- Evidence-based mapping (message = server string, never invented):

| Backend reason | Frontend state | Arabic message | Customer action |
|---|---|---|---|
| Unknown code (404) | invalid | «كود الكوبون غير صحيح.» | fix code |
| Not currently valid | invalid/expired | «الكوبون غير صالح حاليًا.» | remove/retry later |
| Minimum not reached | unmet requirement | Server minimum text | add items |
| Usage limit reached (409) | exhausted | «وصل الكوبون إلى الحد الأقصى لمرات الاستخدام.» | remove |
| Per-customer limit reached (422) | ineligible | «وصلت إلى الحد المسموح به لاستخدام هذا الكوبون.» | remove |
| Guest + per-customer limit (422) | ineligible | «لاستخدام هذا الكوبون، يُرجى تسجيل الدخول إلى حسابك أو إنشاء حساب جديد.» | register or remove |
| Wrong promo type / no eligible lines / no discount (422) | inapplicable | Server reason | adjust cart/remove |
| Network/server failure | unknown | «تعذّر التحقق من الكوبون.» + retry | retry; never claimed applied |

- Removal = resubmit without code (no removal endpoint to verify; coupon state lives in server
  evaluation). Cart changes re-evaluate (estimate/checkout recompute; no stale applied flag kept
  client-side). Applied is claimed only after server-confirmed totals include it.
- Coupon entry: single field on checkout review with the same evaluation shared by cart
  preview (one server evaluation path, displayed in both places; no separate cart-coupon state
  machine) — determined by FP-04 review structure (D13 VERIFIED).

### 10b. Coupon 23-state support audit (BACKEND-CONFIRMED vs BACKEND-GAP vs UNVERIFIED)

Normalization (frozen): trim + UPPER; empty/inner-space/>64 ⇒ 400 "Invalid coupon code." (`writes.ts:427-435`).
Estimate returns `{code, applicable, reason, amount}` (informational, no locks/bumps); checkout enforces with row
locks + conditional bumps (miss ⇒ 409). Statuses below are per-state verdicts, not new rules.

| # | Audit state | Verdict | Evidence | Check stage | Apply timing | Display | Amount on cart change | Input kept? | Safe retry? | Refetch? | AR message (approved/COPY-PROPOSAL) | Acceptance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Empty input | BACKEND-CONFIRMED (no request) | No code ⇒ no evaluation | — | — | Idle field | — | — | — | — | — | AC-13 |
| 2 | Whitespace-only | BACKEND-CONFIRMED (400) | `""` after trim ⇒ "Invalid coupon code." | Submit | Never | Field error | — | Yes | After fix | No | «كود الكوبون غير صحيح.» (approved pattern) | AC-13 |
| 3 | Malformed (inner space/>64) | BACKEND-CONFIRMED (400) | normalize rule | Submit | Never | Field error | — | Yes | After fix | No | «كود الكوبون غير صحيح.» | AC-13 |
| 4 | Unknown code | BACKEND-CONFIRMED (404 estimate/commit) | `checkout.ts:513,771` | Estimate + commit | Never | Invalid | — | Yes | Yes (new code) | No | «كود الكوبون غير صحيح.» (approved) | AC-13 |
| 5 | Accepted | BACKEND-CONFIRMED | `applicable:true + amount` / commit success | Estimate + commit | After server confirmation only | Discount line + totals | Recomputed | Yes | N/A | Yes | Proven totals | AC-13 |
| 6 | Expired / not-valid window | BACKEND-CONFIRMED (no split) | "not currently valid." `checkout.ts:515,773` | Estimate + commit | Never | Invalid/expired | Removed | Yes | Later | Yes | «الكوبون غير صالح حاليًا.» (approved) | AC-13 |
| 7 | Not yet active | BACKEND-CONFIRMED (same signal as 6) | Same check — backend does NOT distinguish | Same | Never | Same as 6 | Removed | Yes | Later | Yes | Same as 6 (no invented split) | AC-13 |
| 8 | Usage limit reached | BACKEND-CONFIRMED (409 commit) | `conflict(...used_count...)` `checkout.ts:784-786,804-806` | Commit (estimate display UNVERIFIED) | Never | Exhausted | Removed | Yes | No (new code) | Yes | «وصل الكوبون إلى الحد الأقصى لمرات الاستخدام.» (approved) | AC-13 |
| 9 | Per-customer limit | BACKEND-CONFIRMED (422 commit; applicable:false estimate) | `checkout.ts:537,795-797` | Estimate + commit | Never | Ineligible | Removed | Yes | No | Yes | «وصلت إلى الحد المسموح به…» (approved) | AC-13 |
| 10 | Guest + per-customer coupon | BACKEND-CONFIRMED (422 commit; "Customer required." estimate) | `checkout.ts:522,791-793` (BGGO-D004) | Estimate + commit | Never | Ineligible + login path | Removed | Yes | After register | Yes | «لاستخدام هذا الكوبون، يُرجى تسجيل الدخول…» (approved) | AC-13 |
| 11 | Minimum not reached | BACKEND-CONFIRMED | `checkout.ts:518-520,776-778` | Estimate + commit | Never | Unmet + server minimum text | Removed | Yes | After adding items | Yes | Server minimum text (passthrough) | AC-13 |
| 12 | Ineligible product/variant | BACKEND-CONFIRMED | "grants no discount." / "type not supported." estimate `checkout.ts:539-561`; commit "no eligible lines." / "grants no discount." `checkout.ts:820-830` | Estimate + commit | Never | Inapplicable + server reason | Removed | Yes | After cart fix | Yes | Server reason (passthrough) | AC-13 |
| 13 | Ineligible cart | BACKEND-CONFIRMED | Same probe (no eligible lines) | Estimate | Never | Inapplicable | Removed | Yes | After cart fix | Yes | Server reason | AC-13 |
| 14 | Coupon removed | BACKEND-CONFIRMED | Omit + re-evaluate (no endpoint) | Any | Immediate local omit, totals after re-eval | Idle | Recomputed | N/A | N/A | Yes | — | AC-13 |
| 15 | Coupon changed/revalidated | BACKEND-CONFIRMED | Every eval is fresh (no stale flag) | Any mutation | After re-eval | Updated | Recomputed | Yes | Yes | Yes | Proven totals | AC-13 |
| 16 | Cart changed after apply | BACKEND-CONFIRMED | Recompute (autos + coupon on running nets) | Mutation | After re-eval | Updated | Recomputed | Yes | Yes | Yes | Proven totals | AC-13 |
| 17 | Price changed after apply | BACKEND-CONFIRMED | Same recompute | Reprice/estimate | After re-eval | Updated | Recomputed | Yes | Yes | Yes | Proven totals | AC-13 |
| 18 | Promo/coupon interaction | BACKEND-CONFIRMED | ONE coupon; bases on post-auto nets; gated promos never auto | Evaluate | After confirm | Combined backend totals | Recomputed | Yes | Yes | Yes | Proven totals | AC-13 |
| 19 | Repeated apply | BACKEND-CONFIRMED | Estimate read-only (safe); commit bumps once per order tx | Any | Idempotent display | Same | Same | Yes | Yes | As needed | — | AC-13 |
| 20 | Network failure | BACKEND-CONFIRMED (unknown state) | No response ⇒ nothing claimable | Any | Never pre-confirm | Unknown + retry | Kept-as-unconfirmed | Yes | Yes | Yes | «تعذّر التحقق من الكوبون.» (approved) | AC-14 |
| 21 | Server failure | BACKEND-CONFIRMED (generic 500 envelope) | Error envelope, no coupon specifics | Any | Never | Unknown + retry | Kept-as-unconfirmed | Yes | Yes | Yes | «تعذّر التحقق من الكوبون.» | AC-14 |
| 22 | Unauthorized request | CONTRACT-CONFIRMED (inherits op auth) | No dedicated coupon 401; estimate/checkout are owner-scoped | With op | — | Op auth UX | — | Per op | Per op | Yes | Per op | AC-13 |
| 23 | Rate limited (no dedicated coupon bucket) | UNVERIFIED | No coupon-specific 429: estimate/cart routes have no bucket (verified absence); only register (openapi:407), guest-create (openapi:645 — covers coupon-bearing guest commits), guest-read (openapi:689) document 429; no Retry-After field anywhere in contract | Estimate eval: no path; guest-create commit: inherits creation bucket | Never pre-confirm | Unknown + backoff | Kept-as-unconfirmed | Yes | With backoff | Yes | «تعذّر التحقق من الكوبون.» + backoff notice | AC-14 |
| 24 | Unknown outcome | BACKEND-CONFIRMED | Same-key/GET-first discipline; never blind re-commit | Any | After resolve | Unknown + resolve path | Re-read | Yes | Resolve-first | Yes | «تعذّر تأكيد النتيجة — لا تعِد الإرسال.» | AC-14 |

Count reconciliation (audited from the 24 rows above, not from memory): the table holds the 23 audit states (#1–23)
plus one supplement (#24 unknown-outcome) = **24 rows**. Verdict totals: **BACKEND-CONFIRMED 22** (#1–21, #24) +
**CONTRACT-CONFIRMED 1** (#22 inherits host-op auth) + **UNVERIFIED 1** (#23 dedicated coupon 429) = 24. No verdict
is double-counted; #23's inherited guest-create bucket path is a documented nuance inside its single UNVERIFIED row,
not a second verdict. Prior report figures (19+1+1) were a counting error and are superseded by this row-by-row tally.

## 11. Cart state and guest persistence

- Guest cart: bearer `guestToken` returned once at creation (`createGuestCart`); customer cart:
  server session. Ownership XOR enforced; merge binds guest→customer explicitly
  (`mergeGuestCartToCustomer`: reassign when customer holds no ACTIVE cart, else per-line
  sum + live reprice, dead lines dropped + reported). No invented merge/conflict policy.
- Expiry: SQL-clocked `expires_at` gates operability (expired ⇒ behaves as absent: mutations 404,
  merge/checkout reject). No indefinite-persistence or cross-device continuity claim (bearer is
  device-local; NOT VERIFIED beyond single-client use).
- Mutations return the complete updated cart (add/set UPSERT + reprice paths return full cart).
- Concurrency: same-cart writers serialize on row locks; set-quantity is last-writer-wins;
  UI reconciles by replacing displayed cart with the latest server-confirmed cart after conflict.
- Estimate is read-only (no locks/rows/counters). After auth/token errors: re-establish identity
  (login / fresh guest cart), preserve lines locally where possible, revalidate before transacting.
- Never conflate guest-cart bearer with guest-order credential (separate secrets, scopes, lifecycles).

## 11b. Cart-states matrix (the nine required states)

| State | Trigger | Scope | Source | Display | Preservation | Allowed | Blocked | Recovery | Retry safe? | Revalidation | AR message | Evidence | Acceptance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Empty | No lines | Whole cart | Cart read (0 lines) | Guided empty + shop path | — | Browse/search | Checkout | Add items | N/A | — | «سلتك فاضية — ابدأ التسوق من الأقسام أو البحث.» (approved FP-04) | cart read | AC-15 |
| Normal | ≥1 sellable line | Lines + summary | Full-cart echo | Lines + totals (quotes) | Selections | Edit/remove/checkout | — | — | Per-op | On mutation | — | echo | AC-15/19 |
| Out of stock | Line sellable, qty unavailable | Line(s) | Reprice/estimate/checkout 409 | Line flagged, kept visible | Rest of cart | Adjust/remove per server | Transact stale line | Revalidate + adjust | Reads yes; submit after fix | Reprice/estimate | Server reason | 409 loser path · AC-09 |
| Price changed | New live price | Line(s) | Reprice/estimate | Old→new + re-confirm gate | Cart | Re-confirm / edit | Submit stale | Re-confirm | After confirm | Immediate | Approved change message | D06/D07 · AC-08 |
| Promotion changed | Altered/dropped rows | Line(s)/summary | Fresh evaluation | Silent badge update; notice if total moved | Cart | Continue / adjust | Claim stale benefit | Re-read | Yes | Reprice/estimate | Silent or total-moved notice | engine · AC-11 |
| Quantity conflict | Step/stock/concurrent-write reject | Line | Set/add response (400/409) | Field/line error | Rest of cart | Fix qty / retry latest | Overwrite blindly | Adopt server-confirmed | Latest-intent only | Re-read line | Server message | writes · AC-15/19 |
| Dead variant | Variant inactive/deleted/gone | Line | Reprice/merge/add reject | Line dropped + reported («غير متوفر», approved — same OOS treatment) | Rest of cart | Remove / replace choice | Purchase it | Pick live variant | Yes | Reprice | «غير متوفر» (approved) | liveness gating · AC-07 |
| Merge conflict | Guest→customer merge races/dead lines | Lines | `POST cart/merge` response | Merged cart = full replace + dropped-reported | surviving lines | Continue | Assume pre-merge cart | Adopt response | Explicit only (never auto) | Post-merge read | Notice of dropped lines | `mergeGuestCartToCustomer` · AC-15 |
| Guest expiry | Bearer expired/invalid | Whole cart | 404/absent on mutate | Access-required + fresh-cart path | Local lines where possible | Mint fresh / login | Transact as ghost | Re-establish identity + revalidate | Fresh only | Full re-read | Cart bearer: access-required (COPY-PROPOSAL); order credential: «تعذّر الوصول إلى الطلب — سجّل الدخول أو تواصل مع الدعم.» (approved FP-04) | SQL `expires_at` · AC-16/17 |

Empty-with-unsellable-lines is NOT auto-cleaned: dead lines stay visible with their problem until reprice/merge
resolution or explicit user removal (security/contract limits excepted).

## 11c. Promotion × Coupon × Weighted interactions (no invented precedence; engine-verified or marked open)

1. Price moves under promotion → reprice/estimate recompute; surface old→new, re-confirm (D06/D07).
2. Promotion expires post-add → rows recompute; badge omitted silently; totals from fresh responses.
3. Qty change kills eligibility → discount drops on recompute; line stays at live price.
4. BXGY with a qualifying unit removed → sets recompute; free line shrinks/vanishes (never kept phantom).
5. Free line rules unmet → SKIP on commit (auto-exhaustion pin); UI mirrors post-recompute truth.
6. Coupon on discounted cart → coupon bases read post-auto running nets (§10b-18); single combined total.
7. Price/stock moves after coupon accept → full recompute; coupon may flip inapplicable (reason shown).
8. Weight change on promoted WEIGHT line → estimate recompute; minimums re-checked gram-denominated.
9. Weight change shifting coupon/promo eligibility → same recompute; reasons surfaced, never auto-submitted.
10. Multi-line reprice → whole-cart replace with latest confirmed echo; per-line outcomes preserved.
11. Single-line update fails → that line errors; rest of cart adopts confirmed state (no wholesale loss).
12. Merge fail / cart identity expiry → access-required + fresh-cart path; guest-order credentials untouched
    (separate lifecycle; expiry of one never invalidates the other).

Unresolved-none: all twelve resolve from engine/checkout/cart contracts above; any future promo mechanic not in
`promotionTypeSchema` is BACKEND-GAP by construction (UI renders no badge for unknown types).

## 12. Checkout handoff and idempotency

Per FP-04 (unchanged): latest cart/price/inventory confirmation via reprice+estimate; coupon/promo
consistency from the same evaluation; submit payload = address/coupon/key per verified contract;
idempotency key required (header wins ties; missing rejected; reuse-with-change ⇒ 409; same key +
same cart ⇒ original replayed, no duplicate, no second guest token); ambiguous/timeout outcome ⇒
same-key recovery only, never blind new-key retry; UI states idle/submitting/succeeded/confirmed vs
failed/ambiguous; nothing truthful claimable before the confirmed creation response. No payment,
refund, delivery-zone, or delivery-time promises (all unsupported).

## 13. Loading, empty, stale, and failure states

Loading skeletons (never white screen, never stale-as-final) · Empty ≠ error (cart/search/orders/
addresses each with shop/search action) · Stale (revalidation pending or failed → badged data +
retry, never silent overwrite) · Failure (transport vs validation vs conflict vs authz mapped per
matrix; field-bound messages; safe retry only) · Auth expiry mid-flow (preserve non-sensitive input,
resume post-login) · Terminal-order actions disabled with reason. Arabic, human, no error codes shown.

## 13b. Error-to-UX mapping (commerce errors; codes are contract-verified, never assumed)

| Failure | Operation | Code/fields | Precisely identifiable? | AR message | Preserve | Refetch? | Retry safe? | Stop/escalate when | Acceptance |
|---|---|---|---|---|---|---|---|---|---|---|
| Input validation | Cart add/set, coupon normalize, address | 400 + shape | Yes | Field error | Inputs | No | After fix | N/A | AC-03/04/10 |
| Auth/session lost | Any owner op | Generic 401 | Yes (never which secret) | Login prompt, resume | Non-sensitive | Yes | After login | N/A | AC-16/17 |
| Guest credential bad/expired | Order reads | 401 / 410 / 404-masked | Yes | Access-required / expired + support | Nothing protected | No | No (staff path) | Always stop | AC-16/17 |
| Unknown/inactive resource | PDP/cart | 404 | Yes | Not-found + path back | Context | No | No | Always stop | AC-04/07 |
| Stock/qty conflict | Set/checkout | 409 loser / step 400 | Yes | Per-line outcome | Rest of cart | Yes | Latest-intent only | After server adopt | AC-09 |
| Price/promo moved | Reprice/estimate | Fresh rows | Yes | Old→new / silent badge | Cart | Yes (immediate) | After re-confirm | Until confirmed | AC-08/11 |
| Coupon refused | Estimate/checkout | 404/400/409/422 + reason | Yes | §10 table (approved/passthrough) | Code + cart | Yes | Yes (new code/fix) | N/A | AC-13/14 |
| Idempotency conflict | Create | 409 different-terms | Yes | Same-key recover path | Everything | Yes | Same-key only | Never new-key | AC-18/20/21 |
| Rate limited | Reads/mutations on bucketed paths (guest create/read, register — verified; other paths: no bucket evidenced) | 429 + backoff where bucketed, else unknown | Partially | Backoff notice | Everything | Yes | With backoff | After budget | AC-14 |
| Transport failure | Any | None/timeout | No (unknown) | Retry affordance, stale badge | Everything | Yes | Reads yes; mutations re-read-first | After budget | AC-10/14 |
| Server error | Any | 500 envelope | No | Generic + retry | Everything | Yes | As transport | After budget | AC-14 |
| Ambiguous timeout | Mutations (esp. create) | None confirmed | No | "لا تعِد الإرسال" + resolve | Everything | Yes (resolve-first) | Resolve-first only | Until resolved | AC-18/20/21 |

Never: stack traces/inner messages to users; "حدث خطأ" where the contract allows precision; cross-owner detail;
blind re-execution after ambiguous create; pre-confirmation success claims; stale-total checkout.

403 has no customer-commerce surface (permission denial is admin-scope; foreign reads mask as 404) — N/A here, not UNVERIFIED.

## 14. Accessibility and Arabic RTL requirements

Server-owned data rendered with semantic HTML; keyboard-operable stepper/quantity/CTA flows with
visible focus; screen-reader labels on price/unit/quantity/add/remove (values announced, not
codes); RTL-first layout with logical property direction; errors programmatically associated;
touch-sized controls; no hover-only affordances; no keyboard traps in drawers/sheets; sticky CTA
never covers fields or errors. No runtime a11y testing claimed (specification only).

## 14b. Frontend implementation contract (FP-12 component map; behavior only, no code)

Sub-elements ProductPrice/PromotionBadge/StockStatus are ProductCard internals (promotable iff reused ≥3 screens —
FP-12 §Commerce). Loading ≠ unavailable ≠ failure everywhere; quotes ≠ confirmed prices; selections kept as drafts,
never as commercial truth.

| Component (FP-12) | Allowed display states | Source per state | Add/edit gating | Drift rule | AR/RTL/a11y notes |
|---|---|---|---|---|---|
| ProductCard (+ProductImage) | Normal / OOS-disabled / unknown-retry / skeleton | List rows + per-card enrichment | Via AddToCartButton | Re-read, no stale checkout | `aria-live` price/stock; wrap names |
| ProductPrice | Server price / compare-at (iff non-null) / estimate-labeled (WEIGHT) | Variant payload | N/A (display) | Old→new disclosure | Exact strings, `152 ج.م` style |
| PromotionBadge | Present iff proven discount row; else absent | Estimate/checkout rows | N/A | Silent removal | Never from compare-at alone |
| StockStatus | Sellable / OOS «غير متوفر» / unknown-retry | Inventory reads | N/A | Unknown ≠ OOS | Announced, not color-only |
| VariantSelector | Options with per-variant price/stock/validity | Variants + inventory | Invalid option unselectable | Switch re-reads variant | Named options, step rules |
| QuantityControl (Piece/Weight/Stepper) | Whole packs / step presets / field errors | Step rules + server confirm | Invalid pre-send block | Server revalidates | Large targets, keyboard-safe |
| AddToCartButton | Idle / pending (single-flight) / disabled-OOS / error-retry | Cart write responses | Disabled when backend blocks | Never success pre-response | Named control, spinner + `aria-busy` |
| CartItem | Normal / flagged-line / line-pending / dropped-reported | Cart echo | Per-line server outcome | Adopt confirmed | Preserved context |
| CartSummary | Quote totals / estimate preview / confirmed (post-201 only) | Echo → estimate → frozen | N/A | Never client-math authority | Estimate labeled non-final |

## 15. Decision register

| ID | Topic | Question | Evidence | Existing rule | Proposed UX | Status | Owner? | Acceptance | Dependencies |
|---|---|---|---|---|---|---|---|---|---|
| FP05-D01 | Card fields | Which fields show? | serialize VariantShape/list shapes; images; inventory status | Server truth | §4 contract | VERIFIED (fact) | No | AC-01/05/06 | catalog/inventory APIs |
| FP05-D02 | PIECE interaction | Pack stepper rules? | `assertLineShape`; whole-pack CHECK | Server validates | integer packs, server-confirmed | VERIFIED | No | AC-01/08 | cart API |
| FP05-D03 | Weight selection | Which presets? | `saleStepGrams` + step rule; FP-00-D010 already frames presets as step-gated examples | No universal preset rule exists | offer a preset only where it satisfies that product's step multiple | VERIFIED (determined by existing authority; nothing new to approve) | No | AC-02 | cart API |
| FP05-D04 | Unit conversion | How g/kg shown? | SIZE_UNITS PIECE/KG/GRAM/LITER/ML; thousandths math; no precision change permitted | Display ≠ API units | show the variant's own sizeUnit; KG↔g conversion is display-only exact (1 kg = 1000 g); always transmit exact decimal strings | VERIFIED (determined; no numeric rule changed) | No | AC-02 | — |
| FP05-D05 | Grouping | Group by product? | productId FK; `listVariantsByProduct`; `variants/[id]`; independent price/stock per variant | Explicit links only | group catalog cards by product; PDP variant selector preserves per-variant identity/price/stock/purchase; selector visuals belong to design phase (out of scope here) | VERIFIED (data model dictates pattern) | No | AC-06 | catalog API |
| FP05-D06 | Price drift browse | Refresh or warn? | No ack endpoint exists (verified absence); recompute via reprice/estimate; checkout recomputes finally | No silent transact | surface old→new + require re-confirmation before submit; notification styling is design-phase | VERIFIED (behavior forced by absence; no alternative exists) | No | AC-08 | reprice/estimate |
| FP05-D07 | Price drift cart | Block or adjust? | Same absence; estimate/checkout recompute authoritatively | Same | adjust to server + notice; never auto-submit on drifted totals | VERIFIED (only contract-compatible behavior) | No | AC-08 | estimate/checkout |
| FP05-D08 | Stock conflicts | Cap, remove, or block? | 409 reserve loser; no auto-cap rule; last-writer-wins set-quantity; no network-as-OOS rule | Never silent-lower | per-line server outcome + recovery message; network failure shows unknown + retry | VERIFIED (all behavior contract-forced) | No | AC-09/10 | inventory/checkout |
| FP05-D09 | Inactive vs OOS | Different states? | isActive/deleted vs available≤0 | Distinct domains | inactive: not purchasable (hide/disable per context); OOS «غير متوفر» | VERIFIED | No | AC-07 | catalog/inventory |
| FP05-D10 | Previous price | When show struck price? | `compareAtPrice` + invariant | Never computed | show only when backend non-null | VERIFIED | No | AC-05 | variant payload |
| FP05-D11 | Promo badge | When badge? | Discount rows from evaluation | No badge from compare-at alone | badge only on proven benefit | VERIFIED | No | AC-11 | estimate/checkout |
| FP05-D12 | Offers feed | How fill Offers entry? | No feed endpoint | Entry kept in desktop header/contextual surfaces (FP03-C1; no bottom-tab slot) | honest empty; no scan | BACKEND-CONSTRAINED | No* | AC-12 | (future feed) |
| FP05-D13 | Coupon placement | Cart, checkout, or both? | Single evaluation path (estimate/checkout); FP-04 review section already includes coupon | One evaluation | entry field in checkout review; cart shows the shared evaluated result (no separate cart-coupon state) | VERIFIED (determined by FP-04 structure; placement has no business consequence) | No | AC-13 | estimate |
| FP05-D14 | Coupon messages | Which text per case? | §10 reason→state→action mapping; owner-approved fixed Arabic copy (2026-10-09) | Functional mapping fixed; Arabic phrasing owner-approved | §10 table exact approved wording; rows 3+7 remain server-passthrough by design | OWNER-APPROVED / CLOSED | No | AC-13/14 | checkout |
| FP05-D15 | Coupon removal | How remove? | No removal endpoint | Resubmit w/o code | removal = omit + re-evaluate | VERIFIED | No | AC-13 | estimate/checkout |
| FP05-D16 | Cart truth | Whose cart shows? | Full-cart mutation responses | Replace on conflict | server-confirmed replace | VERIFIED | No | AC-15/19 | cart API |
| FP05-D17 | Guest persistence | How long/where? | Bearer + SQL expiry; device-local | No cross-device claim | persist token; revalidate; fresh on expiry | VERIFIED | No | AC-16/17 | cart/session |
| FP05-D18 | Duplicate mutations | Double-click safe? | UPSERT + idempotent ops; order keys | Guarded submit | disable-in-flight + keys | VERIFIED | No | AC-18/20/21 | cart/orders |
| FP05-D19 | Ambiguous submit | New key or same? | Same-key replay, no 2nd token | Never blind retry | same-key recovery UI | VERIFIED | No | AC-20/21 | orders |
| FP05-D20 | State coverage | Loading/empty/stale/error? | Matrix §13 | All covered | per-state patterns | VERIFIED | No | AC-all | — |
| FP05-D21 | RTL/a11y | Arabic + keyboard? | FP-00-D028/D029/D067 lock Arabic RTL + WCAG 2.2 AA mindset + rtl shell (§14 restates them) | Mandatory requirements already established | §14 contract stands as the requirement set; visual refinements belong to design phase | VERIFIED (requirements locked; nothing new to approve) | No | AC-23 | — |

*D12 needs no approval to stay honest-empty; a future feed would need backend + owner scope.

## 16. Acceptance criteria

- AC-01: Given a PIECE product with an active sellable variant, When viewed, Then card shows image-or-fallback, full name, variant/size, server price, availability, working add.
- AC-02: Given each approved WEIGHT choice valid under that product's step, When selected, Then estimate shows weight + total marked non-final; invalid decimals rejected pre-send.
- AC-03: Given free-form weight violating the step, When entered, Then field error, nothing sent.
- AC-04: Given missing image, When rendered, Then neutral placeholder never presented as real photo.
- AC-05: Given long Arabic name + RTL, When rendered, Then wraps without clipped meaning; compare-at shown only when backend non-null.
- AC-06: Given multiple variants with independent prices, When switching, Then price/stock/add update from that variant only.
- AC-07: Given variant A unavailable + variant B available, When viewed, Then A disabled «غير متوفر», B purchasable; inactive product never buyable.
- AC-08: Given price change catalog→cart, When detected, Then old→new surfaced, submit requires re-confirmation.
- AC-09: Given depletion between load and submit, When server rejects, Then per-line outcome + message; no silent lowering.
- AC-10: Given availability refresh fails, When offline, Then explicit unknown state + retry; never labeled OOS.
- AC-11: Given no active promotion, When viewed, Then no badge/claim of any kind.
- AC-12: Given Offers opened with (a) no feed → honest empty; (b) loading → skeletons; (c) failure → retry distinct from empty. (Feed itself: BACKEND-CONSTRAINED.)
- AC-13: Given coupon accepted, Then totals include it only after server confirmation; each table reason maps to its message; removal re-evaluates.
- AC-14: Given coupon check unreachable, When failed, Then unknown state + retry; never claimed applied/failed.
- AC-15/19: Given mutation success/failure or concurrent conflict, Then displayed cart equals latest server-confirmed cart.
- AC-16/17: Given expired/invalid guest credentials, Then re-establish identity; refresh/reopen works only within the bearer contract; no cross-device claim.
- AC-18/20/21: Given duplicate/concurrent/ambiguous submits, Then single order effect; same-key recovery; no pre-confirmation success state.
- AC-22: (Reserved numbering; covered by AC-20/21.)
- AC-23: Given keyboard/screen-reader/RTL use, Then labeled controls, visible focus, associated errors, logical RTL order.

## 17. Verified backend limitations

No storefront offers feed · no price/popularity sort (listing sorts per contract) · no profile PATCH · no payments/refunds · no delivery zones/times/slots · no realtime/push · no back-in-stock alerts · no bulk/catalog admin surfaces on storefront · guest bearer is device-local · estimate is read-only · coupons evaluate server-side only.

## 17b. Capability × classification × test mapping (STATIC-VERIFIED; tests cited, none executed here)

| Commerce rule | Operation (real) | Classification | Covering backend suite |
|---|---|---|---|
| List/variant/detail/images | `GET catalog/*` | BACKEND-CONFIRMED | t-catalog 56/56, t-catalog-unit 16/16 |
| Availability/inventory | `GET inventory/*` | BACKEND-CONFIRMED | t-catalog, t-orders 54/54 |
| Cart draft/mutate/merge/reprice | `cart/*` | BACKEND-CONFIRMED | t-cart 50/50 |
| Estimate/coupon eval | `POST orders/estimate` | BACKEND-CONFIRMED | t-orders, t-promotions 58/58 |
| Order create + idempotency | `POST orders` | BACKEND-CONFIRMED | t-orders, t-guest-orders 66/66 |
| Promotions engine (4 types/stacking/caps) | Evaluation inside estimate/checkout | BACKEND-CONFIRMED | t-promotions 58/58 |
| WEIGHT steps/estimates/actuals | Cart validation + order serialize | BACKEND-CONFIRMED | t-cart, t-orders |
| Guest identity/rate limits | Register + `reg:` buckets | BACKEND-CONFIRMED | t-customer-register-ratelimit 14/14, t-customer-auth 37/37 |
| Offers feed / price sort / autocomplete | — none | BACKEND-GAP — No verified operation found (safe UX: honest-empty, supported sorts only, submit-only search) | — |
| Profile PATCH / OTP / payments / zones / realtime / restock | — none | BACKEND-GAP — No verified operation found (safe UX: surface omitted, never faked) | — |
| Coupon-specific 429 | — none dedicated | UNVERIFIED (treat as unknown + backoff) | — |

## 17c. Gap register (new IDs only; existing D/§ references reused, never renumbered)

| ID | Domain | Description | Evidence | Why a gap | UX impact | Data/commerce impact | Core or sub? | Class | Safe alternative | Future owner/stage | Owner decision? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FP05-G1 | Promotion | Expired vs removed vs changed indistinguishable in responses | Re-audited: auto-promo discount rows carry NO cause/reason field (serialize LineApp: id/type/amounts/targets only); only the coupon estimate object has `{applicable, reason}` (`checkout.ts:401`); recompute drops/alters rows silently | Proven signal absence (not an oversight) | Single silent-update behavior mandatory | None (totals always fresh) | Sub | CLOSED — EVIDENCE-BACKED | Silent badge update | — | No |
| FP05-G2 | Coupon | Usage-limit visibility + display mapping | Re-audited 9 questions: total limit (`coupons.usage_limit`) + per-customer limit (`per_customer_limit`) exist server-side; counted ONLY at commit via conditional bump (`checkout.ts:779-806`); estimate is informational (`checkout.ts:279` filters, no bumps); limit VALUES never exposed — openapi has zero usage-limit fields; guest vs registered split verified (BGGO-D004, `checkout.ts:522,787-798`); total-limit refusal = 409, per-customer = 422 (both proven by code + t-promotions `coupon-limit-no-usage`, `coupon-per-customer-422`, `coupon-usage-row`); limits may change between apply and create → commit re-enforces (race resolves by re-estimate + bump) | Frontend knows refusal signals + reasons, never counts | Refusal UX per §10b (no invented numbers) | None (commit is truth) | Sub | DOCUMENTATION-CLOSED (matrix complete; non-exposure is intended posture, not a defect) | Refusal reasons only | Commit path | No |
| FP05-G3 | Coupon | Dedicated coupon 429 absent | Re-audited per-operation: estimate/cart routes have NO bucket (verified absence in route files); documented 429s are register (openapi:407), guest-create (openapi:645 — inherited by coupon-bearing guest commits), guest-read (openapi:689); no Retry-After field anywhere in contract; no coupon-429 test exists | Dedicated 429 unproven; inherited path documented | Generic unknown + backoff (never a promised wait) | None | Sub | OPEN — UNVERIFIED (dedicated signal) | Unknown + backoff | — | No |
| FP05-G4 | Weighted | No preview endpoint beyond live data | Re-audited: no dedicated preview op in route inventory; preview composed from live variant price + cart/estimate (t-cart `add-weight-200`/`set-weight-200` prove the flow); `actualQuantity: string|null` verified (`orders/serialize.ts:23,43`, null pre-fulfillment); estimate labels stay non-final | Experience fully specifiable (§5b) without a preview op | Estimate-labeled display only | Never final until commit | Sub | DOCUMENTATION-CLOSED (experience) + BACKEND-GAP (dedicated preview op absent) | Labeled estimates | Estimate/cart suites | No |
| FP05-G5 | Cart/order continuity | Cross-device bounds per identity | Re-audited four-way: guest cart bearer device-local, no recovery op (route inventory: mint/resolve/read/mutate/merge/reprice only); guest order via FP03-G1 same-browser cookies, cross-device staff-path only; REGISTERED cart is server-side (`getOrCreateCart` customer path, `cart/route.ts:39`) so re-login on a new device restores the ACTIVE cart + addresses + orders (correction: prior "no sync" phrasing covered guest bearer only); registered session itself re-authenticates per browser (phone+password) | Guest: fresh mint / staff path; registered: re-login restores server data | Guest drafts don't roam; registered carts do | Sub | DOCUMENTATION-CLOSED (bounds per identity now explicit) | Fresh mint + re-login | Cart/session contracts | No |
| FP05-G6 | Copy | Non-§10/D14 state wordings | Re-audited all 4 proposal sites: dead-variant → CONVERTED to approved «غير متوفر» (same OOS treatment, §4b row); inactive-product, WEIGHT-estimate label, cart-bearer access-required remain COPY-PROPOSAL (no approved string covers them; FP-04 order-credential string covers order-credential only, not cart bearer) | 1 converted, 3 proposals | Proposals marked, never approved-claims | None | Sub | OWNER DECISION REQUIRED (copy approval; documentation otherwise complete) | 3 proposals in §§4b/5b/11b | Owner copy review | Yes (approval only) |

## 18. Owner decisions — closure review (2026-10-09 audit)

Prior list retired: D03 (presets determined by FP-00-D010 + step rule), D04 (units determined by
SIZE_UNITS, exact conversion), D05 (grouping dictated by data model; visuals out of scope), D06/D07
(drift behavior forced by absent ack mechanism), D08 (conflict outcomes contract-forced),
D13 (placement determined by FP-04 review section), D21 (requirements already locked).
One retained item:

| ID | Question | Why existing authority is insufficient | Alternatives | Recommended default | Consequences | Blocks implementation? |
|---|---|---|---|---|---|---|
| FP05-D14-wording | Approve the final Arabic coupon messages in §10? | Owner decision recorded 2026-10-09: exact fixed messages applied to §10 rows 1, 2, 4, 5, 6, 8; rows 3 and 7 remain server-passthrough by design (no fixed wording invented) | — (closed) | Applied verbatim; reason-code mappings, validation, statuses, and retry behavior unchanged | — | No |

## 19. Evidence/source index

`src/lib/catalog/{serialize,validation,writes,queries,search,media}.ts` · `src/lib/cart/{validation,writes,queries,totals,serialize}.ts` · `src/lib/promotions/{engine,checkout,validation,serialize}.ts` · `src/lib/inventory/{service,serialize,queries}.ts` · `src/lib/orders/{validation,writes,serialize}.ts` · `src/lib/replacements/{validation,writes}.ts` · `src/app/api/store/{catalog,cart,orders,customers,inventory}/**/route.ts` · `docs/openapi.yaml` · `docs/backend-{cart,catalog,promotions,orders,inventory,application-contract}.md`.

## 20. Resolution log and final verdict

Audits 6.1–6.10 executed against sources above; locked context preserved (FP-03 nav final FP03-C1, FP-04 journey/checkout, guest-no-account, price/stock authority, PIECE/WEIGHT, EGP, no-governorate, brand/VI-01, FP-09 untouched, offers/profile gaps as documented, credential separation incl. FP03-G1 adapter rule, idempotency). Closure audit 2026-10-09: prior §18 list retired except one narrowed copy item (D14 wording); all other behavior determined by existing authority/evidence. Copy closure 2026-10-09: owner-approved fixed messages applied verbatim; rows 3 and 7 confirmed as server-passthrough (no invented wording). Counts reconciled: 21 register entries = 21 closed (20 VERIFIED/determined + D12 BACKEND-CONSTRAINED + D14 OWNER-APPROVED); 0 NEEDS OWNER DECISION remaining. No implementation, runtime testing, backend, migration, dependency, commit, or deploy performed.

`FP-05 SPECIFICATION COMPLETE WITH DOCUMENTED BACKEND CONSTRAINTS`

Re-audit (gap review task): G1 CLOSED — EVIDENCE-BACKED (signal-absence proven); G2/G4/G5 DOCUMENTATION-CLOSED
with residual notes (limit invisibility intended; no preview op; guest device-bounds + registered server-cart
correction); G3 OPEN — UNVERIFIED (dedicated coupon 429); G6 OWNER DECISION REQUIRED (3 copy proposals);
coupon tally corrected to 22/1/1 = 24 rows (§10b note); dead-variant converted to approved copy; 403 marked N/A.
No locked decision, approved copy, or unrelated section altered.
