# FP-00 — Frontend Governance, Decision Registry & Contract Map

> **Phase:** FP-00 (Governance / Discovery / Source-of-Truth Mapping — NOT implementation).
> **Authority:** Product Owner Decision Contract — Frontend (§1–§127 LOCKED unless marked otherwise) +
> Agent Governance (§128–§171 LOCKED).
> **Date:** 2026-10-07. **Repo state at analysis:** `master`, HEAD `83253fe` == `origin/master`,
> tree clean (except pre-existing local-only `scripts/set-super-admin-password-local.ps1`, untracked).
> **Backend baseline:** `docs/openapi.yaml` (96 paths / 136 ops) + `docs/AGENT-HANDOFF.md` Phase 5
> (✅ BACKEND DEVELOPMENT COMPLETE) + backend domain docs. No backend file was modified in FP-00.
> `docs/AGENT-HANDOFF.md` was NOT modified (protection §151).
> **Status vocabulary (strict):** Status ∈ {LOCKED, OPEN, DEFERRED}. Owner ∈ {PRODUCT-OWNER,
> ARCHITECT-OWNED, DESIGN-OWNED, BACKEND-FIXED, UNRESOLVED}. Dependency flags
> {BACKEND-DEPENDENT, INFRA-DEPENDENT, DATA-DEPENDENT, DESIGN-DEPENDENT} are NOT statuses.
> Evidence ∈ {VERIFIED (file read), DOCUMENTED (contract doc), ASSUMED, UNKNOWN}.

---

## 1. Source of Truth Hierarchy (LOCKED, §130)

```text
1. Explicit Product Owner Locked Decisions (§1–§127)
2. Backend Contract / OpenAPI / Verified Backend Behavior
3. Existing Locked Architecture Decisions
4. Approved Frontend Governance Decisions (this document, ARCHITECT-OWNED only)
5. Approved Design System / UX Decisions (none yet — no design system exists)
6. Implementation Details
7. Agent Assumptions (never authoritative)
```

Conflict resolution (§131): Product beats implementation. Product-vs-Backend → recorded CONFLICT,
no workaround. Backend beats existing frontend code. Product beats design. Agent assumption loses always.

---

## 2. Current Frontend State (VERIFIED from repo reads)

| Area | State | Evidence |
|---|---|---|
| Storefront pages | MISSING — root `page.tsx` is create-next-app boilerplate | `src/app/page.tsx:5-68` |
| Shared components | MISSING — no `src/components/`, no customer layout/nav/footer | glob empty |
| API client | MISSING — no client fetch wrapper; `src/lib/api/*` is server-only | inventory audit |
| Client state | MISSING — zero `zustand` imports in UI (dep installed, unused) | grep |
| i18n / RTL framework | MISSING — no locale routing/dictionaries; RTL via per-page `dir="rtl"` only | grep `next-intl\|i18n` |
| Arabic font | MISSING — Geist `latin` subset + Arial fallback; `<html lang="en">`, no `dir` | `layout.tsx:2-24`, `globals.css:22-26` |
| SEO framework | MISSING — metadata is `Create Next App` placeholder | `layout.tsx:15-18` |
| Frontend tests | MISSING — no vitest/jest/playwright, no `test` script | glob/config |
| Admin shell | EXISTS (minimal) — login page + `LoginForm` + dashboard stub + users stub + server actions + proxy guard | `src/app/admin/**`, `src/app/actions/auth.ts`, `src/proxy.ts` |
| 403 surface | EXISTS, reusable Arabic card | `src/app/forbidden.tsx:3-7` |
| Styling system | Tailwind v4 CSS-first, no tokens, no component library | `globals.css`, `package.json` |
| Type/lint/build | `strict:true`, ESLint flat + core-web-vitals, `experimental.authInterrupts`, security headers for `/api/*` only | configs |

**Classification summary (§155–§156):** Existing = root layout shell (structure only), admin auth slice
(login form/actions/proxy/403). Missing = everything storefront. Inconsistent = `lang="en"` + Latin font
vs Arabic-first requirement. Obsolete = root `page.tsx` boilerplate. Reusable as-is = `forbidden.tsx`,
`proxy.ts` pattern, `actions/auth.ts` pattern, `LoginForm.tsx` (needs design-system styling only).
Temporary = `admin/page.tsx` dashboard stub, `admin/users/page.tsx` unstyled list. Nothing existing is
"approved architecture" by mere existence.

---

## 3. Decision Registry

Format: `ID | Title | Decision | Status | Owner | Source | Dependencies | Affected screens/APIs`.
PO-clause coverage: every clause §1–§127 is cited below (no silent decisions, §132).

### 3.1 Product decisions (Owner: PRODUCT-OWNER, all LOCKED unless noted)

| ID | Title (PO clauses) | Decision (binding) |
|---|---|---|
| FP-00-D001 | Product vision (§1) | Real supermarket, not demo. Frontend converts backend capability into clear, fast, trustworthy Arabic mobile-first commerce. No UX shortcut may compromise backend security/data integrity. |
| FP-00-D002 | Users: guest / registered / admin (§2.1–2.3) | Guest: browse/search/cart + order + address/phone + tracking via system mechanism. Registered: login (Phone+Password, OTP non-mandatory V1), profile, addresses, orders, replacement preference, sessions. Admin: separate experience (dashboard/orders/products/inventory/promotions/customers/delivery/users/roles/settings/audit per permission). |
| FP-00-D003 | V1 priority journeys (§3) | Customer: Discovery→Search→Product→Cart→Checkout→Order→Tracking. Admin: Login→Dashboard→Orders→Preparation→Inventory→Products→Customers→Promotions→Delivery→Settings/Security. Non-journey features must not block V1. |
| FP-00-D004 | Non-V1 scope (§4, §44–47, §79–81, §125) | DEFERRED/V2+: wishlist, reviews, loyalty, recommendations, PWA, realtime infra, push, personalization, feature-flag platform, full ticketing, camera scanning, advanced analytics vendor. Architecture must stay compatible; no V1 UI/nav/DB/API for them. |
| FP-00-D005 | Brand personality (§5) + visual authority split (§6) | Personality LOCKED: trustworthy, local, modern, practical, simple — "respectable local supermarket", not luxury, not chaotic-discount, no visual clutter. Exact tokens (colors/fonts/radius/shadow/icons/spacing) OPEN until Design System Gate (DESIGN-OWNED). |
| FP-00-D006 | Homepage (§7) | Order: Header/Search → Hero → Quick Categories → Promotions → Featured → Popular(when data) → Delivery/Trust → Footer. Minimal carousels. Search prominent. |
| FP-00-D007 | Navigation mobile/desktop (§8–9) | Mobile: Home/Categories/Cart/Orders/Account + visible search; no bloated bottom nav. Desktop: Logo/Categories/Search/Offers/Cart/Account. Admin nav fully separate. |
| FP-00-D008 | IA + URLs (§10) | No UUIDs/internal IDs in public URLs. Stable, SEO-friendly, canonical-slug-based product/category pages. |
| FP-00-D009 | Product model + piece UX (§11–12) | Product→Variant→Price/Unit/Code/Stock. Variant is the practical choice/price unit. Piece cards: name/image/price/old-price-if-real/badge/availability/qty/add. |
| FP-00-D010 | Weight UX + pricing + actuals (§13–15) | Weight UX with natural gram presets (125/250/500g, 1/1.25kg — each validated per-product against `saleStepGrams`; never free decimals like 0.137kg). Pre-preparation price is an ESTIMATE (e.g. 500g × 320 EGP/KG ≈ 160). Post-preparation UI shows requested vs actual vs final item price vs final total. Actuals come ONLY from backend. |
| FP-00-D011 | Availability authority + OOS (§16–17) | Backend is availability authority; frontend never infers stock locally. OOS products STAY discoverable (`غير متوفر حاليًا`, add disabled, details visible). Matches backend: search/list keep OOS unless `inStock=true`. |
| FP-00-D012 | Search (§18) | Real backend search (no multi-thousand client filtering). Supports name/code/brand/category-ish per contract tiers; OOS not hidden by default. |
| FP-00-D013 | Card + price display + drift (§19–21) | Cards answer what/price/available/discount/addable, no clutter. Old price shown ONLY from backend `compareAtPrice` (struck) + current price. Price drift: surface new price, explain, recompute totals from backend. Never silent. |
| FP-00-D014 | Cart editing + living state + guest + merge (§22–25) | Qty steppers + remove in cart; piece=packs, weight=step-validated, invalid values un-sendable. Cart is living state: revalidate availability/price/promos/qty pre-checkout, show changes. Guest cart via backend guest mechanism, no forced registration to add items. Login mid-journey merges VIA backend merge endpoint only (BACKEND-DEPENDENT — endpoint exists). |
| FP-00-D015 | Checkout flow + fields (§26–27) | Short, stepped, mobile-first: customer info → address → delivery info/fee → payment → review → confirm. Fields: name/phone/city/area/village/street/building/landmark/notes. NO governorate field. |
| FP-00-D016 | Delivery eligibility + fee (§28–29) | Out-of-service area → clear message, no normal order. Backend is eligibility authority. Fee NEVER hardcoded (current 20.00 EGP is data); always from backend settings. |
| FP-00-D017 | Payments (§30–32) | UX abstraction {Cash on Delivery, Online Payment}; concrete online methods per approved provider (OPEN, INFRA-DEPENDENT). COD: estimate at checkout, final total post-execution is the collectible. Prepaid: must render pending/paid/changed/refund-due/additional-due states (BACKEND-DEPENDENT on payment contract). |
| FP-00-D018 | Confirmation + statuses + tracking (§33–35) | Confirmation shows business order number `HM-YYYYMMDD-######` (never UUID), status, items, totals, address, payment, notes. Status set EXACTLY = backend machine (NEW→CONFIRMED→PREPARING→READY_FOR_DELIVERY→OUT_FOR_DELIVERY→DELIVERED + CANCELLED). Arabic timeline with datetimes when available. |
| FP-00-D019 | Cancellation UX (§36) | Show cancel ONLY when backend allows (currently NEW/CONFIRMED/PREPARING-unpicked; picked→409). No independent frontend timing. BACKEND-DEPENDENT. |
| FP-00-D020 | Replacements transparency (§37) | Original → proposal → price → difference → accept/reject; all four visible. BACKEND-DEPENDENT (endpoints exist). |
| FP-00-D021 | Auto-accept default (§38) | Customer setting `السماح بالاستبدال التلقائي`, safe default OFF. Backend default `false` VERIFIED (`schema.prisma:216`). Self-service toggle has NO storefront endpoint → BACKEND GAP G003 (staff-only PATCH exists). |
| FP-00-D022 | No-substitute completion (§39) | Order may complete short per accepted backend behavior; never promise a substitute. Matches L1 short-ship rule. |
| FP-00-D023 | Promotions display (§40–42) | Display ONLY backend-decided promos; no local rule computation (eligibility/priority/usage/stackability/BXGY/coupons). BXGY explained in words, math from backend. Coupon states explicit (applied/invalid/expired/minimum/limit/N-A); never raw `Error 400`. BACKEND-DEPENDENT. |
| FP-00-D024 | Account sections (§43) | V1: Profile / Addresses / Orders / Replacement preference / Logout. No non-core bloat. (Profile-name + preference toggles need G003.) |
| FP-00-D025 | Admin: dashboard/orders/prep/barcode (§48–51) | Dashboard = decision KPIs (today/pending/preparing/delivery/low-stock/OOS/finance-when-API/ alerts). Orders = list→filters→details→prep→availability→replacement→status→delivery. Prep UI is ops-focused (item/qty/unit/availability/picked/replacement/actual-weight/price impact), NOT a customer page clone. Barcode: keyboard-wedge scanner workflow LOCKED; camera DEFERRED. |
| FP-00-D026 | Bulk ops roadmap (§52) | LOCKED AS OPERATIONAL REQUIREMENT (import/update/validate/error-reporting, gradual). No backend bulk endpoints → BACKEND GAP G005. |
| FP-00-D027 | Content quality/images/trust (§53–54, §106) | Clean data only; admin must offer quality tooling. Image priority real→optimized→responsive; placeholder ONLY when no real image and never misleading. Trust via local service/delivery info/contact/order clarity/pricing — no fake reviews/social proof. |
| FP-00-D028 | Localization (§55–56) | Arabic-first, RTL, EGP (`152 ج.م` style, EGP in technical layer), Africa/Cairo, Gregorian. UI Arabic-native, not translated. Requires html `lang="ar" dir="rtl"` + Arabic-capable font (missing today). |
| FP-00-D029 | Accessibility (§57) | WCAG 2.2 AA mindset: keyboard, focus, semantics, labels, contrast, error messages, touch targets, screen readers, RTL order. Real, not token `aria-label`s. |
| FP-00-D030 | Responsive (§58, §111–112) | Priority Mobile→Tablet→Desktop→Large. Admin responsive; tables may become cards on mobile (esp. orders/prep). Mobile customer UX wins ties. |
| FP-00-D031 | SEO (§59, §107) | Indexable: home/categories/products/(brand discovery when approved). Excluded: cart/checkout/account/login/admin. Real content + clean structure + semantics + metadata + stable URLs. |
| FP-00-D032 | Performance (§60) | Architecture-level: fast first render, image optimization, SSR where useful, minimal client JS, server pagination/search, caching, NEVER 20k rows in browser, minimal global state. Good CWV on real mobiles. (N+1 PLP risk → R001.) |
| FP-00-D033 | State/fetching/client/types (§61–64) | Server owns server data; client owns interaction state. Zustand ONLY where genuinely useful (not default). Respect server/client boundaries, lifecycle, errors, cache, revalidation, auth, single source of truth. One typed API-client abstraction (contract→client→feature→UI), OpenAPI-derived. Contract-derived shared types; never reshape API meaning for convenience. |
| FP-00-D034 | States: loading/empty/error/retry (§65–68) | Every key screen has loading (skeletons, never white screen). Empty ≠ error (with actions). Errors Arabic, human, retryable, no jargon (`400 Bad Request` forbidden to users), commercial reason preserved. Retry for transient only; NEVER blind retry of order/payment/mutations (idempotency-respecting). |
| FP-00-D035 | Optimistic UI (§69) | Allowed: qty feedback, non-critical local. Forbidden: payment, order creation, inventory, auth, status transitions. |
| FP-00-D036 | Security posture (§70–75) | Frontend is NEVER security authority (auth/RBAC/inventory/pricing/coupons/orders = backend). Secrets/credentials NEVER in bundle or git. Auth UX covers login/session/logout + wrong/locked/expired/401/403. RBAC hiding is UX-only (backend still enforces). Races/stale shown honestly (e.g. `المنتج لم يعد متاحًا بالكمية المطلوبة`) with revalidate/edit path. No sensitive/internal data exposure. |
| FP-00-D037 | Separation + analytics + flags (§76–78) | Store ≠ Admin in nav/model/density/permissions. Analytics-ready event taxonomy LOCKED (view/search/add/remove/checkout-start/complete/coupon/order); provider DEFERRED. No complex flag system V1 (stay compatible). |
| FP-00-D038 | Design system + QA (§82–83) | Unified reusable system (Button/Card/Input/Modal/Table/Badge/Toast…) after rules lock. Design QA (spacing/type/alignment/RTL/responsive/interaction/states/a11y/consistency) required. |
| FP-00-D039 | Acceptance + E2E (§84–86) | Requirement→behavior→edge→criteria→test per feature; "works for me" rejected. V1 done ONLY when customer journey (browse→…→tracking) AND admin journey (login→…→delivered, RBAC-respecting) pass. |
| FP-00-D040 | Data rules (§87–88) | Frontend never assumes 20k products/promos/customers in bootstrap (real ops data, not seed). Flow ALWAYS Backend→Contract→Frontend→UI. |
| FP-00-D041 | Authority chain (§89–93) | Frontend decides NOTHING about: final price, discount/coupon/promo outcomes, actual weights, final totals, availability, transitions (e.g. never PREPARING→DELIVERED jump), replacement semantics, coupon eligibility. ALL BACKEND-DEPENDENT. |
| FP-00-D042 | Idempotency UX (§94) | Respect backend idempotency (header+body key, replay semantics). Anti-double-submit UX (processing state, disabled button). |
| FP-00-D043 | Forms/checkout-button/review/history (§95–98) | Short forms, required/optional marked, client validation for UX + backend authoritative, field errors, preserve non-sensitive input. Order button enabled ONLY when backend-contract requirements met + processing + no duplicates. Pre-submit review (items/subtotal/discount/delivery/estimate-or-final/payment). History newest-first, summary cards, filters when needed. |
| FP-00-D044 | Admin tables/catalog/SEO-detail (§99–105) | Tables: search/filter/sort/pagination/responsive/bulk-when-safe; never 20k rows in DOM. Large catalog: server search/filter/pagination ONLY. Categories = core discovery (hierarchy + search integration). Brands = real-value-only. Filters/sorts = ONLY backend-supported (category/brand/price/availability; sort relevance/newest/name/created_at — NO price/popularity/bestseller; see G001). Details page = full source (images/name/brand/desc/availability/price/discount/variant/weight/qty/add). |
| FP-00-D045 | Admin security/audit (§108–110) | Show current user/permissions/logout/expiry/sensitive confirmations; enforcement stays backend. Destructive ops (delete/deactivate/cancel/price/stock/roles) need confirmation UX (backend still authoritative). Audit visible ONLY in appropriate admin contexts, no secrets. |
| FP-00-D046 | Platform rules (§113–117) | Modern Chrome/Edge/Safari/Firefox, no hacks. Arabic user errors, technicals in logs. No passwords/secrets/PII in logs (privacy-aware telemetry). Env separation dev/preview/prod; preview NEVER touches prod DB unless deliberate+secured. Traceable releases (commit→build→env→deploy), no experimental+prod mixing. |
| FP-00-D047 | Prototype + freeze (§118–119) | Prototype/visual flows for core journeys BEFORE wide implementation (customer + admin-prep). After Product+IA+journeys+UX+brand+system approval → Frontend Design Contract; changes need decision log. |
| FP-00-D048 | No invented logic + agent/designer/architect boundaries (§120–123) | Frontend translates contract ONLY (pricing/inventory/transitions/replacements/coupons/RBAC/idempotency). Agent executes LOCKED, presents options for OPEN, skips DEFERRED, never invents. Designer free INSIDE brand/UX/IA/rules, never business behavior. Architect free on structure/split/state/fetch/cache/client — never product decisions. |
| FP-00-D049 | Open/deferred/acceptance/final (§124–127) | OPEN: payment provider, analytics provider, delivery-UX details pending delivery API, unbepresented behaviors, visual tokens, V2→V1 promotions. DEFERRED list as §125. Acceptance = requirement+UX+responsive+RTL+a11y+states+security+contract+criteria (render ≠ done). Final bar: simple/fast/trustworthy/Arabic-first/mobile-first/commerce+weight-aware/contract-driven/accessible/SEO/production-grade. New decisions classified LOCKED/OPEN/DEFERRED/BACKEND-DEPENDENT; no self-promotion by agent. |

### 3.2 Backend-fixed decisions (Owner: BACKEND-FIXED — VERIFIED from code/OpenAPI unless noted)

| ID | Decision | Evidence |
|---|---|---|
| FP-00-D050 | Catalog listing: keyset (`limit` 1–100 def 20, opaque cursor), filters category(subtree)/brand/type/price-window/`inStock`, sort name/created_at ONLY. List items carry NO price/stock/image. | `catalog/validation.ts`, `catalog/queries.ts`, `serialize.ts:68-97` (VERIFIED) |
| FP-00-D051 | Search: pg_trgm + Arabic fold, `q`≥2, tiers code→exact→prefix→similarity(≥0.2)→brand/category, sort relevance/newest; OOS kept unless `inStock=true`; no price/stock/image in hits | `catalog/search.ts`, `search/route.ts` (VERIFIED) |
| FP-00-D052 | Availability via dedicated inventory endpoints (`stockStatus` in/out/low from GENERATED available); cart-lines are draft-only (no stock check) — frontend MUST pre-check, checkout enforces | `inventory/*/route.ts`, `inventory/serialize.ts:14-19` (VERIFIED) |
| FP-00-D053 | Pricing: variant `price` + `compareAtPrice` (only discount signal); promos/coupons evaluated ONLY via `orders/estimate`; no storefront offers endpoint; no price sort | routes + `promotions/checkout.ts` (VERIFIED) |
| FP-00-D054 | Cart: guest-token XOR customer-session; merge via backend endpoint; reprice drops dead lines; step/pack rules enforced | `cart/*` (VERIFIED) |
| FP-00-D055 | Checkout: customer-session ONLY (guest token→401); address must be owned; price-drift→409 (new key); atomic reserve; idempotency header/body (header wins; mismatch→400; missing→400); delivery fee server-read | `store/orders/route.ts:25-66`, `orders/writes.ts` (VERIFIED) |
| FP-00-D056 | Orders: customer-scoped list (newest-first keyset)/detail/cancel (NEW/CONFIRMED/PREPARING-unpicked; picked→409); state machine exact; history-first; snapshots immutable; `HM-YYYYMMDD-######` business number (DOCUMENTED via contract §8 — serializer fields to be re-verified in FP-01) | routes + `orders/state-machine.ts` (VERIFIED; number format DOCUMENTED) |
| FP-00-D057 | Replacements: propose (staff) / decide approve-reject (customer) / withdraw + auto-accept (staff, R5 caps 10%/50EGP + pre-consent); READY gated on zero PENDING + zero PROPOSED; short-ship when no substitute (L1) | `replacements/*`, `orders/fulfillment.ts` (VERIFIED) |
| FP-00-D058 | Customer auth: phone+Argon2id, server opaque sessions (30d, revocable), lockout 5→15min, separate buckets/cookies/tables; identify never mints; addresses CRUD owned; no governorate; no storefront profile PATCH | `customers/*`, `customers/auth.ts` (VERIFIED) |
| FP-00-D059 | Admin: 60 routes, frozen 31-key RBAC (server-enforced per request), settings incl. `delivery.enabled=false` + `delivery.default_fee=20.00` (readable/writable, `delivery.enabled` gates NOTHING in code); audit read-only | `api/admin/*`, `seed.mjs:96-148` (VERIFIED) |
| FP-00-D060 | Contract envelope: `{data,meta}` / `{error:{code,message,details}}`; statuses 200/201/400/401/403/404/409/422/429/500 with locked meanings; no versioning (unversioned namespaces pre-launch) | `lib/api/*`, `openapi.yaml` (VERIFIED) |

### 3.3 Architect-owned decisions (Owner: ARCHITECT-OWNED — locked in FP-00, no product impact)

| ID | Decision | Reason / rejected alternatives |
|---|---|---|
| FP-00-D061 | App-router colocation: route groups `(shop)` + `(account)` + `admin/`; shared UI in `src/components/` (design-system + feature components); server-only helpers in `src/lib/frontend/` (never import server DB libs into client) | Keeps journeys separated per D007/D037; rejected: flat pages dir (no journey boundary) |
| FP-00-D062 | Server Components default; client islands ONLY for cart-steppers, search-box, weight selector, qty controls; Server Actions for auth/cart/order mutations; `proxy.ts` stays presence-guard | Matches existing auth pattern; minimizes JS per D032 |
| FP-00-D063 | Single typed API client (`src/lib/frontend/api-client.ts`) over OpenAPI: typed routes, envelope unwrapping, error-code→Arabic-message map, idempotency-key issuance for order creation | Directly implements D033/D042; rejected: scattered `fetch` |
| FP-00-D064 | Contract-derived types (`src/lib/frontend/types.ts` generated/hand-mirrored from OpenAPI + serializer shapes); Decimal-as-string + thousandths-int qty helpers shared | Implements D033; rejected: per-file model duplication |
| FP-00-D065 | Discovery state in URL (search/filter/sort/page params); cart-UI state local (no global store by default); zustand ONLY if cross-tree cart badge proves necessary | Implements D033 + D032; rejected: global-store-first |
| FP-00-D066 | Route-level `loading.tsx` skeletons + `error.tsx` Arabic recovery + `not-found.tsx`; field-level form errors; toast for transient confirmations | Implements D034 |
| FP-00-D067 | RTL framework: `<html lang="ar" dir="rtl">` + CSS logical properties everywhere + `dir`-aware components; Arabic-capable font (family = DESIGN-OWNED D071 choice) | Implements D028/D029 |
| FP-00-D068 | SEO framework: metadata API per route, `sitemap.ts` + `robots.ts`, JSON-LD for products (when data), noindex on cart/checkout/account/admin | Implements D031 |
| FP-00-D069 | Test strategy (tooling locked, installation = FP-01): vitest + React Testing Library (unit) + Playwright (E2E journeys D039); backend `scripts/api/*` remain backend-owned | Implements D039; rejected: no-test frontend |

### 3.4 Design-owned (Owner: DESIGN-OWNED — OPEN, recommendation only, NOT locked)

| ID | Area | Recommendation (non-binding) |
|---|---|---|
| FP-00-D070 | Exact tokens (colors/spacing/radius/shadow) | Calm trust palette (single primary + neutrals, restrained promo accent), generous spacing, medium radius; derive from D005 in Design System Gate |
| FP-00-D071 | Font family | Arabic-capable family with tabular numerals for prices (readability of `152 ج.م`); Geist rejected for Arabic (latin-only VERIFIED) |
| FP-00-D072 | Icons/motion/component styling | Single line-icon family; motion limited to feedback (no decorative animation that delays purchase); card/table/badge/empty/error patterns in system |

---

## 4. Screen / Feature Map (with priority + API + decisions)

### CORE V1 — customer
| Screen | APIs | Key decisions |
|---|---|---|
| Home (`/`) | products(list), categories, search, images, inventory(batch) | D006, D011–D013, D028, D032 |
| Search results | `catalog/search` + inventory + images | D012, D011, F001(N+1) |
| Category/brand listing | products(list+filters) + inventory + images | D044, D011 |
| Product details (`/p/[slug]` → resolve id) | products/[id]+variants+images+inventory | D008–D011, D013, D044 |
| Cart | cart CRUD + reprice + inventory + estimate | D014, D023, D042 |
| Checkout | addresses + estimate + orders(create) + settings(fee) | D015–D017, D042–D043, C001 |
| Order confirmation | orders/[id] | D018, D042 |
| Orders + tracking timeline | orders(list/[id]), replacements(list/decide) | D018–D020, D022 |
| Login/register | session/register/identify/merge | D002, D036, C001 |
| Account (profile/addresses/orders/preference/logout) | addresses, session, password, (G003 for profile/preference) | D024, D021, G003 |

### V1 SUPPORTING — customer system/auth
Login, session-expiry, 403/404, offline/error fallbacks (D034, D036).

### ADMIN OPERATIONAL (permission-gated; all endpoints exist except noted gaps)
Login → Dashboard (KPIs — G004 reporting gap for revenue) → Orders (list/filters/details) →
Preparation (prepare/pick/unavailable/ready + replacements propose/withdraw/auto-accept) →
Inventory (stock/adjust/movements) → Products (CRUD + images + price) → Customers (lookup/edit/register;
order-history via `orders?customerId` workaround) → Promotions/Coupons (full CRUD) → Delivery
(status flips ONLY — G006) → Settings/Users/Roles/Audit (D025, D045).

### DEFERRED — NOT built in V1 (§4/§125 + D004): wishlist, reviews, loyalty, recommendations, PWA,
push, realtime, camera scanning, personalization, flag platform, full ticketing, analytics vendor.

---

## 5. Backend / API Map (capability → consumer → endpoint → status → gaps)

| Capability | Consumer | Endpoint(s) | Status |
|---|---|---|---|
| Product discovery | PLP/search | `GET catalog/products`, `GET catalog/search` | VERIFIED (limits: D050/D051) |
| Product detail enrichment | PDP | `products/[id]`, `products/[id]/variants`, `variants/[id]`, `products/[id]/images`, `inventory/products|variants/[id]`, `codes/lookup` | VERIFIED (N+1 → R001) |
| Taxonomy | Nav/filters | `categories`, `brands` (+`[id]`) | VERIFIED |
| Cart draft | Cart page | `cart`, `cart/items`, `cart/items/[variantId]`, `cart/merge`, `cart/reprice` | VERIFIED |
| Price/promo truth | Cart/checkout | `orders/estimate` (+coupon) | VERIFIED (display-only) |
| Order lifecycle | Checkout/orders/tracking | `orders POST/GET`, `orders/[id]`, `orders/[id]/cancel` | VERIFIED (C001: customer-only) |
| Replacements | Tracking | `orders/[id]/replacements`, `decide` | VERIFIED |
| Identity | Auth/account | `identify`, `register`, `session`, `password`, `addresses*` | VERIFIED (G003: no profile PATCH) |
| Fee/settings | Checkout/admin | `settings`, `settings/[key]` | VERIFIED (`delivery.enabled` non-gating) |
| Fulfillment/ops | Admin prep | prepare/pick/unavailable/ready/dispatch/deliver/cancel | VERIFIED |
| Catalog/inventory/promo/customer admin | Admin | 60 admin routes (§3.2 D059) | VERIFIED (gaps G002/G004–G006) |

---

## 6. Gap Registers

### BACKEND gaps (do NOT patch in frontend; document only)
| ID | Gap | Class | Impact |
|---|---|---|---|
| G001 | No price/discount/popularity sort; no offers feed; no effective-price field; list/search omit price/stock/image (N+1) | BACKEND GAP (+ FRONTEND MITIGATION via batched enrichment) | PLP performance/complexity (R001); sort/filter promises limited (D044) |
| G002 | No customer order-history endpoint (`customers/[id]/orders`) — workaround `admin/orders?customerId` (admin only; storefront uses own `orders` list ✅) | BACKEND GAP (minor) | Admin customer-360 needs extra call |
| G003 | No storefront profile/preference update (name, `auto_accept_replacements`) — staff-only PATCH | BACKEND GAP | D021/D024 account sections need backend endpoint in later phase |
| G004 | No reporting/revenue endpoints (`reports.view` unused) | BACKEND GAP | Admin dashboard finance KPIs (D025) unbuildable |
| G005 | No bulk import / recount endpoints | BACKEND GAP (+ DATA DEPENDENT) | D026 roadmap blocked on backend |
| G006 | No delivery zones/fees-by-area/drivers/assignment/proof; no payments/refunds; no picked-line restock-cancel | BACKEND GAP (+ INFRA DEPENDENT) | D016–D017/D026-delivery parts, COD-fee display stays single-fee |

### FRONTEND gaps (to build in FP-01+)
| ID | Gap |
|---|---|
| F001 | PLP enrichment strategy (batch variants+inventory+images; caching; skeleton) — mitigates G001 |
| F002 | Slug→id resolution layer for SEO URLs (API is UUID-only; list/search carry both) |
| F003 | Weight-selector component bound to per-product `saleStepGrams` (preset × step validation) |
| F004 | Arabic error-message catalog mapped from error codes (never raw codes) |
| F005 | Idempotency-key issuance + double-submit guards on order/payment actions |
| F006 | True guest checkout identity UX (unblocked only after BG implementation; see C001 closure) |
| F007 | Admin responsive table→card patterns + dashboard KPI cards (without revenue until G004) |

### ARCHITECTURE gaps (decided direction, build in FP-01)
| ID | Gap |
|---|---|
| A001 | `src/components/` + `src/lib/frontend/` structure (D061) |
| A002 | Typed API client + contract types (D063/D064) |
| A003 | RTL shell (`lang="ar" dir="rtl"`, logical props, Arabic font) (D067) |
| A004 | SEO framework (D068) + loading/error framework (D066) |
| A005 | Frontend test harness (D069) |

---

## 7. Conflict Register

| ID | Conflict | Product position | Backend evidence | Impact / owner / needed action |
|---|---|---|---|---|
| FP-00-C001 | **Guest checkout without account (§2.1) vs customer-only order creation** | "Guest completes order WITHOUT creating an account" (LOCKED) | `store/orders/route.ts:55-59`: `owner.kind !== "customer"` → 401; session requires password → registered account. `identify` never mints (`customers/identify/route.ts`). | Guest CANNOT order account-free today. Owner: PRODUCT-OWNER. Options: (a) accept register-at-checkout (phone+name+password in one checkout step, UX-framed as order details) as satisfying §2.1 intent; (b) require true account-less ordering = BACKEND CHANGE (new phase, out of FP-00). → **Q1**. Blocks checkout UX + F006. |

No other product/backend conflicts found: statuses (§34) == state machine; cancel window (§36) == transition rules;
short-completion (§39) == L1; OOS-visibility (§17) == contract; no-governorate (§27) == frozen model;
auto-accept OFF (§38) == DB default; fee-from-backend (§29) == settings endpoint.

**C001 closure (2026-10-07, history preserved above):** Q1 LOCKED = TRUE ACCOUNT-LESS GUEST ORDER —
register-at-checkout REJECTED, hidden/temporary customers REJECTED. Backend design closed (not implemented)
in `BG-GUEST-ORDER-DECISION-CLOSURE.md` (BGGO-D001…D016 all LOCKED; `READY FOR IMPLEMENTATION`).
F006 stays gated until BG implementation + migration + tests + verification + updated OpenAPI.

---

## 8. Assumption Register

| ID | Assumption | Why needed | Risk / invalidation |
|---|---|---|---|
| FP-00-A001 | Runtime `delivery.default_fee` ≈ 20.00 EGP and single-fee; no per-area fees in V1 | Seed value; no zones backend (G006) | If per-area fees appear → checkout totals UX must change (BACKEND-DEPENDENT) |
| FP-00-A002 | `order` serializer exposes business `orderNumber` + item requested/actual + history for timeline | Needed for D018; format DOCUMENTED in contract, fields not field-verified in FP-00 | FP-01 to verify `toOrder` fields against D018 before building tracking |
| FP-00-A003 | No real promo/coupon/image data at build time; UI must handle empty gracefully | No seed data for these in dev | If launch catalog lacks images → placeholders per D027 (never misleading) |
| FP-00-A004 | Admin staff operate modern browsers with JS; customer PWA/offline not required (DEFERRED) | Scopes admin responsive patterns | Invalidated only if offline-ops becomes V1 (product decision) |

---

## 9. Open / Deferred Registers

### OPEN (need decisions; agent must NOT lock)
| ID | Question | Owner | Dependency |
|---|---|---|---|
| FP-00-Q001 | ~~C001: accept register-at-checkout vs account-less?~~ RESOLVED 2026-10-07: TRUE ACCOUNT-LESS (register-at-checkout rejected); design in BG closure doc, implementation pending | PRODUCT-OWNER (locked) | — |
| FP-00-Q002 | Payment provider (+ which online methods ship V1; COD-only fallback?) | PRODUCT-OWNER | INFRA-DEPENDENT |
| FP-00-Q003 | Analytics provider (taxonomy locked D037; vendor open) | PRODUCT-OWNER | INFRA-DEPENDENT |
| FP-00-Q004 | Delivery UX details (zones, per-area fees, driver flow, proof) pending delivery API | PRODUCT-OWNER | BACKEND-DEPENDENT |
| FP-00-Q005 | Exact visual tokens sign-off (after Design System Gate proposal) | DESIGN-OWNED (+PO approve) | DESIGN-DEPENDENT |

### DEFERRED (protected; not V1 — D004)
Wishlist, reviews, loyalty, recommendations, PWA, push, full realtime, camera scanning, personalization,
flag platform, full ticketing, analytics vendor, barcode-camera, advanced personalization. No nav/DB/API/UI in V1.

---

## 10. Risks

| ID | Risk | Mitigation |
|---|---|---|
| FP-00-R001 | PLP N+1 (list omits price/stock/image) → slow cards, waterfalls | F001 batched enrichment + caching + skeletons; server components; measure on real mobile |
| FP-00-R002 | Weight UX: preset grams must satisfy per-product `saleStepGrams` or backend 422s | F003 step-bound selector; client pre-validation + honest 422 surfacing |
| FP-00-R003 | C001 blocked checkout design until Q1 locked true account-less (closed 2026-10-07) | Build behind BG implementation gate (see C001 closure) |
| FP-00-R004 | Payment/delivery gaps surface mid-checkout (G006) | Abstraction-first checkout (D017); COD path shippable without provider |
| FP-00-R005 | 20k-row catalog content quality (names/images/units/codes) | D027 quality stance; admin tooling expectations; no fake data |
| FP-00-R006 | Arabic/RTL/a11y regressions (current shell is en/Latin) | A003 first in FP-01; RTL QA per D029/D038 |
| FP-00-R007 | Zero frontend tests today → regression risk as UI grows | D069 harness in FP-01 before wide implementation |

---

## 11. Dependency Graph (critical chains)

```text
Payment provider (Q2) → payment contract → checkout payment UX → confirmation (D017/D018)
Delivery API (Q4/G006) → eligibility/fee UX → checkout address step (D016)
C001/Q1 → checkout identity step → F006 → order creation (D015/D042)
Variant contract (price/unit/step/code/stock) → PDP → cart → checkout validation (D009/D010/D014)
Catalog listing limits (G001) → PLP enrichment (F001) → performance (R001)
Design tokens (Q5) → Design System (D038) → all screens (D047 freeze)
```

---

## 12. Architect Decision Gate (locked, low-risk, no product impact)

D061–D069 as §3.3 (structure, server-first, typed client, contract types, URL-driven discovery state,
skeletons/errors, RTL shell direction, SEO framework, test tooling choice). Reversibility: all EASILY
REVERSIBLE except D063/D064 conventions (MODERATE — cheap to adjust pre-implementation). Self-check
(§166): no product/backend/security/URL impact; no lock-in (no new deps — §154 respected).

## 13. Design Decision Gate (open; recommendation only)

D070–D072 as §3.4. Nothing visually locked; Design System Gate (FP-01) produces tokens + component
styling for PO/design approval.

## 14. Recommended Next Gate: FP-01 — Design System + Prototype Journeys

Prerequisites: Q1 LOCKED true account-less (design closed, implementation pending — checkout identity work gated on BG implementation; Q2/Q4 may lag behind COD-first checkout).
Scope: A003 RTL shell → tokens proposal (Q5 input) → system primitives → prototype customer journey
(home→category→product→cart→checkout→order) + admin prep journey (§118) → design freeze input (D047).
Explicitly NOT: full V1 build, backend changes, production deploys.

## 15. FP-00 Completion Self-Check (§169)

Product rules loaded ✅ · backend mapped ✅ · source-of-truth set ✅ · ownership set ✅ ·
registry created (D001–D072 + C001 + G/F/A + A001–A004 + Q1–Q5 + R1–R7) ✅ · open isolated ✅ ·
deferred protected ✅ · conflicts found (1, with options) ✅ · API gaps ✅ · screen deps ✅ ·
architecture baseline (D061–D069) ✅ · no invented logic ✅ · no product decisions made ✅ ·
no backend modification ✅ · no production changes ✅ · no AGENT-HANDOFF modification ✅.

```text
FP-00 = COMPLETE
```
