# FP-09 — Information Architecture & Navigation (Final)

> Status vocabulary: `CLOSED` (contract/locked-doc decided, no approval needed) ·
> `RECOMMENDATION_PENDING_OWNER_APPROVAL` (agent recommendation, owner must approve) ·
> `BLOCKED` (cannot proceed: missing contract/permission, documented only) ·
> `OPEN` (unresolved, needs input) · `OUT OF CURRENT SCOPE` (classified future, excluded from nav).
> Evidence tags: VERIFIED (read in-repo this phase) · NOT VERIFIED (could not confirm here).
> Brand Strategy v1 + VI-01 + color contract respected as LOCKED; nothing reopened.

## A. Scope and Status

- Goal: IA + navigation + route behavior for storefront and admin, reviewable before any screen work.
- Analyzed: openapi.yaml (98 paths, counted 2026-10-08), App Router tree, auth/guest/cart/checkout/orders/replacements/RBAC contracts, FP-00/BRAND/BG governance.
- Out of scope: UI implementation, CSS/components, typography/spacing/radius/tokens, packages, DB/migrations, deploy, commits.
- Phase state: closed under owner delegation (see §I). Seven prior pending decisions + two design
  sub-choices resolved; backend gaps stay documented as BLOCKED/OUT OF SCOPE, never as ready features.

## B. Storefront Sitemap

| Route | Purpose | Access | Data source | Support | Error behavior | Notes |
|---|---|---|---|---|---|---|
| `/` | Home: hero, categories, offers, featured, trust/delivery info, footer | Public | catalog/products, categories, search, images | PROPOSED page / VERIFIED APIs | empty sections hidden, never fake data | No more carousels than needed |
| `/search` | Results + filters/sort/pagination | Public | `GET catalog/search` (q≥2, relevance/newest) | PROPOSED / VERIFIED | empty query → guided empty state; short/invalid → 400-mapped message | Server-side only; never bulk-load |
| `/categories` → `/c/[id]/[slug]` | Browse + subtree listing | Public | `GET categories`, `GET products?category=` | CLOSED — OWNER-DELEGATED / VERIFIED | empty category → honest empty state | UUID fetched via existing endpoints; slug display-only + canonical redirect on mismatch; stale slugs keep working (D01) |
| `/brands` → `/brand/[id]/[slug]` | Brand discovery | Public | `GET brands`, `brands/[id]`, products `?brand=` | CLOSED — OWNER-DELEGATED / VERIFIED | same as categories | Included: endpoints verified (D08) |
| `/p/[id]/[slug]` | Full detail: images, price/compare-at, variant/weight selector, stock, add | Public | products/[id], variants, images, inventory/products|variants/[id], codes/lookup | CLOSED — OWNER-DELEGATED / VERIFIED | unknown/inactive → not-found; OOS stays visible, add disabled |
| `/offers` | Discounted products | Public | No dedicated endpoint (VERIFIED absent) | BLOCKED BY BACKEND CAPABILITY (D02) | not a launch page; no nav entry | List/detail payloads carry no variants/prices (`toProductListItem`/`ProductDetail` VERIFIED); compare-at appears only on per-product variant fetches — page would need unbounded N+1 scan. Card-level old/new price allowed only from already-fetched variant data with real backend values |
| `/cart` | Guest/registered cart + reprice | Public (both flows) | cart CRUD, merge, reprice, estimate | PROPOSED / VERIFIED | expired/consumed cart → recover by minting fresh | Draft only; price/stock revalidated |
| `/checkout` | Steps: info → address → delivery/fee → COD → review → confirm | Public w/ non-empty cart | orders create, addresses, settings fee, estimate, coupons | PROPOSED / VERIFIED | stock/price/address errors mapped; no success shown before 201 | addressId XOR guest payload; idempotency key per attempt |
| `/order-confirmation/[id]` | HM number + summary | Owner (session or guest token) | orders/[id] | PROPOSED / VERIFIED | foreign/unknown → 404, no leakage | — |
| `/login`, `/register` | Phone+password session; registration | Public | session, register, identify | PROPOSED / VERIFIED | wrong/locked → generic message | No OTP (contract) |
| `/account`, `/addresses`, `/orders`, `/orders/[id]`, `/settings` | Profile/addresses/history/tracking/replacements/password | Authenticated | customers, orders, replacements decide, password | PROPOSED / VERIFIED_contracts | 401→login+safe next; 404 foreign | Profile-name edit: BLOCKED (no storefront PATCH — G003) |
| `/orders/[id]` (guest deep link) | Tracking via stored token | Guest credential | orders/[id] + `x-guest-order-token` | PROPOSED / VERIFIED | no/invalid token → login prompt; expired → 410 guidance; never token in URL | Lost token → support recovery only |

## C. Admin Sitemap

| Section | Pages | Permission | Support |
|---|---|---|---|
| Login | `/admin/login` | public + session-aware | AVAILABLE (exists) |
| Dashboard | `/admin` KPIs: today/pending/preparing/delivery/low/OOS (no revenue) | orders.view + inventory.view | PARTIAL (BO LOCKED: revenue BLOCKED, no report endpoints) |
| Orders | `/admin/orders` (status/customer/number/date filters) → `/admin/orders/[id]` (details + prep tabs + replacements + history) | orders.view; transitions orders.update; cancel orders.cancel | AVAILABLE |
| Preparation | Same detail page: prepare/pick/unavailable/ready/dispatch/deliver + propose/withdraw/auto-accept | orders.update (+cancel key for cancel) | AVAILABLE |
| Catalog | `/admin/products` → `/[id]` (variants/codes/images/price+history) | products.view/create/update/delete, prices.view/update | AVAILABLE (no hard product delete — disable via isActive) |
| Inventory | `/admin/inventory` (stock/adjust/reserve/release/commit/movements) | inventory.view/adjust | AVAILABLE (no recount endpoint; delta-adjust only) |
| Customers | `/admin/customers` → `/[id]` (addresses/register) | customers.view (VERIFIED across all 4 route files incl. writes — sole customers key) | AVAILABLE reads+writes; history via orders filter |
| Promotions | `/admin/promotions`, `/admin/coupons` (+usages) | promotions.*/coupons.* | AVAILABLE |
| Delivery ops | Status flips only | orders.update | PARTIAL (no zones/drivers — G006) |
| System | `/admin/users`, `/admin/roles`, `/admin/settings`, `/admin/audit` | users.*, roles.*, settings.*, audit_logs.view (VERIFIED in both audit route files) | AVAILABLE |
| Excluded from nav | Bulk import, revenue reports, delivery zones/drivers, payments/refunds, notifications inbox | — | OUT OF CURRENT SCOPE (no endpoints; seeded keys unused) |

Existing pages today: `/admin/login`, `/admin`, `/admin/users` (VERIFIED). Everything else PROPOSED.

## D. Navigation Model

- **Header (desktop, persistent):** logo · top categories · prominent search · cart w/ count · account. No mega menu (D03 CLOSED — OWNER-DELEGATED); no offers entry until a backend feed exists (D02 BLOCKED).
- **Footer:** categories, trust/delivery info, contact (content approved later), store meta.
- **Breadcrumbs:** category trail + product; account + order trail; admin section trail.
- **Admin sidebar groups:** Operations (dashboard/orders) · Catalog & Stock (products/inventory) · Marketing (promotions/coupons) · Customers · System (users/roles/settings/audit). Active-section clarity; secondary items collapsed.
- **Mobile:** compact header + always-reachable search; bottom nav Home/Categories/Cart/Orders/Account (D05 CLOSED — OWNER-DELEGATED; guest tabs login-gate without losing cart); filters in drawer/bottom-sheet; smart back (returns to preserved results); sticky add-to-cart/checkout + large weight-stepper targets; no duplicated functions across positions.
- **Active states** on nav + sidebar; **Back/Forward** safe (state in URL, no junk history entries); **direct URL** works per access rules; **loading skeletons / empty (not error) / error+retry / 401→login / 404 / 403** states per route.

## E. Route and Access Matrix

| Route | Level | Login? | Permission / mechanism | Denied behavior |
|---|---|---|---|---|
| `/`, `/search`, `/c/*/*`, `/p/*/*`, `/brands*` | Public | No | — | n/a (OOS content still rendered, disabled) |
| `/cart` | Public | No (guest token or session) | cart ownership XOR | expired → fresh cart |
| `/checkout`, `/order-confirmation/*` | Owner | Cart non-empty; session or guest context | order create/inspect rights | unmet conditions → redirect, never silent fail |
| `/login`, `/register` | Public | No (redirect away if authed) | — | — |
| `/account/*`, `/orders*` | Authenticated | Yes (session) | ownership-scoped reads | 401 → login+safe next; foreign → 404 |
| Guest `/orders/[id]` | Guest | Token (localStorage + header) | order-bound credential; 90d TTL | 401 invalid/revoked; 410 expired (+support path) |
| `/admin/login` | Public | Session-aware redirect | — | — |
| `/admin/*` | Admin | Yes + per-section key (§C) | server RBAC per request | 401 → login; 403 → forbidden page (exists) |

## F. URL State Contract

- **In URL (shareable/restorable):** `q`, `category`, `brand`, `minPrice`, `maxPrice`, `inStock`, `type`, `sort` (only backend-supported: `name/created_at`, `relevance/newest`), `cursor` (opaque keyset; malformed → 400-mapped), `limit` (1..100, default 20).
- **Cursor rules:** `take limit+1`, `nextCursor null` = end; keep filter+sort stable across pages (no duplicates); next-page failure → inline retry, state preserved.
- **Never in URL:** tokens/secrets (guest order token, session material), PII beyond discovery filters, idempotency internals.
- **Safe `next`:** internal same-origin paths only (server-validated); external/unknown/protocol-relative → default (`/account` or `/`); never a privilege grant; re-check permission at destination; expired sessions land on login with destination preserved when safe.
- **Back behavior:** product→results restores query+filters+sort+scroll position; no redundant history entries (replace on filter typing where apt).

## G. Backend Dependency Matrix (all endpoints VERIFIED present in openapi.yaml)

| Feature | Endpoint + method | Auth | Limits |
|---|---|---|---|
| Discovery/list/detail | `GET catalog/products`, `products/{id}`, `products/{id}/variants`, `variants/{id}`, `categories`, `brands` + `[id]` | public | sorts name/created_at only; cursor pages; no price/popularity sort |
| Search/codes | `GET catalog/search` (q≥2), `GET codes/lookup` | public | relevance/newest; OOS kept unless `inStock=true` |
| Images/availability | `GET products/{id}/images`, `GET inventory/products|variants/{id}` | public | gallery (sort_order,id); stock via GENERATED available |
| Cart | `GET/POST cart`, `POST/DELETE items`, `PATCH items/{variantId}`, `POST merge`, `POST reprice` | guest-token XOR session | draft only; merge on login; dead lines dropped+reported |
| Checkout/pricing | `POST orders` (addressId XOR guestAddress+guestContact; idempotency key; 409 on reuse-with-change), `POST estimate` | session or guest-cart | fee server-read (20.00); coupon states explicit |
| Orders/tracking | `GET orders`, `GET orders/{id}`, `POST cancel`, `GET replacements`, `POST decide` | session-owner or order-bound guest token (410 expired) | cancel unpicked-only; picked → 409 |
| Identity/addresses | `POST identify/register/session`, `DELETE session`, `PATCH password`, addresses CRUD | mixed | no storefront profile PATCH (G003 BLOCKED) |
| Admin ops | 60 routes: catalog/inventory/orders+fulfillment/replacements/customers/promotions/coupons/users/roles/settings/audit/session | per-key RBAC | as §C; seeded-but-unused keys (delivery.*, reports.*, notifications.*) map to nothing |
| Absent (OUT OF CURRENT SCOPE) | delivery zones/drivers/fees-by-area, payments/refunds, bulk import, revenue reports, notifications inbox, price sort, popularity | — | must not appear in nav as ready features |

## H. Responsive Behavior

- Desktop ≥ wide: full header, inline filters (collapsible), tables in admin, multi-column PLP (density is a visual-system call, not fixed here).
- Tablet: condensed header, drawer filters, admin tables scroll or card-fallback.
- Mobile: bottom nav, drawer filters/sheets, sticky commerce actions, card lists, touch-sized steppers; keyboard must not cover checkout inputs/CTA (viewport-aware layout rule, no CSS values fixed here).

## I. Decision Register D01–D12

| ID | Decision | Evidence reviewed | Final | Status + reason | Impact |
|---|---|---|---|---|---|
| D01 | Product/category/brand URL shape | Slugs unique+formatted VERIFIED (schema + migration CHECKs); detail routes UUID-only, no slug lookup VERIFIED; slugs present in list/search/detail payloads VERIFIED (`serialize.ts`, `search.ts`) | `/p/[id]/[slug]`, `/c/[id]/[slug]`, `/brand/[id]/[slug]`: UUID fetched via existing endpoints; slug display-only + canonical redirect on mismatch; stale slugs keep working; unknown UUID → 404; no slug endpoint invented; no cached-list resolution | CLOSED — OWNER-DELEGATED DECISION (stable-identifier + readable-slug pattern; slug edits = CMS discipline) | SEO + PDP routing |
| D02 | Offers page | No offers endpoint VERIFIED; `compareAtPrice` exists ONLY on per-variant payloads, never in list/detail shapes VERIFIED (`serialize.ts:68-122`) | No launch-effective `/offers` page and no nav entry. Page = BLOCKED BY BACKEND CAPABILITY (would require unbounded N+1 scan). Card-level old/new price allowed only from already-fetched variant data with real backend values; no fake discounts. Future support needs a dedicated feed/facet contract (backend work, out of scope). Amended by owner-delegated FP-03 closure (FP03-C1/C2): entry slot retained in desktop header/contextual surfaces per FP-00-D007 with BACKEND-CONSTRAINED honest-empty content; no bottom-tab slot; page still BLOCKED as launch-effective. | BLOCKED — BACKEND CAPABILITY MISSING (policy part of the decision is CLOSED — OWNER-DELEGATED) | Marketing nav |
| D03 | Mega menu | Unbounded depth + cycle guard VERIFIED; actual depth NOT VERIFIED | No mega menu. Simple category nav + `/categories` page; keyboard-safe accordions/menus; hover never sole mechanism; desktop/mobile same information model | CLOSED — OWNER-DELEGATED DECISION (revisit only on verified deep-tree evidence) | Header complexity |
| D04 | Pagination + result display | Opaque cursors, limit 1..100/20, take+1, sorts enumerated VERIFIED | Contract CLOSED (unchanged). Convention CLOSED — OWNER-DELEGATED: Load More over cursor; URL holds filter+sort+cursor; end/duplicate/error rules per §F; state restored on back; direct links restorable | CLOSED — OWNER-DELEGATED DECISION | All listing UX |
| D05 | Mobile bottom nav | No existing mobile nav (VERIFIED: no mobile components) | Home/Categories/Cart/Orders/Account; identical tabs for guests (orders/account login-gate without losing cart); active-tab clarity | CLOSED — OWNER-DELEGATED DECISION | Mobile shell |
| D06 | Checkout model | XOR address contract, idempotency 409, estimate, fee, coupon states VERIFIED | Contract CLOSED (unchanged). Stepped checkout (info/address → delivery/fee → COD → review → confirm) CLOSED — OWNER-DELEGATED: per-step data rules; prices/stock revalidated pre-create; drift/shortage/address errors mapped; actual-weight shown post-prep; confirmation only after 201; no payment/delivery-service assumptions | CLOSED — OWNER-DELEGATED DECISION | Core conversion |
| D07 | Safe `next` | No existing mechanism VERIFIED (admin hardcodes `/admin`) | Strict same-origin internal-path policy CLOSED — OWNER-DELEGATED: server-validated; external/unknown/protocol-relative → safe default; permission re-checked at destination; never a grant; no sensitive data in URL. Policy/documentation decision — auth implementation untouched | CLOSED — OWNER-DELEGATED DECISION | Auth UX |
| D08 | Brands pages | Index + detail endpoints VERIFIED | Include `/brands` + `/brand/[id]/[slug]` (same id/slug pattern as D01); unknown → 404 | CLOSED — OWNER-DELEGATED DECISION | Discovery |
| D09 | Guest token handling | Header + 90d TTL + SQL-side expiry + 401/410 + revoke/rotate VERIFIED in code; localStorage per locked governance | As implemented; recovery = support/rotate only; token never in URL/logs/errors | CLOSED (locked design, implemented) | Tracking UX |
| D10 | Admin KPIs | List endpoints + keys VERIFIED; revenue/report endpoints absent VERIFIED | Operational KPIs only (status counts, low/OOS via list+inventory); revenue BLOCKED | Supported part CLOSED; revenue BLOCKED (backend gap) | Dashboard scope |
| D11 | Admin sidebar | 60 admin routes + seed keys VERIFIED; `customers.view` VERIFIED across all 4 customer route files (reads+writes); `audit_logs.view` VERIFIED in both audit route files | Grouping per §C/D: Operations · Catalog & Stock · Marketing · Customers · System | CLOSED — OWNER-DELEGATED DECISION | Admin shell |
| D12 | Advanced ops | All absent VERIFIED (delivery/payment/bulk/reports/notifications; 6 future tables unimplemented) | OUT OF CURRENT SCOPE; excluded from nav; documented, not built | CLOSED (classification) | Roadmap honesty |

> Discrepancy note (§5 of the closing brief): the prior report listed 7 pending recommendations
> (D01, D02, D03, D05, D07, D08, D11) plus 2 design sub-choices under decided contracts
> (D04 load-more convention, D06 stepped-checkout model) — 9 identifiers total, not "7 decisions".
> D04/D06 contracts were never undecided; only their UI conventions were. Above, every item is
> now closed under delegation except backend-missing capabilities, which stay BLOCKED/OUT OF SCOPE
> (a documentation state, not an owner approval wait). No `OWNER APPROVAL PENDING` remains in scope.

## J. Risks and Constraints

N+1 product-card enrichment (price/stock/image on separate calls — batch+cache+skeletons) · offers page BLOCKED (no feed; card-level compare-at only from fetched variant data) · weight-step 422s (preset-per-product validation) · guest token loss = access loss (support-only recovery) · admin permission keys verified this phase (customers.view incl. writes, audit_logs.view; remaining keys per-route at build) · cursor/bookmark fragility across data change (tolerate, re-anchor) · no silent price/stock/permission assumptions in UI (backend decides).
