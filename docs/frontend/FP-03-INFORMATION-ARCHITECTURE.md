# FP-03 — Information Architecture: Final Sitemap, Screen Registry, Navigation Rules & Backend Alignment

> **Status:** SPECIFICATION-CLOSED (documentation + static audit only).
> **Authority order:** explicit owner LOCKED decisions (esp. FP-00-D007) > locked product/UX specs > backend behavior +
> `docs/openapi.yaml` > FP-11→FP-20 specs > current `src/app` tree > conservative technical assumptions for
> non-commercial detail only.
> **Scope:** IA + sitemaps + registries + access/navigation/state/SEO/analytics-plan/responsive rules + API
> traceability. No pages/components/handlers/endpoints created; no backend/schema/config change; no migration/seed;
> no packages; no commit/push/deploy; no `AGENT-HANDOFF.md` edit; no other FP doc edited (conflicts recorded here).
> **Method:** static read only (specs + contract + route code + `src/app` + `src/proxy.ts`). No live run, no DB traffic,
> no operational proof claimed. Evidence status therefore reads "static" throughout — never a runtime guarantee.
> **Non-duplication:** full operation matrices live in FP-13 §1/§5; error scenarios in FP-11.10; closure gaps in
> FP-11.11 §C; brand rules in BRAND-STRATEGY-v1 + FP-02. This doc holds IA decisions and points outward.
> **Four-state discipline:** Specified ≠ Backend-supported ≠ Implemented ≠ Approved-for-implementation (see §2).

## 1. Prior-decision review (no locked decision reopened without record)

| Decision / topic | Current source | Prior state | Review result | Action |
|---|---|---|---|---|
| Mobile bottom-nav composition | FP-00-D007 (PRODUCT-OWNER LOCKED) + FP-09 D05 (delegated) | Home/Categories/Cart/Orders/Account + visible search | `EXISTING — VERIFIED`, RE-RESOLVED final | Retained as final Option A by owner-delegated closure (this task); FP03-C1 CLOSED |
| Desktop header composition | FP-00-D007 LOCKED | Logo/Categories/Search/Offers/Cart/Account | `EXISTING — VERIFIED` | Kept |
| FP-04/FP-05/FP-12 "FP-03 nav" claim (Home/Categories/Search/Offers/Cart + Account/Orders via header) | FP-04:42, FP-05:12, FP-12 §StoreNavigation | Presented as locked FP-03 order | `CONFLICT DETECTED` → RESOLVED | Corrected to Option A across FP-04/FP-12 by owner-delegated closure; FP03-C1 CLOSED |
| Offers page/nav entry | FP-09 D02 (policy CLOSED-delegated; page BLOCKED) vs FP-04/05/12 (tab kept, honest-empty) | Page blocked for launch; tab kept per FP-03 claim | `CONFLICT DETECTED` | Resolved FP03-C2: tab exists where header/nav includes it, content BACKEND-CONSTRAINED (honest empty); no feed invented |
| Category/brand/product URL shape (id/slug, slug display-only, canonical redirect) | FP-09 D01 (delegated-closed) | `/p/[id]/[slug]`, `/c/[id]/[slug]`, `/brand/[id]/[slug]` | `EXISTING — VERIFIED` | Kept |
| Brands pages inclusion | FP-09 D08 (endpoints verified) | `/brands` + `/brand/[id]/[slug]` | `EXISTING — VERIFIED` | Kept |
| Pagination/URL-state contract | FP-09 D04 + FP-13 §1.1 | Keyset opaque/UUID/search cursors; Load More; URL holds filters+cursor | `EXISTING — VERIFIED` | Kept; adopted in §8/§11 |
| Checkout model (stepped; XOR address; idempotency) | FP-09 D06 + FP-11.5 + FP-13 §5 | As specified | `EXISTING — VERIFIED` | Kept |
| Safe `next` + back behavior | FP-09 D07 + §F | Same-origin server-validated; back restores | `EXISTING — VERIFIED` | Kept (§9) |
| Guest credential model (3 separated secrets; token never in URL) | FP-09 D09 + FP-13 §4 + FP-14 | Session vs `x-guest-token` vs `x-guest-order-token` 90d | `EXISTING — VERIFIED` | Kept (§9) |
| Admin sitemap + sidebar groups + per-key RBAC | FP-09 §§C–D + D10/D11 + FP-11.8 family | 5 groups; operational KPIs only; revenue BLOCKED | `EXISTING — VERIFIED` | Kept; refined per real methods (§4: permissions read-only→merged; settings PATCH supported) |
| Advanced ops exclusion | FP-09 D12 | Delivery/payment/bulk/reports/notifications OUT OF SCOPE | `EXISTING — VERIFIED` | Kept; enforced in §§3–4 |
| Screen journeys/states/components | FP-11 family + FP-12 + FP-13 + FP-14 | Closed specs | `EXISTING — VERIFIED` | Referenced, not restated |
| FP-20 "FP-03 MERGED, no file needed" | FP-20:25 + FP-20:208 | Dispersed decision record | `CONFLICT DETECTED` | Resolved: this owner-tasked file consolidates the dispersed record; no FP-20 rule changed; FP-09 untouched |
| FP-09 vs FP-04 precedence claim ("FP-03 wins") | FP-04:42-43 | FP-04 asserts self-precedence | `CONFLICT DETECTED` | Rejected as precedence rule (hierarchy §2 governs); FP-04 content otherwise kept |

## 2. Sources of truth & state vocabulary

Order: (1) explicit owner LOCKED (FP-00-D007 et al.); (2) locked product/UX specs; (3) backend behavior + openapi.yaml
(98 `/api/` paths verified; 138 operation entries); (4) FP-11→FP-20; (5) `src/app` reality (only `/`, `/admin`,
`/admin/login`, `/admin/users` pages exist — everything else PROPOSED); (6) conservative assumptions for
non-commercial detail only. Nothing is "supported" from a page proposal alone; nothing is "implemented" from
documentation alone. Route Status ∈ {EXISTING — VERIFIED, PROPOSED, PLANNED, CONDITIONAL, NOT REQUIRED AS SEPARATE
ROUTE, UNVERIFIED}; Implementation Status ∈ {IMPLEMENTED — VERIFIED, PARTIALLY IMPLEMENTED, NOT IMPLEMENTED,
NOT VERIFIED}; screen verdicts per §12.

## 3. STORE sitemap (final) + per-item verdict

```text
STORE (/)
├── Home `/` [S-HOME — IN SCOPE]
├── Categories `/categories` [S-CATS] → Category `/c/[id]/[slug]` [S-CAT]
├── Brands `/brands` [S-BRANDS] → Brand `/brand/[id]/[slug]` [S-BRAND]
├── Search `/search` [S-SEARCH]
├── Offers `/offers` [S-OFFERS — CONDITIONAL, constrained content]
├── Product `/p/[id]/[slug]` [S-PDP]
├── Cart `/cart` [S-CART]
├── Checkout `/checkout` [S-CHECKOUT] → Confirmation `/order-confirmation/[id]` [S-CONFIRM]
├── Orders `/orders` [S-ORDERS, auth] → Order Details `/orders/[id]` [S-ORDER: session policy + guest-credential policy, one route]
├── Account `/account` [S-ACCOUNT] + Addresses `/addresses` [S-ADDR]
├── Login `/login` [S-LOGIN] · Register `/register` [S-REGISTER] · Forgot Password [OUT — no backend]
├── Replacements [MERGED into S-ORDER, no separate route]
├── Order Tracking [NOT A SEPARATE ROUTE — function of S-ORDERS/S-ORDER]
├── Static `/pages/[slug]` (FAQ/About/Contact/Policies) [S-STATIC — CONDITIONAL on approved copy]
└── Error Pages [S-ERROR — shared]
```

Per-item answers (Q1 separate screen? Q2 need? Q3 source? Q4 real endpoint? Q5 auth? Q6 prior spec? Q7 fit? Q8 alternative? Q9 pre-build resolve?):
Home Y/Y/catalog+categories+search/public/FP-11.1+FP-09/fit/—/none. Categories Y/Y/`GET categories`/public/FP-11.2/fit/—/none.
Category Y/Y/categories+products?category=/public/FP-11.2/fit/—/none. Brands Y/Y (D08 endpoints verified)/`GET brands`/public/FP-11.2/fit/—/none.
Brand Y/Y/products?brand=/public/D08/fit/—/none. Search Y/Y/`GET search` q2–120/public/FP-11.2/fit/—/none.
Offers CONDITIONAL (nav slot kept; page content constrained: honest-empty until feed/facet contract; card compare-at only
from fetched variant data)/public/FP-09 D02 + FP-04/05/12/CONDITIONAL alternative = contextual offer blocks on Home/listing/none.
Product Y/Y/products+variants+images+inventory+codes/public/FP-11.3/fit/—/none. Cart Y/Y/cart CRUD+merge+reprice/guest-XOR-session/FP-11.4/fit/—/none.
Checkout Y/Y/addresses+estimate+orders-create/session-XOR-guest/FP-11.5/fit/—/require non-empty cart. Confirmation Y(separate
from details: post-create success only)/Y/orders/[id] read/owner/FP-11.5+FP-11.6/fit/—/resolve owner policy before build.
Order Tracking NOT separate (function of S-ORDERS/S-ORDER). Orders Y/Y/`GET orders` keyset/session/FP-11.6+FP-11.7/fit/—/none.
Order Details Y/Y/orders/[id]+cancel+replacements/session-OR-guest-credential/FP-11.6/fit/—/two policies one route (build rule).
Replacements MERGED (decide actions inside S-ORDER; admin side in A-ORDER). Account Y/Y/session+orders-summary/session/FP-11.7/fit/—/none
(profile-name edit BLOCKED — no PATCH). Addresses Y/Y/addresses CRUD/session/FP-11.5+FP-11.7/fit/—/none. Login Y/Y/session/public/FP-11.7/fit/—/none
(redirect-away-if-authed). Register Y/Y/register+identify/public/FP-11.7/fit/—/none (G5 buckets; 409→login).
Forgot Password OUT (no OTP/reset endpoint — verified absent; only authed `PATCH password` exists). FAQ/About/Contact/Policies
CONDITIONAL static (no API needed; footer-linked; require approved copy before launch; N/A auth). Error Pages shared (404/403/500/offline per §7).

## 4. ADMIN sitemap (final) + per-item verdict

```text
ADMIN (`/admin`, proxy-guarded, matcher `/admin/:path*`)
├── Login `/admin/login` [A-LOGIN — EXISTING, session-aware redirect]
├── Dashboard `/admin` [A-DASH — EXISTING shell, PARTIAL: operational KPIs only, revenue BLOCKED]
├── Orders `/admin/orders` → Detail `/admin/orders/[id]` (prep tabs incl.) [A-ORDERS/A-ORDER — PROPOSED]
├── Catalog `/admin/products` → Detail `/admin/products/[id]` [A-CATALOG/A-PRODUCT — PROPOSED; no hard product delete]
├── Inventory `/admin/inventory` [A-INV — PROPOSED; delta-adjust only, no recount]
├── Customers `/admin/customers` → Detail `/admin/customers/[id]` [A-CUST — PROPOSED; sole key customers.view]
├── Promotions `/admin/promotions` (+detail) [A-PROMO] · Coupons `/admin/coupons` (+usages) [A-COUPON] — PROPOSED
├── Users `/admin/users` [A-USERS — EXISTING list] → Detail `/admin/users/[id]` [PROPOSED]
├── Roles `/admin/roles` (+detail: grants+members; Permissions read-only merged) [A-ROLES — PROPOSED]
├── Settings `/admin/settings` [A-SETTINGS — PROPOSED; GET list/one + PATCH value]
└── Audit `/admin/audit-logs` (+row) [A-AUDIT — PROPOSED; append-only reads]
```

Rules honored: existing shell kept (no rebuild); every screen bound to real `x-permission` (permissions GET-only under
`roles.view` → merged reference, not a management screen); sidebar visibility never substitutes server RBAC;
route≠operation≠user-permission distinguished; no metrics/reports/payments/notifications screens (no endpoints);
`Customers` (storefront identities, `customers.view`) ≠ `Users` (admin identities, `users.*`).

## 5. Screen Registry (accepted screens; N/A justified; UNVERIFIED marks pre-build work)

Conventions for all: language Arabic-first RTL; price/unit/availability from server responses only; no fake data;
tokens/secrets/PII never in URL/analytics; envelope `{data,meta}`/`{error:{code,message,details}}`; decimals exact
strings (money 2dp, qty 3dp); keyset pagination (limit 1–100 d20, `nextCursor|null`, forward-only, no totals).

**S-HOME** — Home | STORE | `/` | PROPOSED | Purpose: entry + discovery (hero/categories/offers/featured/trust/footer)
| User: visitor | Entry: `/`, logo, back-to-home | Exit: categories/search/PDP/cart/offers-contextual | Data: products/categories/search rows (public; rows w/o price/stock/image)
| Actions: browse/search-triage (GET products/categories/search) | State: discovery | Permission: public | Errors: section failure → hide section, never fake; 400 sanitize
| Loading: page skeleton | Empty: honest empty sections (never error) | Responsive: multi-col grid → single-col; sticky search access
| RTL: logical props; mixed numerals `152 ج.م` | SEO: indexable; title/desc/canonical (no invented prices) | Analytics (planned): home_viewed
| Backend: `GET catalog/products|categories|search, brands` | Impl: NOT IMPLEMENTED | Limits: no totals/popularity/price-sort/autocomplete; no offers feed
| Accept: renders without fake data; search prominent; carousels minimal.

**S-CATS** — Categories | STORE | `/categories` | PROPOSED | Purpose: full taxonomy browse | User: visitor
| Entry: nav/footer/sitemap | Exit: S-CAT | Data: `GET categories` tree (parent filter, unbounded depth) | Actions: drill-down
| State: browse | Permission: public | Errors: 400 sanitize | Loading: skeleton | Empty: honest empty (nav section omittable)
| Responsive: list→accordion on mobile | RTL: trail order | SEO: indexable | Analytics: category_list_viewed
| Backend: `GET catalog/categories` | Impl: NOT IMPLEMENTED | Limits: depth actual unverified; no popularity | Accept: full tree reachable; keyboard-safe.

**S-CAT** — Category Detail | STORE | `/c/[id]/[slug]` | PROPOSED | Purpose: subtree listing + filters | User: visitor
| Entry: S-CATS/nav/search/direct | Exit: S-PDP, back restores state | Data: category + `GET products?category=` (UUID fetch; slug display-only)
| Actions: filter/sort (name/created_at only)/Load More | State: listing w/ URL-held filters+cursor | Permission: public
| Errors: unknown UUID → 404; malformed cursor → 400-mapped | Loading: skeleton + inline next-page retry | Empty: honest empty
| Responsive: drawer filters mobile | RTL: filter order | SEO: indexable w/ canonical slug (mismatch → canonical redirect; stale slugs work)
| Analytics: category_viewed, filters_applied | Backend: categories + products | Impl: NOT IMPLEMENTED | Limits: no price sort/totals
| Accept: slug-mismatch redirects canonical; back restores query+scroll.

**S-BRANDS / S-BRAND** — Brands + Brand Detail | STORE | `/brands`, `/brand/[id]/[slug]` | PROPOSED | Purpose: brand discovery + brand listing
| User: visitor | Entry: nav/contextual/direct | Exit: S-PDP | Data: `GET brands`, `brands/[id]`, products `?brand=` | Actions: browse/filter/Load More
| State/Permission/Errors/Loading/Empty/Responsive/RTL as S-CATS/S-CAT | SEO: indexable + canonical | Analytics: brand_viewed
| Backend: brands + products | Impl: NOT IMPLEMENTED | Limits: as catalog | Accept: unknown → 404; same id/slug contract as D01.

**S-SEARCH** — Search | STORE | `/search` | PROPOSED | Purpose: query results + filters | User: visitor
| Entry: header search (persistent), bottom-nav-adjacent access, direct w/ `q` | Exit: S-PDP/S-CAT | Data: `GET catalog/search` (q 2–120 required; relevance/newest; tier/sim/id cursor)
| Actions: submit/clear/filter/Load More (latest-wins; never client-filter as "search") | State: query-driven | Permission: public
| Errors: empty query → guided empty; short/invalid → 400-mapped; OOS kept unless `inStock=true` | Loading: pending w/ discard-stale
| Empty: no-results state (≠ error) | Responsive: retired filters in drawer | RTL: query dir auto | SEO: indexable for navigable queries; noindex for empty/invalid query states
| Analytics: search_submitted, search_no_results | Backend: search (+ codes/lookup where linked) | Impl: NOT IMPLEMENTED
| Limits: no autocomplete; no price/popularity sort | Accept: submit-only; retry keeps query.

**S-OFFERS** — Offers | STORE | `/offers` | CONDITIONAL (slot kept; content constrained) | Purpose: discounted-products集合 IF feed/facet exists
| User: visitor | Entry: desktop header/contextual (no bottom-tab slot per final FP03-C1) | Exit: S-PDP
| Data: NO dedicated endpoint (verified absent); only already-fetched variant `compareAtPrice` w/ real values
| Actions: browse derivable offers only | State: constrained | Permission: public | Errors: never fake-discount
| Loading: skeleton | Empty: honest empty is the CORRECT launch state | Responsive/RTL as listing | SEO: conditional (noindex until real content)
| Analytics: offers_viewed (only if page live) | Backend: none dedicated (BLOCKED) | Impl: NOT IMPLEMENTED | Limits: unbounded N+1 scan forbidden
| Accept: launches honest-empty OR stays unlinked until feed contract; zero fabricated prices.

**S-PDP** — Product Detail | STORE | `/p/[id]/[slug]` | PROPOSED | Purpose: full detail + variant/weight choice + add
| User: visitor | Entry: listing/search/direct | Exit: cart, back-to-results | Data: products/[id], variants, images, inventory reads, codes/lookup (variant = price authority; gallery fallback `{primary:null,gallery:[]}`)
| Actions: select variant/weight (step-exact presets), add (`POST cart/items` aggregates — NOT idempotent)
| State: detail w/ sellability (variant AND product) | Permission: public | Errors: unknown/inactive → 404; step violation → 422; stock-moved → re-read
| Loading: skeleton (gallery slots layout-stable) | Empty: N/A (detail; OOS stays visible w/ disabled add) | Responsive: sticky add-to-cart mobile; large steppers
| RTL: unit/weight phrasing reviewed | SEO: indexable + canonical | Analytics: product_viewed, variant_selected, add_to_cart_attempted/confirmed (attempt vs confirmed split)
| Backend: products/variants/images/inventory/codes + cart/items | Impl: NOT IMPLEMENTED | Limits: no reviews/related/restock-notify
| Accept: price+unit glanceable; image failure never breaks layout.

**S-CART** — Cart | STORE | `/cart` | PROPOSED | Purpose: draft review + mutate + reprice preview | User: guest (bearer) or customer (session)
| Entry: header indicator, PDP add, direct | Exit: checkout (non-empty), continue shopping | Data: full-cart echo (quote, not authority)
| Actions: mint/resolve/read/add/set/remove/clear/merge(explicit)/reprice | State: draft; XOR identity; consumed/gone → fresh mint
| Permission: guest-token XOR session (never client customerId) | Errors: 400 both-sides; 401 no-identity; 404 gone-cart; 409/422 ladder; add-sums (single-flight + re-read-first)
| Loading: skeleton + per-line pending | Empty: guided empty (≠ error) | Responsive: stepper targets; summary sticky | RTL: totals order
| SEO: private/noindex | Analytics: cart_viewed, add_confirmed, checkout_started | Backend: cart suite | Impl: NOT IMPLEMENTED
| Limits: draft only; merge never automatic on login | Accept: totals from echo only; timeout → re-read, never blind retry.

**S-CHECKOUT** — Checkout | STORE | `/checkout` | PROPOSED | Purpose: stepped info→address→delivery/fee→COD→review→confirm
| User: guest or customer w/ non-empty cart | Entry: S-CART | Exit: S-CONFIRM (201 only) or back
| Data: addresses (saved XOR guest inline), estimate (dry-run preview), fee server-read, coupon states
| Actions: `POST estimate` (repeatable, never final) + `POST orders` (idempotency key required; header-wins; same-key replay 200 / 409-different-terms)
| State: stepped w/ per-step validation; prices/stock revalidated pre-create | Permission: session XOR guest-cart context
| Errors: 400 ambiguous/conflict; 409 drift/short/different-terms; 500/timeout → ambiguous: same-key resolve, never new key
| Loading: step pending; submit locked till response | Empty: N/A (requires non-empty cart; else redirect) | Responsive: keyboard-aware; CTA visible
| RTL: step order mirrored | SEO: private/noindex | Analytics: checkout_started, order_creation_confirmed (201 only)
| Backend: addresses + estimate + orders | Impl: NOT IMPLEMENTED | Limits: payment-neutral (COD convention); no delivery-service assumptions
| Accept: success shown ONLY after 201 + credential-once handling.

**S-CONFIRM** — Order Confirmation | STORE | `/order-confirmation/[id]` | PROPOSED | Purpose: post-create success (HM number + summary)
| User: owner (session or guest credential) | Entry: S-CHECKOUT 201 only (not deep-linkable as public) | Exit: S-ORDER/S-ORDERS/home
| Data: orders/[id] read | Actions: read-only | State: success receipt | Permission: owner-only (foreign/unknown → 404, no leakage)
| Errors: 404/401/410 per policy | Loading: skeleton | Empty: N/A | Responsive: receipt layout | RTL: number/code LTR-safe
| SEO: private/noindex | Analytics: order_confirmation_viewed | Backend: orders/[id] | Impl: NOT IMPLEMENTED | Limits: not a tracking page
| Accept: reachable only via confirmed creation flow; no sensitive data in URL.

**S-ORDERS** — Customer Orders | STORE | `/orders` | PROPOSED | Purpose: session order history (keyset) | User: registered customer
| Entry: header/account/direct (authed) | Exit: S-ORDER | Data: `GET orders` (raw-UUID cursors, forward-only) | Actions: page (Load More), open detail
| State: authed list | Permission: session self-scoped | Errors: 401 → login+safe-next; foreign → 404 | Loading: skeleton + inline retry
| Empty: honest empty | Responsive: cards mobile | RTL: dates/numbers | SEO: private/noindex | Analytics: orders_viewed
| Backend: `GET orders` | Impl: NOT IMPLEMENTED | Limits: no guest list; no totals | Accept: no cross-user leakage.

**S-ORDER** — Order Details (dual-policy, one route) | STORE | `/orders/[id]` | PROPOSED | Purpose: tracking + cancel + replacement decide
| User: (a) owner-customer via session; (b) guest via `x-guest-order-token` (header; planned HttpOnly adapter-held per FP03-G1 §7b; never URL, never localStorage)
| Entry: S-ORDERS / guest deep-link w/ adapter-held credential / S-CONFIRM | Exit: back to list/home; support path on 410
| Data: orders/[id] + cancel + replacements GET/decide | Actions: read/cancel (unpicked-only; picked → 409)/decide
| State: owner-verified | Permission: session-owner XOR order-bound credential (90d TTL; keep-same replay; order-number ≠ auth)
| Errors: 401 invalid/revoked; 410 expired (+support guidance); 404 unknown≡foreign; 409 locked
| Loading: skeleton | Empty: N/A | Responsive: status timeline; big action targets | RTL: timeline dir | SEO: private/noindex
| Analytics: order_viewed, cancel_confirmed, replacement_decided | Backend: orders/[id]+cancel+replacements | Impl: NOT IMPLEMENTED
| Limits: expired → terminal; lost credential → staff rotate/revoke path only | Accept: token never in URL/logs/client-readable storage; build enforces both policies on ONE route via FP03-G1 adapter.

**S-ACCOUNT** — Account | STORE | `/account` | PROPOSED | Purpose: profile hub (orders/addresses/password links)
| User: customer | Entry: header/direct (authed) | Exit: S-ORDERS/S-ADDR/password | Data: session + counts-from-lists (no profile PATCH — BLOCKED G003)
| Actions: navigate; logout (`DELETE session`) | State: authed | Permission: session | Errors: 401 → login | Loading: skeleton
| Empty: N/A | Responsive: hub cards | RTL: standard | SEO: private/noindex | Analytics: account_viewed
| Backend: session + orders + addresses | Impl: NOT IMPLEMENTED | Limits: no name-edit UI | Accept: no invented profile fields.

**S-ADDR** — Addresses | STORE | `/addresses` | PROPOSED | Purpose: saved-address CRUD + default | User: customer
| Entry: account/checkout/direct | Exit: back to caller | Data: addresses CRUD (city+phone required; `isDefault` + 409 race)
| Actions: create/patch/delete/set-default | State: authed mutation w/ pending/success/rejected | Permission: session self-scoped
| Errors: 400 shape; 404-gone → relist; 409 default-race | Loading: inline pending | Empty: guided empty (add-first)
| Responsive: sheet-form mobile | RTL: phone/city order | SEO: private/noindex | Analytics: address_saved
| Backend: addresses suite | Impl: NOT IMPLEMENTED | Limits: no coverage/zone lookup | Accept: guest inline snapshots never mixed w/ saved.

**S-LOGIN / S-REGISTER** — Login + Register | AUTH | `/login`, `/register` | PROPOSED | Purpose: phone+password session / new account
| User: visitor (redirect-away if authed) | Entry: account-gate/direct | Exit: safe-`next` (same-origin server-validated) or default
| Data: session/register/identify (generic 401s; lockout/buckets; G5 register IP30/HMAC-phone10)
| Actions: submit (single-flight; login mints session per success) | State: public-auth | Permission: public (auth-pages)
| Errors: wrong/locked → generic (no oracle); 409 duplicate → login path; 429 backoff | Loading: form pending
| Empty: N/A | Responsive: large inputs | RTL: password LTR-safe | SEO: noindex (auth) | Analytics: authentication_result (no secrets)
| Backend: customers/session+register+identify | Impl: NOT IMPLEMENTED | Limits: no OTP/reset (OUT) | Accept: no failure→success coercion.

**S-STATIC** — Static Content (FAQ/About/Contact/Policies variants) | STORE | `/pages/[slug]` | CONDITIONAL
| Purpose: trust/content pages | User: visitor | Entry: footer/contextual | Exit: home/catalog | Data: approved copy (no API)
| Actions: read-only (+contact channel link if approved) | State: static | Permission: public | Errors: unknown slug → 404
| Loading: N/A (static) | Empty: N/A | Responsive: article layout | RTL: copy-reviewed | SEO: indexable IF approved copy, else noindex
| Analytics: static_page_viewed | Backend: none | Impl: NOT IMPLEMENTED | Limits: launch-blocked until copy approved
| Accept: no publish without approved Arabic copy.

**S-ERROR** — Error Pages (shared) | SHARED | framework 404/403/500 + offline | EXISTING-PARTIAL (`forbidden.tsx` exists; rest PROPOSED)
| Purpose: failure surfaces | User: any | Entry: any failure | Exit: home/back/retry/login per case | Data: none
| Actions: retry (reads only; mutations re-read-first), navigate | State: per §11 | Permission: public surfaces
| Errors: self-describing (never leak data; 403 ≠ empty-as-success) | Loading: N/A | Empty: N/A | Responsive: full-screen calm
| RTL: Arabic-first | SEO: noindex | Analytics: error_shown (code only) | Backend: none | Impl: PARTIALLY IMPLEMENTED
| Limits: none | Accept: denial never renders as success; no redirect loops.

**A-LOGIN** — Admin Login | ADMIN | `/admin/login` | EXISTING — VERIFIED | Purpose: email+password admin session (8h)
| User: admin | Entry: proxy redirect/direct; session-aware redirect-away | Exit: `/admin` | Data: admin session (Server Action `loginAction` + `useActionState` — verified pattern)
| Actions: login/logout | State: public-auth-admin | Permission: public page, server-gated destination
| Errors: generic 401; lockout/buckets | Loading: form pending | Empty: N/A | Responsive: centered card | RTL: Arabic card, email LTR
| SEO: noindex | Analytics: N/A (admin usage tracking only if approved) | Backend: `POST /api/admin/session` | Impl: IMPLEMENTED — VERIFIED
| Limits: none | Accept: as-built kept; no rebuild.

**A-DASH** — Dashboard | ADMIN | `/admin` | EXISTING shell (PARTIAL) | Purpose: operational overview (today/pending/preparing/delivery/low/OOS; NO revenue)
| User: admin w/ `orders.view`+`inventory.view` | Entry: login/sidebar | Exit: section lists | Data: list endpoints + inventory (no report endpoints — BLOCKED)
| Actions: navigate to filtered lists | State: admin-gated | Permission: per-key server RBAC | Errors: 401 → login; 403 → forbidden page (exists)
| Loading: skeleton | Empty: honest empty | Responsive: cards → tables | RTL: tables mirrored | SEO: noindex | Analytics: N/A
| Backend: orders/inventory lists | Impl: PARTIALLY IMPLEMENTED | Limits: revenue/reports BLOCKED | Accept: no fabricated KPIs.

**A-ORDERS / A-ORDER** — Orders + Detail/Preparation | ADMIN | `/admin/orders`, `/admin/orders/[id]` | PROPOSED
| Purpose: list (status/customer/number/date) + detail w/ prepare/pick/unavailable/ready/dispatch/deliver/cancel + replacements propose/withdraw/auto-accept + history
| User: admin | Entry: sidebar/deep-link | Exit: back to list | Data: orders + fulfillment + replacements + history
| Actions: 12 transitions (per-key: `orders.view/update/cancel`) | State: frozen-machine gated; 409-gate + refetch; destructive never blind-retried
| Permission: per-operation server RBAC | Errors: 401/403/404/409-guard | Loading: row-level pending | Empty: honest empty
| Responsive: tables scroll/card-fallback mobile | RTL: status chips | SEO: noindex | Analytics: N/A or approved-only
| Backend: 12 admin order routes | Impl: NOT IMPLEMENTED | Limits: no driver/zone/notify | Accept: every action bound to real route+perm.

**A-CATALOG / A-PRODUCT** — Catalog + Product Detail | ADMIN | `/admin/products`, `/admin/products/[id]` | PROPOSED
| Purpose: products/variants/codes/images/price(+history) | User: admin | Entry: sidebar/search | Exit: list
| Data: catalog admin routes (3-unit boundary; compare-at 422 guard; UQ 409s) | Actions: CRUD + price PATCH + images/codes
| Permission: `products.view/create/update/delete`, `prices.view/update` | Errors: 400/404/409/422 + refetch
| Loading/Empty/Responsive/RTL per admin standard | SEO: noindex | Backend: catalog admin suite | Impl: NOT IMPLEMENTED
| Limits: no hard product delete (disable via isActive; Restrict FKs); no barcode-search/timeline/totals/upload
| Accept: disable-not-delete enforced in UI copy.

**A-INV** — Inventory | ADMIN | `/admin/inventory` | PROPOSED | Purpose: stock/adjust/reserve/release/commit/movements + threshold
| User: admin | Entry: sidebar/product-link | Exit: list | Data: GENERATED available read-only; manual movement types only
| Actions: 6 ops + threshold | Permission: `inventory.view/adjust` | Errors: 409-predicate + refetch | Standard admin states
| SEO: noindex | Backend: inventory suite | Impl: NOT IMPLEMENTED | Limits: no recount endpoint; no alerts | Accept: delta-adjust only.

**A-CUST** — Customers (+Detail) | ADMIN | `/admin/customers`, `/admin/customers/[id]` | PROPOSED
| Purpose: reads+writes + addresses + register; history via orders filter | User: admin | Permission: `customers.view` (sole key incl. writes — verified)
| Errors: 401/403/404/409 | Standard states | SEO: noindex | Backend: 4 customer route files | Impl: NOT IMPLEMENTED
| Limits: no metrics | Accept: identity type never confused w/ admin Users.

**A-PROMO / A-COUPON** — Promotions + Coupons | ADMIN | `/admin/promotions`, `/admin/coupons` (+usages/detail) | PROPOSED
| Purpose: promo config (4 types, rules/targets/BXGY) + coupon CRUD/usages | Permission: `promotions.*/coupons.*` | Errors: 422-checkout family + refetch
| Standard states | SEO: noindex | Backend: promo/coupon suites | Impl: NOT IMPLEMENTED | Limits: no analytics/feed/preview
| Accept: autos+coupon server-side only; no invented preview.

**A-USERS (+Detail)** — Users | ADMIN | `/admin/users` (EXISTING list), `/admin/users/[id]` (PROPOSED)
| Purpose: admin identity + roles assignment + password admin-set | Permission: `users.*` (+ceiling/guards; last-admin 409)
| Standard states | SEO: noindex | Backend: users suite | Impl: PARTIALLY IMPLEMENTED | Limits: no MFA/OTP/recovery (B6)
| Accept: provisioning ≠ recovery in copy.

**A-ROLES** — Roles (+Detail incl. read-only Permissions reference) | ADMIN | `/admin/roles`, `/admin/roles/[id]` | PROPOSED
| Purpose: roles + grants + members; permission registry browsable read-only (GET-only under `roles.view`)
| Permission: `roles.*` | Errors: 401/403/404/409 | Standard states | SEO: noindex | Backend: roles + permissions suites
| Impl: NOT IMPLEMENTED | Limits: no permission authoring UI (registry is read-only contract) | Accept: Permissions NOT a separate management screen.

**A-SETTINGS** — Settings | ADMIN | `/admin/settings` | PROPOSED | Purpose: store settings view + value edit
| Permission: `settings.view` (list/one) + `settings.manage` (PATCH value, DB-typed CHECK, audited; 422 on violation)
| Standard states | SEO: noindex | Backend: settings suite | Impl: NOT IMPLEMENTED | Limits: key-scoped (unknown key → 404), no generic config invention
| Accept: per-key edit w/ type errors surfaced.

**A-AUDIT** — Audit Logs | ADMIN | `/admin/audit-logs` (+row) | PROPOSED | Purpose: append-only trail query (filters + UUID-over-tuple cursor)
| Permission: `audit_logs.view` | Errors: 401/403/404 | Standard states | SEO: noindex | Backend: audit suites
| Impl: NOT IMPLEMENTED | Limits: immutable; secret-free | Accept: filters + paging per contract.

## 6. Route Registry

| Route ID | Area | Path | Page | Existing? | Access policy | Dyn params | Data deps (real) | Direct nav | SEO | Not-found behavior | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R-HOME | Store | `/` | S-HOME | NOT EXISTING (boilerplate) | Public | — | products/categories/search | Yes | Indexable | N/A | IN SCOPE |
| R-CATS | Store | `/categories` | S-CATS | Missing | Public | — | categories | Yes | Indexable | Honest empty | IN SCOPE |
| R-CAT | Store | `/c/[id]/[slug]` | S-CAT | Missing | Public | id UUID (fetch), slug display-only | categories, products | Yes (canonical redirect on mismatch) | Indexable canonical | 404 unknown | IN SCOPE |
| R-BRANDS | Store | `/brands` | S-BRANDS | Missing | Public | — | brands | Yes | Indexable | Honest empty | IN SCOPE |
| R-BRAND | Store | `/brand/[id]/[slug]` | S-BRAND | Missing | Public | id + slug as R-CAT | brands, products | Yes | Indexable canonical | 404 unknown | IN SCOPE |
| R-SEARCH | Store | `/search?q…` | S-SEARCH | Missing | Public | q + filters + cursor (URL-held) | search | Yes | Conditional | Guided empty | IN SCOPE |
| R-OFFERS | Store | `/offers` | S-OFFERS | Missing | Public | — | none dedicated | Contextual until feed | Conditional/noindex | Honest empty | CONDITIONAL |
| R-PDP | Store | `/p/[id]/[slug]` | S-PDP | Missing | Public | id + slug as R-CAT | products/variants/images/inventory/codes | Yes | Indexable canonical | 404 unknown/inactive | IN SCOPE |
| R-CART | Store | `/cart` | S-CART | Missing | Guest-XOR-session | — | cart suite | Yes | Private | Gone → fresh mint | IN SCOPE |
| R-CHECKOUT | Store | `/checkout` | S-CHECKOUT | Missing | Owner + non-empty cart | — | addresses/estimate/orders | From cart only (else redirect) | Private | Redirect, never silent fail | IN SCOPE |
| R-CONFIRM | Store | `/order-confirmation/[id]` | S-CONFIRM | Missing | Owner-only | id (display; NOT auth) | orders/[id] | From 201 only | Private | 404 foreign | IN SCOPE |
| R-ORDERS | Store | `/orders` | S-ORDERS | Missing | Session | cursor | GET orders | Authed direct | Private | 401→login | IN SCOPE |
| R-ORDER | Store | `/orders/[id]` | S-ORDER | Missing | Session-owner XOR guest-credential (adapter-held, FP03-G1) | id (display; NOT auth) | orders/[id]+cancel+replacements | Authed OR adapter-credential-held | Private | 401/410/404 per policy | IN SCOPE |
| R-ACCOUNT | Store | `/account` | S-ACCOUNT | Missing | Session | — | session/orders/addresses | Authed direct | Private | 401→login | IN SCOPE |
| R-ADDR | Store | `/addresses` | S-ADDR | Missing | Session | — | addresses | Authed direct | Private | 401→login | IN SCOPE |
| R-LOGIN | Auth | `/login` | S-LOGIN | Missing | Public (away-if-authed) | `next` (validated) | session/identify | Yes | Noindex | Generic errors | IN SCOPE |
| R-REGISTER | Auth | `/register` | S-REGISTER | Missing | Public (away-if-authed) | `next` | register/identify | Yes | Noindex | 409→login | IN SCOPE |
| R-STATIC | Store | `/pages/[slug]` | S-STATIC | Missing | Public | slug (copy-key) | none | Footer/contextual | Conditional | 404 unknown slug | CONDITIONAL |
| R-ALogin | Admin | `/admin/login` | A-LOGIN | EXISTS | Public + session-aware | `next` internal | admin/session | Yes | Noindex | Generic errors | IN SCOPE |
| R-ADash | Admin | `/admin` | A-DASH | EXISTS shell | `orders.view`+`inventory.view` | — | orders/inventory lists | Authed | Noindex | 401→login; 403→forbidden | IN SCOPE (partial) |
| R-AOrders | Admin | `/admin/orders` | A-ORDERS | Missing | `orders.view` | filters+cursor | orders admin | Authed+perm | Noindex | 403→forbidden | IN SCOPE |
| R-AOrder | Admin | `/admin/orders/[id]` | A-ORDER | Missing | `orders.view/update/cancel` per action | id | orders/fulfillment/replacements | Deep-link w/ perm | Noindex | 403→forbidden | IN SCOPE |
| R-ACat | Admin | `/admin/products` | A-CATALOG | Missing | `products.view` (+mut keys per action) | filters+cursor | catalog admin | Authed+perm | Noindex | 403→forbidden | IN SCOPE |
| R-AProd | Admin | `/admin/products/[id]` | A-PRODUCT | Missing | as R-ACat | id | catalog admin | Deep-link w/ perm | Noindex | 403→forbidden | IN SCOPE |
| R-AInv | Admin | `/admin/inventory` | A-INV | Missing | `inventory.view/adjust` | — | inventory | Authed+perm | Noindex | 403→forbidden | IN SCOPE |
| R-ACust | Admin | `/admin/customers[/[id]]` | A-CUST | Missing | `customers.view` | id opt | customers | Authed+perm | Noindex | 403→forbidden | IN SCOPE |
| R-APromo | Admin | `/admin/promotions[/[id]]` | A-PROMO | Missing | `promotions.*` | id opt | promotions | Authed+perm | Noindex | 403→forbidden | IN SCOPE |
| R-ACoup | Admin | `/admin/coupons[/[id]]` | A-COUPON | Missing | `coupons.*` | id opt | coupons | Authed+perm | Noindex | 403→forbidden | IN SCOPE |
| R-AUsers | Admin | `/admin/users[/[id]]` | A-USERS | List EXISTS | `users.*` | id opt | users | Authed+perm | Noindex | 403→forbidden | IN SCOPE |
| R-ARoles | Admin | `/admin/roles[/[id]]` | A-ROLES | Missing | `roles.*` (perm-reg read under `roles.view`) | id opt | roles/permissions | Authed+perm | Noindex | 403→forbidden | IN SCOPE |
| R-ASet | Admin | `/admin/settings` | A-SETTINGS | Missing | `settings.view/manage` | key | settings | Authed+perm | Noindex | 404 unknown key | IN SCOPE |
| R-AAudit | Admin | `/admin/audit-logs[/[id]]` | A-AUDIT | Missing | `audit_logs.view` | id opt | audit-logs | Authed+perm | Noindex | 403→forbidden | IN SCOPE |

Path rules honored: App-Router naming kept; no token/secret/PII in query (guest credential header-only, persisted solely in HttpOnly order cookies per FP03-G1 — never localStorage/URL; `next` same-origin
server-validated); order id ≠ access proof; admin never public-by-obscurity; no middleware assumed (proxy = presence-check
UX guard only, matcher `/admin/:path*`; real decisions server-side); no duplicate routes per function.

## 7. Access control & navigation

Eight contexts (visitor / customer-session / session-unverified / expired-denied / connectivity-unknown / admin-with-key /
admin-without-key / guest-order-credential): verification-error ≠ guest (unknown → Session-Unknown state, never auto-guest);
local data ≠ auth proof; no OTP/forgot/recovery paths. Redirects: preserve safe-`next` (internal same-origin only,
re-check perm at destination, never a grant, no secrets in URL); login-failure stays failure; 403 renders forbidden
(exists) never fake-empty; protected pages never pre-render before verification; no redirect loops (expired → login once
w/ destination). STORE model: header (logo/top-categories/prominent-search/cart/account) + footer + breadcrumbs +
final mobile bottom bar (FP03-C1 CLOSED, owner-delegated): exactly five items in fixed order —
1. Home (الرئيسية → `/`), 2. Categories (الأقسام → `/categories`), 3. Cart (السلة → `/cart`, badge = confirmed-cart
total quantity only, never invented; failed read → stale badge, never fake-empty), 4. Orders (الطلبات → `/orders`;
guest tabs login-gate without losing cart), 5. Account (الحساب → `/account`; login-gated same as Orders).
Search is NOT a bottom item: it is a globally accessible header function (persistent SearchBox on all storefront
screens incl. small viewports; submit-only `q` 2–120; latest-wins; retry keeps query). Selected-item rule: exact route
match where possible (Home on `/`; Categories on `/categories` + `/c/…`; Cart on `/cart`; Orders on `/orders` +
`/orders/[id]` + confirmation-adjacent owner flows; Account on `/account` + `/addresses`); nested PDP/search keep the
nearest entry tab selected without claiming false hierarchy; auth pages select nothing. Login/status effects: guest sees
identical five tabs (Orders/Account login-gate, cart preserved); customer sees same tabs with live state; admin scope
untouched. Loading/empty/error: skeleton per destination; honest empty; 401→login+safe-next; unavailable destination
never fakes success. Responsive: bar applies to small/mobile viewports only (wider screens use header/nav patterns);
RTL logical order home→account with mirrored chevrons only; keyboard roving focus + Arabic accessible names + visible
selected state + 44pt-scale touch targets. FP03-C1 record: previous conflict = FP-00-D007/FP-09-D05 (A) vs FP-04/FP-05/FP-12
Search/Offers-tab claim (B-variant); candidates assessed = A/B/C/D per delegation scorecard (A wins §§core-tasks, redundancy,
backend-support, IA-consistency; B drops Orders for duplicated search; C drops Categories; D gives a permanent slot to a
feed-less Offers); evidence = FP-00-D007 LOCKED + FP-09 D05 + header-search specs (FP-11.1 AC-H7, FP-12 SearchBox) + openapi
absence of offers feed + `src/app` (no nav code to contradict); rejected = B (order-access loss + search redundancy),
C (category-discoverability loss), D (unsupported-feature slot); docs reconciled = FP-04 + FP-12 corrected, FP-09/FP-00
retained; authority = explicit owner delegation in this task (no further approval needed for this choice).
Final status: `RESOLVED — OWNER-DELEGATED DECISION`; search placement and bottom composition no longer confused anywhere. PDP↔listing cross-links; cart indicator from confirmed reads;
checkout journey cart→checkout→confirmation; orders/account via header+deep-links. ADMIN model: existing shell kept;
5 sidebar groups (Operations · Catalog & Stock · Marketing · Customers · System); per-section perm-gated items;
deep-links per §6; denied → forbidden page; post-success/cancel return to list. Link classes distinguished: persistent nav
vs contextual link vs journey step vs auth redirect (vs authorized-external, none currently).

## 7b. Guest-order credential lifecycle (FP03-G1 — RESOLVED OWNER-DELEGATED TECHNICAL DECISION)

Backend contract (source-verified, unchanged): per-order opaque bearer (64-char), SHA-256 hash-only at rest, raw issued
exactly once in the 201 creation body (`guestOrderToken`); replay 200 carries NO token (`meta.replay:true,
guestTokenIssued:false`, keep-same BGGO-D011); sole transport `x-guest-order-token` (never URL — SI-10);
fixed 90d TTL, DB-side expiry, no sliding (`guest-access.ts:29-30`); order binding structural
(token_hash, order_id) so order A's token never authorizes order B; 401 invalid/revoked, 410 expired (GONE),
404 unknown≡foreign/non-guest (masked); read rate buckets (fail-closed 429); revoke/rotate staff-only
(`credential/revoke|rotate` under `orders.update` + audit); no listing, no self-service recovery (BGGO-D012).
Existing frontend evidence: NO adapter exists (sole Server Action file `app/actions/auth.ts` = admin login/logout;
zero guest-token references in `src/app` tsx/actions) ⇒ the adapter below is PLANNED (solution class 3), explicitly
not existing code. BGGO-D014 history preserved: it chose localStorage and rejected cookies as "ambient + clunky";
this amendment supersedes ONLY the order-access-credential storage (cart bearer `x-guest-token` localStorage unchanged,
out of scope): the cookie here is a same-origin storage vessel only — it is never sent to the backend API directly,
the adapter attaches the explicit header per request (non-ambient property preserved); CSRF surface handled via
Server-Action-first mutations + same-origin adapter conventions (no backend CSRF contract invented); XSS posture
improves (secret not JS-readable). Authority: explicit owner delegation in this task.

A. Creation: guest submits the supported creation flow (addressId XOR guestAddress+guestContact + idempotency key);
backend creates + issues; the planned same-origin server adapter (Server Action preferred; Route Handler where page
lifecycle requires) receives the 201 server-side, binds the raw token to the canonical backend-returned order id
(UUID-validated; invalid id ⇒ no cookie, safe error), sets the order cookie, and returns ONLY non-secret confirmation
to the client. UI reports success only after the real 201. Replays reissue nothing.
B. Storage (per-order cookie `__Host-guest-order-<uuid>`; family convention mirrors `__Host-*-session`):
HttpOnly + Secure (HTTPS) + SameSite=Lax (top-level GET navigation carries it; same-origin POSTs carry it; cross-site
blocked — justified by the read/detail + same-origin-mutation flow) + host-only (no Domain) + Path=/ (required by the
`__Host-` prefix; Path is NOT the security boundary — the (hash, order_id) binding + order-keyed name is) +
Max-Age ≤ 90d (never longer than server TTL) + one cookie per order (never shared across orders, sessions, or cart
bearer). Order-id-in-name is display, never secret, never trusted without UUID validation + backend verdict.
C. Direct/reload/new-tab: route `/orders/[id]` identifies intent by id only; server resolves context —
customer-session path unchanged (ownership query), else reads the order's cookie and calls the real backend op with
`x-guest-order-token`; backend verdict alone grants/denies; page renders only authorized data. Refresh/new-tab on the
same browser works via cookies; no silent id-only authorization ever. Detail responses: private, per-request, never in
shared caches (FP-14 rulings 5–8 apply; no `force-cache` on gated reads; no cross-identity/order bleed).
D. Failure states (distinct, contract-mapped): no cookie ⇒ access-required state (login/support paths, no details);
credential rejected (401) ⇒ invalid-or-revoked state + staff path; expired (410) ⇒ terminal-expired state, no retry,
staff rotate path only; unknown/masked (404) ⇒ not-found; cookies unavailable ⇒ unavailable-persistence state with
same safe options; transient backend failure ⇒ retryable error (never conflated with denial); unverifiable context ⇒
Session-Unknown, never auto-guest. Never auto-recreate orders, never re-issue, never self-service recover.
E. Identity interplay: login never links guest orders (never-link stands); logout does NOT clear order cookies
(no approved contract requires it — cookies are order-scoped, not session-scoped; documented lifecycle choice);
account switch leaves order cookies untouched (access still per-cookie verdict); customer-order access without session ⇒
401 path; guest-order access without matching cookie ⇒ access-required path.
F. Multi-order: N orders ⇒ N cookies; selection strictly by requested order id; expiry/deletion per cookie; practical
limits disclosed (per-cookie ~100B–4KB well within 4KB; browser ~180/domain cap ⇒ heavy multi-order browsers degrade to
per-order access-required states, never to cross-order leakage); new devices/cleared data ⇒ credentials gone ⇒ staff
recovery policy (BGGO-D012) is the only path — direct access across devices is NOT guaranteed by design.

What remains: adapter code (Server Action/Route Handler + RSC wiring + cookie set/read) is future implementation work,
not present in `src/`. No backend change made or required.

## 8. State matrix (per screen-type; N/A justified)

Catalog/listing (S-HOME/CATS/CAT/BRANDS/BRAND/SEARCH/OFFERS): initial-loading ✓ · content ✓ · empty-result ✓ (honest, ≠ error)
· no-search-results ✓ (SEARCH) · error+retry ✓ · session states N/A (public — no auth to expire) · mutation-pending N/A
(except filter-refetch → stale/refreshing ✓) · not-found ✓ (unknown UUID) · partial-data only where contract allows
(card enrichment from fetched rows only). PDP: loading ✓ · content/OOS-visible ✓ · variant-unavailable ✓ · not-found ✓ ·
image-missing ✓ (placeholder, layout-stable) · price/stock-moved ✓ (re-read disclosure) · mutations (add) pending/success/
rejected ✓ + ambiguous-timeout ✓ (re-read-first). Cart: loading ✓ · empty-guided ✓ · lined ✓ · line-pending ✓ ·
server-moved ✓ · modify-failed ✓ · ambiguous ✓. Checkout: address-entry ✓ · field-validation ✓ · estimate-preview ✓
(dry-run) · submit-pending ✓ · rejected (409 ladder) ✓ · ambiguous ✓ · success-only-on-201 ✓. Account/orders: loading ✓ ·
content/empty ✓ · 401-required ✓ · 403-denied (admin) ✓ · session-unknown ✓ · expired ✓ · mutation pending/success/rejected ✓
(addresses) · not-found ✓ (foreign≡unknown) · refreshing ✓. Admin: loading ✓ · data/empty ✓ · perm-denied ✓ · session-expired ✓ ·
row-pending ✓ · confirmed-success ✓ · 409-conflict ✓ (refetch-first; destructive never blind) · ambiguous ✓ (same rules as store).
No invented HTTP/domain codes; guest-credential 401/410 + staff-path surfaced in S-ORDER.

## 9. SEO, Analytics (planned), Responsive/RTL

SEO: indexable = S-HOME/CATS/CAT/BRANDS/BRAND/SEARCH(qualified)/PDP (+S-STATIC-if-approved-copy); private/noindex = cart/
checkout/confirmation/orders/account/addresses/login/register + all admin + error/auth surfaces; conditional = S-OFFERS,
R-SEARCH empty/invalid, S-STATIC-unapproved. Public pages need title/desc/canonical (slug-mismatch → canonical redirect);
never invent product info/prices; never index PII; structured data only where approved (none assumed).
Analytics (PLANNED — no provider installed/approved; never secrets/PII/tokens/phones/full carts in events; attempt vs
confirmed split): home_viewed, category/brand_viewed, filters_applied, search_submitted, search_no_results, product_viewed,
variant_selected, add_to_cart_attempted/confirmed, cart_viewed, checkout_started, order_creation_confirmed(201),
order_confirmation_viewed, orders/order_viewed, cancel_confirmed, replacement_decided, address_saved, account_viewed,
authentication_result, static_page_viewed, error_shown(code-only). No library added.
Responsive/RTL: Tailwind v4 existing system reused (no new breakpoints; FP-10/FP-11.9 govern visuals); mobile guarantees —
search/nav reachable, grids collapse, price/offer legible, PDP sticky actions, cart/checkout usable one-handed, admin tables
scroll/card-fallback, dialogs sheets, errors readable; keyboard must not cover checkout CTA; RTL logical properties, mirrored
chevrons only, trail/timeline/step order mirrored, password/email/code fields LTR-safe, mixed `152 ج.م` phrasing reviewed.

## 10. Screen→API traceability (endpoints real; FP-13 normative for operation detail)

Discovery: `GET catalog/products|categories|brands` (+`[id]`) → S-HOME/CATS/CAT/BRANDS/BRAND. Search: `GET catalog/search`
(+`codes/lookup` where linked) → S-SEARCH. Detail: `GET products/[id] + /variants + /images + inventory products|variants/[id]`
→ S-PDP (+S-OFFERS-derivable only). Cart: `GET|POST /cart, POST|DELETE items, PATCH items/{variantId}, POST merge|reprice`
→ S-CART (guest-XOR-session). Checkout: addresses CRUD + `POST orders/estimate` + `POST orders` (+idempotency header/body)
→ S-CHECKOUT/S-CONFIRM. Orders: `GET orders|orders/{id}, POST cancel, replacements GET|decide` → S-ORDERS/S-ORDER
(session-owner XOR guest-credential). Identity: `POST identify|register|session, DELETE session, PATCH password` →
S-LOGIN/S-REGISTER/S-ACCOUNT (+S-ADDR). Admin: 60 routes per FP-09 §G (catalog/inventory/orders+fulfillment/replacements/
customers/promotions/coupons/users/roles/permissions-GET/settings/audit/session) → A-* screens per §5 (permissions GET-only
merged into A-ROLES). Unsupported-blocking: offers-feed (S-OFFERS conditional), price/popularity-sort, autocomplete,
reviews/related/favorites, batch, payments/refunds, OTP/reset, upload/CSV/scale, zones/drivers/tracking/notifications,
profile-PATCH, metrics — none routed as ready. Evidence is static (contract+code read); no live verification this task;
no API invented.

## 11. Screen verdicts (§16 applied)

IN SCOPE — SPECIFIED: S-HOME/CATS/CAT/BRANDS/BRAND/SEARCH/PDP/CART/CHECKOUT/CONFIRM/ORDERS/ORDER/ACCOUNT/ADDR/LOGIN/REGISTER/
ERROR + all A-* (§4). CONDITIONAL: S-OFFERS (feed/facet), S-STATIC (approved copy). MERGED: Replacements→S-ORDER(+A-ORDER);
Tracking→S-ORDERS/S-ORDER; Permissions→A-ROLES. NOT A SEPARATE ROUTE: Tracking. OUT: Forgot Password (no backend).
DEFERRED: none as screen (deferred capabilities listed §10 instead). UNVERIFIED: none blocking (residuals in §12).

## 12. Decision register + remaining gaps

| ID | Decision | Evidence | State | Build impact |
|---|---|---|---|---|
| FP03-C1 | Bottom-nav Option A final (Home/Categories/Cart/Orders/Account + header search); FP-04/12 Search/Offers-tab variants retired | FP-00-D007 LOCKED + FP-09 D05 + delegation scorecard (§7) | RESOLVED — OWNER-DELEGATED DECISION (no further approval) | Build §7 contract; FP-04/FP-12 corrected |
| FP03-G1 | Guest-order credential: planned same-origin adapter + order-scoped HttpOnly cookies; amends BGGO-D014 storage for order credential only | guest-access.ts + orders route/writes + openapi 114/688-740 + delegation (§7b) | RESOLVED — OWNER-DELEGATED TECHNICAL DECISION (adapter = future implementation) | Build §7b lifecycle; no backend change |
| FP03-C2 | Offers slot kept; page content constrained (honest-empty launch OK) | FP-09 D02 + FP-04/05/12 + FP-11.1 D04 | RESOLVED (conditional) | No feed work in frontend scope |
| FP03-D1 | URL id/slug contract (UUID fetch; slug display-only; canonical redirect; stale work) | FP-09 D01; schema CHECKs | LOCKED-kept | SEO + routing without new endpoints |
| FP03-D2 | Brands included | FP-09 D08; endpoints verified | LOCKED-kept | Discovery scope fixed |
| FP03-D3 | No mega-menu; simple nav + categories page | FP-09 D03 | LOCKED-kept | Header complexity bounded |
| FP03-D4 | Keyset pagination + Load More + URL-held filters/cursor | FP-09 D04; FP-13 §1.1 | LOCKED-kept | All listings uniform |
| FP03-D5 | Stepped checkout + XOR + idempotency rules | FP-09 D06; FP-11.5; FP-13 §5 | LOCKED-kept | Conversion flow fixed |
| FP03-D6 | Safe-next + back-restore | FP-09 D07+§F | LOCKED-kept | Auth UX fixed |
| FP03-D7 | Guest credential separation + never-in-URL | FP-09 D09; guest-access.ts | LOCKED-kept | Tracking UX fixed |
| FP03-D8 | Admin groups + operational-KPIs-only + exclusions | FP-09 D10/D11/D12 | LOCKED-kept | Admin scope fixed |
| FP03-D9 | Permissions read-only merged into Roles; Settings per-key editable; no product hard-delete | openapi 1592-1643; FP-11.11 B7 | Resolved by contract evidence | 3 admin-screen shapes fixed |
| FP03-D10 | Dual-policy single route for S-ORDER; confirmation separate from tracking | FP-09 §§B/E; FP-11.6 | Resolved by contract | Route count fixed |
| FP03-D11 | Static pages conditional on approved copy; auth/analytics as planned-only | No backend dep; no provider | Resolved (conditional) | Launch gates fixed |

Remaining gaps (non-blocking unless noted): approved Arabic copy for S-STATIC (blocks those pages only); S-OFFERS feed/facet
(optional); actual category-tree depth (convention already safe); admin KPI exact composition (implementer binds real lists).
Nothing above blocks specified screens' implementation.

## 13. Closure check (§17)

(1) prior IA reviewed + kept §1 ✓; (2) STORE+ADMIN sitemaps §§3–4 ✓; (3) Route Registry §6 (current vs proposed distinguished;
`src/app` reality stated) ✓; (4) Screen Registry §5 (all fields present/N/A-justified/UNVERIFIED-marked) ✓; (5) fields complete ✓;
(6) auth/perm/guest contexts per screen ✓; (7) every API-dependent screen bound §10 ✓; (8) unsupported never shown ready ✓;
(9) loading/empty/error/perm/responsive/RTL/SEO/analytics per nature ✓; (10) no circular/illogical routes; FP03-C1/C2/G1 resolved ✓;
(11) acceptance criteria per screen ✓; (12) implementation vs specification separated throughout ✓; (13) open items w/ impact ✓;
(14) no implementation/testing claimed ✓.

**Final status: `DECISIONS CLOSED WITH EXPLICIT IMPLEMENTATION LIMITATIONS`** — both delegated decisions closed
(FP03-C1 nav final §7; FP03-G1 adapter architecture §7b); limitations = static-evidence only (no live run), adapter code
unimplemented (future work), multi-order cookie caps + cross-device non-portability as documented, S-OFFERS/S-STATIC
conditional as recorded.

---

*End of FP-03 — specification-only, no implementation.*
