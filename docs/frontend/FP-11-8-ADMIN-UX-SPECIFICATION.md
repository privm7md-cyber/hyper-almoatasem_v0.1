# FP-11.8 — Admin UX Specification

> Classification: `VERIFIED FROM CURRENT CONTRACT` · `LOCKED` (existing approved decision) ·
> `RECOMMENDATION` (proposed, needs owner review) · `BLOCKED — CONTRACT GAP` · `UNSUPPORTED BY
> CURRENT API` · `FUTURE PROPOSAL`. Specification only — no implementation, no backend change.
> D43, D44 and D45 are OWNER-APPROVED — DECISION RECORDED (D44 approved in the gap-resolution
> task within its defined limitations). Nothing else herein is owner-approved.
>
> **Authoritative principle: the backend owns authorization. Hiding or disabling a frontend control
> is supplementary UX, never an access-control boundary.** Every mutating call re-verifies
> server-side (401/403); a crafted request to a hidden control still fails closed.

## 1. Document metadata and status

- **File:** `docs/frontend/FP-11-8-ADMIN-UX-SPECIFICATION.md` (new).
- **Phase:** FP-11.8 Admin UX, Hyper Al-Moatasem operations console.
- **Basis:** read-only inspection of ~65 admin routes, `lib/auth/*` + `lib/admin/*`, `openapi.yaml`
  `x-permission` matrix, seed roles/permissions, existing `/admin` shell pages.
- **Status: `SPECIFICATION COMPLETE — D43/D44/D45 OWNER-APPROVED`** + FP-11.8.2
  deep-dive (§§E1–E16). Companion specs (same task family, separate files): FP-11-8-3 (orders/
  fulfillment), FP-11-8-4 (promotions), FP-11-8-5 (users/permissions), FP-11-8-6 (audit), FP-11-8-7
  (common states), FP-11-9 (responsive/a11y), FP-11-10 (use-case matrix), FP-11-11 (closure).
  FP-11.8.2 closure: D46–D48 OWNER-APPROVED — DECISION RECORDED (2026-10-09); L1/L2/L4/L5 CLOSED FOR CURRENT FRONTEND SCOPE
  (OWNER ACCEPTED 2026-10-09, §E16); L3 IMPLEMENTED + VERIFIED this task (Direction A — see E13/E16).

## 2. Scope and non-goals

**In scope.** Admin login/session, permission-aware nav + route-access policy, honest dashboard,
catalog/products/variants/barcodes/images, prices, inventory ops, orders + fulfillment lifecycle +
replacements, promotions/coupons config, admin users/roles/grants, settings, customer read-only ops,
audit log, cross-cutting states, responsive/RTL/a11y, security, gaps, decisions, acceptance.

**Non-goals.** Implementation; backend/DB/config changes; new endpoints; bulk/CSV/scale hardware;
analytics/BI; delivery-driver tracking; customer notifications; payments; OTP/MFA; storefront
changes; FP-11.6+.

## 3. Verified admin architecture and authentication

| # | Fact | Evidence | Status |
|---|---|---|---|
| A1 | Login: `POST /api/admin/session` `{email, password}` → 201 `{admin{name,email}}` + HttpOnly cookie; same-origin enforcement on credential POST; generic errors; rate-limit + lockout + audit (mirrors customer core with admin semantics) | `admin/session/route.ts:30-67`, `auth/login.ts` | VERIFIED |
| A2 | Session: opaque 8h TTL (`SESSION_TTL_HOURS=8`), SHA-256 at rest, DB-gated; `GET /session` → `{admin, roles, permissions}`; Server-Action form flow + JSON flow coexist; logout action revokes + clears | `auth/session.ts:16-139`, `session/route.ts:69-108`, `app/actions/auth.ts` | VERIFIED |
| A3 | Page guards: `requireAdmin()` (any admin) / `requirePermission(key)` → `forbidden()` 403 page; API: `checkPermission()`/`denyUnless()` → 401/403 envelopes. Existing shell: `/admin/login`, `/admin` (identity card + logout), `/admin/users` — all server-gated; shell preserved, not redesigned away | `auth/rbac.ts:71-100`, `app/admin/*.tsx` | VERIFIED |
| A4 | No MFA/OTP/SSO/password-reset for admins in contract (same absence class as storefront) | route inventory | VERIFIED ABSENT |
| A5 | Seeded identity: roles SUPER_ADMIN (all 31) + STORE_ADMIN; owner user + 8 settings; 31-key permission matrix intact, none added/renamed | `prisma/seed.mjs:74-165`, openapi `x-permission` counts | VERIFIED |

## 4. Role and permission matrix

Effective permissions are per-request server snapshots; grants/assigns ⊆ actor set (ceiling, 403);
role-row serialization; no implicit auto-join; SUPER_ADMIN rename/delete/revoke 403; self-deactivation
403; last-active-SUPER_ADMIN-holder operations 409 (concurrency-safe); zero-grant roles legal.

| Domain | View | Mutate | Notes |
|---|---|---|---|
| Catalog | `products.view` (10 ops) | `products.create` (5) / `update` (8) / `delete` (2) | Variants/prices/images/codes/categories/brands under same keys |
| Inventory | `inventory.view` (4) | `inventory.adjust` (5+) | Manual types only (§10); available GENERATED read-only |
| Orders | `orders.view` (3+) | `orders.update` (11: all fulfillment) / `orders.cancel` (1) | Credential rotate/revoke under `orders.update` |
| Promotions | `promotions.view` (2) | `create`/`update` (5)/`disable` | Status-gated, not deleted |
| Coupons | `coupons.view` (3) | `create`/`update`/`disable` | Usages read-only ledger |
| Customers | `customers.view` (9) | (scoped register/convert only) | Read-dominant; no customer password handling |
| Users | `users.view` (2) | `users.manage` (3: create/update/password) | Self/last-admin guards |
| Roles | `roles.view` (5) | `roles.manage` (7: CRUD + grants + member mapping) | Ceiling enforced |
| Settings | `settings.view` (2) | `settings.manage` (1: PATCH value) | Fixed key set, no create/delete |
| Audit | `audit_logs.view` (2) | — (append-only, no mutation API) | ADMIN-actor rows only |

STORE_ADMIN holds a subset (24 grants); SUPER_ADMIN holds all 31. Assignment beyond own set → 403,
no partial granting (atomic). UI renders sections by `permissions[]` from `GET /session`, but every
action expects 403 as a normal outcome (direct-URL access included).

## 5. Navigation and route-access policy (D45 authorization half OWNER-APPROVED — DECISION RECORDED)

- **Nav (authorization-hide by default, D45.A):** لوحة (dashboard) · الطلبات · الكتالوج · المخزون · العروض/الكوبونات · العملاء · المستخدمون والأدوار · الإعدادات · سجل التدقيق — each visible iff the corresponding `.view` (or `.manage`) permission is present in the current `GET /session` snapshot (D43 for dashboard honesty). Unauthorized actions are hidden by default in nav, menus, and page controls; a forbidden op is never presented as available merely because its page opens. Hiding is supplementary UX ONLY — the backend re-enforces every permission (crafted requests fail closed). No project convention requiring visible-but-forbidden modules was found in the reviewed shell — if one emerges, it will be documented as an explicit exception (none today).
- **Direct URL:** unpermitted screen → server 403 page (never client-only redirect games); unauthenticated → login with safe `next` (same-origin allowlist, cf. FP-11.7 D42 pattern).
- **Forbidden UX:** `غير مصرح — صلاحيات غير كافية` + back-to-dashboard; no permission enumeration to the user beyond their own sections; mutations attempted without permission surface the 403 envelope, never a client-side fake success. **Stale permissions:** on any 403 after previously-visible UI, refresh `GET /session` and re-evaluate visibility (role/grant changed mid-session); the failed action stays failed — re-showing it without the refreshed grant is forbidden.

## 6. Dashboard (D43 OWNER-APPROVED — DECISION RECORDED)

**Operational navigation landing page — not a metrics dashboard.** NO metrics endpoint exists (no
sales/revenue/order-count/bestseller/alert/growth/perf API — verified by route inventory, §3).
Dashboard = (1) identity card (name/email/roles from verified `GET /session`, as today);
(2) navigation shortcuts to existing admin modules, ONLY those permitted by the current permission
snapshot (§5); (3) concise session note (8h TTL) where useful. States: loading skeletons →
content; 401 → login; 403-on-refresh → permission re-evaluation (§5); transport/500 → error card +
retry (never a zero-filled fake dashboard). Missing/failed data is never presented as zero or as a
successful empty result.
**Explicitly excluded (no invent/estimate/derive, no multi-call simulation of a metrics endpoint):**
revenue/total sales, daily/monthly order counts, best-sellers, inventory alerts, growth percentages,
operational KPIs, charts. **Future extensibility:** metrics may be proposed as future work ONLY with
their own approved data contract + definitions + permissions + failure semantics + performance
expectations — never implied as supported. Usefulness without metrics is an acceptance criterion (AC-M3).

## 7. Catalog and product listing

- **List:** `GET /catalog/products` (admin): search/category/brand/type/price-window filters +
  keyset cursor (same conventions as FP-11.2 — no totals, no page numbers, 20k+ safe). Row shows
  contracted list fields ONLY (name/type/unit/category/brand/active); price/stock/images are NOT in
  list rows (separate endpoints — D44 bounded enrichment: variant price + availability + primary image
  fetched lazily per visible row, deduped/cached, per-row failure isolated, never blocking the grid).
  Normative listing/search/pagination/table detail: §E3–E4.
- **Search/sort/filter:** server-applied pre-pagination; name/created_at sorts (no price/popularity
  sort — same limitation as storefront).
- **Product GET:** detail + description; variants/images/counts via dedicated sub-routes.

## 8. Product detail and editing

- **Edit:** `PATCH /products/{id}` (`products.update`): name/description/category/brand/active per
  validation; 400 shape / 404 unknown / 409 conflicts (slug/name UQ) / 403 mapped; success → re-read.
- **Create:** `POST /products` (`products.create`) with required taxonomy; **Delete:** only where the
  `products.delete` route exists (2 ops) with explicit confirmation (destructive, irreversible —
  verify FK/reference consequences per response; never assume reversibility).
- **Categories/brands:** CRUD under same keys; `parentId` hierarchy + `sortOrder` merchandising order
  (FP-11.1 D02 semantics preserved — admin edits `sortOrder` directly).
- **Images:** product gallery GET/POST + `images/{id}` manage (`products.create` family); primary =
  `is_primary` else first (deterministic fallback); no binary upload contract beyond URL/metadata
  rows — verify field-level at build (no upload invention here).
- **Codes/barcodes:** `codes` CRUD (`products.create`); global UQ + primary flags; duplicates → 409.

## 9. Variants, barcodes, units, and weights

- Variant = purchasable entity (id/price/unit/stock per-variant; product-level flattening FORBIDDEN).
  Normative variant/barcode/weight detail: §E5–E6/E9.
- **Variants:** per-product GET/POST + `variants/{id}` manage; price via dedicated `price` route
  (`products.update`); `compareAtPrice` nullable reference with `>= price` invariant (server rejects
  breaches — surface, don't pre-empt).
- **Units/sale types:** PIECE (whole packs) vs WEIGHT (`sizeUnit` + `saleStepGrams` multiples) — same
  frozen rules as storefront; admin UX explains steps, never free decimals (server 422).
- **Barcodes:** global uniqueness enforced; primary designation; conflicts 409 with offending code.
- **No scale hardware import, barcode generation, bulk edit, or CSV** (FUTURE PROPOSALs if wanted).

## 10. Prices and inventory

- **Price change:** variant `price` route only (not product-level); requires `products.update`; shows
  old→new + drift consequence note (live carts will 409 at checkout until reprice — informational,
  not a blocking check); success → re-read variant.
- **Inventory reads** (`inventory.view`): per-variant quantities + GENERATED `available` + status +
  movements ledger (type/time/delta/actor/reference) with filters.
- **Adjustments** (`inventory.adjust` — 5 ops: adjust/commit/reserve/release/[variantId]): manual
  movement types ONLY (`STOCK_IN/ADJUSTMENT/WASTE/RETURN` + delta + reason + optional reference);
  `SALE/CANCELLED_ORDER/REPLACEMENT` rejected 400 (order-flow-owned). `available` NEVER editable.
- **Invariants:** reserve-then-commit preserved; adjustments never bypass holds/fulfillment; every
  adjustment pairs a movement row same-tx (auditability); concurrency conflicts → 409 + re-read.
  Normative pricing/inventory workflows (threshold PATCH, reserve/release/commit forms, field meanings,
  no-held-column, no-alert rule): §E7–E8.

## 11. Orders and order detail (summary — normative detail: FP-11-8-3)

- **List** (`orders.view`): status/customer-number/search/date filters + cursor pages; row:
  number/status/customer/total/created. **Detail** (`orders.view`): full snapshots + items + history +
  fulfillment actuals + discounts/fee rows.
- **Reads never mutate.** Foreign/unknown → 404 (no leakage).

## 12. Preparation, fulfillment, and replacements (summary — normative detail: FP-11-8-3 §§3–5)

Frozen machine: `NEW→CONFIRMED→PREPARING→READY_FOR_DELIVERY→OUT_FOR_DELIVERY→DELIVERED` (+`CANCELLED`
from NEW/CONFIRMED/PREPARING-unpicked). Illegal/repeat → 409.

| Action | Route | Permission | UX rule |
|---|---|---|---|
| Prepare | `POST …/prepare` | `orders.update` | CONFIRMED→PREPARING; 409 if already beyond |
| Pick line | `POST …/items/{itemId}/pick {actualQuantity}` | `orders.update` | Weighed fact only; R7 envelope + step rules server-side; actuals are PREPARING-only writes |
| Mark unavailable | `POST …/unavailable` | `orders.update` | Short-ship path (L1); substitute via replacements, never silent swap |
| Propose replacement | `POST …/items/{itemId}/replacements` | `orders.update` | Link-only proposal (never overwrite) |
| Withdraw proposal | `POST /replacements/{id}/withdraw` | `orders.update` | PROPOSED-only; 409 decided |
| Auto-accept toggle | `POST /replacements/{id}/auto-accept` | `orders.update` | Per-customer preference surface |
| Customer decide (assisted) | storefront decide route (customer/guest creds) | N/A (not admin-impersonated) | Admin NEVER approves as customer — no impersonation UI |
| Ready gate | `POST …/ready` | `orders.update` | Zero-PENDING + zero-PROPOSED required (frozen gate); 409 otherwise |
| Dispatch / Deliver | `POST …/dispatch` / `…/deliver` | `orders.update` | Sequential; terminal thereafter |
| Cancel (admin) | `POST …/cancel` | `orders.cancel` | Unpicked-only; picked lines → 409 (fulfillment-gated); releases holds once |
| Guest credential | `…/credential/rotate` + `/revoke` | `orders.update` | Recovery/support path; fresh token shown once (same once-only rules as FP-11.5) |

- **Business-state gating display (D45.B OWNER-APPROVED — DECISION RECORDED):** buttons for
  currently-illegal transitions render DISABLED (not hidden) with a specific actionable Arabic reason
  derived from the verified contract (e.g. `يتطلب حالة PREPARING — الطلب حاليًا CONFIRMED`,
  `يتطلب وزنًا فعليًا لكل سطر`, `البوابة تتطلب صفر أسطر معلقة/مقترحة`) — generic `غير متاح` ONLY when
  the reason cannot be reliably determined (honest fallback, never a guess; no invented prerequisite
  rules). Disabled controls expose `aria-disabled` + reason text to keyboard/AT users. A disabled
  action never implies future acceptance — the server stays authoritative (409 still expected on races).
- No driver assignment/tracking, customer notifications, or payment capture invented.

## 13. Promotions and offers (summary — normative detail: FP-11-8-4)

- **Promotions:** GET list/detail, POST create (`promotions.create`), PATCH (`update`), DELETE
  (`disable` — status-gated lifecycle, not physical delete); PUT `rules` (min qty/amount, caps),
  PUT `buy-get` (BXGY), POST/DELETE `targets` (variant/product/brand/category scope).
  Types: PERCENTAGE/FIXED_AMOUNT/BUY_X_GET_Y/FIXED_PRICE; scopes LINE/ORDER; priority→specificity,
  stacking caps — configured, never auto-explained beyond contracted fields.
- **Coupons:** POST create (`coupons.create`), PATCH (`update`), DELETE (`disable`); usages ledger
  read-only (`coupons.view` — never bumps counters); per-customer limits + minimums + windows
  server-validated (422 family at checkout).
- **Forbidden inventions:** analytics, scheduling automation, preview endpoints, unsupported rule
  types, public banners/feed (admin config ≠ storefront discovery — no offer feed exists).

## 14. Admin users and permissions (summary — normative detail: FP-11-8-5)

- **Users:** list/detail (`users.view`); create/update (`users.manage`); password provisioning
  (`POST …/password`, policy + Argon2id, lockout-reset + revoke-all same-tx, audited — secret
  body-only, never returned/logged).
- **Roles:** CRUD (`roles.manage`); grants add/remove per permission (ceiling ⊆ actor set, 403);
  members map/unmap (`roles.manage`); permissions catalog list (`roles.view`).
- **Guards surfaced honestly:** self-deactivation 403; last-SUPER_ADMIN-holder ops 409; SUPER_ADMIN
  role rename/delete + grant-revoke 403; zero-grant roles legal/assignable. Sensitive actions get
  explicit confirmation + outcome, but dialogs never substitute server auth (§19.6 pattern).

## 15. Audit log (summary — normative detail: FP-11-8-6)

- **Read** (`audit_logs.view`): GET list (filters: user/action/entity/entityId/dates — equality/range
  on indexed columns, NO full-text search) + GET `[id]`; rows: ADMIN-actor mutations paired same-tx
  (customer self-service stays unaudited — frozen rule, so customer actions simply don't appear).
- **Boundaries:** no password hashes/tokens/secrets in details (VERIFIED by construction); no mutation
  API (append-only); empty (no rows for filter) ≠ error. If audit access is denied → 403 section state.

## 16. API-to-screen mapping

| Screen | Routes + perms | Key fields | Errors |
|---|---|---|---|
| Login/session | `POST/GET/DELETE /admin/session` | email+password → cookie; identity+roles+perms | 400/401-generic/403-origin |
| Dashboard | `GET /session` only | identity, permission set | 401 |
| Catalog list/detail | `GET/POST /products`, `GET/PATCH /products/{id}`, variants/images/codes/categories/brands | contracted shapes; cursor pages | 400/404/409/403 |
| Prices/inventory | variant `price` PATCH; inventory GET/adjust family + movements | delta+type+reason; GENERATED read-only | 400-type/404/409/403 |
| Orders/fulfillment | orders list/detail + 12 action routes (table §12) | status machine + actuals + gate | 404/409-gate/403 |
| Promotions/coupons | promo CRUD+rules/buy-get/targets; coupon CRUD+usages | types/scopes/windows/limits | 400/404/409/403/422-refs |
| Users/roles | users CRUD+password+roles-map; roles CRUD+grants+members; permissions list | guards §14 | 403-ceiling/409-last-admin/404 |
| Settings | `GET /settings`, `GET/PATCH /settings/{key}` | fixed keys, typed values | 400-type/404/403 |
| Customers (read) | customers list/detail/addresses/register-convert | snapshots, no credential handling | 401/404/403 |
| Audit | `GET /audit-logs` + `/[id]` | filters §15 | 403/400-filter |

Customers-admin never handles customer passwords/sessions; credential rotate/revoke lives under orders.

## 17. Loading, empty, success, validation, and failure states (D45.C/D OWNER-APPROVED — DECISION RECORDED)

Standard matrix per screen: skeletons (`aria-busy`) → content → guided empty (no metrics-missing
errors) → per-section failure with retry (rest intact). Mutations: pending lock + duplicate guard
(in-flight: control disabled + progress communicated; re-enabled only when outcome + resulting state
permit) → confirmed re-read (never optimistic success; no success before the backend 200/201) →
mapped 400/401/403/404/409/422/429/500 Arabic messages (raw codes never shown); entered form data
preserved after recoverable errors where safe. Destructive/high-impact: explicit confirmation +
irreversible-consequence copy + post-success re-read. 403-section state distinct from 401-login state;
offline badge never triggers logout.
**Conflict/stale handling (D45.D):** 403 → not-permitted message + refresh `GET /session` and
re-evaluate visibility (stale-permission case); 409 → record-state/business-constraint message +
refresh authoritative record + show updated state; 401/expired → admin login flow (no secret detail);
network/500 → honest failure + retry ONLY when appropriate (never blind retry of destructive or
non-idempotent ops — adjust/cancel/pick/propose each re-armed only after re-read confirms non-effect).

## 18. Responsive, mobile, RTL, and accessibility requirements

- Admin is desktop-first BUT mobile-usable: tables → card lists under ~768px (behavior, not px mandate
  beyond Tailwind defaults); fulfillment pick flows usable one-handed (44px targets).
- `dir=rtl`, logical properties, `bdi`-isolated SKUs/numbers/money; Arabic-first labels with exact
  status names preserved in details for support.
- Keyboard: full operability, focus-to-error, focus-to-success-heading, trapped confirmations with
  restore, Esc dismiss; `aria-live` for mutation/fulfillment outcomes; non-color-only statuses
  (icon + text); no WCAG claim without testing. Brand tokens locked; font deferred.

## 19. Security and data-integrity rules

1. Backend-authoritative RBAC (§4); UI hiding/disabling supplementary only.
2. Admin secrets (passwords set via `users/[id]/password`, session cookies) never logged/returned/URL'd.
3. Guest credential rotate/revoke under `orders.update` with once-only fresh-token display (FP-11.5 rules).
4. Customer PII minimized (phones/addresses shown for operations only; no bulk export — none contracted).
5. No impersonation: admin never acts as customer/guest (decide/cancel-as-customer forbidden by design).
6. Confirmations supplement, never replace, server guards (§14).
7. Money/inventory math never client-computed as authority (server re-read after every mutation).

## 20. Open questions and backend gaps

| # | Gap | Status |
|---|---|---|
| B1 | No dashboard metrics API (sales/revenue/alerts) | BLOCKED — CONTRACT GAP (honest dashboard per D43) |
| B2 | No bulk/CSV/scale-hardware integration | FUTURE PROPOSAL |
| B3 | No binary image-upload contract (URL/metadata rows only) | NEEDS VERIFICATION at build (field-level) |
| B4 | No delivery assignment/tracking/notifications | UNSUPPORTED BY CURRENT API |
| B5 | No promotion analytics/preview/scheduling | UNSUPPORTED BY CURRENT API |
| B6 | No admin MFA/OTP/self-service password recovery (admin password provisioning via audited `users.manage` is NOT recovery) | ACCEPTED LIMITATION for dev/testing scope (never rendered); NOT evidence of production readiness |
| B7 | No product-row hard-delete route (only codes/images DELETE exist under `products.delete`); Restrict FKs would block product deletion regardless | ACCEPTED LIMITATION — product-delete UI out of scope (per-response handling retained as fallback) |

## 21. Decision register and rationale

> `RECOMMENDATION` = proposed, awaiting owner approval. `OWNER-APPROVED — DECISION RECORDED` =
> finalized in prior closure tasks (D43, D45) and in the gap-resolution task (D44, presentation-only).

| ID | Topic | Evidence & constraints | Options | Recommended | Trade-offs | Status |
|---|---|---|---|---|---|---|
| FP11-D43 | Dashboard: operational nav landing, metrics excluded | Zero metrics endpoints (route inventory §3); shell identity card today; metric meaning unfalsifiable without source | (a) Identity (verified session data) + permitted-shortcuts-only + session note + explicit loading/unauthorized/error states, zero metric cards (b) Estimated/derived cards or multi-call simulation (rejected: fabrication) | (a) Per §6 (no invented numbers; missing/failed data never shown as zero/empty-success; future metrics need own contract+permissions+semantics) | Less "rich"; truthful + useful | OWNER-APPROVED — DECISION RECORDED (2026-10-09) |
| FP11-D44 | Catalog per-row enrichment (price/stock/image) | List rows lack price/stock/images (contract split); 20k+ catalog; no batch endpoint | (a) Bounded lazy per-visible-row + dedupe/cache + per-row failure isolation (b) Eager fetch-all (rejected: N+1 storm) | (a) Bounded enrichment (FP-11.1/11.2 pattern) | More code; safe perf | OWNER-APPROVED — DECISION RECORDED (this task; presentation-only — server order preserved, API-fields/static-metadata only, nothing fabricated) |
| FP11-D45 | Authorization-hide vs business-state-disable + in-flight/conflict handling | Frozen machine + 409 races; ceiling/403 model (§4); stale-permission + duplicate-submit risks; keyboard/AT intelligibility | (a) Hide-by-default unauthorized (§5) + disabled-with-specific-reason business-state (§12) + single-flight in-flight + 403/409/401/network mapping (§17) (b) Show-all-then-fail / hidden-without-reason (rejected) | (a) Full D45.A–D split per §§5/12/17 (hiding supplementary only; backend authoritative; no blind destructive retry) | Denser UI; safe + honest | OWNER-APPROVED — DECISION RECORDED (2026-10-09) |

## 22. Acceptance criteria

> Specification-level only. NONE executed. No pass claimed.

- AC-M1: login/session/logout/8h-expiry/origin-enforcement/generic-errors per §3.
- AC-M2: matrix §§4–5 enforced server-side; unauthorized hidden by default yet 403 expected on stale/direct access; 403-section vs 401-login distinct.
- AC-M3: dashboard per §6 — identity + permitted shortcuts + session note; zero metric cards; missing/failed data never zero/empty-success; no multi-call simulation.
- AC-M4: catalog keyset + server filters; rows show contracted fields only; enrichment bounded (D44).
- AC-M5: product/variant model respected (no flattening); barcode UQ 409; step/unit rules; no hardware/bulk invented.
- AC-M6: price via variant route with drift note; inventory manual-types-only + GENERATED read-only + movement pairing per §10.
- AC-M7: fulfillment machine + gate + 12 actions per §12; disabled-with-reason vs hidden (§§5/12); no driver/notify/payment invented; cancel picked→409.
- AC-M8: promo/coupon CRUD + rules/targets/BXGY + usages-read-only per §13; no analytics/feed.
- AC-M9: users/roles guards (self-403, last-admin-409, SUPER_ADMIN-403, ceiling-403) per §14.
- AC-M10: settings fixed-keys + typed PATCH; customers read-dominant; audit filters without full-text per §§15–16.
- AC-M11: states per §17 (403/409/401/network/in-flight/conflict incl. no-blind-destructive-retry + form preservation) + a11y/RTL/responsive per §18; destructive confirmations; re-read after mutation; no pre-response success; RTL respected.
- AC-M12: zero-app-code (only FP-11.7 + FP-11.8 files added).

## 23. Evidence-based final verdict

```text
SPECIFICATION COMPLETE — D43/D44/D45 OWNER-APPROVED
```

Every section traces to §§3–4/16 or explicit §20 gaps (B1 ACCEPTED, B6 accepted dev/test-only,
B2/B4/B5 unsupported/future, B3 verify-at-build, B7 no-delete-route). D43 (nav landing, no metrics),
D44 (bounded enrichment, presentation-only) and D45 (hide-vs-disable + in-flight/conflict
handling) are finalized above. No backend evidence missing for any supported admin capability. Implementation separately authorized.

---

*End of FP-11.8 core sections — specification-only, no implementation.*

---

# FP-11.8.2 — Admin Product Catalog, Variants, Pricing, Barcodes & Inventory (Deep-Dive)

> Same classifications as FP-11.8 header. `SUPPORTED` / `SUPPORTED_WITH_LIMITATIONS` /
> `UNSUPPORTED` / `CONTRACT_AMBIGUITY` / `IMPLEMENTATION_UNVERIFIED` per-operation in §E2.
> Extends §§7/9/10 (their summaries stand; this part is normative detail). D43/D45 apply
> throughout; D44 bounded-enrichment pattern reused. New RECOMMENDATIONs D46–D48 (not approved).

## E1. Purpose and scope

Server-driven admin catalog UX for 20,000+ products: listing, search/filter/pagination, details/edit,
product→variant model, PIECE/WEIGHT rules, variant pricing workflow, barcode handling, variant-level
inventory visibility + authorized operations, permission-aware actions, states/a11y/RTL, acceptance,
dependencies. Orders/fulfillment/promotions/customers/roles/audit appear by cross-reference only.

## E2. API evidence matrix

| Capability | Route/method | Request/query | Response fields | Permission | Error semantics | Status |
|---|---|---|---|---|---|---|
| Product list | `GET /catalog/products` | `search≤160, category, brand, type, active(true/false), minPrice/maxPrice (positive 2dp; inverted→400), inStock(true/false), sort(name/created_at, default created_at/desc), dir, limit 1–100 d20, cursor(opaque)` | `ProductListItem{id,name,slug,productType,unit,saleStepGrams,isActive,category{},brand{}}` + `meta{limit,nextCursor}` — NO price/stock/image/variant-count | `products.view` | 400 query/cursor/price-window | SUPPORTED |
| Product get/create/patch | `GET/PATCH /products/{id}`, `POST /products` | create req `{name, categoryId, productType, unit}` + opt `{slug,description≤4000,brandId,saleStepGrams+int, isActive}`; patch: name/categoryId/isActive optional-only (explicit null→400), rest nullish (null clears nullable) | List-item shape (create → 201 + re-read) | view/create/update | 400/404/409 slug / 422 weight-shape | SUPPORTED |
| Categories/brands list/get/create/patch | `GET/POST /categories`, `GET/PATCH /{id}` (+ brands mirror) | `search≤120, parent(UUID\|"null"), active, sort/dir, limit/cursor`; create `{name + opt slug/description/image/parentId/sortOrder≥0/isActive}` | Shapes + `sortOrder` | view/create/update | 400/404/409 slug | SUPPORTED |
| Variants per product | `GET/POST /products/{id}/variants` | list: limit+cursor (fixed name-asc); create req `{name, price(2dp)}` + opt size/compare/cost/active | `VariantShape{id,productId,name,sizeValue(3dp\|null),sizeUnit,price,compareAtPrice\|null,isActive}` (+admin `costPrice`) | view/create | 400/404/422 shape | SUPPORTED |
| Variant get/patch | `GET/PATCH /variants/{id}` | patch: name/isActive optional-only; size/compare/cost nullish (null clears); PRICE EXCLUDED (→/price) | VariantShape | view/update | 400/404 | SUPPORTED |
| Price change | `PATCH /variants/{id}/price` | `{price(2dp, required), reason(≤500, optional)}` strict | Updated variant (200) | `products.update` | 400/404/422 exceeds-compareAt | SUPPORTED |
| Price history read | — (no GET) | — | History row written same-tx (with audit) but not readable | — | — | UNSUPPORTED (write-only; no timeline UI) |
| Images register/list | `GET/POST /products/{id}/images` | `{url(https only), altText≤200, mime(jpeg/png/webp/gif/avif, no SVG), byteSize/width/height+int, sortOrder, isPrimary}` | `{primary, gallery}` | view/update | 400 URL/mime/dims; 404 product | SUPPORTED_WITH_LIMITATIONS (metadata-only; NO upload flow) |
| Image patch/delete | `PATCH/DELETE /images/{id}` | `{altText, sortOrder, isPrimary}` (atomic primary switch) | Updated row / `{deleted:true}` | update / `products.delete` | 400/404 | SUPPORTED |
| Codes create/get/patch/delete | `POST /codes`, `GET/PATCH/DELETE /codes/{id}` | `{productVariantId, code(1–64, trimmed, case-sensitive, no whitespace), type(BARCODE\|INTERNAL_CODE), isPrimary?}`; patch: type optional-only, isPrimary nullish | Code row | create / view / update / `products.delete` | 400/404/409 duplicate (global UQ) | SUPPORTED |
| Code search/list | — (no list/search endpoint; `GET` by id only; store `codes/lookup` is the cashier aid) | — | — | — | — | UNSUPPORTED (admin barcode search absent — see §E4) |
| Inventory list/get | `GET /inventory`, `GET /inventory/{variantId}` | `search(product-name contains-insensitive ≤120), productId, inStock, lowStock, limit/cursor`; row embeds variant{id,name,sizeUnit,isActive}+product{id,name,slug,productType,unit} | `{quantity, reservedQuantity, availableQuantity(GENERATED), lowStockThreshold\|null, stockStatus, updatedAt}` | `inventory.view` | 400/404 | SUPPORTED |
| Threshold edit | `PATCH /inventory/{variantId}` | `{lowStockThreshold(≥0 3dp \| null clears)}` strict | Updated row (no movement) | `inventory.adjust` | 400/404 | SUPPORTED (thresholds ARE contracted — no alert mechanism exists) |
| Stock adjust | `POST /inventory/adjust` | `{productVariantId, delta(signed ≠0 3dp), movementType(STOCK_IN\|ADJUSTMENT\|WASTE\|RETURN), referenceType?, referenceId?(needs type), reason?(≤2000)}` strict | 201 adjustment+movement ids | `inventory.adjust` | 400-type/404/409 predicate | SUPPORTED |
| Reserve/release/commit | `POST /inventory/{reserve\|release\|commit}` | reserve/release `{variantId, quantity>0}`; commit `{variantId, requested, actual + refs?}` | 201 new reserved/available (+SALE movement for commit; R3/R7) | `inventory.adjust` | 409 insufficient/nothing-to-release; 422 commit-envelope | SUPPORTED (operational tools; checkout owns the order path) |
| Movements ledger | `GET /movements`, `GET /movements/{id}` | `variantId, movementType(7 incl. SALE/CANCELLED_ORDER/REPLACEMENT read-only), referenceType, referenceId≤64` | Movement rows (append-only) | `inventory.view` | 400/404 | SUPPORTED |
| Held quantity | — (no column; R3 uses requested) | — | — | — | — | UNSUPPORTED (only quantity/reserved/available exist) |
| Totals/counts | — (all lists keyset, `nextCursor\|null` only) | — | — | — | — | UNSUPPORTED (no totals; never estimate from page) |
| Bulk/CSV/scale-import | — | — | — | — | — | UNSUPPORTED (FUTURE PROPOSAL) |
| Sorts beyond name/created_at (products) | — | — | — | — | — | UNSUPPORTED (no price/popularity sort) |

Discrepancies recorded (not silently resolved): (1) product `unit` enum is `[PIECE,KG,GRAM]` in
openapi but the code schema allows `[PIECE,KG,GRAM,LITER,ML]`; the frozen weight rule only defines
PIECE→PIECE and WEIGHT→KG/GRAM+step — CONTRACT_AMBIGUITY for LITER/ML (safe UX: offer PIECE/KG/GRAM
only). (2) Storefront search is trigram/relevance while the ADMIN product list uses
case-insensitive `contains` on name — different semantics, both verified; admin UX must not promise
trigram relevance. (3) `search` on product list matches NAME only (codes not included) — barcode
search is UNSUPPORTED on this route.

## E3. Listing UX (20k+ scale)

- **Structure:** heading `المنتجات` + count-free description (`تصفح حسب البحث والفلاتر — تُعرض النتائج
  صفحات بدون إجمالي`) · search box · filter bar (category/brand/type/active/price-window/inStock) ·
  sort control (name/created_at × asc/desc) · table (desktop) / cards (mobile) · keyset pager
  (`التالي` only; forward-only cursor — "previous" = refetch from start with prior criteria, stated
  honestly) · `مسح الفلاتر` · details/edit navigation per row · `منتج جديد` button iff
  `products.create` permitted (else hidden per D45).
- **Search:** name-contains case-insensitive, partial-match capable (substring), combined with all
  filters server-side (pre-pagination); empty query = unfiltered list (no min length on admin list —
  unlike storefront `q≥2`); unknown params → 400 (sanitize client-side: drop unknowns, clamp limit,
  default sort). Case-insensitivity verified; normalization beyond trim/lowercase NOT verified — no
  diacritic/alef-maqsura promises.
- **Timing (D46 OWNER-APPROVED — DECISION RECORDED 2026-10-09):** 400ms debounce applies to
  interactive TYPING only (no contracted min length on this endpoint — empty query = unfiltered list,
  unlike storefront `q≥2`). Explicit submission (Enter/`بحث` button) searches IMMEDIATELY without
  waiting out the interval. Every new query/filter/sort combination INVALIDATES the previous cursor
  (cursor encodes sort value — reuse is a 400/fault class, so the client always resets to first page).
  Out-of-order protection: abort in-flight where the fetch layer supports it AND ignore stale arrivals
  via monotonic latest-wins (abort is client-local — the server may still process the cancelled
  request; results are what get discarded, never assumed unprocessed). Stale results are never
  rendered as current-query results. Invalid queries follow API validation (400 → sanitization message,
  never silent rewrite into an unrelated search). Empty query = full list per contract. Loading spinner
  (grid kept), inline failure + retry (rows kept), no-results vs failure distinct. Debounce is
  typing-scoped ONLY (never around mutations, barcode edits, or inventory ops) and never blocks
  keyboard submit (Enter bypasses the timer; focus visible; `aria-live` announces result counts).
- **Barcodes as strings:** any code input rendered/echoed verbatim (leading zeros, case preserved —
  codes are case-sensitive UQ); never numeric-cast, never arithmetic.
- **Filters/sorts:** each control maps 1:1 to §E2 params; changing ANY filter/sort/search resets cursor
  (cursor encodes sort value — old cursors invalid by construction); state in URL
  (`search/category/brand/type/active/minPrice/maxPrice/inStock/sort/dir/limit`; stale/invalid cursor
  → 400 message + refetch-from-start, cursors never shared as promises).
- **Scale guards:** no full-catalog download (bounded pages ≤100); no client-side catalog-wide sort/filter;
  no per-row enrichment calls on the list (D44: NO price/stock/image per row — table shows list-native
  fields only; variant/price/stock live on the details screen). Counts/totals never shown.
- **Return-from-details:** list URL (filters/sort, not cursor) restored + refetch-from-start; scroll
  restoration best-effort; prices/stock revalidated on details entry.

## E4. Table semantics (column classification)

| Column | Source | Rule |
|---|---|---|
| Name (+slug subline) | List row | Direct |
| Image thumb | — | OMITTED on table (details-only via images endpoint; neutral placeholder there) |
| Category / Brand | List row embedded | Direct |
| Sale type PIECE/WEIGHT (+unit) | List row | Direct |
| Variants summary | — (no count in row) | Details-only: `GET …/variants` count shown as `N صيغة` on DETAILS header, never per-row |
| Price | Variant entity | OMITTED on table (belongs to variants; multi-variant arbitrary-pick FORBIDDEN) |
| Barcode | Code entity | OMITTED on table (no list/search endpoint); details screen lists per-variant codes |
| Stock/availability | Inventory entity | OMITTED on table (inventory list is the stock screen; details shows per-variant row) |
| Status (active) | List row `isActive` | Direct (never color-only: icon + `نشط/موقوف`) |
| Actions (view/edit) | Permission-gated | `products.view/update` (D45 hide-by-default) |

Multi-variant products: table never picks a variant; details screen owns per-variant truth.

## E5. Details & editing

- **Layout (structured sections, not one long form):** header (name/type/status) · core fields ·
  variants (one row/card EACH, never merged) · per-variant codes · per-variant inventory (read) ·
  per-variant price workflow (§E7) · images gallery · danger zone (deletes, `products.delete` only).
- **Core fields:** name/category/description/brand/saleStepGrams/isActive per
  `productInputSchema/productPatchSchema` (explicit-null on non-nullable → 400 — client omits rather
  than nulls; nullable null CLEARS). NO `is_available` field anywhere (availability = derived
  `stockStatus` + sellability, never a stored copy).
- **Zero variants:** valid state — product renders with `لا توجد صيغ بعد — أضف صيغة للبيع`
  + create-variant CTA (`products.create`); unsellable until a sellable variant exists (never implied
  buyable). One/multiple: explicit per-variant rows; product↔variant ids never conflated in any payload.
- **Duplicate barcodes:** global UQ → 409 with offending code echoed where contracted; UI maps to
  `هذا الباركود مستخدم لصيغة أخرى` + preserves input + offers edit-different-code (no auto-regeneration —
  client-generated replacements FORBIDDEN).
- **Edit behavior:** initial values from GET; mirror-validation client-side (lengths/formats/enums);
  single-flight submit; pending lock; success ONLY on 200/201 → server re-read wholesale (no field
  patching, no optimistic price/inventory); failure preserves input + mapped message; stale/409 →
  refetch-then-decide (no blind retry; no invented ETag/version — none contracted).

## E6. PIECE/WEIGHT semantics

- **Frozen rule** (`catalog/writes.ts:75-88`, DB CHECK enforces): PIECE ⇒ `unit=PIECE` AND no
  `saleStepGrams`; WEIGHT ⇒ `unit∈{KG,GRAM}` AND positive integer `saleStepGrams`. Breach → 422
  weight-shape violation on create (400/422 class on patch paths).
- **PIECE UX:** unit fixed `PIECE`; step field hidden/disabled (sending a step breaches the rule);
  quantities whole packs (thousandths %1000==0) everywhere downstream.
- **WEIGHT UX (D47 OWNER-APPROVED — DECISION RECORDED 2026-10-09):** unit KG/GRAM selector +
  positive-integer step (grams); practical presets (125g/250g/500g/1kg/1.25kg) are PRESENTATION
  SHORTCUTS ONLY — offered per product/variant IFF `preset % saleStepGrams == 0` in a consistent unit
  (verified: `isStepMultiple(qty, step, sizeUnit)`, `inventory/quantities.ts`; integer/thousandths math,
  never float). A preset NEVER silently changes variant, price basis, or unit (selection fills the
  quantity field for the CURRENT variant context only). Presets are never a universal list: a product
  whose step admits none of the five shows NO chips (plain validated entry). Where preset validity
  cannot be established from product data + contract, chips are OMITTED (no guessing) and the existing
  free entry remains: inventory deltas accept any signed 3dp, `sizeValue` any positive 3dp — admin
  quantity entry is mirror-validated, NOT step-restricted (step enforcement lives on cart/checkout
  paths). No endpoint/field/config invented for presets. Selecting a preset ≠ validating a submission:
  every submit still passes full server validation (400/422 mapped).
- **Decimals:** money `NUMERIC(10,2)` strings, quantities `NUMERIC(12,3)` strings — parsed as decimal,
  never float; trailing-zero normalization (`130.00`→`130`) is display-exact, never value-changing;
  formatting preserves precision (no rounding in display). No client-computed authoritative
  inventory/price, ever.

## E7. Pricing workflow (dedicated, within variant details)

1. Identify product + exact `variantId` (shown, never inferred). 2. Display current
   server-confirmed `price` (+ `compareAtPrice` reference ONLY if non-null; struck styling, never a
   discount claim). 3. New-price input: positive 2dp decimal string; negative/zero/malformed →
   client block + server 400; exceeding `compareAtPrice` → server 422 (surfaced, not pre-empted —
   client MAY warn when compare-at known, must still send and honor 422). 4. Optional `reason` (≤500).
   5. Single-flight `PATCH …/price` (no double-send). 6. Success (200) → re-read variant (price +
   history-audit proof noted; timeline itself UNSUPPORTED — write-only history). 7. Failures:
   400 shape / 401 session / 403 (`products.update` missing) / 404 gone / 422 compare-at breach /
   429/500 generic — input preserved, mapped retry. 8. Stale/concurrent: no version/ETag contracted —
   last-writer-wins by construction; re-read-before-edit is courtesy, not a lock (stated; never
   promise conflict detection the API lacks). 9. NEVER show: promotional price, discount %, or
   crossed-out computed values (compare-at is a reference, not an offer proof — FP-05 rule).

## E8. Inventory UX (variant-level)

- **Fields (exact meanings):** `quantity` = physical on-hand (editable ONLY via movement ops below,
  never direct set); `reservedQuantity` = holds for live orders (system-owned; reserve/release/commit
  ops or order flows only); `availableQuantity` = GENERATED `quantity − reserved` (READ-ONLY, never
  written, never recomputed client-side); `lowStockThreshold` = admin-set watermark (PATCH, ≥0,
  null clears); `stockStatus` = derived (`out` iff available≤0; `low` iff threshold set and
  0<available≤threshold); movements = append-only ledger. NO `held_quantity` column exists (R3 uses
  requested — recorded, not invented).
- **Operations (all `inventory.adjust`, single-flight, confirmed re-read):** adjust form =
  variant picker (fixed context on details) + SIGNED delta (≠0, 3dp) + movementType
  (`STOCK_IN|ADJUSTMENT|WASTE|RETURN` ONLY — SALE/CANCELLED_ORDER/REPLACEMENT rejected 400 by design)
  + referenceType→referenceId pairing (id needs type) + reason ≤2000; reserve/release =
  `{variantId, quantity>0}` (409 insufficient / nothing-to-release); commit =
  `{variantId, requested, actual + refs?}` (R3/R7, 422 envelope breach, 409 predicate).
- **Threshold editing and display (D48 OWNER-APPROVED — DECISION RECORDED 2026-10-09):**
  `PATCH …/{variantId} {lowStockThreshold}` — same form family, NO movement
  row (contract); null clears. The product LIST (20k rows, zero inventory fields in
  `ProductListItem`) OMITS any threshold/stock column: no per-row supplementary requests (N+1
  forbidden), no full-catalog scan to compute thresholds, no invented default watermark, and the
  PATCH endpoint's existence is NOT treated as list-response presence. Thresholds appear ONLY where
  data exists: inventory list rows (each carries its own `lowStockThreshold`) and per-variant
  inventory details (single bounded `GET /inventory?productId=<id>` per DETAILS screen — one call,
  not per-row). A missing (null) threshold is NEVER displayed as zero. Semantics stay variant-level:
  multi-variant products get per-variant values, never a product-level aggregate. A configured
  threshold is NOT an alert: `low_stock` is a display derivation from documented semantics
  (`threshold set AND 0<available≤threshold`); no backend alert/notification exists.
  **No alert/notification mechanism exists** — `low_stock` is a display
  derivation only; labeling `منخفض` follows the derivation exactly; `غير متوفر` IFF `out_of_stock`
  per the derivation (never on fetch failure → `غير معروفة` + retry).
- **History:** movements list (variantId/type/reference filters) + detail read; empty ≠ error.

## E9. Barcode UX

- Text-first: verbatim echo (leading zeros, case — UQ is case-sensitive); types BARCODE vs
  INTERNAL_CODE (optional-only on patch — null rejected 400, omit instead); `isPrimary` atomic switch
  (one primary by construction); empty/null = no code row (never empty-string rows); duplicates → 409
  mapped truthfully; no client-generated replacements; no checksum/algorithm invention; no numeric
  parse/math. Keyboard: code field focusable with Enter-submit; scanner wedges work as keystrokes
  (no integration claimed — wedge-input only; limitations stated: no scan-feedback protocol, no
  duplicate-beep contract).

## E10. Permissions & visibility (D45 applied)

Per-action map (§E2 Permission column): reads hidden without `.view`; mutations hidden without the
exact mutate key (create vs update vs delete vs adjust vs cancel distinguished — e.g. image DELETE
needs `products.delete`, not just update). 401 → login; 403 → forbidden state + session refresh
(stale-grant case); 409 → record-state message + authoritative refetch; 422 → rule message; no
blind destructive retry; no pre-confirmation success. Owner/admin has ONLY granted permissions
(§4 ceiling — never assumed).

## E11. States, a11y, responsive (D45.C/D + FP-11.8 §§17–18 apply)

Initial/background-refresh skeletons → data → empty (catalog empty / no-results / filtered-empty
distinct) → API failure (grid kept + retry) → partial-supplement failure (core intact + per-row retry)
→ 401/403/409/422/pending/success per §17 rules. Semantic tables (`th scope`, caption), `aria-live`
for mutation/search outcomes, focus-to-error/success, trapped confirmations with restore,
`aria-disabled` + reason on disabled actions, non-color statuses, `bdi` SKUs/codes/numbers/money,
44px targets, tables→cards on small screens WITHOUT dropping identifiers (id/name/type preserved).

## E12. Acceptance criteria (defined, UNEXECUTED — no run authorized)

- AC-P1: 20k+ list server-driven (bounded pages, no totals, no full download, no client-wide sort/filter).
- AC-P2: name search (partial, case-insensitive) + combined filters; barcode search correctly ABSENT —
  no fake control, no page-only filtering, no per-row requests (L1).
- AC-P3 (D46): rapid typing coalesces to one settled request (400ms); Enter/button submits immediately;
  out-of-order arrivals discarded (latest-wins) with abort where supported; cursor resets on every
  query/filter/sort change; 400-stale-cursor → refetch-from-start; failure shows retry with rows kept;
  keyboard submit never blocked.
- AC-P4: cursor lifecycle (forward-only next, filter-change reset, 400-stale → refetch-from-start, return-from-details via URL filters); no totals derived (L4).
- AC-P5: product↔variant separation (no product-level price/barcode/stock; no arbitrary-variant pick; zero-variant state).
- AC-P6 (D47): presets offered IFF step-exact per product (125g–1.25kg candidates, incl. empty-chip case
  when none qualify + omitted-when-unverifiable case); incompatible units never offered; preset select
  never changes variant/price/unit; exact-decimal handling (no float); submit-time validation unchanged.
- AC-P7: decimal exactness (money 2dp/qty 3dp strings, no float, formatting lossless).
- AC-P8: barcode verbatim + case-sensitive 409 + no generated replacements + no numeric parse.
- AC-P9: price PATCH success/failure incl. 422 compare-at + write-only history (no timeline claimed — L2).
- AC-P10: inventory ops success/failure (adjust/reserve/release/commit/threshold) + GENERATED read-only + movement pairing + no SALE-type invention.
- AC-P11: D45 hide-vs-disable + 403-stale refresh + no-blind-retry + no pre-confirm success.
- AC-P12: 409 reconciliation (refetch-then-decide, no ETag invention).
- AC-P13: partial-failure isolation (core intact).
- AC-P14: states/RTL/keyboard/responsive incl. identifier-preserving cards + D46 keyboard-submit +
  D47/D48 screen-reader announcements for preset/threshold outcomes.
- AC-P15: zero fabricated fields/metrics/prices/stock; zero N+1 (no per-row calls on list); no upload
  or bulk controls rendered (L5); no totals displayed (L4).
- AC-P16 (cross-decision): list promises no barcode search (L1) · details promises no price timeline
  (L2) · weight UI offers no universal presets and contradicts no unit rule (D47/L3) · inventory list
  promises no product-list threshold column (D48) · pager promises no totals (L4) · metadata never
  implies upload (L5).

## E13. Dependencies, limitations & unresolved decisions

> D46–D48: OWNER-APPROVED — DECISION RECORDED (2026-10-09, this closure task; contract re-verified
> above — approval is not assumed from the prior report). L1/L2/L4/L5: accepted limitations (+ future
> proposals where tabled — owner acceptance of the limitation is requested at review; no backend work
> authorized). L3: CONTRACT_AMBIGUITY retained (unresolved — clarification requested, not resolved).

| ID/Item | Question/limitation | Evidence | Disposition + safe behavior | Owner? | Backend change? |
|---|---|---|---|---|---|
| FP11-D46 | Search debounce + submit + race/cursor semantics | No contracted timing or min-length on admin list (`productListQuerySchema` search nullish; empty = unfiltered); opaque cursor encodes sort value (400 on stale); abort is client-local | APPROVED: 400ms typing-only debounce; Enter/button immediate; cursor reset per query/filter/sort change; abort + monotonic latest-wins (server may still process aborted calls); 400-stale → refetch-from-start; never around mutations/inventory ops; keyboard submit unblocked. AC: AC-P3/P4/P14 | Recorded (no further approval needed) | No |
| FP11-D47 | Weight presets as presentation aid | Step enforced on cart/checkout paths (`isStepMultiple`, thousandths math); product rule WEIGHT→KG/GRAM+step; admin entry (deltas/sizeValue) mirror-validated, NOT step-restricted; variant sizeUnit optional | APPROVED: five candidates offered IFF step-exact per product in consistent unit; never change variant/price/unit; omit chips when none qualify or validity unestablishable; free validated entry preserved; submit-time validation unchanged. AC: AC-P6/P7/P14 | Recorded (no further approval needed) | No |
| FP11-D48 | Threshold in product list vs details | `ProductListItem` has zero inventory fields; inventory list rows carry `lowStockThreshold`; `PATCH …/{variantId}` contracted; null≠0; per-variant semantics; no alert mechanism anywhere | APPROVED: OMIT threshold/stock columns from product list (no per-row requests, no catalog scan, no invented defaults); show + edit on inventory list/details via existing endpoints (details: one bounded `productId` call); null never shown as zero; threshold ≠ alert. AC: AC-P10/P14/P15 | Recorded (no further approval needed) | No |
| L1 | No admin barcode search; no codes list | Route inventory (§E2: GET by id only; store lookup is cashier aid) | ACCEPTED LIMITATION (+ future proposal if needed: server-side code search endpoint — backend work, not authorized): name search → details → per-variant codes; no fake control, no page-only filtering, no per-row requests | CLOSED FOR CURRENT FRONTEND SCOPE — OWNER ACCEPTED (2026-10-09, §E16) | Would need contract |
| L2 | Price history write-only | No GET (route inventory; history+audit written same-tx on PATCH /price) | ACCEPTED LIMITATION (+ future proposal: history read endpoint): current confirmed price only; no timeline/audit-viewer/comparison UI; mutation ≠ read capability (stated) | CLOSED FOR CURRENT FRONTEND SCOPE — OWNER ACCEPTED (2026-10-09, §E16) | Would need contract |
| L3 | LITER/ML unit ambiguity → CLOSED by Direction A implementation | Boundary narrowed: `productUnitSchema` (PIECE/KG/GRAM) at Zod boundary (`validation.ts`), variant `sizeUnit` metadata preserved (5), openapi already aligned, no migration, no data rewrite; unit 16/16 + live 400/400/201 + catalog 56/56 green | IMPLEMENTED + VERIFIED (this task; §E15/E16) | Closed |
| L4 | No totals anywhere | Keyset-only (§E2) | ACCEPTED LIMITATION (+ optional future enhancement, not a prerequisite): cursor pager, no counts, never derived | CLOSED FOR CURRENT FRONTEND SCOPE — OWNER ACCEPTED (2026-10-09, §E16) | Would need contract |
| L5 | No upload flow; no bulk/CSV/scale | Route inventory (§E2) | ACCEPTED LIMITATION (+ separate future proposals if needed): metadata-only + controls omitted (omissions are not defects) | CLOSED FOR CURRENT FRONTEND SCOPE — OWNER ACCEPTED (2026-10-09, §E16) | Would need contract |

D46–D48 approval respected §4 (no scope expansion, no invented endpoints, no D43/D45 reopen).

## E14. Cross-references

D43 (no metrics — no stock "alert cards", §E8 derivation-display only) · D45 (hide/disable/in-flight/
conflict — §§E10–E11) · D44 (bounded enrichment — list shows native fields only; DETAILS may enrich
per-variant bounded + cached + per-row failure) · FP-11.1 D02 (`sortOrder` admin-editable) ·
FP-11.3/FP-05 step/estimate rules · FP-11.4 D29 (supplemental-failure isolation pattern).

## E15. L1–L5 Owner-Decision Closure (2026-10-09; specification-only, no backend change)

Evidence hierarchy applied: approved decisions > implementation/validation > OpenAPI > schema >
spec text > proposals. D43/D45/D46/D47/D48 preserved untouched. Nothing below invents endpoints,
fields, permissions, statuses, or rules, and nothing authorizes future backend work.

### L1 — Barcode/internal-code search: CLOSED FOR CURRENT FRONTEND SCOPE

- **Question:** accept name-only search for this phase, or require backend-enhancement investigation first?
- **Evidence:** admin product `search` = name-contains-insensitive (`catalog/queries.ts:158`); no
  codes list/search route (§E2 — `GET /codes/{id}` by id only; store `codes/lookup` is the cashier aid,
  not a global search); `search` never matches codes.
- **Disposition:** ACCEPT the limitation for the current phase (default safe recommendation).
  Fallback stands: name search → product details → per-variant code management (§§E3–E5/E9).
  PROHIBITED: fake search controls, page-only filtering passed off as global search, per-row code
  requests, any claim that name search covers codes. Future server-side code search stays a SEPARATE
  proposal requiring its own authorization (not granted here). Owner acceptance of this limitation is
  requested at spec review; no implementation may proceed on an assumed future endpoint.

### L2 — Price-history read: CLOSED FOR CURRENT FRONTEND SCOPE

- **Question:** accept current-price-only display, or require read-endpoint investigation first?
- **Evidence:** `PATCH /variants/{id}/price` writes price + history row + audit in one tx (openapi
  931–949; route comment "history"); no GET history endpoint anywhere in the route inventory.
- **Disposition:** ACCEPT current-price-only display (default safe recommendation). A mutation that
  WRITES history/audit records is NOT equivalent to a readable history API — the distinction is
  normative (§E7). Display current server-confirmed price; fabricate no historical values/timestamps;
  promise no retrieval; keep history viewing as a SEPARATE future proposal (not authorized).
  Price-update contract (reason ≤500, compare-at 422, same-tx audit) unchanged.

### L3 — LITER/ML unit ambiguity: CLOSED by Direction A implementation (this task)

- **Prior question** (kept for history): can this close at spec level, or does it need a backend/API owner decision?
- **Evidence as reinspected** (points 1–6 + answers stand as recorded below; the boundary item is now
  superseded): Zod boundary accepted 5 → **narrowed to `productUnitSchema` (PIECE/KG/GRAM)**;
  variant `sizeUnit` intentionally keeps 5 (packaging metadata — removal never proven necessary).
- **Implemented disposition:** product input offers/accepts PIECE/KG/GRAM only (400-class boundary,
  consistent with all other enum inputs); LITER/ML product writes rejected before domain weight rule;
  variant metadata path untouched; openapi already documented 3 (now aligned, no doc change needed);
  no SQL/Prisma change, no migration, no data rewrite; WEIGHT-transaction math untouched (mass-only,
  per constraint). Verified: unit 16/16 + live `admin-liter-unit-400`/`admin-ml-unit-400`/
  `admin-variant-ml-size-201` + catalog 56/56 + tsc/eslint/build/prisma/route-coverage green.

- **Historical evidence (retained — justified Direction A; boundary item superseded by implementation):**
  1. OpenAPI product-create `unit` enum: `[PIECE, KG, GRAM]` ONLY (`openapi.yaml:839`) — narrower
     than the implementation; LITER/ML appear NOWHERE in openapi (verified by search).
  2. Zod `sizeUnitSchema`: `[PIECE,KG,GRAM,LITER,ML]` (`catalog/validation.ts:54`) — accepted at the
     boundary for product `unit` AND variant `sizeUnit`.
  3. Prisma: free-text `VarChar(10)` with comment "PIECE | KG | GRAM | LITER | ML (CHECK in SQL)"
     (`schema.prisma:73,94`) — no client enum.
  4. Frozen SQL: `chk_products_unit` allows all 5 (`phase1-schema.sql:136`), but the WEIGHT-shape
     CHECK admits only `WEIGHT→KG/GRAM+step` and `PIECE→PIECE+no-step` (`:145-148`); variant
     `chk_variants_size_unit` allows all 5 or NULL (`:181-182`).
  5. Domain mirror `assertProductWeightShape` (`catalog/writes.ts:75-88`) rejects LITER/ML for BOTH
     product types (422) — so no product row can carry them VIA the API; variant `sizeUnit`
     LITER/ML passes creation unchecked (spread `?? null`, no coherence check found).
  6. Downstream incoherence: cart step math branches `GRAM ? step×1000 : step` — a LITER-sized
     quantity would be computed in gram step units (mass/volume confusion); `phase1-schema.sql:314`
     already warns summed totals across ML/LITER are unit-incoherent.
- **Answers:** (1) sets live in openapi-3-enum / code-5-enum / SQL-5-with-2-way-shape / Prisma-text;
  (2) YES at the Zod boundary, but the product domain rule 422s every LITER/ML product combination;
  variant `sizeUnit` LITER/ML passes creation; (3) product rows: only via non-API writes; variant rows:
  yes, via API; (4) schema permits both columns' 5-values; (5) NOT aligned — docs(3) ⊂ rule(2-way) ⊂
  boundary(5); (6) coercion risks: density-unknown L↔kg conversion, frozen-data rewrite, gram-step
  arithmetic on liter units, incoherent totals.
- **Disposition:** KEEP the ambiguity OPEN for the backend/API owner (do NOT declare it fixed); CLOSE
  the interim frontend restriction at spec level: offer PIECE/KG/GRAM only on product input; render
  any existing LITER/ML value truthfully (verbatim, `bdi`-isolated) with incompatible edits DISABLED
  + accessible reason (`وحدة غير مدعومة للتحرير — تُعرض كما هي`); never convert, normalize, or rewrite
  stored units; never invent a save path for unsupported combinations. Clarification requested: the
  intended LITER/ML lifecycle (variant-only? legacy? full volumetric support with liter-based steps?).

### L4 — Pagination totals: CLOSED FOR CURRENT FRONTEND SCOPE

- **Question:** accept cursor-only navigation for this phase?
- **Evidence:** every list returns `meta{limit,nextCursor}` / `nextCursor|null` (§E2); no count field
  on any catalog/inventory route.
- **Disposition:** ACCEPT (default safe recommendation): `nextCursor`-driven pager, forward-only;
  no fabricated totals, no page-derived inference, no fetch-all-to-count; filter/sort change resets
  cursor; invalid cursor → documented refetch-from-start. Total-count support = optional future
  enhancement, NOT a prerequisite. Owner acceptance requested at review.

### L5 — Upload/bulk/CSV: CLOSED FOR CURRENT FRONTEND SCOPE

- **Question:** accept metadata-only + no-bulk scope for this phase?
- **Evidence:** images contract = metadata registration (https URL + mime allowlist + dims) with
  PATCH/DELETE rows; zero upload-transport/signing/multipart/progress routes; zero bulk/CSV/scale
  routes (§E2).
- **Disposition:** ACCEPT (default safe recommendation): show registered metadata/URLs per response +
  security rules; omit upload/bulk controls (omissions are not defects); never imply URL registration
  uploads bytes; no signed-URL/storage-provider/multipart invention; no bulk edit/CSV/scanner/scale.
  Each = SEPARATE future proposal requiring explicit authorization (not granted). Owner acceptance
  requested at review.

## E16. Final Review Closure — Owner Acceptance & L3 Contract Audit (2026-10-09)

Documentation governance only. No implementation, backend, database, or authorization change.
D43/D45/D46/D47/D48 preserved unchanged in meaning; D44 remains deferred RECOMMENDATION (not
reviewed, not a blocker, not implementation approval).

### E16.1 Owner acceptance recorded — L1/L2/L4/L5

Per explicit owner decisions (task §2, authoritative — not agent recommendations):

| ID | Accepted scope | Deferred (separate proposal + explicit authorization, NOT granted) | Status |
|---|---|---|---|
| L1 | Name-only search + details→codes fallback; prohibitions stand (§E15) | Server-side code search endpoint | OWNER ACCEPTED — CURRENT SCOPE LIMITATION (2026-10-09) |
| L2 | Current-price-only display; mutation≠read | History read endpoint / timeline UI | OWNER ACCEPTED — CURRENT SCOPE LIMITATION (2026-10-09) |
| L4 | Cursor pager, no totals, never derived | Total-count support | OWNER ACCEPTED — CURRENT SCOPE LIMITATION (2026-10-09) |
| L5 | Metadata-only images; no upload/bulk/CSV/scanner/scale controls | Upload transport, bulk/CSV, scanner/scale integrations | OWNER ACCEPTED — CURRENT SCOPE LIMITATION (2026-10-09) |

Acceptance of these limitations authorizes NO deferred capability.

### E16.2 L3 evidence matrix (reinspected 2026-10-09 — every row actually inspected this task)

| # | Question | Finding | Evidence path/lines | Consistency |
|---|---|---|---|---|
| 1 | OpenAPI unit enums per request/response | Product-create `unit`: `[PIECE, KG, GRAM]`; variant-create documents `[name, price]` only (no unit/size fields); reads expose `sizeUnit` (VariantShape) | `openapi.yaml:833-839,867-877`; `catalog/serialize.ts:117-130` | Docs NARROWER than code (safe direction, but incomplete) |
| 2 | OpenAPI scope | Applies to product-create input; NOT to variant create/update inputs (absent fields) nor to read shapes (pass-through) | Same as above | Partial coverage — not a full unit contract |
| 3 | Runtime validator | `sizeUnitSchema` = 5 values, shared by product `unit` + variant `sizeUnit` | `catalog/validation.ts:54,141,194-195,163` | Boundary accepts 5 |
| 4 | Per-type combinations | Product: PIECE→PIECE/no-step, WEIGHT→KG/GRAM+step enforced (422 otherwise); variant `sizeUnit`: NO coherence check at create/patch | `catalog/writes.ts:75-88,336-337,357-389` | Products fenced; variants open |
| 5 | Prisma + SQL constraints | Prisma free-text + CHECK comment; SQL `chk_products_unit` allows 5, weight-shape CHECK enforces 2-way; variant CHECK allows 5/NULL | `schema.prisma:73,94`; `phase1-schema.sql:134-148,178-182` | Schema permits 5; shape rule fences products |
| 6 | Enum vs free text | No Prisma enum; VarChar(10) + SQL CHECKs (5 values each) | Same as above | Constrained text, not closed enum |
| 7 | Read/serialize LITER/ML | Pass-through verbatim (`sizeUnit: v.sizeUnit`), no failure branch | `catalog/serialize.ts:129-130` | YES — reads never break |
| 8 | Update without changing unit | PATCH spreads ONLY provided fields (`...(input.sizeUnit !== undefined ? … : {})`); legacy value persists untouched | `catalog/writes.ts:380-389` | YES — supported |
| 9 | Legacy revalidation | Unchanged values are NOT re-checked (only provided sizeValue/compareAt trigger `assertVariantShape`, which checks price/compareInvariant — not unit coherence) | `catalog/writes.ts:362-377` | Legacy exempt — display/edit rule in §E15 stands |
| 10 | Downstream KG/GRAM assumptions | `isStepMultiple`: only `"GRAM"` special-cased, all else (KG/LITER/ML/null) uses gram-step modulus; `countingUnitFor` returns raw `sizeUnit`; commit envelope mirrors it; SQL comment warns ML/LITER totals incoherent | `inventory/quantities.ts:23-50`; `cart/writes.ts:89-115,383-396`; `phase1-schema.sql:314` | YES — liter units compute in gram semantics (incoherent) |
| 11 | Layer consistency | Docs(3) ⊂ rule(2-way) ⊂ boundary(5) ⊃ reads(any-of-5) vs downstream(gram-shaped) | §§above | NOT mutually consistent |
| 12 | Verified vs uncertain | Verified: all rows above (inspected). Uncertain: whether any production row holds LITER/ML (no DB read authorized — fixture "LITER" labels in `db/tests/run-tests.js:20-21` are product NAMES on PIECE-unit lines, not `size_unit` values); whether LITER/ML was ever an intended volumetric track (no design doc found stating so) | `db/tests/run-tests.js:20-21,337-350` (name usage only) | Absence noted, not filled |

### E16.3 L3 options analysis (evaluated, none chosen silently)

- **Option A (not supported):** FEASIBLE as a fence (matches product rule + openapi + downstream); RISK: if legacy/variant LITER rows exist, creation-path 422s don't clean them — needs compatibility handling (§E15 interim rule already covers display); requires contract owner to confirm canonical combos + narrow docs/code enums (NOT done here).
- **Option B (intended volumetric support):** NOT currently feasible without backend work — requires liter-based step semantics, coherent downstream math, persistence review, and tests (none exist); inventory fixtures use PIECE lines. Backend/API changes + tests required (NOT done here).
- **Option C (legacy-compatible reads, restricted writes):** matches OBSERVED behavior most closely (reads pass through, PATCH preserves untouched, creation fenced for products but open for variant `sizeUnit`) — but no evidence establishes it as DELIBERATE policy vs accidental inconsistency. Must NOT be adopted as policy without owner approval.
- **No option is ruled out by source evidence alone** (tests use PIECE-unit lines throughout; nothing asserts volumetric support or its absence at the domain level beyond the product shape rule).

### E16.4 Exact question for the API/business contract owner

> For admin catalog units: is `LITER`/`ML` an intended supported unit anywhere in the product-variant
> lifecycle, or should the supported set be closed to `PIECE` (piece goods) and `KG`/`GRAM` (weight
> goods)? If intended: which product types may use them, what are the authoritative quantity/step
> semantics (the current gram-step modulus in `isStepMultiple`/`envelopeAllows` assumes mass), and
> which persistence, validation, OpenAPI, and downstream changes + tests are approved to support them?
> If not intended: confirm the canonical closed set, approve narrowing the Zod boundary + variant
> `sizeUnit` handling + OpenAPI to match, and direct compatibility handling for any existing
> LITER/ML records (display-only per the current interim rule, or migrate). Do not answer by
> assumption — cite the deciding business rule or approve the investigation.

Essential subquestions: (a) may variant `sizeUnit` accept values the product weight rule rejects?
(b) should PATCH revalidate legacy `sizeUnit` values? (c) is volumetric (density-aware) commerce in
scope at all? The project owner routes this to the responsible API/business contract owner; the
answer — not this audit — closes L3.

### E16.5 Interim frontend restriction (CLOSED — stands as specified)

PIECE/KG/GRAM input only; existing LITER/ML rendered verbatim (`bdi`) with incompatible edits
disabled + accessible reason; no conversion/normalization/rewrite; no invented save path; editable
sibling fields PATCHed independently ONLY where the update contract supports partial writes without
forcing a unit mutation (verified: variant PATCH spreads provided fields only — §E16.2 row 8).
This restriction does NOT resolve the backend discrepancy.

### E16.6 D44 deferred (untouched)

D44 remains RECOMMENDATION, explicitly deferred by the owner: no review performed, no new
requirements added, not a blocker, not implementation approval. Prior D44 text preserved verbatim.

### E16.7 L3 + G5 implementation closure (this task — owner-authorized scope)

- **L3 Direction A implemented:** `productUnitSchema` (PIECE/KG/GRAM) at the Zod boundary
  (`catalog/validation.ts`); variant `sizeUnit` metadata untouched (5 values); openapi already
  aligned (no doc change needed); no SQL/Prisma/migration/data changes; no conversions; no math
  changes. The §E16.4 contract-owner question is RETIRED as moot for the sale-unit path (boundary
  now equals the documented + enforced model); variant-metadata lifecycle needs no decision
  (preserved as-is by constraint). Verified: t-catalog-unit 16/16, live 400/400/201 assertions,
  catalog 56/56, tsc/eslint/build/prisma/route-coverage green, scratch matrix adjacent suites green.
- **G5 implemented (HMAC-hardened this task):** isolated `reg:` buckets (IP 30 + HMAC-bound
  phone 10 /15min, secret `REG_RATE_LIMIT_PHONE_SECRET`) on the existing `customer_auth_rate_limits`
  table (no migration); generic 429; duplicate-409 semantics preserved; no raw phone in keys/bodies;
  missing/invalid secret fails closed (generic 500, no SHA-256 fallback); rotation orphans prior
  phone counters (documented). Verified: unit 9/9 (incl. missing/empty/short-secret throws) + live
  14/14 (incl. HMAC-bound proof, no-fallback proof, fail-closed 500, isolation) + customer-auth 37/37.
  IP trust is environment-dependent (local/direct XFF is client-controlled; Vercel edge behavior
  needs platform-aware verification — phone bucket stands as the independent defense).
- **G5 env readiness (this task):** local dev secret lives Git-ignored in `.env.local` (server-side
  only, never `NEXT_PUBLIC_`; live-proven: dev server resolved it, register → 201). Preview-only
  `REG_RATE_LIMIT_PHONE_SECRET` registered on the verified project (metadata-only check; value never
  handled). Active Preview deployment NOT proven to consume it — new Preview build required, not
   triggered, no deploy performed. Rotation consequence stands: new secret orphans prior phone counters.
- **IP trust boundary status (documentation + evidence only; no code/infra change):** extraction reads
  the first `X-Forwarded-For` entry — CODE-VERIFIED (`register/route.ts:55` and the identical login,
  guest-order, and admin-session call sites; no middleware, no `trustProxy`, no proxy docs in repo).
  Local/direct execution: header is client-controlled, so the IP bucket is bypassable there (spoofing
  follows directly from the code; no trusted layer exists). Direct Vercel requests: vendor request-header
  docs state the edge overwrites `X-Forwarded-For` to prevent spoofing (`x-vercel-forwarded-for`
  identical; custom XFF trust is Enterprise-only) — PLATFORM-DOCUMENTED, but our actual deployment path
  is NOT header-observed and no deploy was performed here, so DEPLOYMENT-PATH-VERIFIED is explicitly
  NOT claimed. Additional-proxy topologies: UNVERIFIED (none evidenced; must not be assumed).
  Standing consequence: IP throttling is defense in depth, not a guaranteed anti-abuse boundary where
  the source may be spoofed; approved phone-bucket limits (30-IP / 10-phone per 15 min) are unchanged.

---

*End of FP-11.8.2 — specification-only, no implementation.*
