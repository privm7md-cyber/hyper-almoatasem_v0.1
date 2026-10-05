# BA-8 Coupons/Promotions — implementation record

> Backend APIs only. No frontend. No BA-9+. No schema/migration changes.
> All behavior verified on scratch (`hyper_almoatasem_scratch`, reused from
> the BA-7 build); production untouched (every test connection is
> allowlisted to scratch names only; the Next server under test pointed at
> scratch).

## 1. Frozen contract (Phase 4, extracted verbatim)

- 7 tables: `promotions` (type/scope-gated values, priority, stackable,
  limits+counters, DRAFT/ACTIVE/DISABLED + window), `promotion_targets`
  (VARIANT/PRODUCT/BRAND/CATEGORY, OR-match, subtree-inclusive categories,
  UQ triple), `promotion_rules` (1:1 conjunctive minimums + cap),
  `promotion_buy_get_rules` (1:1 buy/get/pct/free-variant), `coupons`
  (normalized UQ code, own window+flag, limits, minimum, always on a
  promotion), `coupon_usages` (immutable audit, one coupon per order),
  `order_discounts` (PROMOTION_LINE/ORDER + COUPON applications and
  ALLOCATION children with full snapshots, est+final pairs).
- R19-amended: `discount_total` stays the checkout-agreed estimate
  (frozen CHECK binds it); finals live in row pairs + mirrors +
  `subtotal_final`/`total_final`. No finalize in BA-8 — final columns
  stay NULL by design.
- Base price never moves; discounts live in rows + mirrors only.
- Layers line-autos → order-autos → ONE coupon; coupon minimum on
  merchandise GROSS, coupon base on post-auto NETs.

## 2. Engine (exact integer port of the frozen test doubles)

`src/lib/promotions/engine.ts` (pure, unit-tested): OR-target best-
specificity (VARIANT 4 > PRODUCT 3 > BRAND 2 > CATEGORY 1), thresholds
over eligible lines (WEIGHT in mg, PIECE in packs), priority DESC →
specificity DESC → created ASC (+ id tiebreak), stacking gate (first
wins unless incoming stackable AND all accepted stackable), sequential
compounding on running nets, per-type math (percent / fixed clamped /
fixed-price skip-if-no-benefit / BXGY sets with remainder earning
nothing), per-promo caps, deterministic pro-rata + largest-remainder
allocation (dust by id). All money integer piastres, quantities integer
thousandths, `divRoundHalfAway` exact long division — zero float.
Two architecture-faithful resolutions (documented in code): order-level
allocation applied once (the harness double repeats the loop over
already-reduced nets), and coupon-row names snapshot the parent
promotion (the double's `coupon.name` fallback targets a nonexistent
column).

## 3. Checkout integration (extends BA-6, never duplicates it)

`CreateOrderArgs.couponCode?` (additive; promo-empty orders behave
byte-identically — BA-6 suite green unchanged). Position matches the
doubles: after line validation, before inventory locks —
coupon row → promo rows → inventory ASC. Limited-auto exhaustion SKIPs
with drop + full recompute; coupon exhaustion/limits FAIL (frozen pins).
Same-variant BXGY discounts in place; cross-variant free lines
materialize (validated + reserved + discounted rows; dead/short/capped-
out lines SKIP). `discount_total` = Σ application rows; mirrors updated;
usages + counter bumps in the same tx. Cancel decrements promo + coupon
counters (frozen A34; no-op for promo-free orders; usage rows stay).

## 4. Coupons

UPPER/trim normalization (inner spaces → 400); unknown → 404; flags +
BOTH windows + parent-effective decided by SQL `now()` (CC-1 rule);
minimum on gross; per-customer active-usage COUNT under the coupon-row
lock; conditional rowcount-checked bumps on coupon + parent (miss → 409);
BXGY/FIXED_PRICE parents → 422 (no frozen coupon semantics). Usage rows
at creation; finals NULL (no finalize in scope).

## 5. Endpoints

Storefront (public, server-computed, checkout is sole committer):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/store/orders/estimate` | read-only preview (lines + coupon + fee math, no locks/rows) |
| POST | `/api/store/orders` | + optional `couponCode` (BA-6 compatible) |

Admin (frozen keys; status/isActive flips need `*.disable`, fields need
`*.update`, deletes rely on RESTRICT → 409):

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET/POST | `/api/admin/promotions` | view / create | list + create (ACTIVE requires targets first) |
| GET/PATCH/DELETE | `/api/admin/promotions/[id]` | view / update+disable / disable | detail, gated edits, guarded delete |
| POST/DELETE | `/api/admin/promotions/[id]/targets…` | update | existence+liveness validated, dup 409 |
| PUT | `/api/admin/promotions/[id]/rules` | update | 1:1 thresholds + cap |
| PUT | `/api/admin/promotions/[id]/buy-get` | update | 1:1 BXGY params (BXGY only) |
| GET/POST | `/api/admin/coupons` | view / create | list + create |
| GET/PATCH/DELETE | `/api/admin/coupons/[id]` | view / update+disable / disable | detail, edits, guarded delete |
| GET | `/api/admin/coupons/[id]/usages` | view | usage ledger (BA-F: read-only reporting; reads never bump counters) |

Value/target/rule columns reject edits once order rows reference the
promo (422, A21); activation requires LINE targets (+BXGY rule row).

## 6. Derived decisions (flagged, minimal)

- Coupon-gated promos (≥1 coupon row) never auto-apply: seed intent
  ("reached via coupons") + single-coupon economics; no frozen test
  combines the layers. Without it every coupon would double-dip.
- Coupon-row promotion snapshots use the parent name (no name column
  exists on coupons).
- R5-style caps, dust ties, and SKIP-recompute bounds follow the
  architecture text where doubles are silent or redundant.

## 7. Errors (BA-1 envelopes)

400 malformed/strict-unknown/inner-space codes; 401 anonymous admin;
403 roleless; 404 unknown promo/coupon/variant/order + foreign ownership;
409 global-limit losers (coupon, parent, auto-race) + referenced deletes;
422 shapes, activation, immutability, coupon inapplicability, per-customer
breach, unsupported coupon parent; 500 generic only.

## 8. Prisma vs raw SQL

- Prisma: CRUD, graphs, lists, tx blocks, P2002/P2025 mapping.
- Raw SQL only for: SQL-time effectiveness gates, row locks, conditional
  counter bumps, atomic reserve/release, guarded flips, EXISTS probes,
  nested-P2010 code mapping. `available_quantity` never computed in JS.

## 9. Tests

| Suite | Result |
|---|---|
| `scripts/api/t-promotions-unit.mjs` (math, order, caps, bounds) | 34/34 |
| `scripts/api/t-promotions.mjs` (HTTP on scratch) | 58/58 |
| `scripts/api/t-promotions-concurrency.mjs` (coupon races, SKIP, rollback) | 13/13 |
| BA-1 `t-foundation.mjs` | 26/26 |
| BA-2 `t-catalog.mjs` (scratch) | 53/53 |
| BA-3 `t-inventory-unit.mjs` | 34/34 |
| BA-3 `t-inventory.mjs` (scratch) | 84/84 |
| BA-3 `t-inventory-concurrency.mjs` | 18/18 |
| BA-4 `t-customers-unit.mjs` | 40/40 |
| BA-4 `t-customers.mjs` (scratch) | 66/66 |
| BA-4 `t-customers-concurrency.mjs` | 8/8 |
| BA-5 `t-cart-unit.mjs` | 28/28 |
| BA-5 `t-cart.mjs` (scratch) | 50/50 |
| BA-5 `t-cart-concurrency.mjs` | 13/13 |
| BA-6 `t-orders-unit.mjs` | 16/16 |
| BA-6 `t-orders.mjs` (scratch) | 54/54 |
| BA-6 `t-orders-concurrency.mjs` | 15/15 |
| BA-7 `t-replacements-unit.mjs` | 24/24 |
| BA-7 `t-replacements.mjs` (scratch) | 54/54 |
| BA-7 `t-replacements-concurrency.mjs` | 12/12 |
| CC-1 `t-cc1-lockout.mjs` (scratch) | 8/8 |
| `t-password.mjs` | 9/9 |
| Phase 2 / 4 / 5 functional | 77/77, 65/65, 50/50 |
| `tsc --noEmit` / ESLint (0 warnings) / `npm run build` | PASS |

Races: last-usage single-winner, per-customer single-winner, limited-auto
SKIP (both succeed, one discounted), rollback atomicity (no usage, no
counters, no order).

## 10. BA-C audit findings (2026-10-02)

### 10.1 CORRECTED — targeted ORDER `minimum_amount` was measured on cart-wide gross

`evaluateOrderLayer` compared `minimumAmount` against the **cart-wide**
gross. Frozen Phase-4 semantics (`phase4-schema.sql` comment on
`promotion_rules.minimum_amount`) define it as the **eligible lines' gross,
pre-discount** — identical for targetless promos (they see every line),
but wrong for targeted ones: an unrelated expensive line could qualify a
promo for a cheap line.

Fixed in `src/lib/promotions/engine.ts` (eligible-gross sum; see the
in-code frozen-semantics comment). Regression-proved both ways in
`t-bac-shopping`: `promo-order-min-qualifies` (eligible 30.00 ≥ 20.00 →
10 % = 3.00) and `promo-order-min-eligible-only` (cart-wide 45.00 but
eligible 15.00 < 20.00 → **0**, pre-fix this returned 1.50).

### 10.2 FIXED (BA-C closure, 2026-10-02) — session timezone pinned to UTC in the client factory

Root cause: Prisma 7.10 + `@prisma/adapter-pg` serialises `Date` parameters
**without an offset**; PostgreSQL reads an offset-less timestamp literal in the
*session* time zone, so every Date-bound TIMESTAMPTZ written through Prisma was
stored shifted by the server UTC offset (DST-varying), and Prisma's reads
mirrored the same shift (the CC-1 decode shift already recorded in
`docs/admin-auth-architecture.md` §10).

| Path | Result on this host (server `TimeZone = Africa/Cairo`, +03) |
|---|---|
| raw `pg` param (Date **or** ISO string) | exact (drift 0 s) |
| Prisma Client param, ISO **string** | exact (drift 0 s) |
| Prisma Client param, JS **Date** | **−10 800 s (3 h early)** |

Observed consequences before the fix: a promotion created with
`startAt = now + 1 h` applied immediately (`promo-window-skip` → `201/3`), a
window containing `now()` applied not at all (`promo-window-inside` → `201/0`),
and a 1 h auth token showed ~4 h of life.

**Fix (central, code-level, no production change):** `src/lib/db-url.ts`
`withUtcSession()` rewrites `DATABASE_URL` so every pooled connection starts
with `options=-c timezone=UTC`, applied in the single Prisma factory
`src/lib/db.ts`. It also *replaces* any `timezone` option coming from the URL,
because node-postgres lets connection-string parameters override the config
object — otherwise a stray `?options=…` in the environment would silently
defeat the pin. Non-timezone options (`statement_timeout`, …) are preserved and
the rest of the URL is passed through byte-for-byte (no password re-encoding).

Candidates weighed: (A) UTC pin in the client factory — chosen: one choke
point, covers every Date write and read, deploy-agnostic (Vercel/Neon/local),
visible in the diff, no DB or production configuration change;
(B) `ALTER ROLE hyper_app SET timezone='UTC'` — DB-side, invisible in the repo,
would not travel with a restored/new database, and is a production change;
(C) no equivalent mechanism existed in the architecture;
(D) per-path Date→ISO conversions — rejected as default: it leaves the trap
for future code (exactly the failure mode that produced this bug).

Verification (`scripts/api/t-time-contract.mjs`, 10/10):
BEFORE evidence reproduces the defect with a client built exactly like the old
`db.ts` (`drift=-10800s` on a Cairo session; raw ISO-string control `0s`);
AFTER, a 4×4 matrix (session TZ × process TZ over UTC, Africa/Cairo,
Pacific/Kiritimati, America/New_York) is exact in every combination and the
effective session zone is `UTC` in all of them; the pin also overrides a
hostile URL that requests `Pacific/Kiritimati`. Business gates re-proved
TZ-independent: promotion before/inside/after window, coupon window, cart
expiry, admin session expiry, and the 1 h auth-token TTL (now 3600 s).
`t-bac-shopping` (60 assertions) stays green with the app asking for a Cairo
session while the process runs in Kiritimati — the application no longer
depends on the server or process time zone.

`DATE`-only business clocks inside SQL (`now()`, `now() + interval`) were
always unaffected and remain the mandated authority. Two consequences worth
knowing: keyset cursors previously stayed consistent only because the decode
and write shifts cancelled (fragile across DST — now moot), and rows written
*before* this fix on a non-UTC session keep the old offset, so any deployment
that adopts the fix should audit pre-existing `promotions.start_at/end_at`,
`coupons.start_at/end_at` and `admin_auth_tokens.expires_at` values.

## 11. Session findings (honest)

- My BXGY-cross expectation encoded 2×15=60 (actual 30): the
  implementation (subtotal 60 / discount 30 / total 50) was correct all
  along — DB rows proved it; corrected the test, not the code.
- One leaked P1L hold from an early crashed run was found by the suites'
  exact-value asserts, reset directly on scratch, and both replacements
  suites re-verified leak-free twice.
- Back-to-back full-suite runs exhaust the frozen login rate buckets
  (generic 401 by design); suites were scheduled across rollovers.
- One Phase-2 run hit the harness's own random-ID collision (pre-existing
  flake) — re-run green.
- Skipped with reason: 120-race embedded-PG gate (admin-blocked OS user —
  documented Phase 4 limitation; frozen SQL byte-identical) and CC-1 TZ
  rerun (auth untouched).

## 12. Files

- New: `src/lib/promotions/{engine,validation,serialize,queries,writes,checkout}.ts`;
  store `orders/estimate` route (+ `couponCode` on order create);
  admin `promotions/...` (7) + `coupons/...` (3) routes;
  `scripts/api/{t-promotions,t-promotions-concurrency,t-promotions-unit}.mjs`;
  this doc.
- Modified: `src/lib/orders/writes.ts` (promo phase + counters in cancel),
  `src/lib/orders/validation.ts` (+ optional couponCode) — additive only,
  BA-6 suite green unchanged.
- Untouched/protected: `db/*`, `prisma/*`, auth/API/BA-1..BA-7 behavior,
  `docs/AGENT-HANDOFF.md`, `docs/release-manifest.md`, all frontend.

## 13. Deferred (unchanged + BA-8-specific)

Finalize/final-discount computation, payments, delivery mechanics,
OTP/login, rotation, TTL numbers, versioning, retention, notifications,
images, barcode formula — none invented here.
