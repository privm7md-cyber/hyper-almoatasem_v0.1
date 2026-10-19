# CURRENT SITE CONTENT GAP AUDIT — Hyper Al-Moatasem (2026-10-14)

> READ-ONLY audit. No source, test, config, or historical file was modified; no DB writes,
> commits, pushes, deployments, or settings changes. Only this report file is new.

## 1. Executive Summary

The site is a genuinely data-driven storefront + admin platform (no mock/demo content
anywhere — verified by grep history and honest empty/error states), but it is **content-thin
by owner-side absence, not by code absence**: zero supporting/policy pages exist (footer =
Home + Search only, deliberately — `store-footer.tsx:1-2`), no public offers feed exists
(approved omission FP03-C2), and live data could not be inspected (local DB down; Preview
behind Vercel SSO). Strongest confirmed facts: honest degradation per section, backend-owned
prices/totals, per-order guest-credential custody with zero client leakage, RBAC gates on
all 21 admin pages, keyset-20 pagination everywhere. Biggest uncertainties requiring owner
input: all policy/supporting content, offers-feed intent, guest-order discoverability, and
the actual catalog fullness in staging/production.

## 2. Audit Scope and Evidence

- Repo `D:\Hyper_el-moatasem` · branch `preview/fe11-fe13-verified` · HEAD `7596ac7…`
  (parent `83253fe9…`); tree: 2 pre-existing M + 2 excluded untracked (handoff protected).
- Environments: local (PostgreSQL down — `pg_ctl: no server running`, 0 processes; restart
  prohibited) and Vercel Preview `…ho6uoceuv…` — **still SSO-walled** (rechecked: HTTP 200,
  `<title>Login – Vercel</title>`). No anonymous live rendering possible.
- Methods: source inspection (routes/components/adapters/contracts), prior test reports
  (vitest 119/119 mocked; Playwright 11/11 DB-independent + 37/37 DB-up history), 5 local
  screenshots from FE-13 (DB-down honesty states), read-only HTTP title check.
- **Source-level vs browser-level:** statuses below say which; nothing is claimed visually
  that was not rendered (FE-13 shots) or previously screenshotted.

## 3. Current Website Route Inventory

| Route family | Area | Purpose (evidenced) | State rendered | Data source | Interactions | Status |
|---|---|---|---|---|---|---|
| `/` homepage | Storefront | Hero + categories + featured + index links (`page.tsx`) | Static hero; per-section live/error/empty | Backend reads; static approved copy | Browse/search links | PRESENT, PARTIALLY VERIFIED (no live data views) |
| `/search` | Storefront | Query + filters/sort + keyset load-more | Guided empty + results + honest error | `searchProducts` (pg_trgm) | Full filter/sort/paginate | PRESENT, PARTIALLY VERIFIED |
| `/categories`, `/c/[id]/[slug]` | Storefront | Category index + product listing | Listings + empty/error | Backend reads | Browse/filter/paginate | PRESENT, PARTIALLY VERIFIED |
| `/brands`, `/brand/[id]/[slug]` | Storefront | Brand index + product listing | Same pattern as categories | Backend reads | Browse/paginate | PRESENT, PARTIALLY VERIFIED |
| `/p/[id]/[slug]` | Storefront | Detail + gallery + variant/weight select + purchase | Detail states; OOS visible w/ approved state | Backend reads | Select qty/weight, add to cart | PRESENT, PARTIALLY VERIFIED |
| `/cart` | Customer | Bearer cart review + coupon entry + reprice | Echo rows + estimate preview + errors | Cart/estimate endpoints | Edit qty, coupon, reprice | PRESENT, PARTIALLY VERIFIED |
| `/login`, `/register` | Customer | Phone+password auth (anti-oracle 401) | Forms + validation; no OTP/reset (deferred) | Session endpoints | Login/register | PRESENT, PARTIALLY VERIFIED |
| `/account[/addresses]` | Customer | Profile + address CRUD + default | Lists + forms + errors | Customer endpoints | Full address mgmt | PRESENT, PARTIALLY VERIFIED |
| `/checkout`, `/order-confirmation/[id]` | Customer/guest | Identity/address review + idempotent create | Estimate preview; confirm from readable order only | Estimate + create endpoints | Place order (NOT live-executed) | PRESENT, PARTIALLY VERIFIED |
| `/orders`, `/orders/[id]` | Customer/guest | History/detail/refresh/replacements/decide/cancel | Session list; guests → login guidance; dual-policy detail | Order reads + adapters | Refresh/decide/cancel (NOT live-executed) | PRESENT, PARTIALLY VERIFIED |
| `/admin/**` (21 pages) | Admin | Shell/login/dashboard + 10 domains | Gated pages + CRUD shells + read-only audit/permissions | Admin endpoints + direct lib reads | Full admin ops (NOT live-executed) | PRESENT, PARTIALLY VERIFIED |
| `/prototype/**` | Internal | Mock-scope prototype (bannered) | Mock data, labeled | Hardcoded mock | Demo only | PRESENT BUT PLACEHOLDER/MOCKED (by design, excluded from release) |
| `/_not-found`, `/error`, `/forbidden` | Shared | 404 + boundaries | Arabic 404 + safe reset, no internals | Static | Navigate/retry | PRESENT AND VERIFIED (source + shots) |
| `/about`, `/contact`, `/faq`, `/delivery`, `/privacy`, `/terms`, … | — | — | **Do not exist** (no routes, no footer links) | — | — | MISSING → AUD-001 |

Mobile bottom nav: 5 items (FP03-C1); **Orders item disabled "(قريبًا)"** (`store-nav.tsx:20-28`) → AUD-003.

## 4. Content and Data Inventory

| Type | Source of truth | Availability | Consumers | Authoritative? | Issues |
|---|---|---|---|---|---|
| Categories/brands/taxonomy | Catalog tables via API | Contract-backed; live rows UNVERIFIED (DB down) | Home, listings, filters, PDP | Backend yes | AUD-006 (fullness unknown) |
| Products/variants/prices | Catalog + variant rows; decimals as exact strings | Contract-backed; live UNVERIFIED | Cards, PDP, cart, checkout | Backend yes | None in mapping; AUD-006 |
| Images | Media tables; truthful fallback ("صورة المنتج") | Fallback VERIFIED; coverage UNVERIFIED | Cards, gallery | Backend yes | Missing images render honestly — no gap |
| Units (PIECE/WEIGHT), steps, presets | Catalog contract; weight payloads verified in code | Contract-backed | PDP, cart, checkout | Backend yes | AUD-007 (per-product presets live-UNVERIFIED) |
| Inventory/availability (in/oos/unknown) | GENERATED DB values, never recomputed | Contract-backed | Cards, PDP, guards | Backend yes | None — OOS stays visible per contract |
| Promotions | Promo tables + pricing engine | Admin CRUD VERIFIED (source); **no public feed** (FP03-C2 omission) | Prices silently (no UI explanation) | Backend yes | AUD-002, AUD-004 |
| Coupons | Coupon tables + estimate/preview | Contract-backed; code-entry at cart/checkout | Cart/checkout via estimate | Backend yes | None in mapping |
| Search/filter fields | pg_trgm similarity + structured filters | Contract-backed; live relevance UNVERIFIED | `/search`, listings | Backend yes | AUD-008 |
| Delivery fee/settings | Estimate endpoint (storefront); settings keys backend-internal | Estimate VERIFIED (source); settings→storefront effect UNVERIFIED | Checkout totals | Backend yes | AUD-005 |
| Hero/copy/footer | Approved static strings | Present | Home, footer | Approved static | None — approved |
| Policy/supporting content | **No source exists** | Absent | — | — | AUD-001 |
| Catalog scale (20k+) | Keyset-20 pattern everywhere; no full loads | Pattern VERIFIED | All listings | n/a | None in code |

No MOCK/DEMO data outside `/prototype`; no FRONTEND HARDCODED BUSINESS VALUE found
(prices/totals/fees all server-sourced; static strings are approved copy).

## 5. Homepage Section Audit (rendered order, `src/app/page.tsx`)

1. **Header** (wordmark + search island): BACKEND-independent; renders always. VERIFIED (shots).
2. **Hero** (static approved promise): APPROVED STATIC. VERIFIED.
3. **الأقسام** (categories grid → `/c/…` links): BACKEND-SOURCED; empty/error honest. PARTIALLY VERIFIED (no live rows seen).
4. **منتجات من المتجر** (recent picks, explicit no-bestseller copy): BACKEND-SOURCED; honest states. PARTIALLY VERIFIED.
5. **Index links** (`/categories`, `/brands`): static, valid destinations. VERIFIED.
6. **Footer** (brand + Home/Search only): APPROVED STATIC (absences documented in-file). VERIFIED; gaps → AUD-001.
7. **Bottom nav** (mobile): 4 live + Orders disabled. VERIFIED; gap → AUD-003.

No offers/hero-banner/brand-strip sections — consistent with FP03-C2, not defects.

## 6. Shopping Page Audit (family verdicts)

- Categories/Brands/Search/Listings: PRESENT, PARTIALLY VERIFIED (contract + mocked/unit + DB-up E2E history; live data UNVERIFIED now).
- PDP + variants + PIECE/WEIGHT + presets: PRESENT, PARTIALLY VERIFIED (payload shapes + mocked panel tests; per-product preset behavior live-UNVERIFIED → AUD-007).
- Cart + coupon + estimate preview: PRESENT, PARTIALLY VERIFIED (totals backend-echoed, never computed; live NOT executed).
- Identity (phone/password, anti-oracle), addresses CRUD, checkout idempotency, confirmation gating: PRESENT, PARTIALLY VERIFIED (mocked proof; OTP/reset NOT APPLICABLE — deferred by contract).
- Guest access (per-order HttpOnly credential, dual-policy detail, refresh/history/decide/cancel display): PRESENT, PARTIALLY VERIFIED; discoverability gap → AUD-003. No credential leakage (grep-verified).
- OOS + compare-at + unknown-price/image states: PRESENT AND VERIFIED at source level (truthful fallbacks).

## 7. Supporting Information and Policies

**Nothing exists**: no routes, no footer/nav links, no approved copy for About, Contact, FAQ,
Delivery, Cancellation, Replacement, Privacy, Terms, hours, coverage, or payments. Footer
explicitly documents the absences rather than inventing them. All items → AUD-001
(CONTENT OWNER DECISION REQUIRED; legally consequential subset: privacy/terms/delivery/
cancellation/refund). No invalid links exist (only Home/Search linked — both valid). No
sitemap/`robots.txt` (discovery hygiene, Low).

## 8. Admin Capability Inventory

All modules present as CRUD/read shells with exact permission gates (`orders/products/
inventory/promotions/coupons/customers/users/roles/settings/audit_logs.view` + `.manage`
writes; permissions catalog read-only under `roles.view`; audit read-only): catalog+variants+
pricing+images, inventory adjust/threshold/movements (+fixed next-page), orders queue/
transitions/proposals/credential relay, promotions/coupons+usages, customers+assisted
registration, users/password/roles, roles/grants/members, typed settings, audit feed+detail.
Dangerous actions confirmed (AdminAction + role-delete 2-step); bulk ops absent (no
endpoints — NOT APPLICABLE); barcode attach POST-only without GET (AUD-019). All
**PRESENT, PARTIALLY VERIFIED** (55 admin unit tests mocked + 7 gate E2E; live mutations
never executed by policy).

## 9. Backend-to-Storefront Data-Flow Mapping

| Admin/backend source | Operation | Storefront consumer | Consistency | Finding |
|---|---|---|---|---|
| Category/brand/product/variant writes | CRUD + price edits | Cards, listings, PDP (fresh server reads) | Per-request fresh (force-dynamic); no cache-invalidation needed | Verified (source) |
| Inventory quantities | Adjust/threshold | Stock states + purchase guards (GENERATED values) | Fresh reads | Verified (source) |
| Order fulfillment transitions | pick/unavailable/prepare/dispatch/deliver | Customer status/refresh/history | Manual refresh button + re-read | Verified (source); auto-push absent by design |
| Replacement propose/decide | Staff propose, both sides decide | Proposal list + decide buttons | Re-read after action | Verified (source) |
| Promotions engine | Rules/targets | Prices/totals silently | No customer-facing explanation | **AUD-004** (transparency decision) |
| Coupons | Create/usage caps | Cart/checkout code entry + estimate | Estimate preview | Verified (source) |
| Settings keys | Typed edits | **No direct storefront reader found** (`src/lib/frontend` has zero settings refs); consumed backend-internally (e.g. estimate inputs) | n/a | **AUD-005** (effect unverifiable from frontend) |
| Guest-order credential | Rotate/revoke (server relay) | Guest detail access | Immediate (cookie-based) | Verified (source); live UNVERIFIED |
| Audit log | Backend-paired writes | None (admin-only) | n/a | Verified read-only |

## 10. Confirmed Gap Register

| ID | Area | Page/Feature | Finding | Evidence | Status | Impact | Missing input/decision |
|---|---|---|---|---|---|---|---|
| AUD-001 | 5 | About/Contact/FAQ/Delivery/Privacy/Terms/etc. | Zero supporting/policy pages or links; footer documents absence | `store-footer.tsx:1-2,16-29`; route glob (no matches) | MISSING + CONTENT OWNER DECISION REQUIRED | High — trust, legal, support load | Owner-approved copy per page (privacy/terms/delivery legally consequential) |
| AUD-002 | 2/3 | Public offers feed | No customer-facing promotions feed; admin promotions exist | `page.tsx:1-4` (FP03-C2 omission); no feed route/consumer in `src` | NOT APPLICABLE (approved omission) — kept visible to prevent re-invention | Medium if owner expects offers | Owner: keep omitted or approve feed scope |
| AUD-003 | 1/4 | Guest order discoverability | Mobile Orders tab disabled "(قريبًا)"; guests reach orders only via retained confirmation URL; `/orders` shows login guidance to guests | `store-nav.tsx:22-28`; FE-7 guest guidance (report) | PRESENT, PARTIALLY VERIFIED (mechanism by design; discoverability gap confirmed) | Medium — guests losing URL lose self-service | Owner: add order-lookup entry vs keep URL-only |
| AUD-004 | 6 | Promotion transparency | Promo engine affects prices with no customer-facing explanation of which promotion applied | No promo-label consumer in `src/components/store`; pricing server-side | PRESENT, PARTIALLY VERIFIED | Low-Medium — "why this price?" questions | Owner: show applied-promo labels or keep silent |
| AUD-005 | 6 | Settings→storefront effect | No storefront reader for settings keys; effect only via backend internals | grep `setting` in `src/lib/frontend` = zero | UNVERIFIED | Low — admin edits lack visible confirmation path | Backend mapping doc or acceptance of internal-only settings |
| AUD-006 | 2 | Live catalog fullness | Contracts support 20k+ via keyset; actual staging/prod rows never inspected (DB down, Preview walled) | DB `pg_ctl: no server running`; Preview title = SSO login | DATA MISSING (environment) | High for launch — cannot confirm sellable catalog | Fixture-capable env access or staging data report |
| AUD-007 | 4 | Per-product weight presets | Payload contract + mocked panel tests exist; real per-product preset behavior never observed live | `purchase-panel` tests mocked; no live run | PRESENT, PARTIALLY VERIFIED | Medium — wrong presets block WEIGHT purchase | Fixture-backed live walkthrough |
| AUD-008 | 2 | Search relevance quality | pg_trgm implementation contract-backed; result quality never judged against real catalog | DB down; no query logs reviewed | UNVERIFIED | Medium — core discovery loop | Staging catalog + sample queries |
| AUD-009 | 1/6 | Admin barcode attach UI | `POST …/catalog/codes` exists; no GET/list contract, no UI | codes route = POST-only; products detail has no codes section | BACKEND/CONTRACT BLOCKED | Low — manual code entry only | Owner: approve read contract need or defer |
| AUD-010 | 6 | Bulk operations | No bulk endpoints → no UI (correct omission) | `bulk` grep = zero in `src/app/api` | NOT APPLICABLE | Low unless ops volume demands | Owner: confirm ops can live without bulk |
| AUD-011 | 1 | Preview public verifiability | Vercel Deployment Protection walls all anonymous access | HTTP 200 + `<title>Login – Vercel</title>` rechecked this session | Environment blocker (not app defect) | High for testing — no public smoke test possible | Owner: preview visibility decision (settings change — not made here) |
| AUD-012 | 2 | SEO discovery files | No sitemap/`robots.txt` | gloves: no matches in `src/app` | MISSING (hygiene) | Low pre-launch | Owner: generate at launch or accept |

Prior-phase technical gaps (cross-tab staleness, read timeouts, monitoring, non-Chrome, manual AT, Web Vitals, live-auth/mutations, pghyper service) stand recorded in FE-12 §D / FE-13 §9 and are referenced, not duplicated.

## 11. Unverified and Blocked Items

- All live-data behaviors (listings content, search quality, images coverage, presets, totals,
  fulfillment round-trips, admin mutations): DB down + Preview SSO-walled + no-write policy.
- Guest/registered checkout completion, payment-adjacent behavior: no live execution by policy.
- Non-Chrome rendering, screen-reader pass, Web Vitals, production monitoring: no environment.
- Settings keys' runtime effect; promotion-to-price attribution text: contract-silent.

## 12. Content and Owner-Decision Register

1. Approve (or explicitly defer) each supporting/policy page + supply definitive copy — AUD-001.
2. Offers feed: keep omitted or scope an approved feed — AUD-002.
3. Guest order discoverability: order-lookup entry vs URL-only — AUD-003.
4. Applied-promotion labeling: silent vs shown — AUD-004.
5. Admin barcode attach need; bulk need — AUD-009, AUD-010.
6. Staging catalog fullness report + preview visibility — AUD-006, AUD-011.
7. Sitemap/robots at launch — AUD-012.

## 13. Evidence Appendix

- Routes: build route table (FE-13 §4; 21 admin + 15 storefront families + prototype + boundaries).
- Source anchors: `app/page.tsx`, `components/store/{store-footer,store-nav,product-card}.tsx`,
  `lib/orders/guest-access.ts:27`, `lib/frontend/*` (zero settings refs), `app/api/admin/catalog/codes/route.ts` (POST-only).
- Tests: vitest 119/119 (all mocked), Playwright 11/11 DB-independent + 37/37 DB-up history,
  5 FE-13 screenshots (DB-down honesty states), axe 4 surfaces clean.
- Contracts: FP03-C1/C2, FP03-G1, BGGO-D009/D010, D43/D45, permission keys per FE-10F report.
- Environment: Preview title check output; `pg_ctl: no server running`.

## 14. Audit Limitations and Integrity Statement

Inspected: full route tree, homepage, footer/nav, cards/gallery fallbacks, cart/checkout/
identity/address/order flows (source), all admin modules (source), API contracts and
adapters, test suites and reports, Preview access state, local DB state. Visually rendered:
5 local pages (FE-13 shots); Preview rendering not accessible (SSO). Not inspected live:
any data-backed rendering, checkout completion, admin mutations, non-Chrome, AT, vitals.
**No implementation, fix, refactor, test change, dependency, config, DB, commit, push,
deploy, or settings change was performed — including leaving every gap exactly as found.**
