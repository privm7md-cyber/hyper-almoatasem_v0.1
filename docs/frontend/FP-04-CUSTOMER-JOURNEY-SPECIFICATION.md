# FP-04 — Customer Journey Specification (Pre-Implementation Review)

> Status labels: `OWNER-APPROVED / LOCKED` · `BACKEND-VERIFIED` · `RECOMMENDATION — PENDING OWNER REVIEW`
> · `BLOCKED BY BACKEND CAPABILITY` · `NOT VERIFIED` · `OUT OF CURRENT SCOPE`.
> No React pages, components, CSS, backend, migration, dependency, commit, or deploy in this phase.
> Locked decisions respected: FP-03 bottom nav, single-page Checkout, no-governorate, brand/VI-01.

## 1. Executive Summary

This document specifies the end-to-end customer journey for Hyper Al-Moatasem — from first store
entry to order delivery — for three personas (new guest, returning guest, registered customer),
grounded exclusively in verified backend contracts (`docs/openapi.yaml` + `src/`). The journey is
fully specifiable except two honest limitations: (a) the locked Offers tab has no dedicated offers
feed endpoint (Backend Dependency — safe empty behavior specified, no fake offers); (b) profile-name
editing has no storefront endpoint (BLOCKED). Checkout is one page with sequential sections per the
locked decision. Guest checkout requires no account; registered checkout reuses saved addresses.

## 2. Scope and Non-Goals

In scope: 9 journey stages, 3 personas, entry/homepage, discovery, PIECE/WEIGHT selection, cart,
contact/address, single-page checkout, creation/idempotency, confirmation, guest security, tracking,
fulfillment/replacements, 30-scenario failure matrix, navigation/state rules, dependency matrix,
decision register. Non-goals: UI implementation, design tokens, backend changes, payments gateway,
delivery-platform integration, realtime tracking, ticketing/support system, wishlist/reviews/loyalty.

## 3. Authority and Locked Decisions

| ID | Decision | Status |
|---|---|---|
| FP03-NAV | Bottom nav: Home, Categories, Cart, Orders, Account + prominent header search (FP-00-D007 retained; Search/Offers-tab variant retired by owner-delegated FP-03 closure — see FP-03 FP03-C1) | OWNER-APPROVED / LOCKED |
| FP04-CHECKOUT | One checkout page, sequential sections (not 4 routes) | OWNER-APPROVED / LOCKED |
| FP04-GUEST | Purchase never requires account creation | OWNER-APPROVED / LOCKED |
| FP04-ADDRESS | No governorate field, ever | OWNER-APPROVED / LOCKED (rejected) |
| FP04-PRICE | Backend is final price authority | OWNER-APPROVED / LOCKED |
| FP04-STOCK | Backend is availability/quantity authority | OWNER-APPROVED / LOCKED |
| FP04-IDEMPOTENCY | Duplicate order creation prevented per current contract | OWNER-APPROVED / LOCKED |
| FP04-GUEST-ACCESS | Guest order details protected (no token-in-URL, no order-number auth) | OWNER-APPROVED / LOCKED |
| FP04-REPLACEMENTS | Actual replacement rules respected | OWNER-APPROVED / LOCKED |
| FP04-OFFERS | Offers entry kept in desktop header/contextual surfaces per FP-00-D007; data capability recorded honestly | OWNER-APPROVED (slot) / BACKEND-DEPENDENT (feed) |

Cross-phase note (reconciled by owner-delegated FP-03 closure): FP-09 bottom nav Home/Categories/Cart/Orders/Account
matches FP-00-D007 and is the final model (FP-03 FP03-C1 CLOSED). The Search/Offers-tab variant previously stated here
is retired; search is a prominent header function, Offers lives in the desktop header/contextual surfaces.

## 4. Personas and Access Models

### Persona A — New Guest (BACKEND-VERIFIED capability)

Browse/search/products/cart without account. At checkout enters phone + inline address
(`guestAddress` city/area/village/street/building/landmark/phone + `guestContact` firstName,
optional lastName — `src/lib/orders/validation.ts`, `route.ts:99-117`). Creates order; the one-time
`guestOrderToken` in the 201 body is captured server-side by the planned adapter per FP-03 FP03-G1
(never exposed to client JS/URL/storage) — tracks via credential-gated order read. Never sees another
customer's data; order number alone grants nothing.

### Persona B — Returning Guest

- Same browser with cart token: cart recoverable while cart row alive (else fresh cart minted).
- Different device/browser: cart NOT recoverable (bearer is device-local) — documented, no cross-device claim.
- Prior order: accessible only via the adapter-held credential (HttpOnly order cookie → header
  `x-guest-order-token`, FP-03 FP03-G1 §7b; raw token never in client JS/URL/storage,
  `src/lib/orders/guest-access.ts:27`). No token-recovery mechanism exists: lost token ⇒
  support/admin rotation path only (staff-authenticated, audited); phone/order-number alone never suffice.
- Token expiry: fixed 90-day TTL, no sliding (`GUEST_ORDER_CREDENTIAL_TTL_DAYS = 90`); expired ⇒ 410 Gone.
- Revoked, malformed, or wrong-order token ⇒ 401 (lookup is scoped by token_hash + order_id,
  `guest-access.ts:100-119`, so every bad-token case is indistinguishable — this is the
  non-leaking behavior). Unknown order id probed with a valid customer session ⇒ 404.
  (Correction 2026-10-09: earlier text said wrong-order token ⇒ 404; code proves 401.)

### Persona C — Authenticated Customer (BACKEND-VERIFIED capability)

Phone+password login (generic failures, lockout), 30-day fixed sessions
(`CUSTOMER_SESSION_TTL_SECONDS`), logout revokes server-side. Saved addresses (owned addressId,
server-checked), own order list (newest-first keyset), owned order detail/cancel, replacement
decide, password change. Profile-name editing: BLOCKED BY BACKEND CAPABILITY (no storefront PATCH;
only identify/session/register/password/addresses routes exist). Registered users may still check
out as guest where the contract allows (guest path needs no session).

### Persona × Stage Matrix

| Stage | New Guest | Returning Guest | Registered |
|---|---|---|---|
| Browse/Search/Product | Full, anonymous | Full | Full |
| Cart | Guest-token cart | Same-device recoverable | Session cart; explicit merge only via `POST cart/merge` (never automatic on login) |
| Contact/Address | Inline payload | Inline payload | Saved addressId (ownership enforced) or inline |
| Review/Submit | Idempotency key required | Same | Same |
| Confirmation/Tracking | Token-gated | Token-gated (stored token) | Session-owned list + detail |
| Cancel/Replacements | Token-gated, policy-bound | Same | Session-owned, policy-bound |
| Account mgmt | — (no account) | — | Addresses/password; profile edit BLOCKED |
| Reorder from history | No endpoint (re-add live items via PDP/cart) | Same | Same (no reorder endpoint; BACKEND-GAP, no owner decision needed) |
| Login after guest order | N/A | Never links prior guest orders (never-link) | Guest orders never attach on login |
| Logout effect | N/A | Order cookies survive logout (order-scoped per FP03-G1) | Session revoked; guest-order cookies unaffected |

## 5. End-to-End Customer Journey Map

### J1 — Entry (goal: land correctly in ≤5s)

Entry: `/`, deep product link, shared search/category URL. Public, anonymous. Invalid route → 404;
unknown/inactive product → not-found (product stays visible with «غير متوفر» only when the backend
reports a state — never invented). Session expiry is irrelevant (nothing to expire yet).

### J2 — Discovery (goal: find the product server-side, never bulk-load)

Catalog listing (filters: search/category-subtree/brand/type/price-window/inStock; sorts per contract),
`GET catalog/search` (`q` 2..120 chars, sorts `relevance`/`newest`, keyset pages), brands where supported.
State (query/filters/sort/cursor) belongs in URL for share/restore. OOS products stay listed.
NO popularity/bestseller ordering (no source). NO price sort (unsupported — do not document as available).

### J3 — Selection (goal: correct variant + quantity before cart)

PIECE: name, image (`products/[id]/images`), variant, size/unit, current price, availability
(`inventory/products|variants/[id]`), whole-pack quantities, add. WEIGHT: preset gram options valid
only where the product's `saleStepGrams` allows (e.g. 125/250/500g, 1/1.25kg where supported —
`cart` step-multiple rules); show per-kg price, chosen weight, estimated total; never decimals like
0.137kg; estimate is NOT final. Unavailable variant: «غير متوفر», add disabled, no silent hiding,
no substitute claimed without a trusted source, no back-in-stock alerts (unsupported).

### J4 — Cart (goal: truthful draft, backend-owned)

Per line: product/variant, image, size/weight, quantity, server price, line value, proven discount
only. Summary: merchandise subtotal, proven discounts, coupon result if applied, delivery fee only
when known from server (`delivery.default_fee`, seed 20.00 — display from backend, never hardcode),
backend total. Invalid coupon ⇒ server reason shown. Price/stock drift ⇒ revalidate via reprice,
surface change, never transact on stale snapshot. Double-submit guarded (idempotency).

### J5 — Contact & Address (goal: valid, ownable destination)

Guest: phone + inline address (city required; area/village/street/building/landmark optional;
NO governorate — rejected). Registered: saved addressId (server ownership check) or inline.
Early field validation + inline errors; inputs preserved across correctable failures; server
validation authoritative. Out-of-coverage address ⇒ clear message, no fake delivery promises
(no zones/times/slots in contract).

### J6 — Review & Submit, single page (goal: one explicit atomic commit)

One page, sequential sections (§11). Pre-submit server revalidation (reprice/estimate). Submit:
single attempt guarded against multi-click; idempotency key (header wins on conflict; missing key
rejected; reuse-with-change ⇒ 409). Ambiguous outcome (timeout, no confirmed result) ⇒ no blind
retry with a new key; recover state by safe re-query (same key replay returns original + `replay`
flag, no duplicate order, no second token). No success screen before confirmed creation response. Guest order
access is preserved by the server adapter (FP-03 FP03-G1) — no raw token is ever shown to or stored by client code.

### J7 — Confirmation (goal: proof + next steps)

On confirmed creation only: success message, server-issued order id/number (never reconstructed
client-side), frozen summary, confirmed total, delivery snapshot allowed for display, tracking path,
continue-shopping link. Guest sees a same-browser access note (order stays reachable on this browser via the
server adapter; no raw token is displayed — FP-03 FP03-G1).

### J8 — Preparation & Replacements (goal: honest mid-life updates)

Statuses shown per §15 mapping. Replacement proposal (when raised by staff flow): original vs
substitute, quantity/unit, price difference from response, proposal status, approve/reject only when
contract allows (decided ⇒ 409 on repeat; concurrent decide deterministic). After action: wait for
backend result, render confirmed state, forbid duplicate/conflicting decisions. Short-shipped lines
(final 0 at READY per frozen rule) are shown as short — never as cancelled-by-customer. No
edit/re-prep flow invented.

### J9 — Delivery & Finality (goal: correct terminal truth)

Delivered ⇒ show final totals (actual weights/prices). Cancelled ⇒ terminal, no further actions.
No live map/ETA display (no data source). Journey ends; history remains readable by owner.

## 6. Homepage and Entry Behavior

Brand-consistent entry; search/categories/offers-capped/cart reachable; account/orders via header
menu. Guest shopping without signup. Deep product link resolves when resource live; else not-found.
Sectional failure isolation (one failing section never collapses the page). Missing/invalid images
fall back neutrally. No invented editorial sections, hero offers, or delivery claims without sources.

## 7. Catalog Discovery and Search

Server-side search/pagination/filtering only (20,000+ catalog). Params: `q` (2..120), category
(subtree), brand, type, price window, inStock, sort (`relevance`/`newest` for search; listing sorts
per contract — no price/popularity sort documented as available), opaque cursor pages. Empty results
⇒ helpful message + adjust/clear-filters path (distinct from connection failure). Context (query,
filters, sort, cursor) preserved across product-detail back-navigation where contract-compatible.
Nothing sensitive in URL.

### Offers entry behavior — CLOSED — OWNER-DELEGATED DECISION (BACKEND-CONSTRAINED feed)

The Offers entry is kept in the desktop header/contextual surfaces per FP-00-D007 (no bottom-tab slot per final
FP03-C1). Because no storefront
offers-feed endpoint exists (verified route absence; promotions/coupons apply only inside
`estimate`/checkout), the tab MUST distinguish three states explicitly: (a) loading skeletons
while probing availability; (b) honest empty — «لا توجد عروض متاحة حالياً» + path back to
browsing (this is the expected steady state until a feed exists; it is NOT an error and MUST NOT
show invented percentages, savings, stock, or eligibility); (c) load failure — retry affordance,
visually distinct from (b). Forbidden: unbounded catalog scans or full-catalog downloads to
manufacture an offers page; deriving "discounted" from a lone `compareAtPrice` without the
variant's live promotion context; any discount badge whose numbers did not come from the backend
for that product. If a bounded offers source is added later, this section is superseded by a new
decision — the tab slot itself does not change.

## 8. Product and Variant Selection

Covered in J3 with contract citations: `products/[id]` (+variants, +images), `variants/[id]`,
`inventory/*`, `codes/lookup`. Compare-at shown only when backend returns it (never computed).
No variant may be added when unsellable/inactive.

## 9. Cart Specification

Lines carry server price/line value/proven discount; quantity edits obey PIECE/WEIGHT rules;
remove supported. Summary per J4. Mandatory states: loading (no stale-as-final), empty (+shop path),
price-changed, stock-changed, unavailable (block when backend blocks), promotion-expired, invalid
coupon (server reason), network failure (safe retry, preserve data), concurrent update (re-sync to
server truth), duplicate action (idempotent, no double effect). Rules: backend owns price/stock/total;
no success before server confirmation; local storage is convenience, never truth; merge follows the
contract (`POST cart/merge`), no invented conflict policy; price/stock errors never destroy
preservable data.

## 10. Customer Contact and Address

Per J5 + persona rules. Guest minimum = contract fields only. Coverage: single branch, Matai-area
service — never show unsupported zones as deliverable; never invent city/area lists; eligibility from
actual sources; uncovered address ⇒ explicit message. Registered: saved addresses listed when
supported, ownership server-checked; profile editing BLOCKED (documented, not hidden).

## 11. Single-Page Checkout Specification

One page, sequential sections (LOCKED — not 4 routes): (1) Contact — phone + contract-minimum data,
guest vs registered rules, preserved inputs; no mandatory name/email unless contract requires.
(2) Address — saved-address select (registered, where supported) or guest inline entry; validation,
coverage, fee/total effects only where backend-computed. (3) Review — lines/variants/quantities/weights,
line prices, discounts, coupon if supported, delivery fee if known, server total, phone/address,
change/unavailable alerts; never final before revalidation; no payment gateway UI (unsupported).
(4) Confirm — guarded submit, idempotency per §12, 409 semantics, no random re-POST on ambiguous
timeout, preserved inputs, resync on drift, no success before server confirmation, post-reload
recovery only where supported. Page behavior: section order, mobile reachability, optional progress
indicator, visible price summary, primary CTA placement that never covers fields/errors/summary/
keyboard, sticky-CTA recommendation only (pending owner review as design detail, not behavior).

### 11A. Sticky action + progress contract — CLOSED — OWNER-DELEGATED DECISION

Progress indicator mirrors the four locked sections (Contact → Address → Review → Confirm).
Section states: complete (valid), current, invalid (blocking, with reason), locked (unreachable until
predecessors valid). The indicator is informational and permits back-navigation to completed
sections only — never forward-skipping an invalid section (skipping would bypass required input).
Sticky confirmation bar (mobile): shows live server total + confirm CTA; visible whenever the
checkout page is open. CTA is disabled while: cart empty, any section invalid, server revalidation
pending, or a submission is in flight; the disabled reason is announced next to the CTA.
Desktop: persistent summary sidebar + CTA; mobile sticky patterns are not forced onto desktop.
Safe-area/keyboard: the bar must never cover the focused field, inline errors, the summary, or
system UI — when the keyboard is open the bar docks without overlapping input (behavioral rule;
no CSS values fixed here). CTA lifecycle: idle → submitting (spinner + `aria-busy`, disabled) →
success (navigate to confirmation only after confirmed 201) / field error (re-enable, anchor to
the offending section) / transport failure (re-enable, ambiguous-outcome path per §12). The CTA
label/state must never imply confirmation before the backend confirms it.

## 12. Order Creation and Idempotency

Pressing confirm ≠ order exists. Sending ≠ created. Only the confirmed creation response creates
truth. Key required (header wins ties; mismatch ⇒ 400; missing ⇒ rejected). Same key + same cart ⇒
original replayed (`replay:true`, no duplicate, no second guest token). Same key + different terms ⇒
409. Ambiguous/network-failure outcome ⇒ recover with the SAME key, never mint-and-retry blindly.

## 13. Order Confirmation

Per J7. Server data only.

## 14. Guest Order Security

Order number alone authorizes nothing. Access = `x-guest-order-token` bound to one order
(hash-only at rest, 90-day fixed TTL, revoke/rotate server-side). Never in URL/logs/errors.
No new storage/transport mechanism invented. Phone/order-number lookup grants nothing. Lost token ⇒
no self-service recovery (support/admin rotation path only). Ambiguous-timeout ⇒ no duplicate order
(same-key recovery).

### Credential persistence vs recovery vs authorization — CLOSED — OWNER-DELEGATED DECISION (amended by FP-03 FP03-G1; history preserved, BGGO-D014 localStorage superseded for order credential only)

1. **Persistence:** server-side adapter holding per-order HttpOnly cookies (`__Host-guest-order-<uuid>`,
    FP-03 FP03-G1 §7b), attaching `x-guest-order-token` per request, never URL/client-JS/storage.
    Survives refresh, new tab, and browser restart on the same device. Does NOT transfer
    across devices or browsers — a different device has no access (documented, not a bug).
2. **Recovery:** no self-service recovery exists. Staff-operated rotation (authenticated,
    audited admin action issuing a fresh token) is the only path; support UI must verify caller
    facts first and MUST NOT promise retrieval of the old token or access from phone/order
    number alone.
3. **Authorization:** every order read presents the token; missing/invalid/revoked ⇒ 401,
    expired ⇒ 410, wrong-order ⇒ 401. Token hygiene: never in URLs (no referrer/query leaks),
    analytics, logs, or error bodies; order cookies survive logout (order-scoped per FP03-G1) and lapse
    only on expiry/revocation — never cleared silently while the order is live.

## 15. Order Tracking and Status Mapping

| Backend (verified: `state-machine.ts`) | Arabic label |
|---|---|
| NEW | تم استلام طلبك |
| CONFIRMED | تم تأكيد الطلب |
| PREPARING | جاري تجهيز طلبك |
| READY_FOR_DELIVERY | الطلب جاهز |
| OUT_FOR_DELIVERY | الطلب خرج للتوصيل |
| DELIVERED | تم تسليم الطلب |
| CANCELLED | تم إلغاء الطلب |

Polling/refresh per available capabilities (no realtime). Unknown status or partial payload ⇒ neutral
message + retry, never invented mapping. Errors/unauthorized per matrix. No OUT_FOR_DELIVERY display
or ETA beyond what the backend truthfully reports. Owner-only visibility (session scope or guest
token); no hiding-a-link as protection; no id-based authorization bypass.

### Refresh contract — CLOSED — OWNER-DELEGATED DECISION (frontend policy, not a backend guarantee)

- Initial fetch on page open; refetch on return/visibility-regain and immediately after own
  actions (cancel, decide) resolve.
- Periodic refresh ONLY while: page visible AND order non-terminal AND (a live PROPOSED
  replacement exists OR within 10 minutes of the user's last order action). Otherwise manual
  refresh button only.
- Interval 60s with single-flight requests (abort/stale-guard: overlapping responses cannot
  overwrite newer state — compare response sequence/`updatedAt`, keep newest).
- Backoff on 429/5xx (double up to 5 min, then manual-only); stop entirely on terminal states
  (DELIVERED/CANCELLED) and on 401/410/404.
- Budget rationale: guest reads share 60/15min per bucket (`rate-limit.ts`) with all same-IP
  traffic — 60s keeps one tab far under budget; aggressive polling is forbidden.
- UI shows "last updated" time; after a failed refresh the data is badged stale, never silently
  replaced. Replacement decisions/status changes elsewhere become visible at the next allowed
  refresh or manual retry.

## 16. Fulfillment and Replacement Journey

Per J8 + decide contract (approve/reject, 409 on decided, deterministic concurrency). Price-difference
and status from actual responses. Short-fulfillment rule documented, not assumed to cancel orders.

## 17. Error and Recovery Matrix

| # | Scenario | Cause → preserve → message → action | Retry safe? | Re-verify? | Blocks? | Duplicate risk? | Source |
|---|---|---|---|---|---|---|---|
| 1 | Homepage load fails | transport → nothing → retry screen | yes | — | yes | no | UI |
| 2 | Independent section fails | partial → rest renders → inline retry | yes | — | no | no | UI |
| 3 | Bad deep product link | malformed id → — → not-found | no | no | yes | no | validation |
| 4 | Product missing | deleted/never → — → not-found | no | no | yes | no | 404 contract |
| 5 | Variant unavailable | stock/state → cart preserved → «غير متوفر», add disabled | no-op | yes | if blocking | no | inventory |
| 6 | Search fails | transport → query kept → retry (≠ empty) | yes | — | yes | no | UI |
| 7 | Empty results | no match → query kept → adjust/clear filters | n/a | no | no | no | search |
| 8 | Next page fails | transport → page kept → inline retry | yes | — | no | no | UI/cursor |
| 9 | Price changed | drift → cart kept → show new value | n/a | yes | no | no | reprice |
| 10 | Stock changed | shortage → cart kept → adjust per server | n/a | yes | maybe | no | inventory |
| 11 | Offer expired | window end → summary updated + notice | n/a | yes | no | no | promotions |
| 12 | Coupon invalid | rule fail → code kept → server reason | fix code | yes | no | no | coupon validation |
| 13 | Cart conflict | concurrent write → re-sync to server | yes | yes | no | no (idempotent ops) | cart tx |
| 14 | Address invalid | format → inputs kept → field error | fix | no | yes | no | validation |
| 15 | Out of coverage | no zone → inputs kept → explicit message | change addr | no | yes | no | coverage rules |
| 16 | Fee unknown | no source → omit fee, never invent | retry | yes | warn | no | settings |
| 17 | Session expired | TTL/revoke → preserve non-sensitive → login, resume | login | yes | yes | no | session |
| 18 | Create rejected | validation → preserved → mapped error | fix | yes | yes | no | create |
| 19 | 409 / idempotency | reuse-with-change → same-key recover, never new-key retry | same-key only | yes | yes | guarded | idempotency |
| 20 | Disconnect mid-submit | unknown outcome → SAME-key recovery | same-key | yes | yes | guarded | idempotency |
| 21 | Double click | guarded submit + key → single effect | no-op | — | no | guarded | UI + key |
| 22 | Created but confirmation lost | created, UI unknown → re-query same identity | safe read | yes | no | no | orders read |
| 23a | Foreign order, registered session | valid session, not owner → — → 404 (existence never leaked) | no | no | yes | no | `GET [id]` ownership scope |
| 23b | Bad guest credential (missing/malformed/wrong-order/revoked) | — → 401 for every case (scoped lookup cannot distinguish) | no | no | yes | no | `requireGuestOrder` + `validateGuestOrderToken` |
| 23c | Expired guest credential | TTL elapsed → — → 410 + support path | no | no | yes | no | `GUEST_ORDER_CREDENTIAL_TTL_DAYS` |
| 24 | Guest token lost | no recovery → support path only | no | — | yes | no | credential design |
| 25 | Replacement decided | approve/reject → confirmed state; repeat ⇒ 409 | no | yes | no | guarded | decide |
| 26 | Status raced | concurrent transition → re-read truth | yes | yes | no | no | state machine |
| 27 | Terminal order acted on | DELIVERED/CANCELLED → action disabled + message | no | no | yes | no | state machine |
| 28 | Image missing | no/invalid asset → neutral fallback | no | no | no | no | media |
| 29 | Summary refresh fails | transport → last confirmed kept, marked stale | yes | yes | warn | no | UI |
| 30 | Unknown backend state | unmapped → neutral + retry, never invented | yes | yes | warn | no | UI discipline |
| 31 | Server error (500 envelope) | generic failure → neutral message + stale badge where data exists → retry | yes (reads; mutations re-read-first) | yes | warn | reads no; mutations guarded | error envelope |
| 32 | Cookies disabled | persistence unavailable → access-required/unavailable state, no details | no (fix setting) | no | yes for guest tracking | no | FP03-G1 §D |

403 has no customer-journey surface (permission denial is admin-scope; foreign/unknown reads answer 404 by contract) —
marked N/A for these journeys, not UNVERIFIED.

## 18. Navigation and State Preservation

Per final bottom nav (Home/Categories/Cart/Orders/Account + header search, FP-03 FP03-C1) and FP-09 IA:
entry, deep product links, search↔detail with context restore, category/brand/product moves, bottom-nav
cart, header account/orders, single-page checkout, confirmation, tracking, Back/Forward compatible
where supported, invalid links → 404, protected routes gated. URL holds discovery/pagination state
only — never tokens, sessions, full addresses, PII, or idempotency internals. Auth `next`/return URLs:
internal, validated, no open redirects (implement per FP-09 D07 convention at build time).

## 19. Accessibility, RTL and Content Rules

Backend truth supremacy; privacy (no cross-owner leaks; no secrets in logs/analytics; order number
is identifier, not secret and not auth); keyboard-operable primary path; field-bound errors; clear
loading/success/failure; no hover-only menus; keyboard-safe inputs/CTAs; sticky elements never cover
content/errors; RTL-first Arabic, natural customer language, technical state names kept in docs for
contract mapping; no invented marketing promises or delivery claims.

### Finalized customer copy — CLOSED — OWNER-DELEGATED DECISION

Principles (brand-locked): trustworthy, warm, organized, practical, calm; clear Egyptian Arabic;
no false urgency, no fabricated discounts, no unsupported payment/delivery/availability promises,
no replacement guarantees, no timing/coverage promises without data.

| State | Copy (AR) |
|---|---|
| Empty cart | «سلتك فاضية — ابدأ التسوق من الأقسام أو البحث.» |
| Empty search | «لا توجد نتائج مطابقة — جرّب كلمة مختلفة أو امسح بعض الفلاتر.» |
| Offers unavailable (no feed) | «لا توجد عروض متاحة حالياً — تصفح المنتجات لاختيار احتياجاتك.» |
| Offers load failed | «تعذّر تحميل العروض — حاول مرة أخرى.» |
| Product unavailable | «غير متوفر» (add disabled; product stays visible) |
| Price/quantity changed | «اتغيّر السعر/الكمية — راجع القيمة المحدّثة قبل المتابعة.» |
| Address out of coverage | «العنوان خارج نطاق التوصيل الحالي — جرّب عنوانًا آخر.» |
| Order submitted | «تم استلام طلبك — رقم الطلب: {number}.» |
| Unknown submit outcome | «تعذّر تأكيد النتيجة — لا تعِد الإرسال؛ حدّث الصفحة للتحقق من حالة الطلب.» |
| Guest credential missing/invalid | «تعذّر الوصول إلى الطلب — سجّل الدخول أو تواصل مع الدعم.» |
| Status refresh failed | «تعذّر تحديث الحالة — البيانات المعروضة بتاريخ {time}. حاول مرة أخرى.» |
| Replacement awaiting decision | «يوجد بديل مقترح بانتظار قرارك — راجع الفرق قبل القبول أو الرفض.» |
| Replacement accepted/rejected | «تم تسجيل قرارك.» / «تم رفض البديل.» |
| Replacement no longer actionable | «انتهت صلاحية هذا المقترح — حدّث الصفحة لرؤية الحالة الحالية.» |
| Order cancelled | «تم إلغاء الطلب.» |
| Order delivered | «تم تسليم الطلب — الإجمالي النهائي: {total}.» |

Each string maps to a backend-verified state above; where a state needs data the contract does not
expose, the copy stays conditional and generic rather than inventing detail.

## 20. Backend Dependency Matrix

| Stage | User action | Endpoint/Contract | Data | Auth | Capability | Errors | UI impact | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| Discovery | browse/search/filter | `GET products`, `GET search`, `GET categories`, `GET brands` | q/filters/sort/cursor | Public | server search+pages | 400 bad query | lists, empty states | VERIFIED | openapi + validation |
| PDP | view/select | `products/[id]`, `variants/[id]`, `images`, `inventory/*`, `codes/lookup` | ids | Public | full detail + stock truth | 404 unknown/inactive | PDP, OOS, weight presets | VERIFIED | route files |
| Cart | add/edit/remove | `cart`, `items`, `items/[variantId]`, `merge`, `reprice` | variant+qty | guest-token XOR session | draft + merge + reprice | 404/409/422 | cart states | VERIFIED | route files |
| Pricing | preview/coupon | `POST estimate` (+couponCode) | lines+code | anonymous/session-aware | read-only totals | coupon reasons | summary, coupon UX | VERIFIED | estimate route |
| Address | save/use | addresses CRUD (registered); inline guest payload | fields §12 | session / inline | owned check; guest inline | 400/404 | checkout §2 | VERIFIED | validation + writes |
| Create | submit | `POST orders` (+Idempotency-Key) | address/coupon/key | session XOR guest | atomic create+replay | 400/401/404/409/422/429 | confirm flow | VERIFIED | route + writes |
| Track/cancel | view/cancel | `GET orders`, `GET [id]`, `POST cancel` | — | owner-only | unpicked cancel | 404/409 | history, cancel UI | VERIFIED | routes + state machine |
| Replace | approve/reject | `GET replacements`, `POST decide` | action | owner-only | R10 decide, 409 repeat | 404/409 | proposal UI | VERIFIED | decide route |
| Identity | login/register/logout | `identify/session/register/password` | phone+password | public/session | 30d sessions, lockout | generic 401 | auth UX | VERIFIED | session/auth files |
| Guest access | track owned | `x-guest-order-token` + order reads | token+id | per-order credential | 90d TTL, 410/401/404, rotate/revoke | 401/404/410/429 | tracking, recovery limits | VERIFIED | guest-access.ts |
| Profile edit | — | none | — | — | — | — | hidden, not promised | BLOCKED | route absence |
| Offers feed | — | none | — | — | — | — | tab kept, honest empty | BLOCKED (dependency) | route absence |
| Payments/refunds | — | none | — | — | COD display only | — | no gateway UI | OUT OF SCOPE | contract docs |
| Delivery platform | — | fee read-only | — | — | fee display, no zones/times | — | no promises | PARTIAL | settings + writes |

## 21. Decision Register

LOCKED (respected, not reopened): FP03-NAV, FP04-CHECKOUT (single page), FP04-GUEST, FP04-ADDRESS
(no-governorate), FP04-PRICE/STOCK (backend truth), FP04-IDEMPOTENCY, FP04-GUEST-ACCESS,
FP04-REPLACEMENTS, FP04-OFFERS slot (feed = Backend Dependency, §9).
CLOSED — OWNER-DELEGATED DECISION (this audit, rationale + evidence inline): sticky CTA +
progress contract (§11A); offers empty/unavailable/failure behavior (§9-offers);
credential persistence/recovery/authorization split (§14, persistence amended by FP-03 FP03-G1 — HttpOnly
adapter supersedes BGGO-D014 localStorage for order credential only, history preserved); refresh contract (§15);
finalized customer copy (§19). No delegated decision alters a locked contract or invents a
backend capability. Blocked (technical, not approval): profile edit, offers feed, payments/refunds,
delivery zones/times, realtime, back-in-stock alerts, reorder-from-history (no endpoint; re-add via PDP/cart). NOT VERIFIED at runtime (static review only):
none claimed — all behavior above is contract-derived; live UI/runtime verification belongs to
implementation testing.

## 22. Cross-Phase Consistency and Risks

FP-03 vs FP-09 nav conflict closed by owner-delegated decision (Option A final; FP-03 FP03-C1; FP-09 retained). No invented
endpoints/permissions/rules (verified absence where claimed). Promise scope kept to information
honesty (no service guarantees). Performance risk: N+1 enrichment on cards (batch/cache/skeletons
at build). Privacy risk: guest-token handling rules explicit (§14). No silent-price/stock/permission
assumptions anywhere (backend decides).

## 23. Owner-Review Questions — Resolution Log

All five items below were closed under explicit task delegation (not prior owner approval);
visual styling details remain open by design (no visuals in this phase).

1. Sticky confirm-CTA + progress behavior → CLOSED (§11A). Visual styling (exact placement
   pixels, animation) stays open for the design phase.
2. Empty-Offers copy + pre-data tab behavior → CLOSED (§9-offers + §19 table): honest empty
   state, tab kept, no disabled-hint invented; failure distinct from empty.
3. Support surface for token recovery → CLOSED (§14): no self-service recovery exists;
   support/admin rotation is the only path; support UI must verify facts and promise nothing
   beyond rotation. Whether a support contact surface (phone/page) is staffed is an
   operational decision OUT OF SCOPE here.
4. Tracking refresh cadence → CLOSED (§15 refresh contract: 60s conditional + backoff;
   frontend policy, not backend guarantee).
5. Promotional copy → CLOSED (§19 table): only backend-proven discounts; anything beyond
   remains forbidden until sourced (no change).

## 24. Acceptance Criteria

Single-page checkout §11 · personas + matrix §4/6 · full journey + exceptions §5/17 · PIECE/WEIGHT per
system data §8/10 · cart/price/stock/coupon scenarios §9/11 · phone/address without governorate §10/12 ·
idempotency + 409 per contract §12 · no forced accounts §4–6 · guest security without token leaks §14 ·
status/replacement mapped to backend §15–16 · offers/backend gaps honest §9/20 · no invented contracts ·
locked-vs-recommendation split kept · dependency matrix evidenced §20 · no UI/backend changes · prior
work preserved (verified §25-J).

### Testable criteria (Given/When/Then)

1. Deep product link: Given a live product id When opening `/p/[id]/[slug]` Then detail renders with
   server price/stock; Given unknown id Then not-found (no crash, no fake data).
2. Search context: Given filtered sorted results When opening a product and going Back Then
   query/filters/sort/page restore from URL.
3. Pagination: Given more results exist When requesting next cursor Then items append without
   duplicates; Given end Then no further request affordance; Given cursor failure Then inline retry.
4. PIECE: Given whole-pack qty When adding Then accepted; Given fractional pack Then field error, nothing sent.
5. WEIGHT: Given preset grams valid under `saleStepGrams` When adding Then accepted with estimate marked
   non-final; Given arbitrary decimals Then rejected before send.
6. Unavailable: Given OOS variant When viewing Then «غير متوفر» + disabled add; product stays visible.
7. Reprice conflict: Given drifted price/stock When revalidating Then new values surface; transaction
   uses server truth only.
8. Guest checkout: Given guest cart + valid inline address/phone When submitting with fresh key Then
    201 with credential captured server-side (never exposed to client JS per FP03-G1); no account created.
9. Saved address: Given registered session When checking out Then owned addresses listed; foreign
   addressId rejected server-side.
10. Validation: Given invalid field When submitting Then inline field error, inputs preserved, no request.
11. Duplicate submit: Given double-click/timeout-unknown When submitting Then single order effect
    (same-key recovery, no second token).
12. Unknown outcome: Given ambiguous response When recovering Then same-key re-query; never blind new-key retry.
13. Guest authz: Given wrong/missing/expired token When reading Then 401/401/410 respectively; never 200.
14. Replacement race: Given decided proposal When deciding again Then 409; concurrent decisions settle deterministically.
15. Terminal states: Given DELIVERED/CANCELLED When acting Then actions disabled with message.
16. Offers honesty: Given no feed When opening Offers Then honest empty (no numbers invented); failures show retry, not empty.
17. Bottom nav: order is Home/Categories/Cart/Orders/Account with prominent header search; guest tabs never leak data.
18. A11y/keyboard/RTL: labels bound, errors announced, full primary path keyboard-operable, RTL layout, sticky CTA never covers fields.
19. Section isolation: Given one homepage section fails When loading Then rest renders + inline retry.
20. Sticky CTA: disabled until valid + idle; spinner + aria-busy while submitting; re-enabled with anchored error on failure; never implies confirmation pre-201.

## 25. Final Phase Status

`FP-04 SPECIFICATION COMPLETE — READY FOR OWNER REVIEW` (specification phase only; no UI built).
