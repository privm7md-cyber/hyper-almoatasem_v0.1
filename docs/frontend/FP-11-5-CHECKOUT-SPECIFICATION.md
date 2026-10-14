# FP-11.5 — Checkout UX Specification

> Classification: `VERIFIED` (repo/openapi/code evidence below) · `LOCKED` (existing approved decision) ·
> `OWNER-APPROVED (delegated, 2026-10-09)` (D31–D38 closed under delegated authority for this task only;
> D39 RESOLVED under the existing staff-assisted design — verified this task, no code change) ·
> `NEEDS OWNER DECISION` · `BLOCKED`/`UNSUPPORTED`
> (capability absent) · `NOT VERIFIED`. Specification only — no implementation, no backend change.
> No approval is claimed beyond D31–D39 as recorded in §19.

## Section 1 — Executive Summary

**Objective.** Define the customer journey from the existing cart through delivery-address
selection, order review, financial validation, safe order submission, and confirmed order creation —
contract-first from the verified backend.

**Supported modes.** Authenticated customers (server-verified session + owned `addressId`) and guest
customers (cart bearer `x-guest-token` + inline `guestAddress`/`guestContact`, no account).
Guest ordering without an account is VERIFIED and required; login never auto-merges carts (merge is
explicit `POST /cart/merge`, FP-11.4 D27 LOCKED-direction).

**Financial authority.** Estimate (`POST /orders/estimate`) is a dry-run preview only. Order creation
(`POST /orders`) revalidates everything live in one transaction (liveness, steps, price drift,
promotions/coupon, conditional inventory reserve, server-read delivery fee) and is the SOLE committer.
Price drift and stock-short reject with 409; the cart stays ACTIVE for correction + retry with a new
key. Nothing on the review screen is final until the 201/200-replay creation response arrives.

**Submission safety.** Idempotency is VERIFIED and mandatory: every creation carries a client-generated
key (header `idempotency-key` and/or body `idempotencyKey`, 1–64 chars, no spaces; at least one
required; header wins ties; conflict → 400). Same key + same cart → 200 replay of the original
(keep-same: no credential re-issued). Same key + different cart/terms → 409. Timeouts reuse the SAME
key (safe); fresh attempts after 409-drift use a NEW key after review. Guest lost-response without the
order id + credential routes to staff-assisted recovery (verified rotate/revoke design — §11/§19 D39 RESOLVED).

**Scope.** Checkout UX only: entry, address, review, estimate/revalidation, confirmation, safe submit,
success, rejections, ambiguous outcomes, recovery. No payment step exists in the contract (no payment
field, no payment route, no payment confirmation) and no payment method is promised by this
specification (D37 — the payment-method business decision is unresolved, see §19). No FP-11.6/11.7.

**Status: `SPECIFICATION COMPLETE — OWNER DECISIONS D31–D39 RECORDED; D39 RESOLVED (existing design verified, this task)`.**
All Checkout operations, state transitions, mappings, and acceptance criteria are specified without
guessing. D31–D38 are OWNER-APPROVED under the delegated authority supplied for this review task
only (provenance in §19 — not a direct per-decision user statement; no backend behavior changed or
newly verified by these approvals). D39 stays BLOCKED as a genuine contract gap with a documented
safe policy and an unauthorized future-capability recommendation. Implementation remains unstarted.

## Section 2 — Scope and Non-Goals

**In scope.** Checkout entry + customer-mode handling; saved-address selection and guest inline entry
per the verified schemas; cart/price review from confirmed cart + estimate preview; coupon-code entry
(Checkout-owned, FP-11.4 D28); final confirmation + guarded submit with idempotency; success screen
(order number + snapshots + guest credential handling); full rejection/ambiguity recovery matrix;
security, RTL/a11y/responsive, acceptance criteria, decision register.

**Explicit non-goals (must not be built here).**

- Implementation: no pages, components, hooks, API clients, styles, or logic.
- Backend/DB/config changes of any kind; no new endpoints, fields, or rules.
- Payment-gateway integration: the order contract has NO payment method/field/route (VERIFIED
  ABSENT). No card/online-payment UI, no payment-status display, and — per safety review — no
  payment-method line of any kind (not even informational COD): no approved business decision
  confirms which methods are offered (D37; FP-00-Q002 OPEN). The UI must not invent a payment step
  or promise a method.
- Delivery-logistics implementation (zones/drivers/slots/tracking), order-tracking pages (FP-11.6),
  account-management redesign, new promotion/coupon services.
- FP-11.6 and FP-11.7 remain future, separately authorized specifications.

Prior locked direction respected (not modified): FP-09 D06 stepped checkout + XOR address contract;
FP-11.4 D24–D30 (counts, remove/clear, compare-at omission, merge messaging, Checkout-only coupons,
bounded enrichment, D30 A/B/C stale policy).

## Section 3 — Evidence and Contract Sources

Read-only source inspection (no DB access, no execution claimed as test evidence).

| # | Finding | Evidence | Status |
|---|---|---|---|
| E1 | Order creation route: `POST /api/store/orders` — XOR identity (session XOR guest bearer); body `{addressId XOR (guestAddress+guestContact), idempotencyKey?, couponCode?}` + `Idempotency-Key` header; at-least-one-key + no-conflict enforced | `src/app/api/store/orders/route.ts:8-62,95-120`, `src/lib/orders/validation.ts:41-73` | VERIFIED |
| E2 | Creation semantics: one tx (live revalidation → promos/coupon → conditional reserve → snapshots → history NEW→CONFIRMED → cart CHECKED_OUT → guest credential same-tx); 201 (+`guestOrderToken` once, guest only) vs 200 replay `meta:{replay:true, guestTokenIssued:false}` | `src/app/api/store/orders/route.ts:121-138`, `src/lib/orders/writes.ts:176-215,439-514` | VERIFIED |
| E3 | Pre-tx idempotency: subject = latest cart any-status both kinds; key-hit + same cart → replay; key-hit + different cart → 409; lost INSERT race (23505) → reselect same rule; `CartConsumedError` → winner-by-cart replay or 409 | `src/lib/orders/writes.ts:176-204,515-532` | VERIFIED |
| E4 | In-tx guards: cart ACTIVE+unexpired else consumed path; customer must exist (404) + active (422); address must be owned (404 incl. foreign); guest needs guest ctx (400); empty cart 422 | `src/lib/orders/writes.ts:206-256` | VERIFIED |
| E5 | Line revalidation: unsellable variant/product → 422 + `variantId`; unit-snapshot mismatch → 422; step violations → 422; snapshot-vs-live drift collected → 409 `{variants[]}`; cart stays ACTIVE | `src/lib/orders/writes.ts:258-316` | VERIFIED |
| E6 | Promotions/coupon in-tx: autos + ONE coupon; coupon failures → 422 (`Invalid coupon code`, `not currently valid`, `minimum not reached`, `requires a customer account`, `per-customer limit reached`, `type not supported`, `no eligible lines`, `grants no discount`); per-customer-limited coupons inapplicable on guest path (422) | `src/lib/promotions/checkout.ts:222-230,307-310,757-829` | VERIFIED |
| E7 | Inventory: ASC locks, atomic conditional reserve per variant, all-or-nothing; loser → 409 `{productVariantId}`; bought+free summed per-variant (no double/under-reserve) | `src/lib/orders/writes.ts:389-416` | VERIFIED |
| E8 | Delivery fee: server-read `store_settings.delivery.default_fee`, fail-closed 500 on misconfiguration; never client-supplied, never silent 0 | `src/lib/orders/writes.ts:160-167`, `src/lib/orders/writes.ts:418-426` | VERIFIED |
| E9 | Order shape: `{id, orderNumber(HM-YYYYMMDD-######), status, idempotencyKey, subtotalEstimated, discountTotal, deliveryFee, totalEstimated, subtotalFinal\|null, totalFinal\|null, customerName/Phone snapshots, delivery{city,area,village,street,building,landmark,phone}, items[] snapshots, history[], createdAt/updatedAt}`; reads use SNAPSHOTS only | `src/lib/orders/serialize.ts:66-124`, `src/lib/orders/writes.ts:427-451` | VERIFIED |
| E10 | Estimate: `POST /api/store/orders/estimate` `{lines[{productVariantId,quantity}], couponCode?}` → `{lines[{variantId,quantity,unitPrice,gross,discounts[],net}], freeLines[], coupon{code,applicable,reason,amount}\|null, subtotal, discountTotal, deliveryFee, total}`; dry-run, no locks/rows/reservation; session customer used for per-customer checks when present | `src/app/api/store/orders/estimate/route.ts:14-40`, `src/lib/promotions/checkout.ts:384-418,504-564`, `docs/openapi.yaml:653-675` | VERIFIED |
| E11 | Estimate coupon nuance: malformed → 422; unknown code → 404 (estimate-only); validity/min/customer-required/limit/type/eligibility → `applicable:false + reason` (NOT thrown) | `src/lib/promotions/checkout.ts:504-564` | VERIFIED |
| E12 | Saved addresses (authenticated only): `GET` list / `POST` create / `GET-PATCH-DELETE /{addressId}`; owner server-derived; foreign → 404; default-race → 409; create requires `{city, phone}`, rest optional incl. `label/isDefault`; PATCH partial owner-immutable; DELETE hard (orders keep snapshots, unaudited self-service) | `src/app/api/store/customers/addresses/route.ts:19-67`, `src/app/api/store/customers/addresses/[addressId]/route.ts:17-89`, `src/lib/customers/validation.ts:68-94`, `docs/openapi.yaml:425-503` | VERIFIED |
| E13 | Guest address/contact schema: `guestAddress{city*, phone*, area?/village?/street?/buildingNumber?/landmark?}` + `guestContact{firstName*, lastName?}`; XOR with `addressId` (both/neither → 400; half-guest → 400); snapshots only, zero address rows | `src/lib/orders/validation.ts:14-73`, `src/app/api/store/orders/route.ts:72-81` | VERIFIED |
| E14 | Cart identity for checkout: `x-guest-token` XOR session (`resolveStoreOwner`); neither → 401 on create (absence = unauthenticated); wrong-side payload → 400; cart consumed/expired → 404 path | `src/app/api/store/orders/route.ts:63-81`, `src/lib/cart/owner.ts:18-44` | VERIFIED |
| E15 | Guest order credential: per-order bearer `x-guest-order-token` (64-hex), SHA-256 at rest, issued once same-tx (90d fixed TTL, keep-same on replay), header-only never URL; invalid/revoked → 401, expired → 410, foreign/cross-kind → 404; read bucket 60/15min/IP → 429 | `src/lib/orders/guest-access.ts:26-120,209-231`, `src/app/api/store/orders/route.ts:130-133` | VERIFIED |
| E16 | Post-creation read: `GET /orders/{id}` session-XOR-credential; `GET /orders` list (authenticated, key echoed in list items); guest has NO list endpoint | `src/app/api/store/orders/[id]/route.ts:15-39`, `src/app/api/store/orders/route.ts:141-166`, `src/lib/orders/serialize.ts:126-153` | VERIFIED |
| E17 | Error taxonomy: VALIDATION 400 / UNAUTHENTICATED 401 / NOT_FOUND 404 / GONE 410 (guest-credential expiry) / CONFLICT 409 / BUSINESS_RULE 422 / RATE_LIMITED 429 / INTERNAL 500; envelope `{error:{code,message,details}}` | `src/lib/api/errors.ts`, `src/lib/api/http-status.ts` | VERIFIED |
| E18 | No payment flow: zero payment routes/fields in store API + `orderCreateSchema`; payments tables are future-design-only; FP-04 §20 payments row = OUT OF SCOPE display convention ("COD display only", endpoint "none" — not a business policy); FP-00-D017 = UX abstraction with provider OPEN (Q002 "COD-only fallback?" explicitly open) | store route inventory (no payment namespace), `docs/openapi.yaml` (no payment paths), FP-04 §20–§21, FP-00-D017/Q002/G006 | VERIFIED ABSENT + business-unresolved |
| E19 | No coverage/governorate: no service-area lookup/validation/error anywhere in order path; no governorate field in any address/order schema | `src/lib/orders/*`, `src/lib/customers/validation.ts`, openapi address schemas | VERIFIED ABSENT |
| E20 | Key wire: `Idempotency-Key` header and/or body `idempotencyKey`, 1–64 chars, no spaces, trimmed==self; header wins ties | `src/lib/api/validation.ts:16-21`, `docs/openapi.yaml:69-72,119-124` | VERIFIED |
| E21 | Prior specs consumed unchanged: FP-11.1 (badge = total quantity, conditional sections), FP-11.2 (keyset/URL rules), FP-11.3 (variant authority, estimate honesty), FP-11.4 CLOSED D24–D30 (counts, remove/clear, compare-at omit, merge messaging, Checkout-only coupons, bounded enrichment, D30 A/B/C) | `docs/frontend/FP-11-{1,2,3,4}…` | VERIFIED (read) |

OpenAPI-vs-code: openapi order/address/estimate summaries match implementation; estimate unknown-coupon
404 vs creation-time 422 is an intentional dry-run/commit difference (E11 vs E6), not drift.

## Section 4 — Checkout Journey and State Model

Single-page sequential flow (FP-09 D06 direction; steps are UX sections, not separate endpoints):

1. **Entry (from cart).** Preconditions: confirmed cart read (200, `lines.length > 0`), identity side
   known (session or guest token). Empty/unconfirmed/consumed cart → return-to-cart state, never an
   order attempt. Entry preserves cart id, identity side, and (if typed) coupon draft.
2. **Customer-mode handling.** Authenticated → saved-address step (§5). Guest → inline address step
   (§6). Mode switch mid-checkout (login/logout) resets address selection to that mode's source and
   requires revalidation; merge (if invoked) is explicit and completed BEFORE address entry resumes.
3. **Delivery address.** Select owned `addressId` (authenticated) or complete inline guest form (§7).
   Address is confirmed client-valid AND (for saved) freshly re-listed; guest inline has no server
   pre-check endpoint — creation-time validation is authoritative.
4. **Cart + price review.** Render confirmed cart lines (§8) + `POST /cart/reprice` affordance when
   `priceCheckedAt` stale (FP-11.4 D30-A). No checkout-proceeding block for stale display values.
5. **Estimate/validation (supported, non-binding).** `POST /orders/estimate` with current lines +
   coupon draft → preview block (§9). Failure → mapped message + retry; estimate never gates submission
   by itself and never reserves stock.
6. **Final confirmation.** Explicit submit action (§10) enabled only when: cart confirmed non-empty,
   address confirmed per mode, no mutation in flight, idempotency key minted for THIS attempt (§11).
7. **Submission in progress.** Single-flight lock, progress UI, no duplicate sends (§10–§11).
8. **Confirmed success.** ONLY on 201 (or 200 replay): success screen (§13) with authoritative order
   data + guest credential moment (guest first-creation only).
9. **Rejected submission.** 400/401/404/409/422/429 mapped per §14; cart stays ACTIVE (except consumed
   404-path); address/coupon/key material preserved; review required when totals changed.
10. **Ambiguous outcome.** Timeout/loss after send with key issued → §11 machine (same-key resolve,
    never blind fresh submit).
11. **Recovery/return.** Supported ops only: re-GET cart, reprice, re-estimate, address fix, login,
    fresh mint, NEW key after drift-409, authenticated list-lookup; back-to-cart preserves all input.

Transition data required: confirmed cart object → confirmed address payload → fresh-enough
price basis (or explicit stale acknowledgement per D30-A) → estimate preview (best-effort) → minted
idempotency key → creation response.

## Section 5 — Authenticated Customer Flow

- **Session.** Valid `__Host-customer-session` cookie (or `x-customer-token` same-origin header).
  Missing/invalid/expired/revoked → 401 at any step → login prompt; entered address/coupon preserved
  locally; post-login flow restarts at address selection (no auto-submit, no auto-merge).
- **Saved-address selection (VERIFIED).** `GET /customers/addresses` → owned list. Select exactly one
  `addressId` (radio semantics). `GET /{addressId}` available for refresh; foreign/unknown → 404
  (treat as removed → re-list + reselect). Default flag (`isDefault`) is a creation/patch hint with a
  409 race semantic — UI MUST NOT assume the first address is default; if no `isDefault:true` row,
  require explicit selection (D33).
- **New-address behavior (VERIFIED).** `POST /customers/addresses` with `{city*, phone*, area?,
  village?, street?, buildingNumber?, landmark?, label?, isDefault?}` → 201. Usable immediately as the
  selected `addressId`. PATCH/DELETE exist but are account-management scope: checkout offers
  select + create-new only (edit/delete links may navigate away; never inline-invented management UI
  beyond selection affordance — D33).
- **Cart identity.** Session is the owner; guest token MUST NOT be sent alongside (both-sides → 400).
  If the customer also holds a guest cart, it is invisible here until an explicit merge (FP-11.4) —
  checkout never merges implicitly.
- **Review + submit.** Body `{addressId, idempotencyKey?, couponCode?}` + header key; NO guest fields
  (session + guest payload → 400). Coupon failures are 422 with per-reason messages (§12).
- **Success.** 201 `{order}` (no credential). Follow-up `GET /orders/{id}` or list readily confirms;
  success screen shows `orderNumber` (never bare UUID as the hero identifier).

## Section 6 — Guest Checkout Flow

- **Entry.** Guest arrives with a confirmed guest cart (`x-guest-token`). No account creation required
  — mandating signup is FORBIDDEN (contract supports account-less creation; BGGO Q1 LOCKED-direction).
- **Identity.** The SAME cart bearer authenticates creation. Missing token → 401; malformed → 400;
  unknown/expired/consumed cart → 404 path (fresh mint + re-add, checkout restarts). Never send a
  session alongside (both-sides → 400); never send `addressId` (guest + addressId → 400).
- **Inline address (VERIFIED).** `guestAddress{city*, phone*, area?, village?, street?,
  buildingNumber?, landmark?}` + `guestContact{firstName*, lastName?}`. Both objects COMPLETE or the
  call is 400 (half-guest rejected at schema AND route). Snapshots only — no address entity is
  created, read, or referenced. Phone is contact data here, never an auth factor.
- **Creation request.** `{guestAddress, guestContact, idempotencyKey?, couponCode?}` + guest header +
  `Idempotency-Key` header. Per-customer-limited coupons → 422 `requires a customer account` /
  `per-customer limit` semantics — surface honestly, never silently drop the coupon.
- **Credential moment (critical).** First-creation 201 returns `guestOrderToken` (raw, EXACTLY ONCE —
  a bearer secret, not an order identifier). UI MUST present a one-time save affordance (copy button +
  masked-by-default value revealed/copied ONLY via explicit user action + `لن يظهر هذا الرمز مرة أخرى` +
  acknowledge-saved gate per approved D35). Retention follows the LOCKED backend posture
  (BGGO-D014, FP-04 §14): origin-scoped persistent app storage, key `guest-order-token:<orderId>`,
  explicit header attach per request, never URL — with XSS hygiene (no HTML dump, no query params).
  The acknowledgement is a UX safeguard, NOT a security boundary; persistence guards refresh-loss
  only and does NOT make a wiped/stolen/compromised credential recoverable (storage ≠ recovery —
  D39; a compromised browser profile/device exposes the token). Replay responses carry NO token
  (keep-same). Never in URL, query params, analytics, error-reporting payloads, support text, or
  logs (D36).
- **Success/recovery.** Success screen per §13 with order number + credential-saved confirmation state.
  Follow-up `GET /orders/{id}` requires the credential (401 without, 410 expired, 404 foreign).
  Lost credential + lost response = §11 critical path.
- **Invalid credentials.** 401 → re-check stored token (single-char corruption is a client bug class;
  offer re-paste from the saved moment, else restart as fresh guest). 404 cart-gone → fresh cart path.

## Section 7 — Delivery Address UX

Agreed fields ONLY (no governorate — VERIFIED absent everywhere):

| Field (Arabic label) | Authenticated saved | Guest inline | Rules |
|---|---|---|---|
| المدينة `city` | Required on create | Required | 1–80 chars, trimmed; server 400 on shape breach |
| المنطقة `area` | Optional | Optional | 1–80 when present; empty = omit (never send `""` as meaningful) |
| القرية `village` | Optional | Optional | 1–80 when present (Matai-hinterland reality; no endpoint validates it) |
| الشارع `street` | Optional | Optional | 1–120 when present |
| رقم المبنى `buildingNumber` | Optional | Optional | 1–30 when present |
| علامة مميزة `landmark` | Optional | Optional | 1–160 when present |
| رقم الهاتف `phone` | Required on create | Required | Non-empty ≤32 wire (400 on shape); R8 ladder semantics in domain (422 on non-identity) — client validates non-empty + digits/pluses only as UX pre-check, server is authoritative |
| الاسم الأول `firstName` (guest contact) | — (from customer row snapshot) | Required 1–80 | — |
| اسم العائلة `lastName` | — | Optional | — |
| `label` / `isDefault` | Optional (saved only) | N/A | Display hint only; no default assumed (D33) |

- **Client validation (UX pre-check, never authority):** required-present, max-length, phone
  non-empty; inline Arabic errors per field (`المدينة مطلوبة`, `رقم الهاتف مطلوب`, …). Unknown/extra
  fields never sent (strict schemas → 400).
- **Normalization:** trim only. No case/whitespace/canonical-phone transform claimed (R8 ladder is
  server-side). Show typed values back verbatim on recovery.
- **Server rejection:** 400 shape (fix field) vs 404 address-gone (re-list + reselect) vs 401 session
  (login) — each mapped, values preserved.
- **Coverage:** NO live service-area validation exists (E19). Matai Center + nearby areas is a business
  fact, not an endpoint. UI shows the restrained informational line `التوصيل داخل مطاي والمناطق القريبة`
  with an explicit no-check disclaimer (`معلومة — لا يوجد تحقق لحظي من التغطية`, approved D34) and
  handles no unsupported-area error (none contracted). Promising zone checks or inventing a lookup is FORBIDDEN.
- **Preservation:** all entered values survive recoverable failures (drift-409, coupon-422,
  rate-429, timeout-ambiguous) — cleared only on explicit mode change or successful creation.

## Section 8 — Order Review and Financial Summary

Every value mapped; NOTHING invented.

| Element | Source | Obligation |
|---|---|---|
| Product/variant + qty/weight | Confirmed cart `lines[]` (or creation echo) | Required |
| Unit price | Cart `unitPriceSnapshot` / estimate `unitPrice` / order `unitPrice` | Required; snapshot labeled quote until order confirms |
| Line total | Cart `lineTotal` / estimate `net` / order `estimatedTotal` | Required; estimate-net labeled preview |
| Confirmed discount rows | Estimate `lines[].discounts[]` + `discountTotal` (preview) → order `discountTotal` (authoritative) | Conditional: preview block vs confirmed order block, never mixed |
| Coupon outcome | Estimate `coupon{applicable,reason,amount}` (preview) → order totals (authoritative absorption; no per-coupon row contracted) | Conditional; `reason` shown verbatim when `applicable:false` |
| Delivery fee | Estimate `deliveryFee` (preview) → order `deliveryFee` (authoritative, server-read) | Show ONLY when the supporting response returned it; never typed, never 0-by-default |
| Estimate total | Estimate `total` | Preview ONLY, labeled `تقدير غير نهائي` |
| Final order total | Order `totalEstimated` (+ `totalFinal\|null` when fulfillment later sets it) | ONLY on the success screen from the creation response / follow-up read |
| Taxes/service charges | NONE contracted | NOT SUPPORTED — never shown, never 0-shown as promise |
| Compare-at / crossed-out | NONE in cart/estimate/order line authority for checkout | OMITTED per FP-11.4 D26 (no variant-fetch price dressing on checkout) |

- **Required vs conditional:** identity + address + cart lines + submit key are required; estimate
  preview, coupon reason, delivery-fee line, discount rows are conditional on API support; taxes,
  coverage promises, and every payment element (selection, capture, status, method lines including
  COD — D37) are unsupported and OMITTED: checkout shows no payment step and promises no method.
  The payment-method business decision itself is unresolved (owner business question, FP-00-Q002).
  Fulfillment actuals (`actualQuantity/finalTotal`) belong to later flows.
- **Estimate ≠ total:** the preview block and the confirmed-order block are visually and textually
  distinct (different headings, different timestamps). Reusing preview numbers as "final" is FORBIDDEN.

## Section 9 — Estimate, Revalidation, and Customer Review

- **When.** Best-effort preview after address confirmation AND on every material change (qty, coupon
  draft, reprice). Debounced, latest-wins; failure never blocks address editing, only marks the
  preview stale/unavailable.
- **Input.** Current cart lines `[{productVariantId, quantity}]` + coupon draft (trimmed; empty =
  omitted) — NO address, NO cart identity header contracted for estimate (session customer auto-used
  for per-customer checks when present).
- **Response use.** Render preview block (lines + discounts + coupon reason + subtotal/discount/
  delivery/total). `freeLines[]` shown as informational bonus rows (never added to cart client-side).
- **Statelessness.** Estimate mutates NOTHING: no locks, no rows, no reservation, no coupon
  consumption. Races against creation resolve by re-estimating.
- **Drift/availability at estimate time.** Unsellable line → 422 + `variantId` (drop/fix path);
  unknown coupon → 404 (estimate-only; creation would 422 — surface "غير معروف" distinctly);
  inapplicable coupon → `applicable:false + reason` inline (not an error wall).
- **Retry rule.** Fresh estimate REQUIRED before safe retry after drift-409 or cart mutation; stale
  previews hidden/badged, never submitted against.
- **Estimate failure.** Mapped message + `إعادة المعاينة`; checkout may still submit (creation
  revalidates authoritatively) — but submitting blind after a KNOWN estimate failure requires the
  explicit stale acknowledgement (D30-A).

## Section 10 — Final Confirmation Interaction

- **Button.** `تأكيد الطلب` (primary; `تأكيد الطلب · {total}` ONLY when the total shown is the
  freshly-estimated preview with timestamp, else bare label — never a stale total in the CTA).
- **Preconditions (all required):** confirmed non-empty cart; confirmed address per mode; no
  mutation/estimate in flight on the submit path; coupon draft settled (applied-to-preview or
  explicitly skipped); idempotency key minted for THIS attempt (UUIDv4/hex, 1–64 no-spaces,
  persisted for the attempt lifetime); stale-price acknowledgement if D30-A flag set.
- **Payload sent.** Exactly the contracted body + headers (§5/§6 + key). Client NEVER sends prices,
  totals, discounts, fees, `customerId`, or payment data (no such fields; strict schemas reject extras).
- **In-progress.** Single-flight lock: button disabled + spinner + `جارٍ إرسال طلبك…`; duplicate
  clicks/taps coalesced (no second POST); navigation away guarded by a dismissible
  `beforeunload`-style confirmation ONLY while the request is outstanding or ambiguous-verifying
  (approved D38 — never traps recovery or blocks back-to-cart after settle).
- **Waiting.** Await the authoritative response (generous timeout; no client-side success assumption).
  No required checkbox/payment/acknowledgement beyond the above (none contracted — inventing one is
  FORBIDDEN without owner decision).
- **Success = ONLY 201/200-replay.** Anything else is §12/§14/§11 handling, never a success screen.

## Section 11 — Duplicate Submission and Ambiguous Outcomes

Verified mechanics (E1–E3/E20): client-minted key, persistent server record, same-cart replay,
different-terms 409, race-reselect, keep-same credential, cart-consumed winner replay.

State machine:

```text
IDLE --(submit: key K, cart C)--> SENT
SENT --(201 new)--> CONFIRMED_NEW (credential once if guest)
SENT --(200 replay, meta.replay)--> CONFIRMED_REPLAY (no credential; reuse first)
SENT --(400/401/404/422/429)--> REJECTED (no order from THIS attempt; §12/§14 path)
SENT --(409 drift/stock/key-terms)--> REJECTED_NEEDS_REVIEW (cart ACTIVE; new key after fix)
SENT --(timeout/loss, K issued)--> AMBIGUOUS --(resubmit SAME K + same C)--> SENT (resolve)
AMBIGUOUS --(200 replay)--> CONFIRMED_REPLAY
AMBIGUOUS --(201 — only if nothing committed)--> CONFIRMED_NEW
AMBIGUOUS --(409 different-terms)--> evidence an order exists under K with other terms → resolve via list/read
AMBIGUOUS --(guest, no order id, no credential, list unavailable)--> UNRESOLVABLE (critical gap D39)
```

Rules:

1. **Timeout = AMBIGUOUS, never failed.** Do NOT declare failure and invite a fresh submission.
   Same-key resubmit is the SAFE retry (idempotent by construction).
2. **Fresh key ONLY after:** explicit rejection (400/422/409-drift/stock), cart mutation, address/
   coupon change, or confirmed different-terms 409 understood. Fresh key after AMBIGUOUS without
   resolution risks a duplicate order — FORBIDDEN.
3. **Resolution paths (supported):** same-key resubmit (primary); authenticated `GET /orders` list
   (match `idempotencyKey` echo → identify the order); `GET /orders/{id}` when id known
   (session/credential). NO storefront key-lookup endpoint exists — resolution is via resubmit + list,
   not via a dedicated resolver.
4. **Disconnect-after-commit** is indistinguishable client-side from loss-before-commit: the machine
   above is the ONLY supported handling. Button-disabling alone never guarantees exactly-once (the
   request may already be committed server-side).
5. **Order number ≠ proof of access.** Display only; reads still require session/credential.
6. **Lost-credential path (guest — D39 RESOLVED via staff-assisted recovery, §19).** A guest
   that retains key K can same-key resubmit and learn the ORDER ID via replay — but never the
   credential (keep-same omits it). A guest that also lost K (and received no order id) is directed
   to the staff-assisted recovery route (verified credential + audited rotate/revoke), never to a
   self-service workaround. The state machine MUST surface AMBIGUOUS-verifying (never "failed"),
   forbid fresh-key resubmission until resolved, and offer the §19 safe policy. No client workaround
   is invented.

## Section 12 — Price Drift, Stock Changes, and Business Rejections

| Server response | Meaning | UI behavior |
|---|---|---|
| 409 `Prices changed… {variants[]}` | Snapshot ≠ live; NOTHING committed; cart ACTIVE | Identify rows by name/variant (ids in details); show old→new after reprice/re-estimate; REQUIRE review; NEW key; resubmit only on explicit confirm |
| 409 `Insufficient availability {productVariantId}` | Conditional reserve lost the race | Same identification + review; offer qty-reduce (PATCH, step-valid) / remove / retry unchanged (may re-race); NEW key |
| 422 `Cart contains an unsellable variant {variantId}` / unit/step breaches | Liveness/step rule | Row `غير متاح حاليًا` + fix/remove path; revalidate (reprice) before resubmit; NEW key |
| 422 coupon family (invalid/not-valid/min/account/limit/type/eligible/grants) | Coupon rejected; NOTHING committed | Verbatim reason mapped (`الكوبون غير صالح`, `الحد الأدنى لم يكتمل`, `يتطلب حسابًا`, …); keep coupon draft editable; resubmit WITHOUT coupon or fixed code + NEW key |
| 404 cart/address gone | Consumed/expired cart or deleted/foreign address | Cart path: fresh mint + rebuild; address path: re-list + reselect; values otherwise preserved; NEW key |
| 400 shape/conflict-keys/ambiguous-identity | Client bug class | Fix payload (strip extras, resolve key conflict, correct side/payload pairing); same attempt may reuse key ONLY if nothing was sent (pre-flight 400) — post-send 400s still rotate key per D38 |

- Preserve address + coupon draft + key history across all recoverable rejections. No retry loops
  (single corrective action → single resubmit). Never silently drop/reprice rows in UI — every change
  comes from a confirmed reprice/estimate/creation response. Unavailable-without-substitute ships
  short is a FULFILLMENT rule (post-creation), never a checkout-time omission license.

## Section 13 — Confirmed Success Screen

- **Heading.** `تم استلام طلبك بنجاح` + subline `سنبدأ بتجهيزه الآن` (microcopy RECOMMENDATION;
  FP-04/FP-05 locked strings prevail on conflict).
- **Hero identifier.** Business `orderNumber` (`HM-YYYYMMDD-######`) large; internal UUID in muted
  details-only text (support reference). Date/time from `createdAt` (ISO → localized display).
- **Summary.** Snapshot lines (name/variant/qty/unit/price/estimated line totals) + `subtotalEstimated`
  + `discountTotal` (when non-zero) + `deliveryFee` + `totalEstimated`; delivery snapshot block;
  customer name/phone snapshot. `subtotalFinal/totalFinal` shown ONLY if a follow-up read returns
  non-null (fulfillment-owned; normally null here — never fabricated).
- **Guest credential block (first-creation only, approved D35/D36).** One-time panel: `رمز متابعة طلبك` +
  masked-by-default value (reveal/copy only via explicit action) + copy button + `احفظه — لن يظهر مرة أخرى` +
  acknowledge-saved gate before leaving success (a UX safeguard, not a security boundary). Stored per
  locked BGGO-D014 (`guest-order-token:<orderId>`); clear it only on explicit user sign-out equivalent
  or after confirmed expiry (410) — never silently while the order is live (FP-04 §14). Persistence ≠
  recoverability — a wiped/compromised credential is still unrecoverable per D39. Replay successes show `طلبك مسجل مسبقًا` + credential-reuse hint (no new token). Follow-up read failure
  (401/410/404/429) AFTER creation → success stands; show `تعذر تحميل التفاصيل` inline with retry —
  never revoke the success state.
- **Authenticated.** Order appears in history (`GET /orders`); CTA `تتبع طلبك` navigates ONLY if a
  supported FP-11.6 route exists at build time — else `العودة للرئيسية` + `مواصلة التسوق`. Inventing
  an FP-11.6 route here is FORBIDDEN.
- **Navigation.** Clear the checkout attempt state (key retired — never reused for a NEW order);
  cart identity now consumed (`CHECKED_OUT`); bottom nav intact.

## Section 14 — Error and Recovery Matrix

`Known?` = does the server confirm nothing was created. `Resubmit?` = may the SAME attempt data be
resent (same key) vs NEW key required.

| Scenario | Detectable response | Known? | Message (AR) | Preserve | Recovery | Resubmit? | Evidence | Gap |
|---|---|---|---|---|---|---|---|---|
| Address shape bad | 400 VALIDATION | Nothing created (pre-send or schema gate) | `تحقق من بيانات العنوان` + field error | All input | Fix field | Same key iff never sent; else new | E13/validation | — |
| Half-guest / wrong-side payload | 400 | Nothing created | `أكمل بيانات التوصيل` / `تعارض بيانات الطلب` | All input | Complete/correct side pairing | New key if sent | E1/route 72-81 | — |
| Key conflict/missing | 400 | Nothing created | `تعذر تأمين الطلب — حاول مجددًا` | All input | Resolve key (single source) | New key | E1/E20 | — |
| No identity | 401 | Nothing created | `سجل الدخول أو ابدأ كضيف` | Cart draft | Login / mint guest | New key | E14 | — |
| Session expired mid-flow | 401 | Nothing created by THIS attempt | `انتهت جلستك — سجل الدخول` | Address/coupon/key-draft | Login → reselect → resubmit | New key | E14 | — |
| Guest token bad/gone | 400/404 | Nothing created | `تعذر الوصول للسلة — ابدأ سلة جديدة` | Address draft | Fresh mint + rebuild | New key | E14 | — |
| Cart empty | 422 `Cart is empty` | Nothing created | `سلتك فارغة — أضف منتجات أولًا` | Address draft | Back to cart | New key | E4 | — |
| Unsellable/step/unit | 422 + variantId | Nothing created | `منتج لم يعد متاحًا` + row | Address/coupon | Fix/remove + revalidate | New key | E5 | — |
| Price drift | 409 + variants[] | Nothing created, cart ACTIVE | `تغيرت الأسعار — راجع الجديد قبل التأكيد` | Everything | Reprice + review + NEW key | NEW key only | E5 | — |
| Stock short | 409 + variantId | Nothing created, cart ACTIVE | `الكمية غير متوفرة حاليًا` | Everything | Reduce/remove/retry + NEW key | NEW key only | E7 | — |
| Coupon rejected | 422 reason family | Nothing created | Per-reason mapping | Everything incl. coupon draft | Fix/skip coupon + NEW key | NEW key only | E6 | — |
| Key reused other terms | 409 | OTHER order exists under key | `هذا الطلب مسجل مسبقًا ببيانات مختلفة` | Everything | Resolve via list/read; do NOT force new order on same key | Never same key for new order | E3 | — |
| Guest create throttled | 429 guest bucket | Nothing created (fail-closed pre-tx) | `محاولات كثيرة — انتظر قليلًا` | Everything | Backoff + SAME key retry (same terms) | Same key OK | E1/route 82-94 | — |
| Guest read throttled | 429 read bucket | Unknown (read path) | Same wording | Everything | Backoff + retry read | N/A | E15 | — |
| Server error | 500 | UNKNOWN — treat as AMBIGUOUS if sent | `حدث خطأ — لا تعيد الإرسال مباشرة` | Everything + key | Same-key resolve (§11) | Same key only | E17 | — |
| Timeout/loss after send | No response, key issued | AMBIGUOUS | `لم نتأكد من النتيجة — جارٍ التحقق بنفس المحاولة` + explicit do-not-fresh-submit notice | Everything + key K | Same-key resubmit / list lookup (auth); guest follows D39 safe policy | Same key only | §11 | Guest credential recoverable via staff-assisted rotate/revoke (D39 RESOLVED) |
| Success then details fail | 201 then 401/410/404/429 on follow-up | CREATED (confirmed) | `تم إنشاء طلبك — تعذر تحميل التفاصيل` | Order id + credential | Retry read; success stands | Retired key | E16 | — |

## Section 15 — API-to-UI Mapping

| UI state/field | Method + route | Request | Response fields | Authority | Errors → recovery | Evidence | Verification |
|---|---|---|---|---|---|---|---|
| Checkout cart | `GET /cart` (+ `POST /cart` resolve/mint) | XOR identity | Full `cart` | → Server | 400/401/404 per FP-11.4 | E14/FP-11.4 | VERIFIED |
| Refresh prices | `POST /cart/reprice` `{}` | XOR identity | `{cart, reprice{repriced,dropped}}` | → Server | 404 consumed path | FP-11.4 §E8 | VERIFIED |
| Saved addresses | `GET /customers/addresses` | Session | Address list | → Server | 401 login | E12 | VERIFIED |
| New saved address | `POST /customers/addresses` `{city*,phone*,…}` | Session | Created address | → Server | 400/401/409-default-race | E12 | VERIFIED |
| Preview pricing | `POST /orders/estimate` `{lines[], couponCode?}` | Lines + code (session auto for per-customer) | lines/discounts/freeLines/coupon/subtotal/discountTotal/deliveryFee/total | → Server (preview) | 422/404-coupon-unknown/applicable:false | E10/E11 | VERIFIED |
| Submit (auth) | `POST /orders` `{addressId, idempotencyKey?, couponCode?}` + `Idempotency-Key` | Session, NO guest fields | 201 `{order}` / 200 replay | → Server (sole committer) | 400/401/404/409/422/429 | E1–E8 | VERIFIED |
| Submit (guest) | `POST /orders` `{guestAddress, guestContact, …}` + headers | Guest bearer, NO addressId | 201 `{order, guestOrderToken}` / 200 replay (no token) | → Server | Same + guest-422 coupon | E1–E8/E15 | VERIFIED |
| Confirm read (auth) | `GET /orders/{id}` | Session | `{order}` snapshots | → Server | 401/404 | E16 | VERIFIED |
| Confirm read (guest) | `GET /orders/{id}` | `x-guest-order-token` | `{order}` snapshots | → Server | 401/410/404/429 | E15/E16 | VERIFIED |
| History resolve | `GET /orders` (+cursor) | Session | List incl. `idempotencyKey` echo | → Server | 401 | E16 | VERIFIED |
| Fee source | (none client-facing) `store_settings.delivery.default_fee` | — (server-read in-tx) | `deliveryFee` in estimate/order | → Server | 500 misconfig (fail-closed) | E8 | VERIFIED |

Unsupported in mapping: payment capture/refund, coverage lookup, key-resolver endpoint, guest list,
cart-version/etag, order edit/cancel-here (cancel is post-creation account flow, not checkout submit).

## Section 16 — Security and Data Integrity

1. **Server-enforced ownership.** Address selection constrained server-side (owned-only list, 404 on
   foreign, no `customerId` accepted). Guest creation never invents/links a customer row
   (true account-less, `customer_id NULL`). Order reads require session ownership or the order-bound
   credential — order number alone authorizes nothing.
2. **Guest cart token vs order credential.** Two different bearers, two headers, two lifecycles:
   `x-guest-token` (cart, until CHECKED_OUT) vs `x-guest-order-token` (per-order, 90d). Never
   interchange, never co-send as substitutes, never persist one in the other's slot. Post-creation,
   the cart token is dead (consumed cart) — retain ONLY the order credential.
3. **Credential transport/storage hardening (approved D35/D36; posture LOCKED per BGGO-D014 +
   FP-04 §14, restated here as binding UX rules).** (1) The token is a bearer SECRET, never an order
   identifier — no order number, phone, or order response reconstructs it. (2) Headers only; never in
   URLs, query params, browser history, analytics, logs, error-reporting payloads, or support messages;
   support flows never solicit it over insecure channels. (3) Masked by default; reveal/copy ONLY via
   explicit user action. (4) The acknowledge-saved gate is a UX safeguard, NOT a security boundary.
   (5) Persistent storage (`guest-order-token:<orderId>`) increases exposure if the browser profile or
   device is compromised — stated, not hidden. (6) No recovery promised after loss: no self-service
   reissuance exists; rotation/revocation are staff-operated server paths (FP-04 §14), never
   presented as guest capabilities. (7) Clearing only on explicit sign-out equivalent or confirmed
   expiry (410) — never silently while live. (8) No invented expiry/rotation/reissuance guarantee
   beyond the verified 90-day fixed TTL + 401/410/404 semantics. Session stays HttpOnly cookie.
   401 → login; 410 → expired-terminal (no retry as success); 429 → backoff.
4. **No client-trusted money.** Prices/totals/discounts/fees come ONLY from estimate (preview) and
   creation (authoritative) responses. Strict-schema 400s mean no convenience fields in bodies.
5. **No false success.** Success screen renders ONLY on 201/200-replay. Preview/optimistic states never
   masquerade as creation. Follow-up read failure never revokes a confirmed creation.
6. **No unsafe retry.** Ambiguous outcomes reuse SAME key (never fresh-key duplicate risk); rejected
   outcomes rotate to NEW key after review (never same-key different-terms 409 loops). Button
   single-flight + navigation guard; no background auto-resubmit.
7. **Data preservation without bypass.** Retained input (address/coupon/key) is redisplayed for
   correction but revalidated server-side on every submit — preservation never skips validation.

## Section 17 — RTL, Accessibility, and Responsive Design

- **Layout.** Arabic-first `dir=rtl`; mobile-first single column: address → review → coupon →
  confirm (sticky bottom CTA bar, non-occluding, keyboard-safe); tablet/desktop two-column (form +
  sticky summary rail). Progress = UX sections (1-العنوان 2-المراجعة 3-التأكيد) — never implying
  server steps that don't exist. Bottom nav (`الرئيسية·الأقسام·بحث·العروض·السلة`) intact; checkout
  is header-flow, not a nav tab.
- **Labels/errors.** Every input labeled (`المدينة *`, `رقم الهاتف *`, …); required marked; errors
  `aria-describedby` + `role=alert` on submit-level failures; `aria-live="polite"` for estimate
  refresh, drift notices, submit progress, success/ambiguity announcements; `aria-busy` skeletons.
- **Keyboard/focus.** Logical RTL tab order; visible focus (FP-10 pairs); error summary focuses on
  submit-fail; success heading focuses on confirm; sheet/modal (if any) traps + restores; Esc
  dismisses without side effects.
- **Submit states.** Disabled (missing/incomplete), enabled, sending (spinner + `جارٍ…` + locked),
  ambiguous-verifying (distinct from sending). No duplicate CTAs on mobile (one primary).
- **Money readability.** Western numerals + `ج.م`, exact strings (no rounding in display),
  unit-aware quantities (`0.500 كجم`, `2 عبوة`), `bdi`-isolated mixed strings; preview vs confirmed
  blocks visually distinct (dashed preview border vs solid confirmed — approved D38).
- **Brand.** Purple `#511D9C` / Orange `#FF7100` / Text Orange `#C2410C` / Ink `#1B1530` / Purple
  Surface `#EEE8F5` / Orange Surface `#FFF1E6` / Success `#15803D` / Error `#C62828`; `#FF7100`
  never body-text on white; deferred font untouched. No WCAG conformance claimed without testing.

## Section 18 — Acceptance Criteria and Test Scenarios

> Specification-level only. NONE executed. No pass claimed. Future build verifies on scratch with
> explicit `DATABASE_URL` override (per handoff discipline).

- AC-CH-01 Auth: valid session full flow 201; expired session 401 → login → reselect → NEW key → 201.
- AC-CH-02 Guest: bearer + complete inline address/contact → 201 + one-time credential; half-guest
  400; guest+addressId 400; session+guest-payload 400; neither identity 401.
- AC-CH-03 Saved address: list → select → submit 201; foreign id 404 → re-list path; create-new
  (city+phone) 201 → immediate use; no default assumed.
- AC-CH-04 Guest inline: required/optional matrix per §7; overlong/empty → 400 field errors; values
  preserved after 409/422 recoveries; no governorate field anywhere.
- AC-CH-05 Coverage: no lookup offered; informational area text only; no unsupported-area error
  invented or asserted.
- AC-CH-06 Financial review: every figure traced (§8); estimate labeled preview; order figures from
  creation only; no tax rows; no payment step, status, fee, or method promise of any kind (D37
  corrected — neutral omit); fee only when returned.
- AC-CH-07 Drift: live-price mutation → 409 `{variants[]}` → old→new review → NEW key → 201; cart ACTIVE
  throughout; no silent auto-accept.
- AC-CH-08 Stock: depleted variant → 409 `{productVariantId}` → reduce/remove/retry paths; unsellable
  → 422 + row treatment.
- AC-CH-09 Coupon: valid → absorbed totals; unknown (estimate 404 vs creation 422) distinguished;
  per-customer on guest → honest 422; inapplicable → reason verbatim; coupon never listed/invented.
- AC-CH-10 Success: 201 shape (id + `HM-…` + CONFIRMED + snapshots + fee/totals); guest token once;
  replay 200 `meta.replay` without token; UUID never hero identifier.
- AC-CH-11 Double-click: 5 rapid taps → ONE POST (single-flight); no duplicate orders.
- AC-CH-12 Timeout: killed response → AMBIGUOUS → same-key resubmit → replay/201; no fresh-key
  duplicate.
- AC-CH-13 Ambiguity resolve: auth list matches `idempotencyKey` echo; guest with key held replays
  to learn the order id but never the credential (keep-same); guest with key + credential both lost
  → staff-assisted recovery route (D39 RESOLVED — rotate/revoke verified, no workaround claimed).
- AC-CH-14 Credential: missing → 401 path; expired → 410 terminal; foreign → 404; throttled reads 429
  backoff; token never in URL/logs.
- AC-CH-15 Preservation: address/coupon/key-draft survive drift/coupon/429/ambiguity; cleared only on
  mode change or confirmed creation.
- AC-CH-16 RTL/mobile: 360px single column, 44px targets, sticky CTA safe, focus + live-region
  behavior per §17, preview/confirmed distinction visible.
- AC-CH-17 No fabrication: zero fee/tax/discount/payment/coverage claims beyond responses; estimate
  never presented as final.
- AC-CH-18 Zero-app-code: status shows only the target spec changed atop pre-existing work; no
  backend/DB/dep/commit/push.
- AC-CH-19 Safety-review hardening (spec-level, unexecuted): checkout shows no payment-method claim
  (D37 neutral omit; method business question recorded unresolved); credential panel implements the
  8-rule policy (secret-not-id, never-in-URL/params/history/analytics/logs/errors/support,
  masked-default + explicit action, ack≠boundary, compromise exposure stated, no recovery promise,
  staff-only rotation, live-only clearing per BGGO-D014/FP-04 §14); in-progress/ambiguous/lost-token
  states follow D39 A/B/C (processing lock + same-key discipline, verifying-not-failed + no fresh
  key, confirmation-vs-access split + no replay-recovers-token claim).

## Section 19 — Owner Decision Register

> `OWNER-APPROVED (delegated, 2026-10-09)` = closed under the delegated owner authorization
> supplied for this review task (D31–D38 only). Provenance: agent professional review exercised under
> explicit delegation — NOT a direct per-decision user statement, NOT a backend change, NOT new
> verification. Decision IDs preserved; evidence/options retained with outcome rationale.
> `BLOCKED` (D39) = contract gap needing separately authorized backend/product work — the future
> capability below is recommended, not authorized, and the gap stays unresolved.

| ID | Topic | Evidence & constraints | Options | Selected + rationale | Rejected & trade-offs | UX requirements + cross-refs | Status |
|---|---|---|---|---|---|---|---|
| FP11-D31 | Coupon-box placement inside checkout | Estimate + creation both accept `couponCode` (E10/E1); estimate separates `applicable:false+reason` from thrown errors (E11); creation coupon failures are post-submit 422+new-key (E6); FP-11.4 D28 = Checkout-owned; no coupon list | (a) Review-step field + `تطبيق` → live estimate re-run + reason display (b) Confirm-line-only | SELECTED (a). Review-step placement surfaces invalid/min/account/limit/type/eligibility failures at the cheapest moment (pre-submit estimate) instead of the most expensive (post-submit 422 + key rotation + re-review). The `تطبيق` action is estimate-scoped and never implies application; creation remains the only applier. Mobile: one field + one button, RTL-natural. | (b) rejected: pushes every coupon error past the commitment point, maximizing wasted submits and key churn for zero contract benefit. | Coupon field lives in review (§4.5/§9/§10); `reason` verbatim on `applicable:false`; unknown-code 404-vs-422 distinction kept (§9/§12/§14); no Cart coupon box (FP-11.4 D28 intact) | OWNER-APPROVED (delegated, 2026-10-09) |
| FP11-D32 | Estimate auto-refresh policy | Estimate stateless dry-run, no locks/rows/reservation (E10); stale-preview risk is the D30-A failure mode; no estimate rate bucket, but unbounded calls still cost latency/battery | (a) Auto re-estimate on settled cart/coupon change (debounced, latest-wins, abort/stale-discard) + manual `تحديث المعاينة` fallback (b) Manual-only | SELECTED (a). Auto keeps previews fresh without user vigilance; bounding (settle-debounce, in-flight abort, newest-wins, failure→stale badge + manual retry) prevents spam and stale-as-final display. Manual fallback covers failures and metered-data caution. | (b) rejected: guarantees stale previews after every qty/coupon/reprice change unless the user remembers — the exact D30-A violation the spec exists to prevent. | Auto triggers enumerated in §9; sending/guarded states in §10/§17; stale-badge rule in §8/§9/§14; never gates submission alone (§4.5) | OWNER-APPROVED (delegated, 2026-10-09) |
| FP11-D33 | Saved-address default + management scope | `isDefault` hint + 409 race, no default guaranteed (E12); PATCH/DELETE exist (account scope); wrong-address delivery is physically irreversible; mobile focus cost of inline management | (a) Explicit selection required + inline create-new + edit/delete via account area (b) Auto-pick first address | SELECTED (a). Explicit choice prevents silent wrong-address orders; create-new keeps conversion (no context loss); keeping edit/delete/default management in the account area avoids scope creep, keyboard/focus burden, and duplicated 409-race handling in checkout. Selection + form input preserved on recoverable errors (§7). | (b) rejected: invents a default the contract does not guarantee; first-row order is undefined and may be a stale/foreign-cached row. | Radio-select + create-new in §5/§7; reselect-after-404 path; no default assumed in §5/§7/§14/AC-CH-03 | OWNER-APPROVED (delegated, 2026-10-09) |
| FP11-D34 | Informational delivery-area text (no endpoint) | Zero coverage lookup/validation/error (E19 ABSENT); Matai + nearby business fact; hard-coded guarantees unverified | (a) Restrained static info line without validation promise (b) Zone selector / availability checker | SELECTED (a) with wording guardrail: `التوصيل داخل مطاي والمناطق القريبة` PLUS a no-check disclaimer (`يُعرض كمعلومة — لا يوجد تحقق لحظي من التغطية`). Honest expectation-setting; any future documented server rejection gets a mapped message without redesign. | (b) rejected: fabricates a lookup, error states, and geographic guarantees with zero contract support. | Static line in §7; no unsupported-area row invented in §14 (generic 400/500 path covers any future documented error); D34 guardrail binds §5–§7 copy | OWNER-APPROVED (delegated, 2026-10-09) |
| FP11-D35 | Guest credential save UX + storage posture | Once-only raw bearer secret, replay omits (E15/E2–E3); header-only 90d; loss = D39 gap. STORAGE EXPLICITLY AUTHORIZED: locked BGGO-D014 (`localStorage` key `guest-order-token:<orderId>`, explicit header attach, never URL; per-order-cookie/sessionStorage/in-memory rejected with rationale; XSS posture = existing discipline) + FP-04 §14 CLOSED delegated split (persistence authorized; recovery staff-only; hygiene rules). No storage library in deps; nothing new needed | (a) Copy + masked default + acknowledge-saved gate + BGGO-D014 persistent retention (b) Plain display, memory-only | SELECTED (a). Copy + `لن يظهر هذا الرمز مرة أخرى` + saved-acknowledge before leaving success minimizes loss at the only recoverable moment. Retention implements — not extends — the LOCKED posture (same key format, header-only, never URL). EXPLICIT LIMITS: acknowledgement is UX, not a boundary; persistence ≠ recoverability after wipe/theft/compromise (D39); no cross-device transfer (documented, not a bug). | (b) rejected: memory-only loses the credential on refresh/reopen — the failure mode BGGO-D014 explicitly rejected (sessionStorage/in-memory) — converting routine navigation into D39 cases. | One-time panel in §6/§13 (copy + masked + acknowledge + key format + clearing rule); storage rule in §16; replay `مسجل مسبقًا` hint; AC-CH-10/14/19 | OWNER-APPROVED (delegated, 2026-10-09) |
| FP11-D36 | Credential hardening policy + its limits | Bearer secret authorizing order reads (E15: 401/410/404 + 429; FP-04 §14: number/phone lookup grants nothing; wrong-order 401); field-name log-redaction design; URL/history/analytics/screenshot/error-report exposure classes; rotation/revocation are staff-operated ONLY (FP-04 §14 — not guest self-service); frontend cannot change TTL/invalidation/server storage | (a) Full 8-rule policy (§16.3): secret-not-id + never-in-URL/params/history/analytics/logs/errors/support + masked-default/explicit-action + ack≠boundary + compromise exposure stated + no recovery promise + staff-only rotation + live-only clearing + no invented guarantees (b) Minimal note | SELECTED (a). One-tap cost buys the entire frontend-available secrecy posture; masked-default defeats shoulder/screenshot capture; the saved-moment re-paste path avoids support-channel exposure. LIMITS RECORDED in §16.3: cannot undo expiry (410 terminal), theft-after-exposure, device loss, or server-side revocation; support verifies caller facts first and never promises old-token retrieval (FP-04 §14). | (b) rejected: saves nothing measurable while leaving the highest-probability leak vectors (URL paste, log attach, screenshot) open. | Hardening rules in §6/§13/§16.3; 401/410/404/429 rows in §14; token-URL ban in §11/§15; AC-CH-14/19 | OWNER-APPROVED (delegated, 2026-10-09) |
| FP11-D37 | Payment presentation — CORRECTED (COD claim removed) | Zero payment fields/routes in store API + `orderCreateSchema` (E18). FP-04 §20 payments row: endpoint "none", status OUT OF SCOPE — "COD display only" there is a display convention inside an out-of-scope row, NOT a business policy and NOT a capability. FP-00-D017: UX abstraction {COD, Online} with provider OPEN; Q002 ("COD-only fallback?") explicitly OPEN; G006 backend gap. No explicit approved business decision confirms COD — verified by reading FP-04 §20–§21 + FP-00-D017/Q002, not assumed | (a) CORRECTED: no payment step, no method line of any kind (neutral omit) + record method choice as unresolved owner business question (b) Prior informational-COD-line wording (WITHDRAWN: treated absence-of-integration as proof of COD — unsound) (c) Payment selector/status/fees (rejected: invented) | SELECTED (a). Checkout renders address → review → confirm with NO payment element; the absence of a gateway proves no online flow exists — it does NOT prove COD is offered. The method question (COD-only? which methods?) is marked NEEDS OWNER DECISION (business, refs Q002), blocking no other checkout work. | (b) withdrawn per safety review: "fulfillment fact" language overstated FP-04; (c) rejected in full as before. | No payment rows anywhere (§2/§8/§15 mapping excludes); neutral copy in §1/§2/§8; §18 AC-CH-06/17/19; FP-00-D017/Q002 OPEN preserved; FP-11.6+ untouched | OWNER-APPROVED (delegated, 2026-10-09) — corrected under FP-11.5 safety review |
| FP11-D38 | CTA total + navigation guard + preview/confirmed styling | No contracted CTA-total rule; stale-total-in-CTA = D30-A violation; ambiguous-loss needs distinct verifying state (§11); FP-11.1–11.4 financial-honesty + brand tokens; guards must not trap recovery | (a) Total-in-CTA ONLY when fresh-preview timestamped + dismissible sending/ambiguous nav-guard + dashed-preview vs solid-confirmed split (b) Bare button always, no guard | SELECTED (a) with non-trapping constraint: `{total}` appears in `تأكيد الطلب · {total}` ONLY with a live preview timestamp (else bare label); `beforeunload`-style guard fires ONLY while sending/ambiguous-verifying, is dismissible, and never blocks back-to-cart after settle or recovery navigation. Preview/confirmed visual split reuses FP-11.4 honesty language. | (b) rejected: discards commitment context the preview already earned and leaves accidental-navigation data-loss unguarded during the single most dangerous window (in-flight commit). | CTA rule in §10; guard in §10/§11/§17; style split in §8/§13/§17 (dashed vs solid); AC-CH-11/12/16 | OWNER-APPROVED (delegated, 2026-10-09) |
| FP11-D39 | Guest lost-response unresolvability — RESOLVED under existing staff-assisted design (no backend change) | Keys REQUIRED (E1/E20); same-key replay returns the ORDER but `guestToken:null` on replay (E2: route 126-133 + writes 512-514/519/526-527); credential hash-only, no retrieval endpoint (guest-access issuance-only + validate-by-presentation, E15); NO guest list/key-lookup (E16); authenticated key-echo cannot serve guests; order number authorizes nothing (E15–E16, [id] route). RE-VERIFIED this task: staff rotate (`orders.update` + audit, atomic, one-time fresh token) + revoke (audit, 404-indistinguishable) + isolated buckets (10/60) + 401/410 semantics + t-guest-orders 66/66 green; openapi documents header + issuance + rotate/revoke (1165/1174) | SELECTED (a) as the standing safe UX (unchanged) — PLUS: no new backend capability needed; the approved staff-assisted recovery path exists and is tested. The former "conceptual future capability" is WITHDRAWN as unnecessary. | Honest gap closed by evidence: recovery = staff rotate/revoke + safe UX (§11/§14 rows); nothing invented | §11 machine + UNRESOLVABLE branch (now staff-resolvable); §14 timeout row; §6/§13/§16 credential rules; AC-CH-12/13; §20 verdict language | RESOLVED — EXISTING DESIGN VERIFIED (this task; no code change) |

D37/D39 note: D37 is CORRECTED per safety review — the prior COD line is withdrawn (absence of
integration ≠ proof of COD); checkout is payment-neutral and the method choice is an unresolved owner
business question (refs FP-00-Q002). D39 is NOT approval-seeking polish — it records a missing backend
capability; its disposition below is documentation-only and authorizes no implementation.

### D39 disposition — evidence, gap, safe policy, future (documentation-only, unauthorized)

**Verified contract facts.** (1) Idempotency keys are REQUIRED (at-least-one, E1/E20) and client-held,
so a guest that retains key K CAN same-key resubmit safely. (2) Same-key replay returns the original
order id (`{orderId, replay:true}`) but `guestToken:null` — keep-same: replays carry NO credential
(E2: `orders/route.ts:126-133`, `writes.ts:512-514,519,526-527`). (3) Credentials persist hash-only
with validate-by-presentation; no retrieval/re-issue-to-unauthenticated-holder endpoint exists
(`guest-access.ts` issuance-only + `validateGuestOrderToken`/`requireGuestOrder`, E15). (4) No guest
order-list and no key→order lookup exist (E16); the authenticated `idempotencyKey` echo cannot serve
guests. (5) Order number is display-only; every read still demands session/credential (E15–E16,
`orders/[id]/route.ts`).

**The unresolved gap (precise).** Replay solves the DUPLICATE problem but not the CREDENTIAL problem:
a guest whose FIRST 201 is lost holds K (resubmittable → learns the order id via replay) yet CANNOT
learn the credential (never re-issued on replay, unrecoverable without presentation). If the client
also lost K (fresh profile, cleared storage, crash before persist), even the order id is unreachable.
Either sub-case leaves order access unrecoverable under the current contract.

**Resolved disposition (this task — no code change).** The approved staff-assisted recovery path
EXISTS and is tested: admin rotate (`orders.update` + same-tx audit, atomic revoke+reissue, fresh
token once) + revoke (audit, 404-indistinguishable) + isolated rate buckets + 401/410 semantics +
openapi coverage + t-guest-orders 66/66 green. (a) Standing safe UX unchanged (AMBIGUOUS-verifying,
same-key discipline, no fresh-key encouragement, support path never solicits the credential over
insecure channels). (b) The former "conceptual future capability" is WITHDRAWN as unnecessary — no
new backend work required. The specification IS guest-recovery-complete via the staff path, and §20
says so.

## Section 20 — Final Verdict and Handoff

```text
SPECIFICATION COMPLETE — OWNER DECISIONS D31–D38 RECORDED (delegated, 2026-10-09); D39 RESOLVED (existing design verified, this task)
```

**Why this verdict.** All eleven quality-gate questions are answered from evidence: guest-without-account
works (§6/E1); address matrix verified (§7/E12–E13); estimate = dry-run preview, creation = sole
authority (§9–§10/E10/E2); 201/replay proves creation (§10–§11/E2–E3); drift-409 keeps cart ACTIVE for
new-key review (§12/E5); lost-response handling is same-key resolve, and the guest credential
sub-case is covered by the verified staff-assisted recovery path (rotate/revoke + audit + buckets;
D39 RESOLVED under the existing design this task — no code change, safe UX retained). D31–D38
are OWNER-APPROVED under the delegation for this review task (D37 as safety-corrected above); the D39
future capability is recommended, not authorized. The payment-method business question (D37,
refs FP-00-Q002) is unresolved but blocks no checkout UI work, since the UI promises no method.
No contract evidence is missing for anything else the checkout UI must render.

**Next permitted step (do NOT start it).** With D31–D39 recorded, implementation remains separately
authorized work. Open FP-11.6 under its own authorization. Backend/DB/dependency changes,
commits/pushes, FP-11.1–11.4 edits, and FP-11.6/11.7 work remain forbidden until separately authorized.

---

*End of FP-11.5 specification — specification-only, no implementation.*
