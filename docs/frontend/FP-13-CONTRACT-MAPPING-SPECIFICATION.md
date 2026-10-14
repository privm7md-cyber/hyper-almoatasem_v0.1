# FP-13 — Frontend–Backend Contract Mapping & Integration Specification

> Evidence hierarchy: implementation/tests > OpenAPI/schemas > approved decisions > prior FP specs.
> Specification-only — no API clients, hooks, or stores created; no packages installed.
> Conventions: 98 API paths (FP-09 count); envelopes `{data,meta}` / `{error:{code,message,details}}`;
> decimals exact strings (money 2dp, qty 3dp); pagination is endpoint-specific (§1.1 — no universal
> protocol; limit 1–100 d20, `nextCursor|null`, forward-only everywhere, no totals/offsets).

## 1. Screen→API inventory (endpoint coverage per domain)

| Screen / Feature | Action | Method + Endpoint | Key req/resp | Auth / RBAC | Errors → retry/revalidate | Evidence | Gap |
|---|---|---|---|---|---|---|---|
| Home/discovery | List, search, categories, brands | `GET catalog/products|search|categories|brands` | filters/sorts/cursor; list rows w/o price/stock/image | Public | 400 sanitize; 404 unknown | openapi + FP-11.1/11.2 | No totals/autocomplete/popularity |
| PDP | Detail + variants + images + stock + codes | `GET products/[id]`, `…/variants`, `…/images`, `inventory/products\|variants/[id]` | variant price basis; gallery fallback; availability strings | Public | 404 unknown/inactive; unknown-stock ≠ OOS | FP-11.3 | No reviews/related/restock |
| Cart | Mint/resolve/read/mutate/merge/reprice | `POST|GET /cart`, `POST|DELETE items`, `PATCH|DELETE items/{id}`, `POST merge|reprice` | full-cart echo; XOR identity; step rules | Guest header XOR session | 400/401/404/409/422 mapped | FP-11.4 | Echo shape re-verify at build |
| Estimate/checkout | Preview + submit + credential | `POST orders/estimate`, `POST orders` (+key header/body) | snapshots; 409-drift/stock; one-time `guestOrderToken` | Session XOR guest bearer | 409 new-key review; ambiguous same-key resolve | FP-11.5 | D39 staff path; no payments |
| Addresses | CRUD + default switch | `GET|POST /customers/addresses`, `GET|PATCH|DELETE /{id}` | city+phone required; `isDefault` + 409 race | Session self-scoped | 404-gone → relist | FP-11.5/11.7 | No coverage lookup |
| Account/auth | Register/login/session/password/logout/orders | `POST register|session`, `GET|DELETE session`, `PATCH password`, `GET /orders`, `GET orders/{id}` | 30d sessions; generic 401s; lockout/buckets; key echo in list | Session | 401 relogin; 409 duplicate→login | FP-11.7 | No OTP/reset/profile-PATCH/sessions-list |
| Guest order access | Read/cancel/decide by credential | `GET orders/{id}`, `POST cancel`, replacements `GET|decide` + `x-guest-order-token` | 90d TTL; 401/410/404; keep-same replay | Per-order bearer | Expired → terminal; no self-recovery | FP-11.5/11.4 | D39 staff path only |
| Admin catalog | CRUD + variants + price + images + codes + taxonomies | catalog admin routes (§FP-11.8.2 E2) | 3-unit boundary; compare-at guard; UQ 409s | `products.view/create/update/delete` | 400/404/409/422 + refetch | FP-11.8.2 | No barcode search/timeline/totals/upload |
| Admin inventory | Reads + 5 ops + threshold + movements | inventory routes (§FP-11.8.2 E2) | GENERATED read-only; manual types only | `inventory.view/adjust` | 409-predicate + refetch | FP-11.8.2 | No alerts |
| Admin orders/fulfillment | List + 12 actions | orders admin routes (§FP-11.8.3) | frozen machine; R2/R7; snapshots | `orders.view/update/cancel` | 409-gate + refetch | FP-11.8.3 | No driver/notify/payments |
| Admin promos/coupons | Config + usages | promo/coupon routes (§FP-11.8.4) | 4 types; autos+coupon server-side | `promotions.*/coupons.*` | 422-checkout family | FP-11.8.4 | No analytics/feed/preview |
| Admin users/roles/audit | Identity + grants + log reads | users/roles/grants/members/password + audit reads | ceiling/guards; append-only log | `users.*/roles.*/audit_logs.view` | 403-ceiling/409-last-admin | FP-11.8.5/8.6 | No MFA/OTP |

Unsupported (never mapped as available): offers feed, totals, autocomplete, price/popularity sort,
reviews/related/favorites, batch endpoints, payments/refunds/OTP/password-reset, upload/CSV/scale,
delivery zones/drivers/tracking/notifications, profile PATCH, session lists, metrics/analytics.

### 1.1 Endpoint-specific pagination protocols (Decision A closed)

No offset/page-number mechanism exists anywhere (grep-verified in `src/lib`). Each family below is
independent; adapters (§FP-12 Pagination) translate, never impose:

| Endpoints | Protocol | Params | Meta | Evidence |
|---|---|---|---|---|
| Storefront catalog lists (products/categories/brands) + admin catalog mirrors | Opaque keyset | `limit`, base64url `cursor` (sort-field,id), `sort/dir` | `meta{limit,nextCursor}`, `null`=end; malformed→400 | `lib/api/validation.ts:31-42`, `lib/api/pagination.ts:3-85`, `lib/catalog/queries.ts:5-33` |
| Orders, customers, inventory, promotions, roles/permissions/users admin lists | Raw UUID cursors | `limit`, `cursor` uuid (`id gt/lt`), `take limit+1` | `nextCursor\|null`, no totals | `lib/admin/queries.ts:17-148`, `lib/orders/queries.ts:30-78`, `lib/inventory/queries.ts:11-131`, `lib/promotions/queries.ts`, `lib/customers/queries.ts:10-37` |
| Catalog search | Search cursors | opaque `cursor` (tier/sim/id) | `nextCursor\|null` | `lib/catalog/search.ts:41-69,210-236` |
| Audit logs | UUID wire over `(created_at,id)` tuple | `cursor` uuid | `nextCursor\|null` | `lib/admin/queries.ts:140-148` |

Forward-only throughout (no previous-page); criteria change resets the cursor. Nothing here is UNVERIFIED.

## 2. Contract→component mapping

- ProductCard ← catalog list rows + per-card variant/inventory/images enrichment (FP-12 §4).
- AddToCartButton → `POST cart/items` (never local-count success).
- CartSummary ← full-cart echo subtotal + estimate preview (never client math as authority).
- DataTable ← keyset pages (+meta limit/cursor); StatusBadge ← frozen state sets (display only).
- ConfirmDialog → user confirmation only; execution stays in the feature action + backend.
- Auth forms → session/register/password/logout routes (cookie managed by server; no token storage).
- Address forms → address CRUD (saved) or inline snapshots (guest) — never mixed.
- Fulfillment/promo/user forms → respective admin routes with permission-gated visibility (D45).

## 3. Future communication layer (proposed location, NOT created) + verified boundaries (Decision B closed)

Verified existing code (not assumed):
- **Server-only modules** (`import "server-only"` in ~25 `src/lib/*` files: all writes/services/sessions/
  rbac/db; pure exceptions: `cart/totals`, `promotions/engine`, `admin/policy`, `orders/state-machine`,
  `customers/phone`, `inventory/quantities`, `auth/reg-phone-bucket`, validation/serialize files) must
  NEVER be imported into browser-executed Client Components or client bundles.
- **Server Actions exist and are supported**: `"use server"` + `loginAction`/`logoutAction` in
  `src/app/actions/auth.ts`, consumed via `useActionState` by the sole Client Component
  (`src/app/admin/login/LoginForm.tsx`). This is the verified action mechanism for admin login/logout.
  No other Server Actions exist (only `auth.ts` in `app/actions/`).
- **Server-rendered reads** (RSC admin pages via `requireAdmin`/`requirePermission`, public catalog
  reads) may use server-only utilities — verified pattern, unchanged.
- **Browser-initiated mutations** use: (a) the verified Server Actions above where present, else
  (b) `fetch` to an actual supported HTTP endpoint (no shared client util exists — suites call routes
  directly in tests; no production client code does yet). Shared presentation components must not
  depend on server-only modules, databases, secrets, or privileged internals.
- **No client-safe HTTP utilities, data stores, or additional Server Actions exist** — anything beyond
  (a)/(b) is future work, not available API.

Verified request paths (`UI interaction → client-safe mechanism → endpoint → response → UI state`):
admin login/logout = form → Server Action → session cookie → RSC redirect/render; all other mutations
= control → `fetch` Route Handler call → `{data,meta}`/`{error}` envelope → confirmed-state render;
server reads = RSC → server-only lib → DB → render. Secrets/credentials never cross to the client;
session, guest-credential, RBAC, and ownership contracts unchanged.

No API client/service layer exists today (verified: only server-side `lib/api/*` helpers + one
`"use client"` login form). Future layer lives under `src/lib/storefront/` — PLANNED, not
implemented (name/structure not settled until code exists; RSC-first fetching;
route handlers own mutations at first, extracted only on 3rd reuse):
- Base URL per environment (never hardcoded prod); session cookie auto-sent (same-origin), guest
  headers attached explicitly per request (never URL/logs); JSON + DecimalString discipline.
- Error normalization mirroring `ApiError` codes → Arabic UX mapping (FP-11.4 §13 pattern reused).
- Abort + latest-wins + monotonic seq for search/estimate streams; single-flight for mutations;
  idempotency-key issuance lives in the checkout feature (not buttons).
- Log hygiene: sanitize rule mirroring `lib/api/log.ts` forbidden keys (no tokens/phones/secrets).
- Unexpected responses → generic error + retry, never field invention. No new dependencies implied
  (fetch + RSC suffice; SWR/RQ NOT assumed).

## 4. Auth & guest separation (binding)

Session (`__Host-customer-session` HttpOnly, 30d) vs cart bearer (`x-guest-token`) vs order credential
(`x-guest-order-token`, 90d, persistence per FP03-G1: planned same-origin adapter + order-scoped HttpOnly cookies —
amends BGGO-D014 localStorage storage for the order credential only, history preserved in FP-03 §7b) vs order number
(display only, never auth).
Login never auto-merges (explicit `POST cart/merge`); guest never becomes registered implicitly
(only credentialed `register` converts); admin sessions (8h, email+password) never interchangeable
with customer flows. Secrets never in URLs/logs/errors (D35/D36 rules).

## 5. Errors, retry & money authority + operation-level idempotency matrix (Decision C closed)

- Per-operation errors/retry/revalidate: §1 matrix + FP-11.10 11-scenario matrix (normative).
- Timeouts: re-read first (state unknown); same-key resolve (orders) / GET-first (cart) / no blind
  destructive retry (admin deltas). 429 backoff (15-min windows respected).

### Idempotency / retry matrix (verified per operation — broad "estimate/create is idempotent" claims removed)

| Operation | Type | Evidence | Guarantee | Retry guidance | Limitation |
|---|---|---|---|---|---|
| `POST cart/items` (add) | Mutation | UPSERT aggregates qty on conflict (`lib/cart/writes.ts:203-216`) | NOT idempotent (repeat doubles quantity) | Do NOT auto-retry; re-read cart first | Concurrent adds sum by design |
| `PATCH cart/items/{id}` (set) | Mutation | Last-writer-wins single row (`lib/cart/writes.ts:223-241`) | Same-value resend converges; concurrent races resolve last-wins | Safe to resend same value; re-read after ambiguous | No version/etag to detect races |
| `DELETE cart/items/{id}` (remove) | Mutation | Missing line → 404 (`lib/cart/writes.ts:244-258`) | Idempotent outcome (absent); 404 = already-gone | Safe; treat 404 as success | — |
| `POST cart/merge`, `POST cart/reprice` | Mutation | Sum+reprice / live-snapshot refresh (writes.ts:261-267,397-416) | NOT GUARANTEED same-response (live prices) | Re-read; no blind retry | Prices/stock may move between calls |
| `POST orders/estimate` | Estimate (read-only) | No locks/bumps/rows; checkout sole committer (`app/api/store/orders/estimate/route.ts:1-6`) | No business record created; response NOT guaranteed identical (commercial data changes) | Safe to repeat; NEVER treat as final/committed | "Dry-run" ≠ "same response forever" |
| `POST orders` (create) | Mutation | `idempotencyKey` UNIQUE + pre-check + same-cart replay / 409-different-terms (`lib/orders/writes.ts:172-202,524-529`, `queries.ts:83-86`) | VERIFIED server-enforced dedup | Same-key resubmit safe (replay or 409); fresh key = NEW order; generic-500/timeout → ambiguous: resolve via replay, never blind new key | Key scope is same-cart terms |
| `POST customers/register` | Mutation | Duplicate phone → documented 409 (`lib/customers/auth.ts:76`) | NOT idempotent (creates once, 409 after) | Do NOT auto-retry unknown outcome; re-read via login instead | 409 reveals existence (accepted surface) |
| `POST customers/session` (login) | Mutation | Session INSERT per success (`lib/auth/login.ts:208-223`) | NOT idempotent (new session each call) | Single-flight; no retry loops | Each success mints server state |
| Address CRUD | Mutation | Standard CRUD; 404-gone | PUT/PATCH/DELETE effectively idempotent; POST creates | Per-method standard; re-read after ambiguous | — |
| Admin mutations | Mutation | No idempotency keys; 409 guard races | NOT GUARANTEED | Re-read + explicit user confirm; never blind-retry destructive | Races resolve server-side first |
- Money authority per value: variant `price` → cart snapshot (quote) → estimate (preview) →
  creation (authority) → fulfillment actuals; discounts only from discount rows; availability only
  from inventory reads; permissions only from session snapshot. Frontend computes NOTHING authoritative
  (display-only conversions labeled as such).

## 6. Gaps, conflicts & acceptance

- Gaps: §1 Gap column + FP-11.11 §C register (D39 staff path, L1–L5, G/B series, Q-PAY,
  D41/D44 ACCEPTED/RESOLVED, L3 RESOLVED/LOCKED) — no new backend work proposed here.
- Conflicts found in this review: NONE beyond already-recorded C-NAME (corrected) and L3 (Direction A
  IMPLEMENTED + VERIFIED — sale units PIECE/KG/GRAM locked, LITER/ML metadata-only, FP-11.8.2 E13/E15/E16).
  OpenAPI-vs-code: estimate-404-vs-creation-422 coupon difference is intentional (dry-run
  vs commit), not drift.
- Acceptance (DEFINED — NOT EXECUTED): every §1 row traceable to route+schema+suite; every component
  bound in §2; comm layer uncreated (§3); auth separated (§4); errors/money/matrix per §5; unsupported
  explicitly marked. Implementation, visual testing, and live verification NOT claimed.

---

*End of FP-13 — specification-only, no implementation.*
