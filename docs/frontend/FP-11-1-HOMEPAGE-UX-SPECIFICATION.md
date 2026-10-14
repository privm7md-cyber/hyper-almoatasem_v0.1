# FP-11.1 — Storefront Homepage UX & Screen Specification

> Classification: `VERIFIED` (repo/openapi evidence below) · `LOCKED` (existing approved decision) ·
> `RECOMMENDATION` (proposed, needs owner review) · `NEEDS OWNER DECISION` · `BLOCKED`/`UNSUPPORTED`
> (capability absent) · `NOT VERIFIED`. Specification only — no implementation, no owner approval claimed.

## 1. Executive summary and verdict

**Verdict: `SPECIFICATION COMPLETE — READY FOR OWNER REVIEW`.** Homepage content hierarchy,
section behaviors, product-card contract, search/navigation/cart interactions, responsive/RTL rules,
all UI states, performance constraints, and endpoint mapping are fully specified from verified
contracts. Delegated decisions closed: category strategy (top-level/sortOrder/name, max 6),
verified-content-only policy rule, total-quantity indicator. Remaining inputs (hero content,
promotional data, policy texts) are content dependencies with specified honest behaviors — not
specification gaps. Nothing is fabricated; every data-driven section has a verified source or is
explicitly conditional.

## 2. Scope and non-goals

In scope: homepage hierarchy/layout/responsiveness, section behaviors, product-card contract,
search/navigation/cart-feedback contracts, 16 UI states, performance rules, endpoint mapping,
decision register, acceptance criteria. Non-goals: implementation, CSS/components, backend changes,
data seeding, CMS construction, FP-11.2+, deploy, commit.

## 3. Verified repository/API evidence

| # | Capability | Evidence | Status | Constraint |
|---|---|---|---|---|
| E1 | Homepage route exists (boilerplate) | `src/app/page.tsx` (default Next.js starter) | VERIFIED | Replace content at implementation; boilerplate proves nothing |
| E2 | Product list w/ filters + keyset pages | openapi `GET catalog/products` (search/category-subtree/brand/type/price-window/inStock; OOS listed) | VERIFIED | No total counts; cursor pages only |
| E3 | Search contract | openapi `GET catalog/search` (q 2–120 required; sort relevance/newest; opaque cursor; 400 on short/bad) | VERIFIED | No autocomplete/suggestions endpoint |
| E4 | Product fields | `ProductListItem`: id/name/slug/productType/unit/saleStepGrams/isActive/category{}/brand{} (`serialize.ts:68-97`); detail adds `description` only | VERIFIED | **No price/compareAt/stock/image in list/detail payloads** |
| E5 | Variant fields | `VariantShape`: id/productId/name/sizeValue/sizeUnit/price/compareAtPrice/isActive (`serialize.ts:113-135`) | VERIFIED | Price lives only here |
| E6 | Images | `GET products/{id}/images` → `{primary, gallery}`; empty array when none; 404 unknown product | VERIFIED | Per-product call; may be empty |
| E7 | Availability | `GET inventory/products|variants/{id}` → quantity/reserved/available decimal strings | VERIFIED | Per-product/variant call |
| E8 | Brands/categories shapes | `{id,name,slug,image?,isActive}`; categories carry `parentId` (hierarchy exists, depth unbounded) | VERIFIED | Curation/order rules are editorial, not backend |
| E9 | Cart lifecycle | Mint (201+guestToken)/resolve(200)/read/mutate/merge/reprice; XOR identity; 400/401/404/409/422 mapped | VERIFIED | Mutations return updated cart (verify at build: full-cart echo assumed from 200 descriptions) |
| E10 | Add-to-cart | `POST cart/items` {productVariantId, quantity}; 422 on step/unit/price violation; re-add aggregates | VERIFIED | Variant ID required (never product ID alone) |
| E11 | Promotions engine exists; **no storefront feed** | No `/api/store/promotions|coupons|offers|banners|content|settings|delivery` routes (full route inventory) | VERIFIED ABSENT | Homepage cannot list “today's offers” from an endpoint |
| E12 | Coverage/delivery data | No endpoint; settings-fee read is checkout-internal | VERIFIED ABSENT | No promises, fees, hours, or zones on homepage |
| E13 | Error envelope | `{error:{code,message,details}}`; codes VALIDATION/UNAUTHENTICATED/FORBIDDEN/NOT_FOUND/GONE/CONFLICT/BUSINESS_RULE/RATE_LIMITED/INTERNAL (`errors.ts:15-23`) | VERIFIED | Map codes to messages, never raw codes |
| E14 | Deps/conventions | Next 16.3.8, React 19, zod, zustand, Tailwind v4; no fetch/state-server library; Server Components default | VERIFIED | No SWR/RQ assumptions; RSC fetch + handlers |
| E15 | No CMS/config endpoint | Route inventory has no content/banner/config namespace | VERIFIED ABSENT | Hero/featured is conditional on owner-provided static content |

## 4. Homepage content hierarchy

Order (LOCKED IA direction; density per VI-01 restraint): (1) store strip — conditional, only with
verified static message; (2) header — logo/fallback, search entry, account access, cart with
indicator, delivery-area line ONLY if operationally confirmed (default: omitted); (3) category nav
(real categories only); (4) hero/featured — OPTIONAL, renders only with approved static content or
verified source, else section omitted entirely (no placeholder hero); (5) promotions — OPTIONAL and
conditional (see §6.5; never fabricated); (6) product discovery collections (bounded, sourced);
(7) trust strip (omitted: no verified coverage/contact source exists — seed contact values have no
storefront read path); (8) footer (verified routes only; no policy entries until owner-approved
content exists — see FP11-D06).

## 5. Section-by-section UX requirements

**5.1 Strip:** purpose = single operational message; source = owner-approved static string;
visible only when configured; mobile = one truncated line; absent data ⇒ section omitted (not an
empty box). **5.2 Header:** logo (official asset or neutral wordmark fallback — no fabricated logo);
search submits to results; account icon → login/account per session; cart icon + indicator (see
§5.7); no duplicate nav; compact mobile height. **5.3 Categories:** real `GET categories` data,
parent/child via `parentId`. Selection strategy (CLOSED — OWNER-DELEGATED DECISION, FP11-D02):
top-level only (`parent=null`), active rows, ordered client-side by (`sortOrder` ASC, name ASC) —
`sortOrder` is admin-managed (`PATCH categories`, default 0; VERIFIED) and no merchandising order
is claimed beyond it; take up to 6; fewer when fewer exist; zero ⇒ shortcuts section omitted
(listing entry points remain). No popularity/bestseller claims (no source). No duplicate entries;
each shortcut links to the category-filtered listing, which renders its own honest empty state,
so no emptiness pre-check calls are needed. Manual curation later would need a separate product
decision; none is assumed. **5.4 Hero:** conditional
per §4; static-approved content only; no admin banner system assumed. **5.5 Promotions:** allowed
content = backend-proven benefits only (estimate-computed line/coupon outcomes already in the
user's cart, or compare-at present in a fetched variant payload — never inferred); expired/
ineligible/malformed ⇒ section hidden with no phantom badge; urgency copy forbidden.
**5.6 Discovery collections** (e.g. “تسوق حسب القسم”, “وصل حديثًا” via `newest` sort, “أساسيات
البيت” via curated category): each declares purpose + source endpoint + params + max initial items
(8–12, bounded for N+1 cost) + loading/error + “عرض الكل” → filtered listing + keyset “load more”;
any collection without a source is omitted, not mocked. **5.7 Footer:** verified routes only (Home/Categories/Search/Offers/Cart + account entries per
locked nav). Policy rule (CLOSED — OWNER-DELEGATED DECISION, FP11-D06): a policy entry renders
only with owner-approved text from a verified source; no approved source exists in-repo (no policy
routes, no public settings read, seed contact values unreachable storefront-side), so the footer
ships with zero policy entries and no contact block. Missing content is a content dependency, never
a placeholder text. Layout stays usable with entries absent. No invented links, terms, fees, hours,
or coverage claims.

## 6. Product-card behavior and data dependencies

Card = name + image/fallback + variant/unit line + server price + availability state + add control
(+ compare-at struck ONLY when variant payload returns non-null + valid promo badge per §5.5).
Data cost per card: list row + variants call + inventory call + images call — specified resilience:
skeleton → progressive fill → per-card error retry, never blocking the grid; hard cap on initial
cards per collection (§5.6). PIECE: chosen sellable variant + whole-pack qty (minimum 1 pack; no
invented maximum — stock-bounded) — one-variant products preselect, multi-variant require explicit
choice. WEIGHT: only backend-supported gram presets per product `saleStepGrams` (125/250/500/1kg/
1.25kg where valid); free decimals rejected client-side with message; estimate shown, never final
total. Unavailable («غير متوفر»): visible, disabled add (or permitted alternate where contract
allows — none verified: disabled). Missing image: neutral fallback, never broken icon. Add-to-cart:
pending spinner → server-confirmed success feedback (badge pulse + count) → failure message + retry;
duplicate-submit guard (disable while in flight); indicator refresh from mutation response, else
single follow-up read (verify full-cart echo at build; fallback read documented).

## 7. Search, navigation, and cart interactions

Search box submits (no autocomplete — unsupported); results route preserves `q` + filters;
empty query ⇒ guided empty state (not a search call); no-results ⇒ adjust/filters suggestion;
in-flight ⇒ debounce + latest-wins (stale responses discarded as UX rule); failure ⇒ retry keeping
query; keyboard: Enter submits, Esc clears; RTL: preserved param order, logical icons. Navigation
targets verified: all routes in §4 exist as API-backed destinations except hero/offers-conditional;
route gaps (e.g. brand detail page) = NEEDS OWNER DECISION only if pursued (brand endpoints exist,
page is a design choice). Cart indicator: shows server-confirmed total quantity across lines after each confirmed
mutation (CLOSED — OWNER-DELEGATED DECISION: total quantity is the standard grocery convention and
both metrics derive identically from the full-cart response, so the choice has zero contract impact).
Empty (no lines) ⇒ guided empty state, never a bare zero badge.

## 8. Mobile/tablet/desktop behavior

Mobile: compact header, persistent search access, bottom-nav per FP-03 (Home/Categories/Search/
Offers/Cart), 2-col cards min touch 44px, sticky add-to-cart on PDP only (not homepage grids),
drawer filters on listing (homepage: search only). Tablet: 3-col, condensed header. Desktop: full
header, 4–5-col, hover supplements tap (never hover-only). No invented breakpoints (follow Tailwind
v4 defaults at build; spec describes transitions, not px values).

## 9. RTL and accessibility requirements

`dir=rtl` document, logical properties, Arabic-first copy with Latin SKUs/numbers isolated
(`bdi`/unicode-bidi); semantic headings (h1 page, h2 sections); icon-only controls named in Arabic;
focus visible + logical order; status changes announced (aria-live for cart count, errors);
contrast from FP-10 locked pairs only; availability never color-only (icon + «غير متوفر» text);
form/error association; no WCAG conformance claim without testing.

## 10. All applicable UI states

| # | State | Trigger | Behavior | Action | Scope | Backend dep |
|---|---|---|---|---|---|---|
| 1–3 | Loading/success/empty (per section) | fetch lifecycle | skeleton/content/guided empty | retry or browse | local | endpoint |
| 4 | API failure | transport/5xx | section error card, rest intact | retry | local | — |
| 5 | Missing/invalid image | null/404 asset | neutral fallback | none | local | images endpoint |
| 6 | Unavailable | stock/state | «غير متوفر», disabled add | view alternatives | local | inventory |
| 7 | Expired/invalid promo | evaluation | badge removed, totals recomputed | continue | local | estimate |
| 8–10 | Add pending/success/failure | mutation lifecycle | spinner/confirm/error+retry | retry once | local | cart/items |
| 11–12 | Cart empty/populated | line count | guided empty / badge count | shop / open cart | global indicator | cart read |
| 13–14 | Search empty/failure | no match vs transport | adjust-filters vs retry | as shown | local | search |
| 15 | Partial failure | one section fails | others render | per-section retry | local | — |
| 16 | Expired session/cart | 401/404 | re-login / fresh guest cart, preserve lines locally | authenticate | global | session/cart |

Copy is proposed microcopy (RECOMMENDATION) unless FP-04/FP-05 locked strings apply.

## 11. Performance and large-catalog constraints

Max 8–12 products initial per collection (N+1 bound); below-fold image lazy + fixed aspect-ratio
slots (no layout shift); no duplicate variant/inventory/images calls per product (request cache per
render); sections load independently; keyset “load more” only; zero full-catalog loads; no client
fabrication of missing data; no numeric performance promises (no baseline/budget approved).

## 12. Data-source and endpoint mapping

Catalog list/detail/search/variants/images/inventory/brands/categories/codes per §3 E2–E8; cart
mint/read/mutate/merge/reprice + estimate per E9–E10; auth/session/guest per FP-04; orders flow per
FP-04 (out of homepage scope except add-to-cart handoff). Absent: offers/promotions/coupons-list/
content/settings/delivery endpoints (E11–E12); profile edit; payments.

## 13. Owner decision register

| ID | Question | Evidence | Recommended default | Alternatives | Impact | Status |
|---|---|---|---|---|---|---|
| FP11-D01 | Hero/featured source | E15: no CMS endpoint | Static approved content or omit section | Fictitious banner system (rejected) | Homepage richness | RECOMMENDATION |
| FP11-D02 | Category selection/order | E8 + admin-managed `sortOrder` (default 0); no popularity source | Top-level (`parent=null`), active, client-ordered (`sortOrder`, name), max 6 with graceful degrade | Owner-curated list (deferred: needs future product decision) | Discovery UX | CLOSED — OWNER-DELEGATED DECISION |
| FP11-D03 | Discovery collections set | E2–E8 endpoints | Category-led + newest + essentials (bounded) | Fewer/more sections | Scope | RECOMMENDATION |
| FP11-D04 | Offers section data | E11 absent feed | Conditional section; honest empty; never fabricated | Hide tab (rejected: FP-03 locked) | Marketing honesty | RECOMMENDATION + BACKEND-CONSTRAINED data |
| FP11-D05 | Cart indicator metric | E9 full-cart response (both metrics derivable identically) | Total quantity across lines | Lines count | Consistency | CLOSED — OWNER-DELEGATED DECISION (zero contract impact; standard grocery convention) |
| FP11-D06 | Footer policies/links | No policy routes/texts; seed contact unreachable storefront-side | Verified routes only; entries render solely from owner-approved verified sources (none today ⇒ none render) | Invented links/text (rejected) | Legal/trust | CLOSED — OWNER-DELEGATED DECISION |
| FP11-D07 | Weight presets per product | Step rules (FP-05) | Backend-valid presets only | Free entry (rejected) | Correctness | RECOMMENDATION |
| FP11-D08 | Missing-image fallback style | E6 may be empty | Neutral placeholder | Category art (needs assets) | Visual quality | RECOMMENDATION |
| FP11-D09 | Search UX details (debounce, stale) | No autocomplete (E3) | Debounced submit, latest-wins | Live suggestions (rejected: unsupported) | Correctness | RECOMMENDATION |
| FP11-D10 | Initial counts/density | N+1 cost (E4–E7) | 8–12 bounded | More (rejected: perf) | Performance | RECOMMENDATION |

Locked respected: FP-03 nav, single-page checkout, guest-no-account, price/stock authority,
PIECE/WEIGHT, EGP, no-governorate, brand/VI-01, FP-09 untouched.

## 14. Acceptance criteria

- AC-H1: every data-driven section names a §3 endpoint or is marked conditional/omitted.
- AC-H2: search honors q/sort/filters/cursor contract; no autocomplete implied.
- AC-H3: cart flows match XOR identity + mutation responses; no pre-confirm success.
- AC-H4: prices/units/availability/promotions only from verified payloads; compare-at only when returned.
- AC-H5: PIECE whole-pack vs WEIGHT step-presets distinguished; estimates never final.
- AC-H6: catalog bounded (≤12 initial/collection), lazy images, independent sections, keyset more.
- AC-H7: mobile/desktop/RTL/loading/empty/error per §§8–10.
- AC-H8: missing assets/content documented, never fabricated.
- AC-H9: delegated closures (D02/D05/D06) recorded with rationale and evidence, not silent defaults.
- AC-H10: zero application-code/dependency changes (verify via status).

## 15. Explicit list of unsupported or unverified capabilities

No offers/promotions/coupons-list/content/settings/delivery endpoints; no profile edit; no payments;
no popularity/bestseller source; no price sorting documented; no autocomplete; variant-selection UX
bound by step rules; cart echo shape re-verified at build; footer policies/content pending owner.

## 16. Statement of readiness and blocks

Ready for owner review as a specification. D02 (category strategy) and D06 (verified-content-only
policy rule) closed under owner delegation; D05 indicator metric likewise closed. No owner decisions
remain within FP-11.1 scope. Remaining implementation prerequisites (not spec blockers): owner-supplied
hero content, promotional data feed, and footer policy texts when wanted — all handled by specified
honest-empty/omit behaviors until supplied.
