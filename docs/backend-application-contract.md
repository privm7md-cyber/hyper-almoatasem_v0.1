# Backend Application Contract — Hyper Al-Moatasem (BA-0)

> Status: AUDIT + CONTRACT DEFINITION. No code, schema, migration, or data
> changes were made to produce this document. Every rule below is tagged with
> its provenance:
> `[FROZEN]` verified frozen SQL architecture (source of truth) ·
> `[IMPL]` existing reviewed implementation (source of truth for behavior) ·
> `[DERIVED]` technical detail derived from the above without new semantics ·
> `[PROPOSAL]` explicit architectural proposal (needs no human veto to proceed
> but recorded as proposal, not fact) ·
> `[OPEN]` unresolved decision (blocking or not, stated explicitly).
> Nothing here invents business rules, database behavior, or API behavior.

## 0. Scope boundary

BA modules cover ONLY what the frozen architecture implements: catalog,
inventory, customers, cart, orders, replacements, coupons/promotions, admin
auth/RBAC/sessions, store settings, notifications inbox. The 6 designed-but-
unimplemented tables (`product_images`, `payments`, `payment_transactions`,
`delivery_zones`, `delivery_drivers`, `deliveries`) are EXCLUDED from all BA
work until a future reviewed migration lands them. No storefront, no checkout
UI, no customer-facing pages in BA scope. No `orders.payment_status` ever
(payments domain owns state later). EGP-only. One branch. No governorate field
(frozen address model has city/area/village/street/building/landmark only).

## 1. Existing backend inventory

| Path | Methods | Auth | Status | Notes |
|---|---|---|---|---|
| `/` | GET | none | `[IMPL]` infrastructure | Starter template page; no DB access; NOT the application |
| `/admin` | GET (page) | `requireAdmin()` (redirect login) | `[IMPL]` infrastructure | Admin landing |
| `/admin/login` | GET (page) + Server Action `loginAction` | public GET; action enforces same-origin + `authenticateAdmin` | `[IMPL]` infrastructure | Zod shape → generic error → cookie → redirect `/admin` |
| `/admin/users` | GET (page) | `requirePermission(...)` → 403 via `forbidden.tsx` | `[IMPL]` infrastructure | Server-side gate, not UI hiding |
| `/api/admin/session` POST | login JSON | same-origin check + `authenticateAdmin`, 401 generic | `[IMPL]` infrastructure | Thin transport over the single login core; mirrors action guarantees |
| `/api/admin/session` GET | session inspect | `getCurrentAdmin`, 401 | `[IMPL]` infrastructure | Returns name/email/roles/permissions |
| `/api/admin/session` DELETE | logout | revokes server-side + clears cookie, always 200 | `[IMPL]` infrastructure | Idempotent; audits best-effort |
| `src/proxy.ts` | middleware `/admin/:path*` | cookie-presence guard ONLY | `[IMPL]` infrastructure | Zero DB, zero crypto; never authorization |

No business APIs exist. All DB access paths: Prisma Client (representable
models) + parameterized raw SQL (sessions, audit, inet, rate limits, locks,
sequences, views). No other data layer exists.

## 2. Module A — Auth & Session `[IMPL]` (exists, frozen behavior)

- Login core `authenticateAdmin(email, password, {ip, userAgent})`: Zod
  (email lowercase/trim, 1..160 / password 1..128) → rate-limit buckets FIRST
  (IP 30 + account 10 per 15-min aligned window, single-statement atomic bump,
  opportunistic TTL prune) → user lookup → ALWAYS verify a hash (real or
  constant dummy — timing-equal unknown path) → uniform generic Arabic error.
- Fail path: single-statement atomic fail bump; lock at 5 consecutive fails
  for 15 min; audit `auth.login_failure` / `auth.account_locked`.
- Success path: reset attempts/lock + session row + audit row in ONE
  transaction (fail-closed: audit failure fails the login).
- Sessions: 256-bit opaque tokens, hex64; DB stores ONLY SHA-256 hash;
  fixed 8h TTL, no sliding; `last_seen_at` touch on validation; revocation by
  flag (rows are history, never deleted); cookie `__Host-admin-session`
  (HttpOnly, Secure in prod, SameSite=Lax, Path=/, 8h maxAge).
- Validation: token shape → hash lookup + `revoked_at IS NULL` +
  `expires_at > now()` gated IN SQL (single clock source) → active,
  non-deleted user → `last_seen_at` touch.
- Logout: revoke server-side + clear cookie (idempotent); `changePassword`:
  policy + hash + reset + revoke-all atomically.
- Same-origin enforcement on both credential submission paths (action +
  route); unknown/inactive/locked accounts all yield the identical generic
  error. No password reset/invitation ROUTES or emails (token lifecycle core
  only); no MFA/TOTP/WebAuthn.
- Planned later (not in BA-0 scope to build): nothing — auth core is complete;
  BA work only CONSUMES `requireAdmin/requirePermission/checkPermission`.

## 3. Module B — Catalog `[FROZEN]`

- `categories` (slug UNIQUE, `parent_id` self-FK, anti-cycle trigger),
  `brands` (slug UNIQUE), `products` (`product_type` PIECE|WEIGHT,
  `sale_step_grams` whole-gram offer granularity, product-level).
- `product_variants`: price basis (`size_value NUMERIC(10,3)` + `size_unit`),
  `price` NEVER moves (base-price separation); `compare_at_price >= price`;
  `UNIQUE(product_id,name)`; WEIGHT products carry exactly one loose variant.
- Weight rule `[FROZEN]`: `WEIGHT → unit IN (KG,GRAM) + sale_step_grams>0`;
  `PIECE → unit=PIECE + sale_step NULL`. Counting-unit pin `[FROZEN]`:
  PIECE lines count packs (`'PIECE'`), WEIGHT lines count `size_unit`;
  mismatch vs live counting unit aborts the line (no silent conversion).
- `product_codes`: global `code UNIQUE` (leading zeros preserved),
  `type BARCODE|INTERNAL_CODE`, at most one primary per variant
  (`uq_codes_one_primary`); codes CASCADE with parent (only CASCADE table).
- Price history: append-only `product_price_history`
  (`old<>new` CHECK); price change MUST insert a row in the same tx
  (convention + comment); old orders never read it (snapshots); carts
  re-price from live variant price.
- VIEW `product_stock_status` (raw-SQL reads only).

## 4. Barcode contract `[FROZEN]` + one `[OPEN]`

- Lookup: global code UNIQUE resolves a scan to exactly one variant.
- Fixed vs weighed handling: no distinct barcode-format rule exists in frozen
  SQL; `type` distinguishes BARCODE vs INTERNAL_CODE only.
- `[OPEN — NON-BLOCKING]` weighed-barcode pricing formula (e.g. `2010106` +
  `0.125`): no explicit formula is frozen. `[PROPOSAL]`: price = live variant
  `price` (per-`size_unit` basis) × weighed quantity, validated against
  `sale_step_grams` multiples and the R7 envelope; requires human confirm in
  BA-2. No check-digit/format rule exists — record none, invent none.

## 5. Inventory contract `[FROZEN]`

- `inventory` 1:1 per variant; `available = quantity − reserved` GENERATED
  (never stored, never written); `reserved <= quantity`; all ≥ 0.
- 7 movement types: STOCK_IN, SALE, RETURN, WASTE, ADJUSTMENT, REPLACEMENT,
  CANCELLED_ORDER. Signed `quantity <> 0`; `new = prev + qty` CHECK;
  reference pair rule; append-only by convention (INSERT+SELECT grants only).
- Reserve/release = reserved-only adjustments, NO movements. Commit =
  quantity AND reserved decrement + SALE movement. Corrections = ADJUSTMENT
  (PREPARING-only). Post-commit cancel restock = CANCELLED_ORDER movement;
  post-delivery = RETURN. No new movement types.
- **R3 commit predicate** `[FROZEN]`: `quantity −= actual; reserved −=
  requested` is banned unless `(quantity − reserved + requested_held) ≥
  actual` holds atomically (rowcount-checked single UPDATE).
- **R7 fulfillment envelope** `[FROZEN]`: commit ⟺ `actual ≤ requested +
  tolerance` AND R3 atomically. Tolerance: WEIGHT = MAX(1 sale_step in unit,
  10% of requested); PIECE = 0. Cases: A (actual ≤ requested: commit actual,
  release full hold, SALE(actual), FULFILLED iff equal else
  PARTIALLY_FULFILLED); B (requested < actual ≤ envelope: commit, no extra
  reservation, FULFILLED); C (actual > envelope: gate REJECTS, nothing
  written; re-cut or UNAVAILABLE + replacement flow); shortage: commit
  max-fulfillable, movement on committed, note recorded.
- **In-transaction (single tx, READ COMMITTED, ASC lock order):**
  lock inventory rows ASC → conditional atomic reserve (rowcount-checked).
  **Raw-SQL/locking/DB-enforced:** reserve bump, commit predicate, movement
  pairing (`previous_quantity` from locked `SELECT FOR UPDATE` row),
  GENERATED math, transition CHECKs, history-first trigger. Prisma NEVER owns
  these paths (gap documented, suites prove it).

## 6. Customer contract `[FROZEN]`

- Unified `customers` table: `password_hash NULL` = guest;
  `is_registered=FALSE OR password_hash NOT NULL`; phone UNIQUE, canonical
  digits `^[0-9]{8,15}$`, app-normalized to `2010XXXXXXXX` BEFORE write
  (R4/R8 ladder; DB constrains shape+uniqueness, never normalizes); email
  optional + partial UNIQUE; `auto_accept_replacements` (R5 pre-consent);
  soft-delete consistency (`deleted ⇒ !active`).
- Addresses: owner book, hard-deletable (orders carry snapshots, never FKs);
  `city` required; phone looser (landline OK); one default
  (`uq_addresses_one_default`, switch in one tx). No governorate. No
  `deleted_at` on addresses.
- `customers.password_hash` (frozen P2 column) is the CUSTOMER credential
  slot; customer login is NOT implemented (no customer auth routes exist).

## 7. Cart contract `[FROZEN]`

- Draft only; carts NEVER reserve inventory. Ownership XOR `[FROZEN]`:
  `CHECK((customer_id IS NULL) <> (session_id IS NULL))` — exactly one owner;
  sessions are ≥128-bit server-random opaque tokens, stored hashed, rotated
  on login, server-side expiry, cart-lines scope only.
- States: ACTIVE→CHECKED_OUT|ABANDONED|EXPIRED|MERGED (terminal guard
  trigger; only ACTIVE leaves). One ACTIVE per owner (two partial UQs +
  sweeper index). `expires_at`: guest TTL (~+30d config), registered
  persistent. Failed-checkout carts stay ACTIVE (rolled-back checkout writes
  nothing); retired by sweeper or reuse.
- Lines: quote semantics (`quantity>0`, `unit_snapshot`, nullable
  `unit_price_snapshot`, `price_checked_at`); `UNIQUE(cart_id,variant)`,
  re-add aggregates. 9-step binding merge on login (detect→resolve→reassign
  or per-line sum + live reprice, dead lines dropped + reported; ASC locks;
  checkout serializes on same locks).
- Guest TTL enforced at resolution (BA-A): operable-cart lookups require
  `status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > now())`
  (SQL `now()`, never a JS clock); expired guest carts behave as absent
  (mutations 404, merge/checkout reject as unavailable, POST mints fresh).
  Customer carts (`expires_at NULL`) are unaffected. Implemented default
  remains +30d guest / persistent registered (matches frozen seed).
- Sweeper (BA-B): manual runner `scripts/maintenance/sweep-expired-carts.mjs`
  flips logically-expired ACTIVE guest carts to the frozen EXPIRED terminal
  (single conditional UPDATE, idempotent, row-local; dry-run default;
  scratch-only allowlist). Scheduling remains `[OPEN — NON-BLOCKING]`
  (no cron/provider wired; script claims none). Exact TTL number stays
  config-level (+30d default).

## 8. Orders contract `[FROZEN]`

- Creation (ONE tx, READ COMMITTED + row locks): key → BEGIN → lock cart
  (ACTIVE else replay) → idempotency pre-check (`idempotency_key` UNIQUE,
  sole key) → validate customer/address → lock inventory ASC → revalidate
  active/unit/price/step → atomic reserve (rowcount) → INSERT order + items +
  history(NULL→NEW) → cart CHECKED_OUT → COMMIT; else ROLLBACK. Price drift =
  new terms = new key + confirmation.
- State machine `[FROZEN]`: NEW→CONFIRMED→PREPARING→READY_FOR_DELIVERY→
  OUT_FOR_DELIVERY→DELIVERED; CANCELLED only from NEW|CONFIRMED|PREPARING.
  Item states: PENDING→FULFILLED|PARTIALLY_FULFILLED|UNAVAILABLE|REPLACED|
  CANCELLED + UNAVAILABLE→REPLACED (trigger-whitelisted).
- Snapshots (frozen, never re-read live): item name/variant/brand/code/unit/
  type/step/price; requested vs actual weights (actual NULL until picked,
  PREPARING-only writes, pending↔actual linkage CHECKs); customer/address
  snapshots on the order row; `order_number` `HM-YYYYMMDD-######` (gaps OK).
- Money: `estimated_total=ROUND(qty×price,2)`, `final_total` NULL until
  terminal; `discount_total` = checkout-estimate snapshot (NEVER rewritten —
  amended R19 decision); finals live in allocation rows/mirrors;
  `total_estimated=sub−discount+delivery`;
  `total_final=sub_final−LEAST(discount_total,sub_final)+delivery`.
  No `payment_status` anywhere (Phase 3 owns it). EGP-only.
- History-first trigger `[FROZEN]`: status UPDATE requires a pre-existing
  matching history row (EXISTS, not latest — same-tx `now()` ties); write
  order is INSERT-history-then-UPDATE-status in the same tx.

## 9. Replacements contract `[FROZEN]`

- Link-not-overwrite: original `order_items` row is NEVER edited; proposals
  live in `order_item_replacements`; `replacement_order_item_id` filled
  strictly after the new line exists (R10, single tx, ASC lock order:
  orders→items→inventory→replacement row).
- States: PROPOSED→CUSTOMER_APPROVED|CUSTOMER_REJECTED|AUTO_ACCEPTED
  (trigger-whitelisted); withdrawal rides REJECTED (R5); one live PROPOSED
  per item (partial UQ); sequential re-proposals preserved.
- Substitute is reserved AT APPROVAL (never at proposal); `price_difference`
  is the agreed signed delta (service-computed, no cross-row CHECK —
  writer-discipline + V3 reconciliation).
- **READY gating** `[FROZEN]`: READY needs zero PENDING-pickable AND zero
  PROPOSED; live-proposal lines excluded from picking; OOS-proposal flips
  original to UNAVAILABLE same-tx; swap-proposal freezes the PENDING line.
- R5 pre-consent covers SPEND with relative+absolute caps (defaults 10% /
  50 EGP), else explicit approval.

## 10. Coupons / promotions contract `[FROZEN]`

- Header `promotions`: exactly one shape (PERCENTAGE|FIXED_AMOUNT|
  BUY_X_GET_Y|FIXED_PRICE); scope LINE|ORDER (BXGY/FIXED_PRICE LINE-only);
  window, priority, stackable flag, counters. Value/target/rule columns
  immutable once referenced (app policy); disable/schedule/soft-delete
  allowed.
- Targets are OR (subtree-inclusive for CATEGORY); LINE promos need ≥1
  target; ORDER promos may be targetless. Evaluation order ONLY:
  `priority DESC → specificity VARIANT>PRODUCT>BRAND>CATEGORY → created_at
  ASC` (never "best price").
- Stacking is sequential compounding on current net; gate: accept iff no
  promo yet OR (incoming stackable AND all accepted stackable);
  non-stackable is exclusive, first-in-order wins.
- Coupon tx: lock coupon row `FOR UPDATE` → validate → conditional bump
  `used+1 WHERE limit NULL OR used<limit` (rowcount-checked) → insert usage;
  same pattern for promo global limits; per-customer limit via in-tx COUNT
  of active usages; counters decremented at cancel tx; backstop
  `used<=limit` CHECKs. Auto-promo exhaustion = SKIP (undiscounted);
  coupon exhaustion/limit = FAIL the checkout. Suite evidence: coupon×25,
  inventory×25, idempotency×10, races A–F single-winner/no-overshoot.
- `coupon_usages`: immutable audit (estimate set, final set exactly once at
  finalize); one coupon per order; liveness derives from `orders.status`
  (no revoked flag). `order_discounts`: frozen application+ALLOCATION rows
  with FULL snapshots; parent owns snapshot; checkout writes estimates,
  finalize writes finals from ROW data only (never re-reads live promos);
  deterministic pro-rata allocation with largest-remainder dust.

## 11. Admin application contract `[BUILT in BA-9]` (was future/classified)

- Catalog management (categories/brands/products/variants/barcodes),
  inventory (stock/adjustments/movements), pricing (changes + history),
  orders (inspection/transitions/replacements), customers (lookup/history),
  RBAC-protected actions — all PLANNED. Each future admin write MUST flow
  through the frozen domain txs (price-history row, inventory tx+movement,
  promo tables, status-history rows) plus an `audit_logs` row in the same tx;
  administration manages frozen domains, never duplicates them (no `admin_*`
  entities).

## 12. API design contract `[PROPOSAL]`

- Methods: GET (reads, safe/idempotent) / POST (creates, actions, transitions)
  / PATCH (partial updates incl. state transitions) / DELETE (hard delete
  ONLY where frozen model allows — addresses, notifications; never ledgers,
  history, sessions, audit, price-history, movements, usages).
- Validation in three layers (never substitutes): transport (Zod shapes,
  required/optional/types/ranges, normalization e.g. lowercase email) →
  domain/service (business rules: step multiples, counting units, windows,
  caps, ownership) → database (CHECKs/triggers/partial-UQs — the ONLY
  enforcement).
- Normalization at the boundary (lowercase emails/keys, trim, phone
  canonicalization) before any DB contact.

## 13. Response contract `[LOCKED in BA-A]` (was proposal; all routes conform)

- Success: `{ "data": {}, "meta": {} }` (`meta`: paging, request id,
  estimate-vs-final markers where relevant). Creation answers 201
  (orders, replacements, coupons, users, roles, grants, login session).
- Error: `{ "error": { "code": "...", "message": "...", "details": {} } }`
  with the locked taxonomy below. The legacy `{ok,...}` session shape was
  migrated in BA-A (`src/app/api/admin/session/route.ts`); no route keeps
  an ad-hoc envelope.
- Machine-readable companion: `docs/openapi.yaml` (coverage validated by
  `scripts/api/t-ba-a-contract.mjs`).

## 14. HTTP status contract `[LOCKED in BA-A]` (extends existing 400/401/403 usage)

- 200 read/success (replays answer 200 with `meta.replay`); 201 created;
  204 reserved (logout answers 200 + `{data:{revoked:true}}` — no 204 in
  use); 400 malformed/shape; 401 unauthenticated (incl. locked/expired —
  never distinguish); 403 forbidden (permission, disabled, ceiling
  violation, cross-origin credential submission); 404 unknown ids (never
  leak existence across privilege boundaries); 409 conflict
  (idempotency-key reuse with different terms, double-submit races,
  state-transition races, inactive-role assignment); 422 semantically
  unprocessable (weight-step violation, envelope breach, cap exceeded,
  coupon/window/type violations — business-rule failures distinct from
  malformed input); 429 rate-limit/lockout-adjacent throttles; 500
  unexpected only, always `{error:{code:"INTERNAL",
  message:"Unexpected error.",details:null}}`.
- Single mapping `src/lib/api/http-status.ts statusForCode`; single
  builders `ok/created/fail` in `src/lib/api/respond.ts`.

## 15. Error architecture `[LOCKED in BA-A]` (taxonomy = existing 8 codes)

- Domain → 422/409 with code; validation → 400; authn → 401 generic;
  authz → 403; not-found → 404; DB unexpected → 500 generic; concurrency
  loser → 409 with replay instruction (re-read, never auto-retry writes
  blindly).
- Never leak: passwords/hashes, session/token material, SQL/state, connection
  strings, secrets, stack traces, `DATABASE_URL`, internal actor ids beyond
  need. Audit every auth failure (best-effort outside tx, in-tx on success
  paths — fail-closed rule from login core).

## 16. AuthN/AuthZ boundary `[IMPL]` + `[FROZEN]`

- Authentication = session-cookie validation + active non-deleted user
  (`getCurrentAdmin`, per-request memoized). Authorization = effective grant
  (`user.is_active AND role.is_active AND mapping exists`), evaluated
  server-side on EVERY sensitive page/action/route via
  `requireAdmin/requirePermission/requireRole/checkPermission`. UI hiding is
  convenience only. Disabled users/roles authorize nothing, including through
  live sessions (re-checked per request).
- Effective grant model mirrors frozen RBAC exactly (SUPER_ADMIN holds all
  31 explicitly as data, never a bypass flag).

## 17. Prisma vs raw-SQL contract `[FROZEN]` (gaps doc, binding)

- Prisma owns: representable models/relations, PKs, plain/composite uniques,
  ordinary indexes, FKs with exact actions, scalar defaults, soft-delete
  columns (no global middleware — deliberate), `Decimal/DateTime/Json`
  mappings.
- Raw SQL owns: sessions + audit (inet poisoning — whole-model query-build
  failure), rate-limit buckets, locks (`FOR UPDATE`, conditional bumps),
  GENERATED (never in writes), views, sequences (`nextval` + app format),
  partial UQs (never faked as `@@unique`), triggers + `updated_at` (no
  `@updatedAt`), money ROUND parity, transition whitelists, polymorphic refs
  (bare UUIDs, existence enforced at activation + reports), INET behavior,
  `migrate diff` is COMPUTATIONAL ONLY — migrations always ship frozen SQL
  supplements (raw Prisma DDL alone loses the integrity layer — proven).

## 18. Transaction contract `[FROZEN]` (+ `[DERIVED]` read classification)

- Atomic single-tx REQUIRED: checkout (key→reserve→order+items+history→
  cart CHECKED_OUT), replacement approval/materialization, coupon
  checkout+usage+counters, login success (reset+session+audit),
  password change (hash+reset+revoke-all+audit), bootstrap seed.
- Transaction + row-locking REQUIRED: inventory reserve/commit paths
  (ASC lock order), coupon/promo counter bumps, cart-merge serialization,
  same-cart double-submit guard.
- Read-only safe: catalog/storefront reads, stock-status view, settings
  reads, permission evaluation reads, audit/report reads. All time-gates
  (expiry, lockout, windows) decided IN SQL (`now()`), never in JS —
  mandatory on this stack (proven decode shift).

## 19. Idempotency contract `[FROZEN]` + BA-A transport `[LOCKED in BA-A]`

- Needs it: order creation (`idempotency_key` UNIQUE + pre-check + replay
  path; price drift = new key), same-cart double submit (cart guard +
  replay), coupon double-submit (usage UQ per order + row-lock serialize),
  replacement approval (PROPOSED gate replay-safe), seed/bootstrap (fixed
  UUIDs + mismatch-loud).
- Same key + same terms → replay original outcome (no duplicate effect).
  Same key + different terms → 409 CONFLICT (never silent overwrite).
- No blanket `ON CONFLICT DO NOTHING` anywhere in product paths (allowed
  ONLY inside the single-statement atomic rate-limit bump, which is a
  counter, not business state).
- BA-A transport (order creation only; other surfaces evaluated — none
  needs a key): canonical `Idempotency-Key` HTTP header, validated by the
  shared `idempotencyKeySchema` (1..64 chars, trimmed, no spaces).
  Precedence: header wins ties with body `idempotencyKey`; both present
  but different → 400; neither present → 400. Fingerprint for
  same/different-terms comparison is `(idempotencyKey, cartId)` — stored
  key + owning cart, no secret hashing, no timestamps, no transport data.
  Case table: new key → execute; same key + same cart → replay (200 +
  `meta.replay`); same key + different cart → 409 `CONFLICT`; concurrent
  same key → UQ arbitrates exactly one execution, loser reselects +
  same-cart rule; failed (rolled-back) tx → key NOT consumed (nothing
  committed); internal failure → sanitized 500, safely retryable.
  Concurrency protection is the DB UNIQUE + row locks + reselect — never
  application SELECT-then-INSERT.

## 20. Concurrency contract `[FROZEN]` (proven: 240 + 120 + coupon/inventory races)

- Last-stock race: conditional atomic reserve on ASC-locked rows
  (READ COMMITTED suffices — guards are row-local); exactly one winner;
  invariants `quantity = available + reserved`, all ≥ 0.
- Simultaneous inventory updates: row locks, ASC order (H1 contention rule:
  keep txs lean + ordered).
- Simultaneous coupon usage: coupon-row lock + conditional bump; exactly
  one winner; counters never overshoot.
- Duplicate order requests: idempotency UQ + cart CHECKED_OUT-once guard;
  loser replays.
- Simultaneous replacement updates: one live PROPOSED (partial UQ) +
  approval gate; failed approval mutates nothing (stays PROPOSED).
- Conflict response: 409 + re-read; never blind auto-retry of writes;
  never SERIALIZABLE (rejected); never read-check-write (rejected).

## 21. Security contract `[IMPL]` + `[FROZEN]`

- Authn/authz per §16; Zod at every boundary; parameterized queries
  exclusively (no dynamic SQL construction; `order_by` whitelists where
  sorting exists); no secret logging/return (hashes, tokens, cookies,
  `DATABASE_URL`, internal ids minimized); mass assignment impossible by
  construction (explicit allowlisted fields per write); IDOR closed by
  ownership checks (cart/customer XOR, user-scoped rows) + server-side RBAC;
  admin/customer boundary: separate tables, no shared sessions (customer
  login does not exist); rate limiting (login buckets) + lockout enforced;
  CSRF: Server Actions rely on platform protections + explicit same-origin
  checks on credential paths; cookies: `__Host-` + HttpOnly + Secure(prod)
  + SameSite=Lax + Path=/.
- No redesign without authorization.

## 22. Logging/observability contract `[PROPOSAL]` (extends login-core audit rule)

- Log: auth successes/failures/lockouts (sanitized), admin mutations
  (paired audit rows in-tx), order lifecycle transitions, inventory
  adjustments, coupon redemptions, bootstrap events, unexpected 500s with
  correlation ids.
- Never log: passwords/hashes, raw tokens, cookies, `DATABASE_URL`, API
  keys, full customer PII beyond operational need, request bodies containing
  credentials. No new platform in BA scope (Vercel logs + audit_logs suffice).

## 23. Testing contract `[PROPOSAL]` (extends frozen suite posture)

- Unit: pure math (stacking, allocation pro-rata + dust, R7 envelope cases,
  phone ladder vectors, totals formulas). Integration: each BA module
  against real PG (frozen-suite pattern: PGlite/embedded + pristine files).
- API: route-shaped suites (shape codes, 401/403 matrix, replay paths).
- Auth/RBAC: protected-endpoint matrix (existing suites as template).
- Concurrency: two-session races per new contended path (coupon/inventory
  pattern). Idempotency: same-key races + drift-mismatch cases.
- Regression: Phase 1/2/4/5 suites stay green (77+65+50+240+120 baselines).
- Matrix per module in its BA phase; no suite may weaken frozen asserts.

## 24. API versioning `[LOCKED in BA-A: unversioned namespaces]`

No versioning exists. Decision (as built across BA-2..BA-11): stay
unversioned under the stable `/api/admin/*` + `/api/store/*` namespaces
while the surface is pre-launch and single-client; adopt `/v1` only on
first breaking change. The session-envelope migration (BA-A) is the first
breaking change and was absorbed pre-launch with test updates instead of
a version bump — consistent with this rule.

## 25. Pagination/filtering/sorting `[PROPOSAL]`

- Cursor/Keyset preferred for large tables (products 20k+); page/limit
  tolerated for small admin tables. Defaults: limit 20, max 100; max
  page-size enforced server-side; stable ordering mandatory (id tiebreak);
  filters whitelisted per endpoint; search scoped (name/code/phone) with
  explicit indexes; NEVER unbounded list queries on admin endpoints.

## 26. Endpoint inventory

| Module | Endpoint | Method | Auth | Permission | Status |
|---|---|---|---|---|---|
| Infra | `/` | GET | none | — | EXISTING |
| Admin UI | `/admin` | GET | session | any admin | EXISTING |
| Admin UI | `/admin/login` | GET+Action | public/session-aware | — | EXISTING |
| Admin UI | `/admin/users` | GET | session | `users.view` (exact key TBD in BA-9) | EXISTING |
| Auth API | `/api/admin/session` | POST/GET/DELETE | POST public+same-origin; GET/DELETE session | — | EXISTING |
| Catalog | `/api/store/products …`, `/api/admin/catalog …` | GET/POST/PATCH | store public-read; admin session+perm | TBD | PLANNED |
| Inventory | `/api/admin/inventory …` | GET/POST | session+perm | TBD | PLANNED |
| Customers | `/api/admin/customers …` | GET | session+perm | TBD | PLANNED |
| Cart | `/api/store/cart …` | GET/POST/PATCH/DELETE | guest-token XOR registered | — | PLANNED |
| Orders | `/api/store/orders …`, `/api/admin/orders …` | POST/GET/PATCH | guest/registered; admin perm-gated | TBD | PLANNED |
| Replacements | under Orders (`…/replacements`) | POST/PATCH | role-dependent | TBD | PLANNED |
| Coupons | under checkout recompute | POST (checkout) | customer context | — | PLANNED |
| RBAC admin | `/api/admin/users|roles …` | GET/POST/PATCH | session + `users.manage`/`roles.manage` | TBD | PLANNED |
| Health | `/api/health` (DB ping, no secrets) | GET | none | — | IMPLEMENTED (BA-A closure: public liveness + readiness probe, single `SELECT 1`, canonical envelope, sanitized 500; OpenAPI + `t-ba-a-contract` health asserts) |

Exact paths/keys beyond EXISTING rows are PLANNED (shapes above are
illustrative, locked in their BA phase, not here). Nothing is BLOCKED.

## 27. CONTRACT CONFLICTS (mandatory section)

### CC-1 — Lockout duration evaluated in JS contradicts the SQL-only time-gate rule [STATUS: genuine conflict, fix required in auth hardening — NOT in BA-0]
- Source A (`src/lib/auth/login.ts:191`): `new Date(row.locked_until).getTime() > Date.now()` decides `nowLocked` in JS from a Prisma-decoded TIMESTAMPTZ.
- Source B (locked architecture, gaps doc §12 + auth decision): security time-gates MUST be decided in SQL; Prisma 7.10 decode on this stack shifts instants later by the server UTC offset (proven, DST-varying).
- Impact: with a +3h shift, a 15-minute lockout reads as ~3h15m — fail-closed but wrong duration; user-visible lockout overstay.
- Recommended resolution: move the lock decision into the bump statement (e.g. `RETURNING` a SQL-computed boolean) and never branch on decoded timestamps in auth paths. Requires a code fix outside BA-0 scope — recorded, not applied.

### CC-2 — AGENT-HANDOFF production snapshot is stale relative to live production [STATUS: known documentation lag, resolution gated]
- Source A (`docs/AGENT-HANDOFF.md` §5/§7/§17): describes pre-go-live state (baseline-only, no auth objects, no bootstrap).
- Source B (live production + verified reports): auth migration applied, bootstrap applied, owner credential set, releases through `7b6e400`.
- Impact: agents relying on the handoff alone would mis-plan; the handoff itself declares repo/DB/tests authoritative over it, which resolves behavior but not the staleness.
- Recommended resolution: handoff refresh under explicit human authorization (standing rule) — NOT done here.

### CC-3 — Naming shorthand vs frozen exact names [STATUS: resolved — SQL wins, no action]
- Proposal/architecture prose uses `READY`, `OUT_FOR_DELIVERY` shorthand variants and `REJECTED` for replacements; frozen CHECKs enforce `READY_FOR_DELIVERY`, `OUT_FOR_DELIVERY`, `CUSTOMER_REJECTED`. Authority is SQL; prose MUST be read with exact names. No code impact.

### CC-4 — discount_total dual meaning [STATUS: resolved per approved decision]
- Frozen CHECK requires estimate snapshot; finalize needs final truth. Resolved: `discount_total` stays checkout-estimate; finals live in allocation rows/mirrors (amended R19). BA implementation must preserve both, never "fix" the CHECK.

## 28. Open decisions

### BLOCKING (must resolve before the BA-1 work that depends on them — none block BA-1 itself)
- (none) — BA-1 (shared foundation: response envelope, error codes, validation helpers, Prisma/raw-SQL data-access patterns, audit helper generalization) needs no business decisions.

### NON-BLOCKING (recorded, resolved in stated phase)
1. Response envelope + error codes (§13–15): adopt proposal before BA-2 routes.
2. Weighed-barcode pricing formula (§4): confirm proposal in BA-2 (catalog).
3. Guest cart TTL exact value + sweeper cadence (§7): confirm in BA-5.
4. API versioning (§24): confirm unversioned-namespaces vs `/v1` before BA-2.
5. Password-reset/invitation ROUTES + emails: deferred by architecture; confirm scope if BA-9 touches tokens.
6. Audit/notification retention windows: deferred upstream; confirm if BA-9/BA-11 needs sweeps.
7. `lastLoginAt` semantics (written on login success; not in frozen P5 doc — arrived with auth migration): confirm display/audit use in BA-9.
8. Notifications as bootstrap data: FORBIDDEN by task scope (kept out unless architecture explicitly requires).

## 29. Roadmap BA-1 → BA-11 (order preserved — no architectural reason to reorder)

- **BA-1 Shared Application Foundation** (envelope, codes, Zod primitives, data-access patterns, audit helper, health endpoint; NO business logic).
- **BA-2 Catalog** (categories/brands/products/variants/codes; weight rules; barcode formula confirm).
- **BA-3 Inventory** (lookup, reserve/release/commit paths as raw-SQL services; movement pairing).
- **BA-4 Customers** (unified/guest/registered, phone ladder, addresses).
- **BA-5 Cart** (ownership XOR, merge, TTL config, checkout orchestration entry).
- **BA-6 Orders** (creation tx, snapshots, state machine, idempotency, finalize).
- **BA-7 Replacements** (propose/decide/materialize flows + READY gating).
- **BA-8 Coupons/Promotions** (eligibility engine, stacking, coupon tx, allocation).
- **BA-9 Admin APIs** (catalog/inventory/pricing/orders/customers/RBAC management surfaces).
- **BA-10 Integration/Concurrency/Idempotency** (cross-module races, replay paths).
- **BA-11 Full Backend Verification** (matrix green + frozen regression green).
- Dependencies flow forward only (BA-n consumes contracts of <n); auth/RBAC consumed throughout, never rebuilt.

## 30. Definition-of-Done checklist for BA-0 (self-check)

Audit complete (frozen SQL via targeted extraction, all auth/session/RBAC code read, arch docs read) · modules + order fixed · API conventions proposed · auth/RBAC boundaries locked from implementation · validation/error architecture proposed · transaction boundaries from frozen flows · Prisma/raw-SQL boundaries from gaps doc · concurrency/idempotency from proven suites · known business rules recorded · conflicts CC-1..CC-4 recorded · open decisions recorded, none blocking BA-1 · roadmap fixed · zero assumptions hidden (every rule tagged) · zero DB mutations (no connection was opened in this phase) · zero production changes · zero frontend implementation.

## 31. BA-A implementation record `[LOCKED]`

- Shared modules (single implementations, `src/lib/api/`): `errors.ts`
  (taxonomy + `businessRule/conflict/normalizeError`), `http-status.ts`
  (`statusForCode`), `respond.ts` (`ok/created/fail`), `validation.ts`
  (uuid/strict/idempotency-key/quantity/pagination), `serialize.ts`
  (`dec/decReq/iso/isoReq/pageMeta` — all domain serializers import it;
  no local copies remain), `route-auth.ts` (`denyUnless/adminOrDeny`),
  `audit.ts` (`auditInTx`), `concurrency.ts` (ASC order + classifier),
  `idempotency.ts` (contract helper), `log.ts` (secret redaction).
  Phone ladder: single service `src/lib/customers/phone.ts`
  (identity + contact; staff-contact shape stays a digits-only wire
  check — different domain, documented).
- Correlation IDs: evaluated — NOT introduced (audit rows + sanitized
  server logs suffice; no business column stores one; never a substitute
  for idempotency).
- Time contract: business gates in SQL `now()` (login lockout, session
  expiry, promo/coupon windows, cart expiry); transport instants as
  ISO-8601 UTC (`toISOString`); no JS `Date` on decoded DB timestamps in
  any gate (statically asserted); boundary tests winter/summer instants +
  exact-boundary (`== now()`) semantics in auth suites.
- Machine-readable contract: `docs/openapi.yaml` (all routes; validated
  bidirectionally against `src/app/api` by `t-ba-a-contract.mjs`).
- Contract tests: `scripts/api/t-ba-a-contract.mjs` (envelope, 201,
  error, safe-500, strict validation, pagination, decimal strings, ISO
  instants, idempotency 6-case matrix on real PG, time boundaries,
  phone ladder + concurrent identity, guest-token lifecycle incl.
  expired-token rejection).
- BA-B catalog/search/media record: `docs/backend-integration.md` BA-B
  section. Search engine decision: pg_trgm + `hyper_norm_ar` + functional
  GIN indexes (`db/future/search-trgm.sql`, scratch-verified, never
  production-applied, never in `prisma/migrations`); FTS rejected (no
  Arabic stemmer shipped). Keyset pagination: opaque cursors over
  (sort-field, id) with direction-matched tiebreaks (raw UUID cursors
  rejected); price/availability/subtree filters live; price-sort and
  promotion-filter documented unsupported. Media: product-level gallery
  metadata (`db/future/product-images.sql`), raw-SQL CRUD, no provider;
  primary/gallery/fallback semantics in `docs/backend-integration.md`.
