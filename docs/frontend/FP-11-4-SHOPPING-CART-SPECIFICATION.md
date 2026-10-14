# FP-11.4 — Shopping Cart UX Specification

> Classification: `VERIFIED` (repo/openapi/code evidence below) · `LOCKED` (existing approved decision) ·
> `OWNER-APPROVED (delegated, 2026-10-09)` (D24–D30 closed under delegated authority for this task only) ·
> `NEEDS OWNER DECISION` · `UNSUPPORTED` (capability absent) · `NOT VERIFIED`. Specification only —
> no implementation, no backend change. No approval is claimed beyond D24–D30 as recorded in §19.

## Section 1 — Executive Summary

**Purpose.** Define the customer-facing shopping cart experience for Hyper Al-Moatasem before any
frontend implementation, contract-first from the verified backend.

**Scope.** One cart page + its item rows + summary + all loading/error/recovery states, for
authenticated and guest customers, PIECE and WEIGHT products, on RTL mobile-first layouts.

**Major constraints (all VERIFIED).**

- Cart is draft-only: it NEVER reserves inventory (`src/lib/cart/writes.ts:4-6`). Availability is
  enforced at checkout, not by cart membership.
- Server is authoritative for prices, totals, validation, and mutation success. Cart snapshots
  (`unit_price_snapshot`) are quotes; live variant `price` is the basis; checkout is final.
- Cart payload carries NO images, NO `compareAtPrice`, NO discount rows, NO coupon state, NO
  availability, NO delivery fee, NO final payable total. Each missing field has a named supplemental
  source or is explicitly unavailable until Checkout (FP-11.5).
- Identity is strict XOR: `x-guest-token` header OR server-verified customer session — never a
  client-supplied `customerId`. Both sides together is 400. Login does NOT auto-merge; merge is an
  explicit `POST /cart/merge` call.
- Quantity wire is decimal text `NUMERIC(12,3)`, strictly > 0. Zero is rejected; removal is DELETE-only.
  PIECE = whole packs; WEIGHT = exact `saleStepGrams` multiples. Variant change is NOT a quantity edit.

**Status: `SPECIFICATION COMPLETE — OWNER DECISIONS D24–D30 RECORDED (delegated, 2026-10-09)`.**
All cart operations, state transitions, mappings, and acceptance criteria are specified without
guessing. The seven decisions FP11-D24…D30 are OWNER-APPROVED under delegated authority supplied
for this closure task only (provenance in §19); no direct user per-decision statement is claimed,
and no backend behavior was changed or newly verified by these approvals. Implementation remains
unstarted.

## Section 2 — Scope and Non-Goals

**In scope.**

- Cart page structure, item content, summary, primary/secondary actions, empty/loading/error/retry
  states, mobile bottom-nav integration.
- PIECE increment/decrement and WEIGHT preset/step interactions against the verified rules.
- Server-confirmed totals presentation; price-change and availability-change handling.
- Remove-item and clear-cart flows with server confirmation.
- Concurrency model for rapid/repeated interactions from verified server behavior.
- API-to-UI mapping, RTL/a11y/responsive rules, security handling, acceptance criteria, decision register.

**Explicit non-goals (out of scope, must not be built here).**

- Checkout implementation, order submission, payment processing, delivery-fee calculation, order
  tracking — all FP-11.5 Checkout scope.
- Any backend change: no route/schema/migration/seed/RBAC/rate-limit change.
- Favorites, promotion feeds, coupon lists, batch endpoints, restock alerts, related-products,
  reviews/ratings — all UNSUPPORTED (no endpoint); must not be invented.
- Automatic login-time cart merging, automatic substitutions, silent quantity capping — forbidden
  workarounds; documented as limitations with owner decisions instead.

## Section 3 — Evidence and Contract Sources

All rows inspected in this task (read-only; no execution claimed as test evidence).

| # | Capability | Evidence | Status |
|---|---|---|---|
| E1 | Cart mint/resolve: `POST /api/store/cart` — neither side mints guest (201+`guestToken`), existing ACTIVE resolves (200); both sides 400; bad session 401 | `src/app/api/store/cart/route.ts:15-51`, `docs/openapi.yaml:505-515` | VERIFIED |
| E2 | Cart read: `GET /api/store/cart` — XOR identity; neither side 400; expired/consumed/unknown 404 | `src/app/api/store/cart/route.ts:53-72`, `docs/openapi.yaml:516-525` | VERIFIED |
| E3 | Add line: `POST /api/store/cart/items` `{productVariantId, quantity}`; re-add aggregates at live price; answer 200 full cart; 400/401/404/422 mapped | `src/app/api/store/cart/items/route.ts:14-44`, `src/lib/cart/writes.ts:197-221`, `docs/openapi.yaml:526-547` | VERIFIED |
| E4 | Set quantity: `PATCH /api/store/cart/items/{variantId}` `{quantity}` last-writer-wins; missing line null→404; answer 200 full cart | `src/app/api/store/cart/items/[variantId]/route.ts:14-49`, `src/lib/cart/writes.ts:225-242`, `docs/openapi.yaml:556-574` | VERIFIED |
| E5 | Remove line: `DELETE /api/store/cart/items/{variantId}`; missing→404; answer 200 full cart | `src/app/api/store/cart/items/[variantId]/route.ts:51-74`, `src/lib/cart/writes.ts:245-259`, `docs/openapi.yaml:575-583` | VERIFIED |
| E6 | Clear cart: `DELETE /api/store/cart/items`; row stays ACTIVE; answer 200 emptied cart | `src/app/api/store/cart/items/route.ts:46-64`, `src/lib/cart/writes.ts:315-322`, `docs/openapi.yaml:548-555` | VERIFIED |
| E7 | Merge: `POST /api/store/cart/merge` — guest header REQUIRED + customer session; reassign (no customer ACTIVE) or per-line sum + live reprice with dead-line drops; report `{mode, inserted, summed, dropped}`; unknown token 404; consumed/non-guest 409 | `src/app/api/store/cart/merge/route.ts:19-53`, `src/lib/cart/writes.ts:338-417`, `docs/openapi.yaml:584-594` | VERIFIED |
| E8 | Reprice: `POST /api/store/cart/reprice` — strict empty body; refresh every line to LIVE price + drop dead variant/product lines; report `{repriced, dropped:[{lineId, variantId}]}`; quantities untouched; no inventory/promo/coupon touched; expired/consumed 404 | `src/app/api/store/cart/reprice/route.ts:16-48`, `src/lib/cart/writes.ts:271-311`, `docs/openapi.yaml:595-611` | VERIFIED |
| E9 | Owner resolution XOR: `x-guest-token` (64-hex shape) XOR session (`__Host-customer-session` cookie / `x-customer-token` header); both→400; malformed guest→400; invalid session→401 via `requireCustomer`; neither→null (mint or 400 per route) | `src/lib/cart/owner.ts:18-44`, `src/lib/cart/session.ts:24-26`, `src/lib/customers/cookies.ts:11-24`, `src/lib/customers/session.ts:130-148` | VERIFIED |
| E10 | Quantity schema: text regex `^\d+(\.\d{1,3})?$` + `> 0`; never `z.coerce`; strict objects (unknown fields 400) | `src/lib/cart/validation.ts:12-38` | VERIFIED |
| E11 | PIECE whole packs (`% 1000 == 0` thousandths) else 422; WEIGHT step multiples (`saleStepGrams`, GRAM×1000) else 422; missing step → unsellable; liveness gates variant AND product | `src/lib/cart/writes.ts:97-119`, `src/lib/cart/queries.ts:49-72` | VERIFIED |
| E12 | Cart shape: `{id, status, customerId\|null, guest, expiresAt, lines[], subtotal, updatedAt}`; line `{productVariantId, variantName, productId, productName, productType, quantity, unitSnapshot, unitPriceSnapshot\|null, lineTotal\|null, priceCheckedAt\|null}`; decimals exact strings; money informational piastres, `ROUND(qty×price,2)` | `src/lib/cart/serialize.ts:12-74`, `src/lib/cart/totals.ts:37-57` | VERIFIED |
| E13 | Draft-only + locks: no inventory call in cart writes; `SELECT … FOR UPDATE` on cart row serializes same-cart writers; create-race converges via partial-UQ reselect; guest expiry SQL `now()`; customer carts persistent NULL | `src/lib/cart/writes.ts:179-221`, `src/lib/cart/queries.ts:17-31` | VERIFIED |
| E14 | Customer session: 30-day fixed TTL, no sliding; DB-gated expiry/revocation; `requireCustomer` 401-generic, inactive/deleted 422 parity | `src/lib/customers/session.ts:24,70-148` | VERIFIED |
| E15 | Error taxonomy + HTTP: VALIDATION 400, UNAUTHENTICATED 401, NOT_FOUND 404, CONFLICT 409, BUSINESS_RULE 422, RATE_LIMITED 429, INTERNAL 500; envelope `{error:{code,message,details}}`; GONE 410 exists but cart uses 404 for expired/consumed | `src/lib/api/errors.ts:14-51`, `src/lib/api/http-status.ts:10-32` | VERIFIED |
| E16 | Estimate dry-run: `POST /api/store/orders/estimate` `{lines[], couponCode?}` → `{lines[{variantId,quantity,unitPrice,gross,discounts[],net}], freeLines[], coupon{code,applicable,reason,amount}\|null, subtotal, discountTotal, deliveryFee, total}`; no locks/rows; per-customer coupon needs session customerId | `src/app/api/store/orders/estimate/route.ts:14-40`, `src/lib/promotions/checkout.ts:384-418`, `src/lib/promotions/validation.ts:130-145`, `docs/openapi.yaml:653-675` | VERIFIED |
| E17 | Variant price basis: `VariantShape {id,productId,name,sizeValue,sizeUnit,price,compareAtPrice\|null,isActive}`; price lives only here; list/detail carry NO price/stock/image | `src/lib/catalog/serialize.ts:113-135,68-111` | VERIFIED |
| E18 | Images: `GET products/{id}/images` → `{primary, gallery}`; empty when none; 404 unknown | FP-11.1 E6 / FP-11.3 E5 (re-verified by reference; not re-read byte-for-byte here) | VERIFIED (inherited) |
| E19 | Availability: `GET inventory/products\|variants/{id}` → quantity/reserved/available strings + `stockStatus` (out iff available≤0) | `src/lib/inventory/serialize.ts:12-30` | VERIFIED |
| E20 | Rate limits: login buckets (admin IP 30/acct 10; customer separate buckets) + guest-order buckets (create 10/read 60 per 15 min/IP) in `src/lib/auth/rate-limit.ts`; NO cart-read/mutate bucket exists in code | `src/lib/auth/rate-limit.ts:11-54` | VERIFIED (absence: no cart bucket found) |
| E21 | No storefront promotions/coupons-list/offers/content/settings/delivery endpoints (full route inventory `src/app/api/store/**`) | `src/app/api/store` listing (29 routes; no promotions/offers/content namespace) | VERIFIED ABSENT |
| E22 | Concurrency primitives: ASC lock order helper; retryable PG codes 40P01/40001 = re-read (never blind re-fire) | `src/lib/api/concurrency.ts:8-21` | VERIFIED |
| E23 | FP-11.1/11.2/11.3 + FP-04/FP-05/FP-10 constraints consumed, not modified | `docs/frontend/FP-11-1…`, `FP-11-2…`, `FP-11-3…`, `FP-05…§5-8`, `FP-10…` | VERIFIED (read) |
| E24 | Guest-order credential (`x-guest-order-token`, 90d TTL) is per-ORDER post-checkout, not cart identity | Handoff BG closure + `docs/openapi.yaml:113-118` | VERIFIED (out of cart scope) |

OpenAPI-vs-implementation note: OpenAPI cart summaries match implementation behavior observed in
route/domain code above. Cart echo shape (200 = full cart) is stated in both route comments and
OpenAPI descriptions and confirmed in `writes.ts` return of `getCartFull`. No OpenAPI-only cart field
was relied upon without a serializer counterpart.

## Section 4 — Cart Ownership and Customer Modes

### 4.1 Authenticated customer (VERIFIED)

- Identification: server-verified session only — `__Host-customer-session` cookie (primary) or
  `x-customer-token` header (same token). Client MUST NOT send `customerId`; strict schemas reject
  unknown fields (400).
- Every cart operation resolves via `resolveStoreOwner` → `{kind:"customer", customerId}`. Invalid /
  expired / revoked / malformed session → 401 UNAUTHENTICATED (generic, no reason leaked).
- Inactive/deleted customer with otherwise valid session → 422 BUSINESS_RULE (checkout parity).
- `POST /cart` with valid session resolves-or-creates the persistent customer ACTIVE cart
  (`expires_at NULL`): existing → 200, created → 201, no token in response.
- `GET /cart`, add/set/remove/clear/reprice all operate on that ACTIVE cart; unknown/expired/consumed
  → 404 (never silently recreated outside `POST /cart`).

### 4.2 Guest customer (VERIFIED)

- Identification: bearer `x-guest-token`, 64-hex shape (`/^[0-9a-f]{64}$/i`), presented as a request
  header on every cart call except the initial mint. Stored server-side as SHA-256 hash; raw token is
  returned EXACTLY ONCE at creation and never again.
- Mint: `POST /cart` with NEITHER side → 201 `{cart, guestToken}`. Client must persist the raw token
  to perform any further operation (see §17 for safe handling — header-only, never URL/log).
- Resolve/read: `POST /cart` with token, or `GET /cart` with token → 200 full cart.
- Malformed token shape → 400 VALIDATION. Well-formed but unknown (never minted / wrong server state)
  → 404 via `requireActiveCart`. Expired guest cart (`expires_at <= now()`, default ~30d SQL clock)
  behaves as absent → 404 (client mints fresh via `POST /cart` with neither side).
- Guest carts carry `customerId: null`, `guest: true`, `expiresAt` non-null.

### 4.3 Both / neither side (VERIFIED)

| Presented | Result |
|---|---|
| Guest header + session together | 400 VALIDATION ("Exactly one … required") on every cart route; merge route requires BOTH by design (guest header + session) — this is the sole exception |
| Neither side on `GET /cart`, add/set/remove/clear/reprice | 400 VALIDATION |
| Neither side on `POST /cart` | Mint fresh guest cart (201 + token) — the ONLY auto-create path |
| Authenticated request submitting a guest token as well | 400 (same both-sides rule); server never prefers one side silently |
| Authenticated request with EXPIRED session + valid guest token in same call | Still 400 (both-sides check precedes verification); client must send exactly one side |

### 4.4 Login transitions and merge (VERIFIED — explicit only)

- Login does NOT change cart identity and does NOT auto-merge. The customer ACTIVE cart and the guest
  ACTIVE cart remain separate rows until the app explicitly calls merge.
- Merge trigger: `POST /api/store/cart/merge` with REQUIRED guest header + valid customer session
  (body is strict-empty `{}`; unknown fields → 400).
- Outcomes (one tx, ASC locks):
  - No customer ACTIVE cart → `mode:"reassigned"`: guest row is rebound (`customer_id` set,
    `session_id`/`expires_at` cleared). `inserted/summed` are 0.
  - Customer ACTIVE exists → `mode:"merged"`: per-line sum + live reprice into the customer cart;
    dead lines (inactive/deleted variant or product) are dropped and reported in
    `dropped:[{lineId, variantId}]`; guest cart → `MERGED`.
- Failures: unknown token → 404; consumed/non-guest/expired guest cart → 409 CONFLICT;
  missing/invalid session → 401; inactive customer → 422.
- Post-merge handling (OWNER-APPROVED D27, delegated 2026-10-09): claim success ONLY on the
  confirmed 200 merge response. Present an Arabic result reflecting ONLY the outcomes actually
  returned (`mode`, `inserted`, `summed`, `dropped`; `reassigned` carries no per-line counts).
  Identify dropped rows from `dropped[].variantId` without inventing a reason (the response carries
  no reason — e.g. never claim "out of stock" when the contract only proves inactive/deleted
  liveness). Once the server confirms the merge, stop using the old guest token and follow the
  customer-cart identity flow (re-read the customer cart). On failure or ambiguous timeout, assume
  neither success nor invalidation — follow the error contract (404 fresh-cart path, 409 consumed
  path, 401 login path) and re-read before acting. Never render the token itself in messages, logs,
  or diagnostics.
- Cross-device / cross-browser guest-token portability: NOT VERIFIED (no contract statement; token is a
  bearer string but expiry/rotation semantics for portability are undocumented) — must not be promised.

### 4.5 What is NOT supported here

- No anonymous read without credentials (except mint). No `customerId` in URL/body. No guest-token
  refresh/rotation endpoint for CART (rotation exists only for per-order `x-guest-order-token`, which is
  a different credential and must never be sent as `x-guest-token`). No cart transfer by order id.

## Section 5 — Cart Information Architecture

Brand direction: "Modern, Clean & Practical" (FP-10). Bottom nav stays locked:
`الرئيسية · الأقسام · بحث · العروض · السلة` (السلة active on this page). Palette per §6 task tokens.
Font: deferred — must not be decided here.

Page structure (mobile-first, `dir=rtl`):

1. **Header context.** Page title `سلة التسوق` (h1) + count subtitle per approved D24: distinct
   cart lines as the primary count (`M منتج في السلة`, from `lines.length`); per-row quantities shown
   with their own units. NO combined cross-unit aggregate (never sum PIECE packs + WEIGHT kilograms
   into one `N قطعة` figure — mathematically misleading). The bottom-nav badge is unchanged
   (total quantity per FP-11.1 D05 LOCKED) and is a separate navigation concern. No delivery/coverage
   promise line (no endpoint).
2. **Cart items list.** One row per `lines[]` entry in server order (`id ASC` from `getCartFull`).
   Row contract in §6. Order is server-defined; client must not re-sort.
3. **Summary card.** Cart-level `subtotal` (informational) + line-count + explicit "غير شامل التوصيل"
   disclaimer + optional estimate-preview block ONLY when an estimate call succeeded (see §9). No total
   masquerading as payable.
4. **Primary action.** `إتمام الطلب / المتابعة للدفع` — navigates toward Checkout (FP-11.5); MUST be
   disabled when cart is empty, when cart is unconfirmed (initial load failed), or while a mutation is
   in flight on the primary path. It does NOT submit an order here.
5. **Secondary actions.** `مواصلة التسوق` (→ categories/home), `تحديث الأسعار` (explicit reprice call),
   `إفراغ السلة` (clear, explicit confirmation per approved D25 — see §12). No coupon-code box on the
   cart page (approved D28: coupon entry and authoritative validation are Checkout concerns; the cart
   contract has no coupon workflow).
6. **Empty state.** Confirmed empty (`lines: []` on 200) → illustration-free clean block: title
   `سلتك فارغة`, guidance line, single CTA `تصفح المنتجات`. Must NOT render on failed/401/404 reads.
7. **Loading state.** Initial: skeletons with fixed slots (no layout shift), `aria-busy`. Mutation:
   per-row pending + summary dimmed, page stays interactive except the in-flight row + primary CTA.
8. **Error/retry states.** Full matrix in §13. Global read failure keeps last-known cart (if any)
   visibly marked stale, with retry — never blank, never fake-empty.
9. **Mobile nav integration.** Bottom nav `السلة` shows the server-confirmed indicator (total quantity,
   FP-11.1 D05 LOCKED) and navigates here; badge updates only from confirmed cart responses.

## Section 6 — Cart Item Content

Each row renders ONLY from verified sources. Fallback column is mandatory — no invention.

| Field | API source (VERIFIED) | Fallback when absent/failed |
|---|---|---|
| Product image | Supplemental `GET products/{id}/images` → `primary ?? gallery[0] ?? null` | Neutral placeholder; never broken icon; per-row retry (approved D29: bounded lazy, cached within validity, deduped) |
| Product name | `lines[].productName` | Row shows `…` skeleton until cart confirms; never invented |
| Variant / selling unit | `lines[].variantName` + `unitSnapshot` (PIECE → `PIECE`; WEIGHT → live `sizeUnit`) | Skeleton; on unknown unit show variant name only |
| Weight selected | `lines[].quantity` + `unitSnapshot` (e.g. `0.500 KG`) | Skeleton; never converted to another unit |
| Unit price | `lines[].unitPriceSnapshot` (string\|null) | `null` (unpriced line) → show `السعر غير متاح — حدّث الأسعار` + reprice CTA; never 0, never last price as final |
| Quantity | `lines[].quantity` (exact string) | Skeleton; stepper disabled until confirmed |
| Line total | `lines[].lineTotal` (string\|null; `ROUND(qty×price,2)`) | `null` → em-dash with same "غير متاح" note; never computed client-side from a different price |
| Confirmed discount | NONE in cart payload (no discount rows) | Show nothing on cart rows. A discount or coupon result may appear ONLY in a labeled estimate context when a supported estimate response confirms it for the current cart — never as a confirmed per-row discount, never as proof of coupon application (approved D26/D28) |
| Availability / validation | NONE in cart payload | Supplemental `GET inventory/variants/{id}` per approved D29 (bounded lazy: visible rows only, deduped, cached within an explicit validity policy; on-demand or on-rejection); unknown → `حالة التوفر غير معروفة` + retry; never "متوفر" by default, never "غير متوفر" on fetch failure |
| Price freshness | `lines[].priceCheckedAt` (ISO\|null) | `null` → treat as stale; surface reprice affordance |
| Remove | `DELETE items/{variantId}` | Per §12 |
| Identity keys | `productVariantId` (line key), `productId` (catalog link) | Product link navigates to PDP by `productId`; add/merge always address `productVariantId` |

Rules:

- Previous/compare-at prices are OMITTED on cart rows (approved D26, delegated 2026-10-09).
  The cart contract provides no authoritative `compareAtPrice` or cart discount; no crossed-out price,
  percentage, or "previous price" may be rendered from local calculation, stale snapshots, product
  names, presumed promotion rules, or values fetched from an unrelated endpoint (e.g. per-row variant
  `compareAtPrice`) without a verified relationship to the current cart line.
- Never show stock counts as exact numbers unless the supplemental inventory call succeeded; prefer
  status wording (`متوفر` / `كمية محدودة` only when `low_stock` confirmed / `غير متوفر` only when
  `out_of_stock` confirmed).
- Product IDs are NEVER line keys; quantity/variant changes always address `productVariantId`.

## Section 7 — Piece-Based Quantity Interaction

Preconditions (VERIFIED): product `productType == "PIECE"`; quantity text `> 0`, whole packs
(`thousandths % 1000 == 0`); server rejects fractions with 422 BUSINESS_RULE.

Interaction contract:

1. **Stepper.** `−` / `+` adjust by exactly 1 pack. Direct numeric entry (if offered) accepts integers
   only; client validates integer-before-send (400-avoidance, not a behavior change); decimals →
   inline `الكمية للقطع بعدد صحيح من العبوات` without a network call.
2. **Minimum.** 1 pack. Decrementing at 1 MUST NOT send `quantity: "0"` (server rejects 0 with 400 —
   frozen `> 0` CHECK). At minimum, `−` is disabled; moving to zero is an explicit remove action
   (approved D25: direct per-row remove without a confirmation dialog, DELETE only, never PATCH 0).
3. **Maximum.** No contract maximum. Client MUST NOT invent one. Stock-bounded only at checkout
   (409 loser path). High quantities are accepted into the draft cart.
4. **Submit.** `PATCH items/{variantId} {quantity}`. Pending: row spinner, stepper disabled,
   duplicate-tap guard (§14). Success (200): reconcile the ENTIRE row + summary from the returned
   full cart (price may have moved — `unitPriceSnapshot`/`lineTotal` refresh even on qty-only ops
   because add-path reprices; set-path preserves snapshots but the echo is still authoritative).
5. **Rejection.** 422 (became unsellable / step breach) or 404 (line/cart/variant gone) or 401/400 →
   mapped Arabic message (§13), selection preserved, row re-rendered from a fresh `GET /cart` (never
   left showing the rejected quantity as confirmed).
6. **Synchronization.** After every mutation, the returned `cart` object replaces local state wholesale
   (including `updatedAt`, `subtotal`). No field-level patching.

## Section 8 — Weight-Based Quantity Interaction

Preconditions (VERIFIED): product `productType == "WEIGHT"`; request quantity unit = variant's live
`sizeUnit`; value must be an exact multiple of `saleStepGrams` (GRAM: `step×1000` thousandths);
missing/invalid step → variant unsellable (422).

Interaction contract:

1. **Selection, not free typing.** Offer ONLY preset quantities that satisfy THIS product's step
   (e.g. 125g/250g/500g/1kg/1.25kg usable ONLY where `qty % step == 0`). Free-form decimals
   (e.g. 0.137 kg) are rejected client-side with `الوزن المتاح لهذا المنتج بزيادات محددة` unless they
   satisfy the step (virtually never). This matches FP-05 §5 + FP-11.3 §6.
2. **Variant vs weight distinction (critical).** Changing quantity keeps the SAME `productVariantId`
   (PATCH). Changing pack/size (e.g. 250g-pack variant → 500g-pack variant where variants model packs)
   is a DIFFERENT line: add the new `productVariantId` (POST) and remove the old (DELETE) as two
   confirmed steps — never a single PATCH across variant ids, never a client-side id swap.
3. **Price refresh.** Unit price is per-`sizeUnit` from the live variant. After any weight change, the
   confirmed `unitPriceSnapshot` + `lineTotal` come from the mutation response; any pre-confirm
   computed total is labeled `تقدير` and discarded on response.
4. **Validation.** Server 422 (`Weight quantity violates the sale step` / `missing sale step` /
   `not sellable`) → mapped message + preserved selection + fresh cart re-read. 404 (variant gone) →
   row marked unavailable with PDP/catalog path.
5. **Fulfillment honesty.** PDP/Checkout (FP-06) may deliver a different actual weight/total. Cart MUST
   label weight totals as `تقديري` and never promise finality (see §9).

## Section 9 — Cart Totals and Financial Presentation

Authoritative sources (VERIFIED):

- **Line total:** `lines[].lineTotal` — informational `ROUND(qty × price, 2)` over the snapshot.
- **Cart subtotal:** `cart.subtotal` — sum over priced lines only; unpriced lines contribute nothing.
- **Estimate preview (optional):** `POST /orders/estimate` returns `subtotal / discountTotal /
  deliveryFee / total` + per-line `discounts[]` + `coupon{}` + `freeLines[]`. Read-only, no locks/rows.
- **Checkout (FP-11.5):** sole committer and final authority. Nothing on the cart page is final.

Presentation rules:

1. Show: per-row `lineTotal` (or em-dash + note when `null`); summary `subtotal` labeled
   `المجموع الفرعي (استرشادي)`; distinct-line count (`M منتج في السلة`, approved D24 — never a
   combined cross-unit quantity aggregate). NOTHING ELSE by default.
2. MUST NOT show: delivery fee, taxes, service charges, coupon discount, promotion "-X EGP" rows, or a
   "الإجمالي المستحق" total. A discount or coupon result may be displayed ONLY when a supported
   response confirms that result for the current cart and its relationship is established (approved
   D28) — and even then labeled non-final, never as proof that a coupon is applied to the cart, never
   as a final order total. Any estimate block expires on cart mutation (re-estimate required; stale
   estimates hidden or badged stale, never current). Coupon entry itself lives in Checkout (FP-11.5).
3. Currency: EGP; decimals exact strings; never float; parse as decimal, never string-compare
   (trailing-zero normalization, e.g. `130.00`→`130`, is VERIFIED serialization behavior).
4. Unpriced lines (`unitPriceSnapshot: null`): excluded from subtotal by the server — UI must say so
   (`يشمل الأسطر المسعرة فقط`) rather than implying completeness.
5. Update timing: totals refresh ONLY from confirmed cart/estimate responses. No client-side money math
   as authority (totals helpers are server-side informational; frontend must not reimplement checkout).

## Section 10 — Price Changes, Discounts, and Promotions

- **No promotion feed.** There is no storefront promotions/offers/coupons-list endpoint (VERIFIED
  ABSENT). PDP/cart MUST NOT claim "Buy 2 get 1", "% off", or eligibility from `compareAtPrice` alone.
- **Where discounts can truthfully appear:** ONLY (a) estimate `discounts[]`/`coupon.amount`/
  `freeLines[]` in the labeled estimate block, or (b) checkout-computed rows (FP-11.5). Cart payload
  itself has zero discount fields.
- **Price-change detection:** `POST /cart/reprice` returns `{repriced, dropped}`. UX: explicit
  `تحديث الأسعار` affordance + reprice prompt when `priceCheckedAt` is stale or after a rejection
  hinting drift. On result: `repriced > 0` → per-row old→new display with the cost change disclosed
  before the customer confirms an order (silent auto-accept forbidden; approved D26/D30-A);
  `dropped` non-empty → unavailable-row treatment (§11) with `variantId` identification.
- **Stale values:** never present a snapshot price as "current" after a newer mutation/estimate
  contradicts it. Loading price = skeleton; failed price = unknown + retry.
- **Coupon codes (approved D28, delegated 2026-10-09):** the cart has no coupon field and must not
  introduce a coupon-entry box by assumption. Coupon entry and authoritative validation are Checkout
  (FP-11.5) concerns. The cart displays a coupon/discount outcome ONLY when a supported response
  confirms it for the current cart — never a coupon list, never frontend-computed eligibility, never
  an estimate treated as permanently applied or final. Per-customer-limited coupons on the guest path
  report customer-required — surface honestly, do not retry as authenticated silently.

## Section 11 — Availability and Rejected Mutations

Backend truth (VERIFIED):

- Cart payload returns NO availability. Stock is NOT validated on cart mutation except liveness
  (sellable variant AND product); quantity-vs-stock is a CHECKOUT-time conditional reserve (409 loser).
- Reprice/merge DROP dead lines (inactive/deleted variant or product) and report them; add/set REJECT
  unsellable lines (422/404). Failed mutations leave the cart row unchanged (throw before commit),
  except reprice drops which are committed deletions.
- Cart NEVER reserves: membership ≠ guarantee. Order submission may still 409 on short stock.

UX contract:

1. **Identify the affected item** by `productName` + `variantName` (+ `variantId` in details for support,
   never as the primary label). For reprice/merge `dropped[]`, match `variantId` to the row.
2. **Communicate confirmed state:** `غير متوفر` ONLY when the server said so (422 not-sellable, 404
   variant/line gone, reprice/merge dropped, or supplemental inventory `out_of_stock`). Fetch failure →
   `حالة التوفر غير معروفة` + retry (never OOS).
3. **Preserve unaffected items:** re-render the full confirmed cart; failed row reverts to its confirmed
   quantity; other rows untouched. Never clear the list on a single-row failure.
4. **Offer only supported actions:** retry mutation, reprice, remove the dead row (DELETE), view PDP /
   continue shopping. NO automatic substitution (replacements are a post-order concern), NO silent
   quantity lowering, NO restock promise.
5. **Distinguish inactive vs OOS:** inactive/deleted (`غير متاح حاليًا — تم إيقافه`) vs sellable-but-zero
   (`غير متوفر حاليًا`). Both disable quantity controls and the primary CTA only if the cart becomes empty.

## Section 12 — Remove Item and Empty Cart

**Remove one item (VERIFIED contract; approved UX policy D25, delegated 2026-10-09):**

1. Row action `إزالة` (accessible label `إزالة {productName} — {variantName}`) is DIRECT — no
   confirmation dialog — with the affected item clearly identified and a pending state while the
   server processes the request.
2. Pending: row spinner + disabled controls; duplicate-remove guard.
3. `DELETE items/{variantId}` → 200 full cart: row disappears ONLY on server confirmation; summary +
   indicator reconcile from the response. Success is never declared before the 200.
4. 404 (already gone) → treat as success (row removed, fresh `GET /cart` to reconcile). 401/400/500 →
   row stays with mapped error + retry; last-known contents preserved. Ambiguous timeout →
   `GET /cart` first; re-DELETE only if the row is still present (never blind loops).
5. No undo is promised: no verified restoration mechanism exists (re-adding re-aggregates at the live
   price and is NOT an undo).

**Clear cart (VERIFIED contract; approved UX policy D25, delegated 2026-10-09):**

- `DELETE /cart/items` → 200 emptied cart; row stays ACTIVE (no lifecycle transition).
- Destructive bulk action: explicit confirmation (wording at spec level, e.g. `إفراغ السلة؟ سيتم حذف
  كل المنتجات — لا يمكن التراجع` + `تأكيد الإفراغ` / `تراجع`) REQUIRED before sending the request;
  loading state on the confirm button; the clear is successful ONLY on the 200; failure keeps all
  lines + retry with server reconciliation.
- No 422/409 contract on clear; 404 means no ACTIVE cart → surface as already-empty with fresh mint
  guidance, not as an error wall.

**Empty-cart appearance (confirmed empty only):**

- Trigger: 200 with `lines: []`. Title `سلتك فارغة` + guidance `اكتشف منتجاتنا الطازجة وابدأ التسوق` +
  CTA `تصفح المنتجات` (→ categories). No order summary, no totals, primary CTA hidden/disabled.
- MUST NOT render on: initial loading, read failure, 401 (session), 404-no-cart (offer mint/re-login),
  or offline. Failed ≠ empty (§13 states E-EMPTY vs E-FAIL).

**Supported route back:** categories index / home discovery; preserve bottom-nav state.

## Section 13 — Loading, Error, and Recovery States

Envelope: `{error:{code,message,details}}` (details sanitized). Map codes to Arabic; never show raw
codes, stack traces, tokens, or internals.

| State | Trigger (VERIFIED unless noted) | Customer outcome (RECOMMENDATION copy) | Recovery |
|---|---|---|---|
| S-LOAD initial | `GET /cart` in flight | Skeletons, `aria-busy`, CTA disabled | Auto-resolve; no action |
| S-LOADED | 200 with lines | Rows + informational subtotal | — |
| S-EMPTY | 200 `lines: []` | Empty block (§12) | Browse CTA |
| S-MUTATING | PATCH/POST/DELETE/reprice in flight | Row spinner + summary dimmed; rest interactive | Guard duplicates |
| S-REJECTED | 400/404/422 on mutation | Inline row error + preserved confirmed qty | Retry / reprice / remove / PDP |
| S-OFFLINE | Network timeout / fetch throw / `navigator.onLine === false` (client signal, NOT VERIFIED backend) | `تعذر الاتصال — تحقق من الإنترنت وحاول مجددًا`; last-known cart (if any) badged `بيانات قديمة غير مؤكدة` | `إعادة المحاولة` (re-GET); never auto-clear |
| S-STALE | `priceCheckedAt` old / estimate older than cart `updatedAt` / mutation returned newer prices | `الأسعار قد تكون تغيرت` + `تحديث الأسعار` | Reprice call |
| S-SESSION | 401 on any call | `انتهت جلستك — سجل الدخول للمتابعة` (authenticated mode) | Login; preserve local selection for post-login merge prompt (explicit merge only) |
| S-GUEST-BAD | 400 malformed token | `رمز السلة غير صالح — ابدأ سلة جديدة` | Mint fresh (`POST /cart` neither side) |
| S-GUEST-GONE | 404 no ACTIVE cart (expired/consumed/unknown) | `لم نجد سلتك (ربما انتهت) — ابدأ سلة جديدة` | Mint fresh; never auto-recreate on GET |
| S-RATE | 429 (NOT VERIFIED on cart paths; generic guard) | `محاولات كثيرة — انتظر قليلًا وحاول مجددًا` | Backoff + retry; respect 15-min windows on auth-adjacent calls |
| S-SUPPLEMENT | Images/variants/inventory enrichment fail | Row renders with fallback + per-row `إعادة المحاولة`; grid intact | Per-row retry; cart ops unaffected |
| S-SERVER | 500 / malformed success payload | `حدث خطأ غير متوقع — حاول مجددًا` | Retry GET; report id if provided in details |

Notes:

- Distinguish 400-shape (client fixable, no retry loop) vs 404-gone (mint/re-link path) vs 422-rule
  (selection fix) vs 401 (auth path) vs 409-merge-consumed (fresh cart path) vs 500/offline (retry path).
- Backend does NOT guarantee a customer-readable message per failure — UI owns the Arabic mapping.
- Where the backend does not distinguish (e.g. 404 conflates unknown/foreign/expired/consumed cart;
  422 conflates step/unit/sellable), document the limitation in-row (`قد يكون المنتج موقوفًا أو الكمية
  غير صالحة — تحقق من الكمية أو أعد التحميل`) rather than inventing precision.

## Section 14 — Concurrency and Repeated Interaction

Verified server behavior:

- Same-cart writers serialize on `SELECT … FOR UPDATE` (one tx per mutation). `addLine` is an atomic
  UPSERT (re-add aggregates; concurrent adds sum, never lose). `setLineQuantity` is last-writer-wins
  per row (no version check). No ETag / version / idempotency-key on cart ops (idempotency keys exist
  only on order creation). Deadlock/serialization codes (40P01/40001) mean re-read, never blind re-fire.

Client interaction model (RECOMMENDATION, no unverified server feature assumed):

1. **Per-row serialization.** One in-flight mutation per cart at a time is the SAFE default; queue
   rapid stepper taps per row and send only the LATEST intended quantity (coalesce), discarding
   intermediate values. Global lock is NOT required — unrelated rows may still render — but the
   in-flight row + primary CTA are disabled until confirmation.
2. **No optimistic success.** Never badge count/total/row as updated before the 200 arrives. Pending
   UI shows intent (spinner + pressed state), not outcome.
3. **Stale-response discipline.** Tag outgoing mutations with a monotonic seq; ignore any 200 whose seq
   is older than the latest sent (latest-wins). Reconciliation always uses the NEWEST confirmed full
   cart.
4. **Ambiguous timeout.** On timeout with unknown server effect: `GET /cart` FIRST; then decide
   (re-send only if the intended effect is absent). Never blind POST/PATCH loops (add aggregates — a
   duplicate POST doubles quantity).
5. **Remove races.** Double-remove of the same row: second 404 is treated as success (idempotent
   outcome). Clear-during-mutate: serialize — complete/cancel the row op first, then clear.
6. **Merge/reprice overlap.** Never fire merge and reprice/add concurrently; serialize with the same
   per-cart queue. After merge, invalidate the guest token and reset the queue to the customer cart.
7. No client-invented idempotency keys, versions, or conflict dialogs beyond the above — the server
   provides none for cart, and the UI must not pretend it does.

## Section 15 — API-to-UI Data Mapping

`→` = authoritative source. Fallback and limitation per row.

| UI field / behavior | Route + method | Request input | Response field | Authority | Fallback | Verification | Limitation |
|---|---|---|---|---|---|---|---|
| Page cart | `GET /cart` | Header `x-guest-token` XOR session | `cart{…}` full object | → Server | Stale-marked last-known + retry | VERIFIED | Neither side 400; expired 404 |
| Mint guest cart | `POST /cart` (neither side) | No body | `cart` + `guestToken` (once) | → Server | N/A (creation only) | VERIFIED | Persist token to operate further |
| Resolve cart | `POST /cart` (one side) | Header/session | `cart` (200/201) | → Server | GET on 200-path | VERIFIED | Never recreates on GET |
| Row name/variant/qty/unit | Any mutation 200 echo | Per-op schema | `lines[].productName/variantName/quantity/unitSnapshot` | → Server echo | Skeleton until 200 | VERIFIED | Order is server `id ASC` |
| Row unit price | Same echo | — | `lines[].unitPriceSnapshot\|null` | → Server | "غير متاح + reprice" when null | VERIFIED | Snapshot = quote, not authority |
| Row total | Same echo | — | `lines[].lineTotal\|null` | → Server | Em-dash when null | VERIFIED | Excludes unpriced lines |
| Cart subtotal | Same echo | — | `cart.subtotal` | → Server (informational) | Hide with note if no priced lines | VERIFIED | NOT payable; never add fees |
| Freshness | Same echo | — | `lines[].priceCheckedAt\|null` | → Server | Null = stale | VERIFIED | No push/expiry events |
| Add / aggregate | `POST /cart/items` | `{productVariantId, quantity}` strict | 200 full `cart` | → Server | Mapped 400/401/404/422 | VERIFIED | Variant id required; re-add sums |
| Set quantity | `PATCH /cart/items/{variantId}` | `{quantity}` strict | 200 full `cart` | → Server | 404 line-gone → fresh GET | VERIFIED | Last-writer-wins; 0 rejected |
| Remove row | `DELETE /cart/items/{variantId}` | Path UUID | 200 full `cart` | → Server | 404 → treat-as-gone + GET | VERIFIED | — |
| Clear all | `DELETE /cart/items` | Identity only | 200 emptied `cart` | → Server | Retry keeps lines | VERIFIED | Row stays ACTIVE |
| Merge guest→customer | `POST /cart/merge` | REQUIRED guest header + session; `{}` body | 200 `{cart, merge{mode,inserted,summed,dropped}}` | → Server | 404 fresh-cart path; 409 consumed path | VERIFIED | Explicit only; token dies after |
| Refresh prices | `POST /cart/reprice` | `{}` strict | 200 `{cart, reprice{repriced,dropped}}` | → Server | Per-row old→new UI | VERIFIED | Qty untouched; drops committed |
| Estimate preview | `POST /orders/estimate` | `{lines[{productVariantId,quantity}], couponCode?}` | `{lines[].discounts, coupon, subtotal, discountTotal, deliveryFee, total}` | → Server (preview) | Hide block on failure | VERIFIED | Dry-run only: confirms a preview for the current cart, never applies a coupon to the cart, never final (approved D28) |
| Row image | `GET catalog/products/{id}/images` | Product UUID | `{primary, gallery}` | → Server | Neutral fallback | VERIFIED (inherited) | Extra N calls; may be empty |
| Row reference price | `GET catalog/variants/{id}` | Variant UUID | `price / compareAtPrice` | → Server | Not shown on cart (see D26) | VERIFIED | Reference only; no offer proof |
| Row availability | `GET inventory/variants/{id}` | Variant UUID | `availableQuantity / stockStatus` | → Server | "غير معروفة" + retry | VERIFIED | Cart itself returns none |
| Auth state | Customer session validate | Cookie/header | 401 vs customer object | → Server | Login prompt | VERIFIED | 30d fixed; generic 401 |

Unsupported (must not appear in mapping as available): favorites, promotion feeds, coupon lists, batch
fetch, cart version/etag, quantity caps, reservation holds, delivery-zone fees on cart, order submit.

## Section 16 — RTL, Accessibility, and Responsive Design

- **RTL (Arabic-first).** `dir=rtl` document; logical CSS properties only; Latin SKUs/numbers/prices
  isolated (`bdi`/`unicode-bidi`); directional icons (back/chevron/stepper) mirrored; brand/technical
  symbols never mirrored. Preserved param/unit order in mixed strings (e.g. `0.500 كجم`).
- **Mobile-first item layout.** Stacked row: image (fixed aspect slot) → name/variant → price line →
  stepper + line-total → remove. Sticky summary CTA bar on mobile (non-occluding, keyboard-safe);
  tablet two-column (list + summary rail); desktop list + sticky summary column. Breakpoints follow
  Tailwind v4 defaults at build — no px invented here.
- **Touch targets.** ≥ 44px for stepper buttons, remove, retry, primary/secondary CTAs; 8px+ gaps to
  prevent mis-taps on rapid tapping (§14).
- **Accessible labels.** Every stepper: `زيادة الكمية — {productName}` / `إنقاص الكمية`; remove:
  `إزالة {productName} — {variantName}`; quantity input labeled + `aria-describedby` error; summary
  totals in a labeled region; state changes via `aria-live="polite"` (success/reprice/merge/error
  announcements); skeletons `aria-busy`, never focus-trapped.
- **Keyboard/focus.** Full operability: Tab order = visual RTL order; visible focus ring from FP-10
  locked pairs; clear-confirmation sheet traps + restores focus (approved D25); Esc dismisses
  without side effects.
- **No layout shift.** Fixed image/price/skeleton slots; totals area reserves estimate-block space only
  when the block is active; badge pulses do not move content.
- **Numerals/currency.** Arabic copy with Western numerals for prices/quantities (consistent with FP-11.1
  cards); EGP suffix `ج.م`; exact decimal strings preserved (no rounding in display); unit abbreviations
  (`كجم`/`جم`/`عبوة`) paired with the API `unitSnapshot` on first render to avoid confusion.
- **Brand tokens (LOCKED direction, values as specified).** Purple `#511D9C`, Orange `#FF7100`, Text
  Orange `#C2410C`, Ink `#1B1530`, Purple Surface `#EEE8F5`, Orange Surface `#FFF1E6`, Success
  `#15803D`, Error `#C62828`. `#FF7100` never as body text on white (contrast); CTA pairs per FP-10;
  deferred font choice untouched — no font decision here.
- **No WCAG conformance claim** without testing (same posture as FP-11.1/11.2/11.3).

## Section 17 — Security and Data Integrity

1. **Ownership enforcement is server-side.** UI never decides ownership from a stored `customerId` or
   URL param. Every request sends exactly one side (guest header XOR session). Both-sides is always a
   client bug → fix the caller, never retry both.
2. **Guest token handling.** Bearer `x-guest-token` (64-hex): send as header only; never in URL,
   logs, error reports, or support text; retain only while the guest cart is active; discard after
   successful merge, after checkout consumption, or when the server 404s it as gone. Do NOT confuse
   with `x-guest-order-token` (per-order post-checkout credential — different header, different
   lifecycle; sending one as the other yields 400/401/404).
3. **Session handling.** `__Host-` cookie is HttpOnly (browser-managed); `x-customer-token` header path
   is for same-origin non-browser clients only. No token in URL (FP-04 rule). 401 → login, never
   silent retry with stored passwords.
4. **Trust server responses.** Prices/totals/validation/success come ONLY from 200 payloads. Never trust
   client-computed totals, client-supplied prices, or cached snapshots after a newer response arrived.
   Strict-schema 400s on unknown fields mean the client must not add convenience fields to cart bodies.
5. **Stale financial values (approved D30, delegated 2026-10-09).** Snapshot prices older than the
   latest confirmed response, or estimates older than cart `updatedAt`, are labeled stale/
   unverified — never presented as currently confirmed. Revalidate via the supported path for the
   state (`GET /cart`, mutation echo, `POST /cart/reprice`, or estimate preview); reconcile to the
   authoritative values and disclose cost changes before order confirmation. Navigating to Checkout
   is NOT itself forbidden for stale display values; Checkout (FP-11.5) owns pre-submission
   validation, and the existing backend drift rejection (409, cart stays ACTIVE) is honored with a
   recovery path. No silent auto-accept of drift; no fabricated replacement values; no new endpoint.
6. **No sensitive persistence beyond necessity.** Guest cart token persists only as long as needed to
   operate the cart (origin-scoped app storage with XSS hygiene — no inline dump into HTML, no query
   params). Session tokens stay in their HttpOnly cookie. No credential in `localStorage` beyond the
   guest-cart bearer actually required for cart ops, and never the per-order credential alongside it
   longer than its display-once moment (BG rule).
7. **Rate/abuse posture.** No cart-specific bucket exists; generic 429 handling (§13) + respect for
   login/guest-order 15-min windows on adjacent flows. No CAPTCHA/OTP invented here.

## Section 18 — Acceptance Criteria and Test Scenarios

> Specification-level only. NONE executed in this task. No pass claimed. Each AC names its contract;
> a future build verifies it against scratch with explicit `DATABASE_URL` override (per handoff).

- AC-CART-01 Authenticated cart: login → `POST /cart` resolves/creates → `GET /cart` returns same id;
  add/set/remove/clear round-trip with 200 full-cart echoes; badge = server quantity.
- AC-CART-02 Guest cart: neither-side POST mints 201+token → header-authed GET/POST/PATCH/DELETE all
  200; malformed token 400; unknown token 404; expired cart 404 → fresh mint path works.
- AC-CART-03 XOR enforcement: both-sides POST/GET → 400; neither-side GET/add/set/remove → 400.
- AC-CART-04 PIECE: +1/−1 packs; fractions rejected pre-send AND 422 if sent; PATCH 0 is 400 (removal
  is DELETE); re-add aggregates at live price.
- AC-CART-05 WEIGHT: only step-valid presets accepted; invalid step value → 422 mapped + preserved
  selection; variant-pack change = POST-new + DELETE-old (never cross-variant PATCH).
- AC-CART-06 Remove: DELETE → 200 row gone + totals reconciled; double-remove second 404 treated as
  gone; timeout → GET-first, no blind re-DELETE loop.
- AC-CART-07 Clear: guarded confirm → DELETE collection → 200 `lines: []` + ACTIVE row retained;
  failure preserves all lines.
- AC-CART-08 Empty vs failed: 200-empty renders empty block; any failure/401/404 renders its own state,
  never the empty block.
- AC-CART-09 Rejected mutation: unsellable variant add → 422/404 mapped, cart unchanged (fresh GET
  confirms); dead lines on reprice dropped + identified by name/variant; others preserved.
- AC-CART-10 Price change: mutate `price` server-side → reprice reports `repriced: 1` → old→new UI +
  cost-change disclosure before order confirmation; stale estimate hidden; navigation to Checkout not
  itself blocked for stale display values (approved D30-C); backend drift 409 honored with recovery.
- AC-CART-11 Availability: supplemental inventory OOS → row `غير متوفر` + disabled controls; fetch
  failure → `غير معروفة` (never OOS); cart membership never claimed as reservation.
- AC-CART-12 Offline/timeout: airplane-mode GET/mutation → offline state + stale badge (if prior cart)
  + retry; no data loss, no fake-empty.
- AC-CART-13 Credentials: expired session 401 → login prompt + preserved selection; malformed guest
  400 → fresh-mint path; gone guest 404 → fresh-mint path; consumed-guest merge 409 → fresh-cart path.
- AC-CART-14 Repeated interaction: 5 rapid taps coalesce to one PATCH of latest qty; out-of-order 200s
  latest-wins; ambiguous timeout GET-first; no duplicate-POST quantity doubling.
- AC-CART-15 Merge: guest (3 lines incl. 1 dead) + customer (1 overlapping line) → `merged` with
  `inserted/summed/dropped` exact; guest token invalidated; no-auto-merge-on-login verified (login
  alone changes nothing).
- AC-CART-16 No cart-level coupon box (approved D28): cart page offers no coupon input; coupon
  entry/validation is exercised in Checkout (FP-11.5). Any estimate-derived discount shown on cart is
  labeled non-final preview for the current cart only, invalidated by mutation, never proof of
  application.
- AC-CART-17 RTL/responsive: mobile 360px single-column, 44px targets, sticky CTA non-occluding,
  bottom nav intact, `dir=rtl`, `bdi`-isolated numerals, keyboard-only full flow, `aria-live`
  announcements verified by inspection (no automated a11y pass claimed).
- AC-CART-18 Reconciliation: after EVERY mutation, visible rows + subtotal + badge equal the latest 200
  `cart` byte-for-byte (no field patching); `updatedAt` advances.
- AC-CART-19 Zero-app-code check: `git status` shows only the new spec file added (plus pre-existing
  uncommitted work untouched); no backend/dependency/DB/commit/push.

## Section 19 — Owner Decisions and Decision Register

> Status `OWNER-APPROVED (delegated, 2026-10-09)` = closed under delegated owner authorization
> supplied for this specific closure task (D24–D30 only). Provenance: delegated authorization in the
> FP-11.4 closure prompt — NOT a direct per-decision user statement, and NOT a backend change or new
> verification. Decision IDs preserved; evidence/alternatives/rationale preserved with minimal
> consistency edits. Locked prior decisions (FP-11.1 D02/D05/D06; FP-11.2 D12/D13/D17/D18; FP-11.3
> D21/D22/D23; FP-04 journey; FP-05 commerce rules) are respected and NOT re-decided here.

| ID | Topic | Evidence & constraints | Options | Approved rule | Consequences / trade-offs | Status |
|---|---|---|---|---|---|---|
| FP11-D24 | Cart count terminology (unambiguous; badge preserved) | FP-11.1 D05 LOCKED: nav badge = total quantity (preserved, not redefined). Cart `quantity` is decimal text in mixed units (PIECE packs vs WEIGHT sizeUnit); summing across units is misleading. No new backend field verified | (a) Distinct-line count primary + per-row qty w/ units (b) Combined `N قطعة` aggregate (rejected: ambiguous for WEIGHT) | Cart page subtitle = distinct lines (`M منتج في السلة`, from `lines.length`); per-row quantities carry their own units; no cross-unit aggregate. Badge unchanged | Honest counts; negligible cost | OWNER-APPROVED (delegated, 2026-10-09) |
| FP11-D25 | Single-remove vs full-clear confirmation; no invented undo | DELETE flows VERIFIED (remove per-variant; clear collection, row stays ACTIVE); no UX mandate in contract; mobile mis-tap risk vs friction; no verified restore endpoint | (a) Direct per-row remove + explicit confirm for clear (b) Modal per remove (rejected: friction) | Single remove = DIRECT action (identified item + pending state), success ONLY on 200; clear = explicit confirmation (spec-level wording) before request, success ONLY on 200; failures preserve + reconcile; NO undo promised | Fast removes; bulk stays safe; no false recovery promise | OWNER-APPROVED (delegated, 2026-10-09) |
| FP11-D26 | Compare-at / previous-price omission on cart | Cart payload has NO `compareAtPrice`/discount rows (E12 VERIFIED); variant `compareAtPrice` is an admin reference, not offer proof (FP-05); no storefront promo feed (E21 ABSENT) | (a) Omit on cart (b) Per-row variant-fetch struck price (rejected) | DEFAULT CART OMITS previous/compare-at/percentage/crossed-out prices. Nothing inferred from local calc, stale price, names/labels, presumed rules, or unrelated-endpoint values without a verified cart-line relationship. Backend promo behavior unchanged — display-only rule | Honest + performant; PDP keeps reference display | OWNER-APPROVED (delegated, 2026-10-09) |
| FP11-D27 | Explicit merge messaging + old-token invalidation | Merge VERIFIED explicit-only (`POST /cart/merge`, `{mode,inserted,summed,dropped}`, 404/409/401/422); login never auto-merges; response carries NO drop reason | (a) Explicit result + discard token (b) Silent merge (rejected) | Claim success ONLY on confirmed 200; Arabic result reflects ONLY returned outcomes (incl. `reassigned`); never invent drop reasons; stop using old guest token once the server confirms the merge; on failure/ambiguity assume neither success nor invalidation (follow error contract + re-read); never expose the token | Transparent; no false merge/token claims | OWNER-APPROVED (delegated, 2026-10-09) |
| FP11-D28 | Coupon placement + Checkout boundary | Cart contract has NO coupon field/workflow (E3–E8, E16 VERIFIED); estimate is dry-run (no locks/rows, never applies); FP-04 single-page checkout owns coupons | (a) Checkout-only coupon box (b) Cart coupon input (rejected: assumption) | NO coupon-entry field on cart. Coupon entry + authoritative validation = Checkout (FP-11.5). Cart shows a discount/coupon result ONLY when a supported response confirms it for the current cart — never a coupon list, never frontend eligibility, never estimate-as-applied/final, never new cart coupon state | Cleaner boundary; no implied cart coupon state | OWNER-APPROVED (delegated, 2026-10-09) |
| FP11-D29 | Bounded supplemental enrichment; cache never overrides authority | Images/inventory per-product VERIFIED, no batch endpoint (E18/E19); N+1 cost bounded per FP-11.1/11.2; server echo is price authority (E12) | (a) Lazy + deduped + cached w/ validity (b) Eager fetch-all (rejected) | Fetch ONLY for visible rows; dedupe in-flight where architecture permits; cache ONLY within an explicit validity policy; CORE (cart echo: names/qty/units/prices/totals/freshness) vs SUPPLEMENTAL (images/inventory) distinguished; supplemental failure never erases cart or misrepresents price + per-row retry; reconcile via authoritative echo/re-GET; cached supplemental NEVER overrides newer server-confirmed prices | Bounded cost; truth preserved | OWNER-APPROVED (delegated, 2026-10-09) |
| FP11-D30 | Stale/unverified prices: strict display integrity WITHOUT a new checkout gate | Revalidation paths VERIFIED (`GET /cart`, mutation echo, `POST /cart/reprice`, estimate preview); backend drift rejects at order submit (409, cart stays ACTIVE — `orders/writes.ts:312-315`, openapi 642); NO backend/frontend global checkout-entry gate verified; no stale-status field exists | (a) Strict A/B/C policy (b) Blanket frontend checkout block (rejected: unsupported) | **A (stale + path exists):** label stale/unverified, revalidate via the supported path for the state, reconcile + disclose cost changes before order confirmation. **B (unconfirmable):** preserve contents, mark unverified, offer retry, no fabrication, no new op. **C (proceeding to Checkout):** navigation NOT forbidden for stale display values; NO frontend-only global gate; FP-11.5 owns pre-submission validation; never imply unverified = final; honor backend 409 + recovery; unestablishable prices = documented contract limitation requiring separate authorization. Nuance: strictness governs PRESENTATION as authoritative, not entry prohibition or new backend rules | Financial honesty without invented restrictions | OWNER-APPROVED (delegated, 2026-10-09) |

Deferred font choice, hero/offers content, footer policies, and FP-10 owner picks remain with the owner
per their own phases — not duplicated here.

## Section 20 — Final Verdict and Handoff

```text
SPECIFICATION COMPLETE — OWNER DECISIONS D24–D30 RECORDED (delegated, 2026-10-09)
```

**What closed.** D24 (unambiguous counts, badge preserved) · D25 (direct remove / confirmed clear /
no invented undo) · D26 (compare-at omitted absent authority) · D27 (explicit merge messaging +
token invalidation) · D28 (Checkout-only coupons) · D29 (bounded lazy/cached/deduped enrichment,
cache never overrides authority) · D30 (strict A/B/C stale-price policy WITHOUT a blanket checkout
gate — presentation integrity only; FP-11.5 owns pre-submission validation). Register in §19 carries
the exact approved status + delegated provenance; dependent §§1/4/5/6/7/9/10/12/15/16/17/18 updated
for consistency. No backend behavior changed or newly verified by these approvals.

**Why not "blocked".** No missing contract evidence blocks this spec: every UI field traces to a
verified route/serializer or a named supplemental endpoint; every unavailable value (discounts,
delivery fee, final total, availability in-cart) is explicitly marked with its Checkout-or-estimate
home. No endpoint was invented; no OpenAPI-only field was relied upon.

**Next permitted step (do NOT start it here).** Implementation remains unstarted and separately
authorized. FP-11.5 Checkout will define the complete coupon interaction and authoritative
pre-submission validation on its own contract investigation. Any backend/DB/dependency change, any
commit/push, and any modification of FP-11.1/11.2/11.3 remain forbidden until separately authorized.

---

*End of FP-11.4 specification — specification-only, no implementation.*
