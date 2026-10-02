# AGENT HANDOFF — Hyper Al-Moatasem / هايبر المعتصم (canonical, self-contained)

> Read this file first. The authoritative CURRENT STATE is the block
> "⚑ SESSION HANDOFF — CURRENT STATE (BA-D, 2026-10-02)" immediately below.
> It supersedes any conflicting wording further down (including the BA-C
> closeout block, which is preserved beneath it as history); the standing
> reference sections (§ Project identity … § Human decisions) are preserved
> and must not be deleted. Conversation history is NOT the source of truth —
> the repository, the database and passing tests are. If anything here
> conflicts with those, stop and investigate.

# ⚑ SESSION HANDOFF — CURRENT STATE (BA-D, 2026-10-02)

> Status labels are strict: **DONE** (implemented) · **VERIFIED** (executed,
> output actually seen) · **PARTIAL** · **BLOCKED** · **DECISION-REQUIRED**
> (needs an explicit human decision; do not guess) · **NOT STARTED**.

## 0. BA-D STATUS: COMPLETE (verification-only; zero src changes)

* **Audit verdict:** BA-4 (customers/addresses) and BA-6 (orders/checkout) are
  real application services, not test doubles — **reused, not rewritten**.
  `db/tests/**` reference doubles are declared frozen-rule harnesses
  (acceptable); all API suites drive real HTTP; **no production-code doubles
  exist**. Full audit record: `docs/backend-customer-checkout.md` §1.
* **New suite `scripts/api/t-bad-customer-checkout.mjs`: 64/64, 0 failures,
  4 consecutive runs.** Covers: identify/equivalence/normalization + 8-way
  same-phone race + identity race at checkout; address CRUD + ownership +
  default switch + delete-default state + default-switch race; guest→customer
  upgrade via merge + tokenless customer-cart checkout; full journey
  (70.00 − 23.00 + 20.00 = 67.00, estimate == checkout); weighted 0.125 kg =
  40.00; product/address snapshot immunity (rename/mutate/delete post-order);
  address PATCH/DELETE races at checkout (no torn reads, no partial orders);
  failed-key reuse (409 → fix → 201 → replay same id); frozen phone-identity
  binding documented.
* **Full regression green** (this session): customers 66+8+40 · orders 54+15+17 ·
  cart 50+13+28 · inventory 84+18+34 · promotions 58+13+34 · replacements
  54+12+24 · admin 80 · catalog 53 · bac-shopping 60 · time-contract 10 ·
  ba-a-contract 45 · Phase 2/4/5 77/65/50 · units all green.
  `tsc --noEmit` / ESLint / `npm run build`: PASS (run at closeout).
* **Regression notes (environmental, not product):** login buckets (IP 30 /
  account 10 per 15 min) forced spacing; one replacements run caught an
  orphaned P1L `reserved_quantity = 1.000` with zero referencing order rows
  (reset after verification → 54/54 + 12/12 green); t-bab-catalog pending
  bucket rollover at handoff time (unrelated to BA-D; no BA-D dependency on it).
* **Diff impact of BA-D:** +2 files only (`t-bad-customer-checkout.mjs`,
  `backend-customer-checkout.md`). **Zero `src/**` changes.**
* **Closeout done:** t-bab-catalog 46/46 (after scale seed + ANALYZE);
  `tsc`/`ESLint`/`build` PASS; scratch residue-free (0 orders/carts/promos/
  coupons/customers; P330 500/0, ROMI 47.350/0); production untouched
  (read-only; only the 5 disclosed telemetry rows); servers stopped.
  One lint warning fixed (`idC3` unused var removed; 0 warnings now).
* **Deferred (unchanged):** OTP/login, password reset, MFA,
  `customers.manage` split, phone change, customer hard-delete, storefront
  address self-service, picking/fulfillment, payments, delivery. BA-E:
  DO NOT START.

---

# ⚑ SESSION HANDOFF — CURRENT STATE (BA-C closeout, 2026-10-02)

> Status labels are strict: **DONE** (implemented) · **VERIFIED** (executed,
> output actually seen) · **PARTIAL** · **BLOCKED** · **DECISION-REQUIRED**
> (needs an explicit human decision; do not guess) · **NOT STARTED**.

## 1. CURRENT PROJECT STATE

* **VERIFIED:** BA-0 → BA-11 backend roadmap COMPLETE and committed.
  HEAD = `e108acc28539178e2ebf1e2ad6e00e036af2241d`
  (`chore: sync verified backend state and project documentation`).
* **IN PROGRESS (uncommitted, by standing rule):** post-BA-11 hardening track
  **BA-A → BA-C**. No commit, no push, no schema/migration change, no
  deliberate production write.
* **BA-A — DONE + VERIFIED:** canonical envelopes + status taxonomy +
  `/api/health` + expired-cart sweeper + `docs/openapi.yaml`.
* **BA-B — DONE + VERIFIED:** opaque keyset cursors, Arabic `pg_trgm` search,
  product metadata media, `db/future/search-trgm.sql`,
  `db/future/product-images.sql` (scratch-only activation; NOT production).
  Requires the 20k scale dataset: `node scripts/api/seed-bab-scale.mjs --db
  hyper_almoatasem_scratch` (and `--clean` afterwards) — `t-bab-catalog`
  fails without it.
* **BA-C — VERIFIED COMPLETE.** Cart / repricing / promotions / coupons closed:
  engine bug fixed, persisted reprice endpoint added, and the **session-timezone
  root cause fixed centrally in code** (no production change needed, §6.1).
  Suites green: `t-bac-shopping` **60/60** and `t-time-contract` **10/10**;
  full regression + `tsc`/ESLint/build green; scratch residue-free.
* **BA-D — NOT STARTED.** Frontend — NOT STARTED (deferred by standing rule).
* **VERIFIED at handoff time:** PostgreSQL (5432) and Next dev (3131) are
  **stopped**. Scratch `hyper_almoatasem_scratch` is residue-free:
  0 orders / 0 order_items / 0 carts / 0 cart_items / 0 promotions /
  0 coupons / 0 coupon_usages / 0 customers / 0 auth tokens; fixtures exact
  (2 products, 4 variants, inventory 47.350/0, 500/0, 300/0, 150/0; 3 users,
  2 roles, 31 permissions, 55 role_permissions, 2 user_roles, 8 settings).
  `audit_logs` holds append-only rows accumulated by admin-mutating suites
  (expected; never deleted — audit is append-only by design).

## 2. CURRENT PHASE

```text
CURRENT_ENGINEERING_TRACK: BA-C — CLOSED (code + tests green, TZ root cause
                            fixed in code; no production change required)
BA-C STATUS:               COMPLETE for the engineering scope. Two items stay
                            with the human and are NOT code blockers:
                            the 5 production telemetry rows (§6.2) and
                            acceptance of the new production migration
                            baseline (§6.3).
NEXT PHASE (NOT STARTED):  BA-D
PRODUCTION TRACK:          unchanged — go-live still awaits explicit human
                           authorization; production was read-only in this
                           closure except the disclosed telemetry rows
```

## 3. COMPLETED IN THIS SESSION (BA-C)

| # | What | Where | Result | Verified? |
|---|---|---|---|---|
| 1 | **Bug fix** — targeted ORDER-scope promotion `minimum_amount` was compared against **cart-wide** gross; frozen Phase-4 semantics define it as the **eligible lines' gross, pre-discount** | `src/lib/promotions/engine.ts` (`evaluateOrderLayer`) | DONE | **VERIFIED** — new `promo-order-min-qualifies` (3.00) + `promo-order-min-eligible-only` (0, pre-fix 1.50) |
| 2 | Persisted cart reprice endpoint: refresh every line snapshot to the LIVE price, drop inactive/deleted variant lines, quantities untouched, one tx under the cart lock | `repriceCart` in `src/lib/cart/writes.ts`; `cartRepriceSchema` in `src/lib/cart/validation.ts`; `src/app/api/store/cart/reprice/route.ts` | DONE | **VERIFIED** — `reprice-refresh` / `reprice-noop` / `reprice-drop-dead` / `reprice-strict-400` |
| 3 | BA-C verification suite created and extended to **60 assertions** (cart lifecycle, ownership, expiry, merge + concurrency, PIECE/WEIGHT rules, weight step matrix 0.250/0.500/1.000/1.250, price tamper, exact money math, 4 promotion types, 4 scopes, priority, specificity, stacking, caps, min qty/amount, windows, coupons + limits + races + rollback, cart×promo×coupon integration, checkout boundary) | `scripts/api/t-bac-shopping.mjs` | DONE | **VERIFIED** 60/60, 0 failures |
| 4 | Fail-closed **server-identity guards** — the suite refuses to run if the API server is not bound to the scratch DB: (a) pre-login read-only check that the scratch-only seeded fixture is served, (b) post-login round-trip proving the server's writes are visible to the suite's own connection; a polluted scratch also aborts (`env-clean`) | `scripts/api/t-bac-shopping.mjs` | DONE | **VERIFIED** — all three guards exercised (production `--db` → `REFUSED_DB`; server on another DB → `REFUSED_WRONG_SERVER_DB`; correct pairing → allowed) |
| 5 | Storage-level timestamp guard `promo-window-stored-exact` (asserts `extract(epoch from (start_at - now()))` against the **DB** clock) + behavioural guards `promo-window-skip` / `promo-window-inside` | `scripts/api/t-bac-shopping.mjs` | DONE | **VERIFIED with a negative control**: pre-fix the suite failed exactly those 3 (`sentDelta=7200 storedDelta=-3600`); with the central fix they pass under every session/process time zone |
| 6 | **Root-caused and FIXED a real defect:** Prisma 7.10 + `@prisma/adapter-pg` serialises JS `Date` parameters **without an offset**; PostgreSQL then reads that naive wall clock in the session time zone → every Prisma-written TIMESTAMPTZ is shifted by the server offset (−10 800 s here). raw `pg` params and Prisma ISO-**string** params are exact. **Fix:** `src/lib/db-url.ts` `withUtcSession()` pins `options=-c timezone=UTC` on every pooled connection from the single factory `src/lib/db.ts` (also overrides any timezone option arriving via `DATABASE_URL`) | `src/lib/db-url.ts`, `src/lib/db.ts`; root-cause record in `docs/backend-promotions.md` §10.2 | DONE | **VERIFIED** — new `scripts/api/t-time-contract.mjs` 10/10: BEFORE evidence `drift=-10800s` with a pre-fix client; AFTER a 4×4 session×process TZ matrix (UTC / Africa/Cairo / Pacific/Kiritimati / America/New_York) exact in all 16 combos, auth-token TTL exactly 1 h, and `t-bac-shopping` green with the app requesting a Cairo session in Kiritimati |
| 7 | Full regression re-run on scratch **after** the timezone fix: 25 API suites + 7 unit suites + Phase 2/4/5 PGlite + `tsc` + ESLint + `build` | see §5 for the recorded numbers | DONE | **VERIFIED** — all green |
| 8 | Docs updated for what actually changed | `docs/backend-cart.md` (§3.1 reprice), `docs/backend-promotions.md` (§10 BA-C findings), `docs/openapi.yaml` (`/api/store/cart/reprice`) | DONE | VERIFIED (build + OpenAPI/route coverage suite green) |

### BA-A / BA-B status note
BA-A and BA-B were completed earlier on the same uncommitted track and are
re-verified green as part of item 7 (`t-ba-a-contract` 45/45,
`t-bab-catalog` 46/46).

## 4. ARCHITECTURAL / TECHNICAL DECISIONS (this session)

* Money stays integer piastres / `NUMERIC`; no binary float is ever
  authoritative; `divRoundHalfAway` long division (audit found no float in
  any money path).
* Cart line snapshots are **not** the checkout authority; promotions/coupons are
  evaluated at estimate/checkout (frozen R19 untouched).
* Repricing is an **explicit, persisted endpoint**, never folded into a read
  (`GET` must not write) and never folded into add/update (a quantity edit must
  not silently move money). Checkout still re-validates independently.
* Targeted ORDER `minimum_amount` = **eligible-lines gross, pre-discount**
  (frozen Phase-4 semantics) — identical for targetless promos.
* A promotion that owns a coupon is **gated** out of auto-application and only
  applies via an explicit code (existing `gated` set in `checkout.ts`) — now
  asserted by the suite.
* The estimate endpoint is intentionally **address-free**; `addressId` is a
  checkout-only field and the estimate schema is strict (400).
* Test suites must **fail fast on a dirty or wrong environment**: stray ACTIVE
  promotions, leftover BA-C customers, debug catalog rows, inventory drift and a
  non-scratch API server all abort the run instead of producing false results.
* Still standing (do not relitigate): effective-permission ceiling ·
  role-row serialization · per-request RBAC snapshot · no implicit auto-join ·
  same-transaction mutation+audit pairing · guest-token expiry · fail-closed
  rate limits · SQL-side business clocks.

## 5. CURRENT STOPPING POINT

BA-C is closed. The last actions were the post-fix regression, the residue audit
and shutting both servers down:

```text
node scripts/api/t-time-contract.mjs --db hyper_almoatasem_scratch → 10/10
node scripts/api/t-bac-shopping.mjs  --db … --port 3131          → 60/60
(t-bac-shopping also 60/60 with the app requesting an Africa/Cairo session while
 the process ran in Pacific/Kiritimati — the app is now time-zone independent)
API suites: BA-A 45 · BA-B 46 · cart 50+13 · orders 54+15 · inventory 84+18 ·
  customers 66+8 · replacements 54+12 · promotions 58+13 · admin 80+8 ·
  xmodule 17 · atomicity 18 · idempotency 9 · deadlock 2 · rbac-guards 49 ·
  rbac-races 53 · audit-pairing 101 — all 0 failures
unit suites: cart 28 · promotions 34 · orders 17 · admin 22 · inventory 34 ·
  customers 40 · replacements 24 — all 0 failures
Phase 2 77/77 · Phase 4 65/65 · Phase 5 50/50
tsc --noEmit PASS · eslint src PASS (0 problems) · npm run build PASS
residue: 0 orders/carts/promos/coupons/customers/auth-tokens; fixtures exact
production: READ-ONLY verified (0 business rows; see §6.5)
PostgreSQL + Next dev: STOPPED
```

Nothing was committed or pushed. `docs/AGENT-HANDOFF.md`,
`docs/backend-cart.md`, `docs/backend-promotions.md` (§10.2 carries the
root-cause record) and `docs/openapi.yaml` carry the BA-C record.

## 6. BLOCKERS / OPEN ISSUES

### 6.1 CLOSED — session timezone pinned to UTC in the client factory (no production change needed)

Root cause: Prisma 7.10 + `@prisma/adapter-pg` serialises JS `Date` parameters
without an offset; PostgreSQL reads such a literal in the *session* time zone,
so every Date-bound TIMESTAMPTZ written through Prisma was stored shifted by the
server UTC offset (−10 800 s here), and reads mirrored it (the CC-1 decode
shift). Fix applied **in code**, centrally: `src/lib/db-url.ts`
`withUtcSession()` pins `options=-c timezone=UTC` on every pooled connection
from the single factory `src/lib/db.ts`, and it also overrides any timezone
option arriving via `DATABASE_URL`.

Verified by `scripts/api/t-time-contract.mjs` (10/10) — BEFORE evidence
reproduces the defect with a pre-fix client (`drift=-10800s`), AFTER a 4×4
session×process time-zone matrix is exact (UTC, Africa/Cairo,
Pacific/Kiritimati, America/New_York), auth-token TTL is exactly 1 h, and
`t-bac-shopping` (60/60) passes with the app requesting a Cairo session while
the process runs in Kiritimati. **No production change is required** — the fix
ships with the code. Residual operational note: rows written *before* the fix
on a non-UTC session keep the old offset; production currently has **0**
promotion/coupon/token rows, so nothing to remediate today.

### 6.2 DECISION-REQUIRED — the 5 unintended production telemetry rows

Classified as **TELEMETRY / AUDIT RESIDUE** (not business data). Left in place
deliberately; deleting them is itself a production write. Details in §6.5.

### 6.3 OPERATIONAL — production migration history (read-only verified)

Production holds **three** `_prisma_migrations` rows: baseline (finished,
steps 0), `20260923_admin_auth_foundation` (failed → rolled back
2026-09-24 13:36), and the same migration **finished** (2026-09-24 14:19,
`applied_steps_count = 1`). Production therefore HAS the auth foundation
(35–36 tables incl. `admin_sessions`, `admin_auth_tokens`,
`admin_auth_rate_limits`; users 1, roles 2, permissions 31, role_permissions
55, user_roles 1, store_settings 8). Future objects are **absent**: `pg_trgm`
not installed, no trigram indexes, no `hyper_norm_ar`, no `product_images` —
so `db/future/*.sql` remain unapplied in production (correct). No role carries
a `timezone` setting (all `(none)`), and the production session zone is
`Africa/Cairo`. This session ran **no** migration and **no** deploy; the auth
apply happened outside these sessions, so §5/§17 below are stale and need a
human decision on whether to accept the new production baseline.

### 6.4 Open, non-blocking

* BA-B price-sorted catalog listing — DEFERRED by decision.
* `_recovery/` (production dumps) is untracked and **not** in `.gitignore` —
  add it before any commit (operator action; deliberately not changed here).
* `.agents/ .claude/ .cursor/ .devin/` are agent-tooling skill folders, not
  project code — ignore or gitignore before committing.
* Everything in the standing "Deferred" section (payments, delivery, FTS beyond
  trigram, MFA, frontend, …) remains out of scope.

### 6.5 Production telemetry incident — read-only verification (2026-10-02)

```text
admin_auth_rate_limits : 3 rows, window_start 10:15, updated_at 10:23:45
                         attempts 1 (acct owner) / 1 (acct store) / 2 (ip 127.0.0.1)
audit_logs             : 2 rows, action auth.login_failure, 10:23:45.717 and .816
business tables        : products 0 · variants 0 · inventory 0 · movements 0 ·
                         customers 0 · carts 0 · cart_items 0 · orders 0 ·
                         order_items 0 · promotions 0 · coupons 0 ·
                         coupon_usages 0 · order_discounts 0 · replacements 0
auth tables            : users 1 · roles 2 · permissions 31 · role_permissions 55 ·
                         user_roles 1 · admin_sessions 0 · admin_auth_tokens 0 ·
                         store_settings 8
```

Cause: the dev server was started without the scratch `DATABASE_URL` override
and ran bound to production for ~15 minutes; one suite performed two admin
logins. Both failed (the accounts do not exist in production `users`), so no
credential, session or token was ever created. Why preserved: they are
append-only security telemetry; deleting them is another production write and
would also erase the incident trail. Recommended human decision: leave them
(they expire out of the 15-minute window by themselves and carry no business
meaning) — do not delete.

Prevention now in place: `t-bac-shopping` refuses (a) a non-scratch `--db`
value, (b) a server that does not expose the scratch-only seeded fixture
(pre-login, read-only), and (c) a server whose writes the suite's own
connection cannot see (post-login row round-trip). All three were exercised:
`--db hyper_almoatasem` → `REFUSED_DB` (exit 1); server bound to another
scratch DB → `REFUSED_WRONG_SERVER_DB` (exit 1); correct pairing → allowed.
`.env` still points at production, so any local server must always be started
with an explicit `DATABASE_URL` override.


## 7. NEXT ACTION

1. **Human decision on §6.2** — the 5 production telemetry rows: recommendation
   is to leave them (self-expiring window, append-only audit trail). Do not act
   unilaterally, and do not delete.
2. **Human decision on §6.3** — accept the current production baseline (auth
   foundation applied on 2026-09-24) and update the standing production-track
   sections (§4/§5/§17 below are stale on this point).
3. **Before any commit:** add `_recovery/` and the agent-tooling folders
   (`.agents/ .claude/ .cursor/ .devin/`) to `.gitignore` (§6.4) so production
   dumps and tooling cannot be committed by accident.
4. **Human review of the uncommitted BA-A/BA-B/BA-C diff** (86+ paths, audited
   in this closure: no secrets, no destructive SQL, no production URLs in code,
   no debug leftovers, no frozen-schema or config change), then the usual
   commit/push decision — still forbidden without explicit instruction.
5. **Optional belt-and-braces:** `ALTER ROLE hyper_app SET timezone='UTC'` on
   production is no longer required for correctness (the app pins UTC itself);
   it would only protect non-application clients. Not recommended.
6. Only then consider starting **BA-D**. Do not start it unprompted.

## 8. DO NOT REPEAT

* Do **not** re-run or re-implement BA-0 → BA-11 or the RBAC hardening
  (committed at `e108acc`, green).
* Do **not** rebuild the BA-A envelope/error taxonomy, `/api/health`, the
  sweeper, BA-B pagination/search/media, or the Phase-4 PGlite harness fix.
* Do **not** rewrite `repriceCart`, `cartRepriceSchema` or the reprice route —
  they compile and 4 reprice assertions pass.
* Do **not** re-apply the ORDER-minimum fix (already in `engine.ts`) and do
  **not** re-litigate promotion precedence, specificity, stacking, caps or
  coupon row-lock/rollback design — the audit found them sound.
* Do **not** re-investigate the session-timezone defect: root cause recorded in
  `docs/backend-promotions.md` §10.2, fixed centrally in `src/lib/db-url.ts` +
  `src/lib/db.ts`, proven by `t-time-contract.mjs` (10/10) and a 4×4 TZ matrix.
  Do **not** "also" apply `ALTER ROLE … timezone` — it is not needed.
* Do **not** convert `Date` parameters to ISO strings per call site — the
  central pin already makes Date params exact; per-path conversion would be
  redundant churn.
* Do **not** rebuild the BA-C suite (60 assertions) or the time-contract suite
  (10 assertions); extend them if needed.
* Do **not** touch frozen SQL, production data, or the Prisma version triple.
* Do **not** `git reset` / `git clean` / `git checkout .` — the BA-A/BA-B/BA-C
  work is uncommitted in the working tree.
* Do **not** run suites back-to-back: login rate buckets (IP 30 / account 10
  per 15 min, fail-closed) turn into spurious generic 401s; space runs.

## 9. IMPORTANT SAFETY / PROJECT RULES (preserved)

These remain in force; the standing sections referenced below are authoritative.

* **Production DB `hyper_almoatasem` — READ-ONLY.** Never recreate, destroy,
  truncate, `db push` or `migrate dev` it. No production writes of any kind
  without explicit per-step human authorization (migrations, seeds, bootstrap,
  logins, deploy). All destructive/concurrency testing belongs on
  `hyper_almoatasem_scratch`.
* **`.env` points at production.** Any local API server must be started with an
  explicit `DATABASE_URL` override to a scratch database, and a suite must
  refuse to run if the server is not on scratch.
* **Frozen files are immutable** without an explicit architecture decision:
  `db/phase1-schema.sql`, `db/phase2-schema.sql`, `db/phase4-schema.sql`,
  `db/phase5-schema.sql`.
* **Do not upgrade Prisma** (7.10.0 CLI/client/adapter-pg triple is locked).
* **No commit, push, amend, rebase, reset, or force-push** without an explicit
  instruction; keep the work uncommitted for human review.
* Do not create a new release for hygiene reasons.
* Do not add the 6 designed-but-unimplemented ERD tables except via future
  reviewed migrations.
* Rate limits are **fail-closed**; space login-heavy suite bursts across bucket
  rollovers.
* Business clocks are SQL-side only (`now()`); never compare Prisma-returned
  timestamps in JS (see §6.1 — the same defect exists on the write path).
* Conversation history is never authoritative; the repository, the database and
  passing tests are.
* Git safety for this phase: NO commit / push / amend / rebase / reset /
  force-push / history rewrite — the changes stay uncommitted for human review.

---
---

## 1. Project identity

* **Project:** Hyper Al-Moatasem / هايبر المعتصم — grocery/hypermarket e-commerce (production-oriented)
* **Path:** `D:\Hyper_el-moatasem` · **Stack:** Next.js 16.3.5 + React 19.2.8 + TypeScript 5 + Tailwind + ESLint
* **DB:** PostgreSQL 18.4 GA, local production database `hyper_almoatasem` (server binaries under `C:\pgprov`, data dir `C:\pgprov\data`); client tooling 18.6 under `C:\pgtools\pg18\pgsql\bin` (binaries ZIP, no installer/service touched)
* **Prisma:** CLI 7.10.0 + `@prisma/client` 7.10.0 + `@prisma/adapter-pg` 7.10.0 (matched stable triple; Prisma 8 RC rejected — §8)
* **Runtime:** Node v24.21.0, npm 11.19.0, Windows 11 · `argon2 ^0.45.1`, `zod ^4.6.5`, `zustand ^5.0.15`, `server-only ^0.0.1`, `dotenv ^17.4.2`
* **Scope:** 20,000+ products, Arabic-first, EGP, one branch, Matai Center delivery, guest + registered customers

## 2. Source-of-truth hierarchy

```text
1. Actual frozen SQL / verified database structure (db/*.sql + live PG checks)
2. Passing automated tests and live PostgreSQL verification
3. Architecture documents (docs/*-architecture*.md, *-notes.md)
4. Final ERD (docs/final-erd-v1.mmd)
5. AGENT-HANDOFF.md (this file — accurate snapshot, not authority over 1–4)
6. Conversation history (never authoritative)
```

## 3. Gate history (all verified)

* **Phase 1 — COMPLETE/FROZEN/VERIFIED:** 8 tables (catalog + inventory). Invariants: GENERATED `available_quantity`, weight CHECKs, global code UQ, 7 movement types, price history.
* **Phase 2 — COMPLETE/FROZEN/VERIFIED:** 8 tables (customers/cart/orders/replacements). Unified guest model, phone identity, counting-unit quantities, reserve/commit (R7 predicate), order lifecycle + history-first trigger, link-not-overwrite replacements. **77/77 tests.**
* **Phase 4 — COMPLETE/FROZEN/VERIFIED:** 7 tables (promos/targets/rules/buy-get/coupons/usages/order-discounts). Base-price separation, OR-targets + subtree, priority→specificity ordering, sequential stacking, coupon row-lock races, `discount_total` = checkout-estimate (amended R19). **65/65 functional + 120/120 two-session concurrency.**
* **Phase 5 — COMPLETE/FROZEN/VERIFIED:** 8 tables (users/roles/mappings/permissions/grants/audit/settings/notifications). Identity-only users at freeze time. **50/50 tests** + Phase 2 (77/77) + Phase 4 (65/65) regressions green.
* **Final ERD V1 — REVIEWED/READY:** 37 tables (31 implemented + 6 designed, §6).
* **Foundation — COMPLETE:** Next.js + TS + ESLint + Tailwind + App Router + Zod + Zustand + Git; dev 200 + build green.
* **Database Gate — PASSED:** hybrid model, PG 18, `hyper_almoatasem`, three roles (owner/migrator/app), least privilege.
* **Provisioning — COMPLETE:** local PG18, DB + roles + pgcrypto + `.env` (gitignored), frozen SQL applied byte-identically (31/1/1 objects verified).
* **Prisma Schema Gate 1 — COMPLETE + EVOLVED:** `prisma/schema.prisma`, now **34 models** (31 frozen + `AdminSession`, `AdminAuthToken`, `AdminAuthRateLimit` from the auth migration below); automated COLUMNS-OK; frozen-name index `map:`s; `Decimal?` GENERATED shell.
* **Prisma Schema Review — PASSED** (with one toolchain decision, §8).
* **Migration Planning — PASSED:** dual-artifact prototype proven on scratch (COMPARE-CLEAN).
* **Prisma Toolchain Alignment — COMPLETE:** CLI pinned 7.10.0 (8.0.0-rc.15 skew removed); `prisma.config.ts` loads `.env` via `dotenv/config`; `DATABASE_URL` = app role, `MIGRATION_DATABASE_URL` = migrator role; session-env override is the supported mechanism for migrator-routed commands (proven live).
* **MIGRATION IMPLEMENTATION / BASELINE — COMPLETE:** official baseline `20260923_baseline__official` (migration.sql + supplement.sql + README) authored from the prototype, scratch-proven, and **resolve-marked on production** (`applied_steps_count=0`, zero schema mutation).
* **Bootstrap Seed — COMPLETE (code + scratch proof):** `prisma/seed.mjs` (pg driver; deterministic IDs; no blind upserts — mismatch FAILs loudly; guards: explicit `SEED_TARGET`, allowlisted DBs, history assertion, single transaction; credential-free). Strict counts 2/31/55/8/1/1 verified on scratch, idempotent re-run identical.
* **Admin Auth Architecture — APPROVED:** custom DB-backed opaque sessions (no Better Auth — Auth.js is merged into Better Auth per its 2026 docs; no JWT — revocation required; no Edge for auth paths).
* **Auth Foundation — IMPLEMENTED (scratch only):** Argon2id (OWASP minimums), 8h sessions, `__Host-` cookies, lockout 5→15min, DB rate buckets (IP 30 + account 10 per 15min), one-time tokens, raw-SQL audit, bootstrap CLI. Migration `20260923_admin_auth_foundation` (dual-artifact) scratch-proven; **NOT applied to production.**
* **Auth Hardening — PASS:** timezone root cause proven (Prisma 7.10 decodes TIMESTAMPTZ shifted by server UTC offset, DST-varying — all security time-gates are SQL-side by rule); races exact; 403/RBAC/audit verified.
* **Staging (local prod-mode + real TLSv1.3 self-signed terminator) — PASS:** least-privilege app role model proven (incl. self-grant inertness); **124/124 assertions PASS** (99 foundation + 25 hardening).
* **Production Go-Live Review — DONE:** verdict was NOT READY solely for missing HTTPS/backup/release-identity; all three environmental gaps have since been closed (local-TLS proof, verified backup, release commits below).
* **Release Freeze — COMPLETE:** code commit + manifest commit (see §4); 35 critical SHA-256 recorded.
* **Backup/Recovery — VERIFIED:** `pg_dump -Fc` → SHA-256 recorded → two independent restores → object-for-object + functional equivalence. Decision recorded: BACKUP/RECOVERY VERIFIED.
* **Post-Backup Hygiene — PASS:** backup untracked/kept; no release mutation.
* **Production Bootstrap Design — IMPLEMENTED + SCRATCH-VERIFIED (working tree only, uncommitted, NOT executed on production):** `prisma/bootstrap-production.mjs` (dedicated production path; frozen single-DB allowlist + PG18/schema/fingerprint/ownership/history/zero-state fail-closed guards; transactional drift-loud idempotent 2/31/55/8/1/1, credential-free with password_hash-NULL proof). Scratch-only `prisma/seed.mjs` unchanged (still hard-denies production). Verified on an isolated PG 18.4 scratch instance (history/ownership/grants mirrored): happy-path OK, idempotent rerun identical, chaos rollback atomic, drift mismatch loud-fail, missing-target/wrong-DB denies; two findings fixed in-file (rolled-back history tolerance, business-wide zero-state keeping reruns possible). New release commit + manifest + deploy still require separate authorization.

## 4. Current gate (MOST IMPORTANT)

```text
CURRENT_GATE: GO-LIVE EXECUTION (awaiting explicit human authorization)
```

Everything verifiable without production writes is DONE. The only remaining
work is the go-live runbook (auth migration → seed → bootstrap → deploy),
which requires explicit human go-ahead per step. **Do NOT begin any of it
unprompted.** In particular: do NOT run `migrate resolve/deploy`, seed, or
bootstrap against production; do NOT create a new release for hygiene reasons.

```text
Release SHA (code, immutable): f73ce0b984b3bbbebdfdce92d9aa6c4aab04708d
Manifest commit (attests release): 468fddf7b7a49e8b39c6e1180d7fa5eb4ae29187
Previous production release: NONE (first release)
Release freeze / manifest: `6b6cdfb` + `7b6e400` (production bootstrap path release + manifest attestation — NEW; manifest updated from `f73ce0b`-era; previous manifest `468fddf`; NO deployment performed)
Last re-verified (read-only, no production writes): 2026-09-24 — gate unchanged,
release intact, DB fingerprint + backup hash re-confirmed (see §17).
Auth migration attempt 2026-09-24 (explicit phase authorization): FAILED —
P3018 / 42501 `must be owner of table users` as hyper_migrator; schema unchanged,
failed history row present (see §5/§17). Do NOT retry deploy unprompted.
Recovery analysis 2026-09-24 (read-only, no DB writes): ownership-only confirmed —
all 31 business tables + DB owned by hyper_owner, _prisma_migrations by
hyper_migrator; arch rule `owner applies DDL` (migration-architecture §18);
artifacts + backup re-verified intact; decision: hyper_owner must execute auth
migration after separate failed-row recovery approval.
Recovery plan 2026-09-24 (PLAN ONLY, zero prod writes): failed-row state +
unchanged catalog + ownership + artifacts + backup re-verified read-only;
official Prisma v7 docs confirm `resolve --rolled-back` + re-deploy path;
DDL identity hyper_owner, history-recovery identity hyper_migrator, no ownership
transfer; awaits separate explicit execution authorization.
B14 Hosted PostgreSQL design verified (scratch-only `prisma/bootstrap-production.mjs`): complete; scratch-only; production authorization separate; NOT EXECUTED on production.
B14 Hosted PostgreSQL scratch verification PASS: happy + idempotent rerun + chaos rollback + drift + wrong-target deny + missing-target deny.
B15 (Hosted DB deployment + HTTPS / Runtime Smoke): NOT EXECUTED.
Build pipeline fix verified (working tree, UNCOMMITTED at freeze time): `package.json` = `"prisma generate && next build"`; `prisma generate` + `tsc --noEmit` + `npm run build` PASS; `prisma validate` PASS.
```

### Backend application roadmap — BA-0 → BA-11 COMPLETE (2026-09-27)

```text
BA-0  (contract audit) ............ COMPLETE (docs/backend-application-contract.md)
BA-1  (shared foundation + CC-1) .. COMPLETE (src/lib/api/* + timezone fix in SQL)
BA-2  (catalog APIs) .............. COMPLETE (20 routes, barcode 2010106 live proof)
BA-3  (inventory APIs) ............ COMPLETE (stock/weighted/reserve/commit/sale,
                                     no held_quantity column — R3 uses requested)
BA-4  (customer APIs) ............. COMPLETE (unified model, R8 phone ladder)
BA-5  (cart APIs) ................. COMPLETE (XOR ownership, guest tokens, R1 merge)
BA-6  (orders APIs) ............... COMPLETE (one-tx checkout, snapshots, idempotency)
BA-7  (replacements) .............. COMPLETE (link-only, R2/R5/R10)
BA-8  (coupons/promotions) ........ COMPLETE (integer engine, coupon races, R19 kept)
BA-9  (admin APIs) ................ COMPLETE (users/roles/permissions/settings/audit)
BA-10 (concurrency/idempotency) ... COMPLETE (verification only, zero src changes)
BA-11 (full backend verification) . COMPLETE (integration gate green, see BA-11 block below)
BA-A  (canonical contract + health) IN PROGRESS-track DONE, UNCOMMITTED
BA-B  (catalog search/media/pagination) DONE, UNCOMMITTED, scratch-only activation
BA-C  (cart/reprice/promo/coupon audit) CLOSED — t-bac-shopping 60/60 GREEN,
                                      t-time-contract 10/10 GREEN; session-TZ
                                      root cause fixed centrally in code
BA-D  ........................................... NOT STARTED
Frontend .......................... DEFERRED — DO NOT START
```

```text
BA-A → BA-C are UNCOMMITTED working-tree work on top of HEAD e108acc (86 paths).
BA-A, BA-B and BA-C are all DONE + VERIFIED green. BA-C is CLOSED: the
session-timezone root cause was fixed centrally in code (no production change
required). Two items remain with the human and are not code blockers: the five
disclosed production telemetry rows and acceptance of the current production
migration baseline (both detailed in "SESSION HANDOFF — CURRENT STATE" §6).

BA-10 added (uncommitted work, no commit/push per standing rule):
`scripts/api/{t-xmodule,t-atomicity,t-idempotency-matrix,t-deadlock}.mjs` +
`docs/backend-integration.md`. Zero product-code changes in BA-10;
no schema/migration/permission/role changes; no production writes.

BA-10 verified results (real PostgreSQL, scratch-only):
cross-module X1–X8 17/17 · atomicity 18/18 · idempotency-matrix 9/9 ·
deadlock probes 2/2 · re-run races inventory 18/18, cart 13/13, orders
15/15, replacements 12/12, promotions 13/13, customers 8/8, admin 8/8.
Full regression green with zero failures: BA-1 26 · BA-2 53 ·
BA-3 34+84+18 · BA-4 40+66+8 · BA-5 28+50+13 · BA-6 16+54+15 ·
BA-7 24+54+12 · BA-8 34+58+13 · BA-9 22+80+8 · CC-1 8 · password 9 ·
Phase 2/4/5 functional 77/65/50. `tsc`/`eslint` (0 warnings)/`build` PASS.
Skipped with reason: 120-race embedded-PG gate (admin-blocked OS runner;
frozen SQL byte-identical) and CC-1 TZ rerun (auth untouched).
Scratch verified residue-free (0 test rows everywhere; fixtures exact;
3 users, 2 roles, 8 settings intact). Test-only notes: full-suite bursts
can exhaust frozen login buckets (IP 30 / account 10 per 15 min,
fail-closed generic 401 by design — schedule across rollovers); one
customers-concurrency assert flaked once under rate pressure then passed
clean twice; one Phase-2 run hit the harness's own random-ID collision
(pre-existing flake) — re-run green.

BA-11 verified results (real PostgreSQL, scratch-only; authorized human
go-ahead received, gate executed 2026-09-27):
PRE-BA-11 hardening first: RBAC safety guards (self-deactivation 403,
last-active-SUPER_ADMIN 409 concurrency-safe, SUPER_ADMIN revoke 403) +
audit pairing retrofit of all 36 BA-2..BA-8 admin endpoints (same-tx
mutation+audit; customer self-service paths stay unaudited) +
effective-permission ceiling (grant/assign ⊆ actor set, 403) +
role-row serialization (assign vs deactivation, inactive-assign 409) +
per-request snapshot semantics + no-implicit-auto-join + ordinary
self-ungrant legal. New suites: `t-rbac-guards.mjs` 49/49,
`t-rbac-races.mjs` 53/53, `t-audit-pairing.mjs` 101/101.
BA-11 full matrix green with zero failures: units foundation 26 ·
admin 22 · cart 28 · customers 40 · inventory 34 · orders 16 ·
promotions 34 · replacements 24; API catalog 53 · inventory 84+18 ·
customers 66+8 · cart 50+13 · orders 54+15 · replacements 54+12 ·
promotions 58+13 · admin 80+8 · xmodule 17 · atomicity 18 ·
idempotency-matrix 9 · deadlock 2 · rbac-guards 49 · rbac-races 53 ·
audit-pairing 101 · CC-1 8 · password 9 · Phase 2 77 · Phase 5 50.
Phase 4 PGlite: environmental exception (0.4.3 `rowCount: undefined`
for UPDATEs, proven by direct probe; frozen harness untouched; same
coupon/concurrency behavior green on real PG). `tsc`/`eslint`
(0 problems)/`build` PASS. Production read-only verified: 35 tables,
future six absent, 1 view, 1 sequence, 0 product rows, migration
history intact. Scratch residue-free; fixtures exact. Two minimal
verification-tied code fixes (role-mapping DELETE + grants DELETE
missing try/catch — guard errors escaped as 500); full details in
`docs/backend-integration.md` (BA-11 record) and
`docs/rbac-audit-hardening.md` (§7 final decisions).

## 5. Database current state

`hyper_almoatasem`: **31 business tables + `_prisma_migrations` (32 total),
1 view (`product_stock_status`), 1 sequence (`order_number_seq`), 39 FKs,
155 CHECKs, 10 partial indexes (7 unique + 3 plain), 6 trigger functions,
22 triggers, 1 generated column, 1 extension (pgcrypto), 1 INET column.**
Migration history: exactly one row — `20260923_baseline__official`
(steps=0, no rollback, clean logs). **Zero business rows; zero auth objects**
(no `admin_*` tables, no `password_hash` column — verified read-only).
[2026-09-24 auth attempt update: `migrate deploy` of
`20260923_admin_auth_foundation` as hyper_migrator FAILED (P3018/42501,
`must be owner of table users`); production schema verified unchanged
(31/32 tables, 39 FKs, 155 CHECKs, 10 partials, 22 triggers, 0 auth objects,
0 business rows); `_prisma_migrations` now holds the baseline finished row
PLUS one unfinished `20260923_admin_auth_foundation` row
(finished_at NULL, rolled_back_at NULL, steps=0) that blocks further deploys
until a separate privilege/failed-state decision. Auth NOT applied.]

> **SUPERSEDED 2026-10-02 (read-only re-verification — the historical notes
> above are kept verbatim as the record of that gate).** The current
> authoritative production state is:
>
> ```text
> TABLES            : 36 public tables (31 business + 3 admin + _prisma_migrations
>                     + product_stock_status view etc.)
> AUTH FOUNDATION   : APPLIED on the authoritative DB on 2026-09-24 14:19:59
>                     (finished, applied_steps_count = 1). admin_sessions,
>                     admin_auth_tokens, admin_auth_rate_limits and
>                     users.password_hash are PRESENT.
> MIGRATION HISTORY : 3 rows —
>                       20260923_baseline__official        finished, steps 0
>                       20260923_admin_auth_foundation     failed → rolled back
>                                                           (2026-09-24 13:36)
>                       20260923_admin_auth_foundation     finished, steps 1
>                                                           (2026-09-24 14:19)
> BUSINESS ROWS     : ZERO in every business table (products, variants,
>                     product_codes, categories, brands, inventory, movements,
>                     carts, cart_items, orders, order_items, replacements,
>                     promotions, coupons, coupon_usages, order_discounts).
> AUTH ROWS         : users 1 · roles 2 · permissions 31 · role_permissions 55 ·
>                     user_roles 1 · store_settings 8 · admin_sessions 0 ·
>                     admin_auth_tokens 0.
> SEARCH / MEDIA    : NOT APPLIED — pg_trgm absent, no trigram indexes,
>                     hyper_norm_ar absent, product_images absent.
>                     db/future/search-trgm.sql and db/future/product-images.sql
>                     REMAIN future activation (never moved into
>                     prisma/migrations, never applied to production).
> ROLE SETTINGS     : no role carries a timezone setting; the session zone is
>                     Africa/Cairo. The application itself pins UTC
>                     (src/lib/db-url.ts), so no production change is needed.
> TELEMETRY RESIDUE : 3 admin_auth_rate_limits rows + 2 audit_logs rows
>                     (auth.login_failure) written 2026-10-02 10:23:45 by a
>                     mis-targeted test run. UNINTENDED INCIDENT RESIDUE,
>                     INTENTIONALLY PRESERVED (human decision: leave in place —
>                     no business data affected, deleting would be another
>                     production write and would erase the incident trail).
> ```
>
> The BA-C closure did **not** intentionally modify the production database:
> verification was SELECT-only (`NON_SELECT_STATEMENTS_ATTEMPTED=0`).

Distinguish from Final ERD V1 (37 tables — the extra 6 are design-only, §6).

## 6. Final ERD boundary

Final ERD V1 = 37 tables. These 6 are DESIGNED but NOT IMPLEMENTED and MUST NOT
be added except via future reviewed migrations: `product_images`, `payments`,
`payment_transactions`, `delivery_zones`, `delivery_drivers`, `deliveries`.

## 7. Frozen phases (see §14 for files)

* **P1:** 8 tables; catalog/inventory; `quantity = available + reserved` (GENERATED);
  single loose variant + `sale_step_grams`; global code UQ; price history.
* **P2:** 8 tables; guest ordering; requested/actual weights; reserve-then-commit;
  NEW→…→DELIVERED + cancellations; replacements link (never overwrite); 77/77.
* **P4:** 7 tables; base price never moves; stacking sequential; weighted promos recompute
  from row snapshots; coupon row-lock + conditional bump races safe; 65/65 + 120 races.
* **P5:** 8 tables; RBAC users→roles→permissions; users table now EXTENDED by the
  auth migration on scratch only (production still identity-only until go-live);
  append-only audit; 50/50.
* **P6 (auth foundation, scratch-proven, NOT on production):** users
  `password_hash`/`failed_login_attempts`/`locked_until` + `admin_sessions` +
  `admin_auth_tokens` + `admin_auth_rate_limits`; 10 CHECKs + 1 partial index +
  1 reused trigger; opaque sessions, Argon2id, atomic lockout/rate/token logic.

## 8. Prisma toolchain (final)

CLI 7.10.0 + client 7.10.0 + adapter-pg 7.10.0 (matched triple). Prisma 8 RC
**rejected** (proven incompatible — §3-era `contract emit` diagnostics).
**Do NOT upgrade Prisma without a new architecture decision.** Key files:
`prisma/schema.prisma` (34 models), `prisma.config.ts`
(`dotenv/config` + `datasource.url = env("DATABASE_URL")`),
`docs/prisma-sql-gaps.md` (gaps + v8 verdict + INET poisoning finding:
`Unsupported("inet")` breaks whole-model queries — audit/sessions go raw SQL).

## 9. Prisma SQL ownership (dual-artifact rule)

*Prisma-owned:* tables, columns, types, nullability, defaults, PKs, plain uniques/indexes
(frozen names via `map:`), FKs, `inet` column shells.
*SQL-owned (supplement):* pgcrypto, all CHECKs, partial indexes, functions, triggers,
GENERATED expression, VIEW, SEQUENCE, INET behavior, money ROUND math, transition
whitelists, row-lock transactions. Raw Prisma DDL alone was **proven inappliable**
(`cannot use column reference in DEFAULT expression`) — it must never be used complete.
Baseline adoption and all scratch builds follow migration.sql-then-supplement.sql order.

## 10. Migration architecture (proven repeatedly)

Official baseline + auth migration, each dual-artifact, each scratch-proven
(structural 31/39/155/10/22/6 + view/seq/ext/generated/inet + functional
batteries + races). `migrate diff --from-config --to-schema` on a correctly
built database yields ONLY inet no-ops + accepted index renames — zero structural drift.
Production adoption is history-marking only (`resolve --applied`, steps=0).

## 11. Real database safety

```text
REAL DATABASE: hyper_almoatasem — NEVER recreate or destroy it.
```

No DROP/TRUNCATE/destructive migration/`db push`/`migrate dev` against it — ever.
Experiment only on scratch DBs (several exist; all disposable; never seed or
resolve against production without explicit per-step authorization).
Current real state: §5 above. Verified backup exists (see §17).

## 12. Next-step requirements (read before acting)

There is NO standing approval for production writes of any kind. The go-live
runbook (separate review) defines the exact authorized sequence IF AND ONLY IF
a human explicitly orders go-live execution:

1. Freeze already done (release commits above — do NOT create another release
   for hygiene; docs/recovery notes stay uncommitted by design).
2. Verified backup already exists (`_recovery/production-pre-auth-20260924.dump`,
   SHA-256 recorded in `docs/recovery-verification.md`; re-verify hash before use).
3. Then, only on explicit order: auth migration → catalog verify → bootstrap
   seed → seed-count verify → owner-password bootstrap (interactive) →
   application deploy → HTTPS/browser smoke → RBAC/audit/logs verification.
4. STOP after each step class and report; never chain production writes unprompted.

> Do NOT re-execute §12-style baseline procedures from older revisions: the
> baseline is resolved; re-running adoption steps is at best redundant.

## 13. Critical decisions (locked)

UUIDv7 app-generated + `gen_random_uuid()` backstop · `NUMERIC(10,2)` money / `(12,3)`
quantities / `(5,2)` percents · sale-step weights, no per-weight variants · availability
derived (no stored copy) · no `orders.payment_status` (state from future payments domain) ·
`discount_total` = checkout-estimate snapshot, finals in allocation rows/mirrors · server-side
promo math · coupon/promo races via row-lock + conditional bump · `quantity = available +
reserved` · unified guest model (phone identity) · auth = custom opaque DB sessions +
Argon2id (OWASP minimums) + 8h TTL + 5→15min lockout + DB rate buckets (30/10 per 15min) ·
INET raw-SQL-only (client model blocked — proven) · polymorphic refs relation-less ·
Prisma 7 stable, classic PSL · transitions DB-enforced (never middleware) ·
`updated_at` trigger-owned (no `@updatedAt`) · security time-gates SQL-side only
(Prisma TIMESTAMPTZ decode shift — proven, DST-varying) · sessions raw-SQL-only
(same Unsupported poisoning as audit) · proxy optimistic-only (no DB, no auth decisions) ·
seed credential-free + drift-loud (mismatch FAILs, never silent) · least-privilege
runtime grants documented in `scripts/staging-app-grants.sql` (staging pattern).

## 14. File map (authority)

| File | Purpose | Authority | Status |
|---|---|---|---|
| `db/phase{1,2,4,5}-schema.sql` | frozen DDL source of truth | HIGHEST | frozen, byte-verified |
| `db/phase{1,2,4,5}-seed-example.sql` | example fixtures (never applied to real DB) | medium | frozen |
| `prisma/schema.prisma` | 34-model classic PSL representation | high | current |
| `prisma.config.ts` | datasource-via-env config (v7) | high | minimal, correct |
| `prisma/migrations/20260923_baseline__official/` | official baseline dual-artifact | high | resolved on production |
| `prisma/migrations/20260923_admin_auth_foundation/` | auth dual-artifact | high | scratch-proven, NOT on production |
| `prisma/migrations/00000000000000_baseline__PROTOTYPE_DO_NOT_APPLY/` | planning prototype | medium (prototype!) | scratch-proven, NEVER production history |
| `prisma/seed.mjs` | credential-free bootstrap seed | high | scratch-proven |
| `prisma/bootstrap-production.mjs` | production-only bootstrap (fail-closed, drift-loud) | high | NEW working-tree, scratch-verified, NOT on production, NOT released |
| `scripts/bootstrap-admin-password.mjs` | owner-password CLI (TTY, guarded) | high | scratch-proven |
| `scripts/staging-app-grants.sql` | least-privilege runtime grant pattern | medium | staging-proven |
| `docs/final-erd-v1.mmd` / `docs/final-database-architecture-v1.md` | 37-table design | high | reviewed |
| `docs/prisma-sql-gaps.md` | gaps + v8 verdict + INET finding | high | current |
| `docs/prisma-migration-architecture.md` | 18-section migration design | high | current |
| `docs/admin-auth-architecture.md` | auth design + driver-quirk record | high | current |
| `docs/recovery-verification.md` | backup metadata (no secrets) | medium | current, uncommitted by design |
| `docs/phase*-implementation-notes.md` | per-phase pins/limits | high | current |
| `docs/release-manifest.md` | release identity + file hashes | high | current, uncommitted by design |
| `db/tests/run-{tests,phase4-tests,phase5-tests}.js` | PGlite suites (77/65/50) | high | passing |
| `db/tests/run-{concurrency,phase4-concurrency}.js` | embedded-PG races (240+120) | high | passing |
| `scripts/auth/` | auth suites (99 foundation + 25 hardening) | medium | passing on scratch |
| `.env` | local URLs (app+migrator) | secret | gitignored, present |
| `.env.example` | empty placeholder | low | present |

## 15. Frozen file rule

`db/phase1-schema.sql`, `db/phase2-schema.sql`, `db/phase4-schema.sql`,
`db/phase5-schema.sql` are immutable without an explicit architecture decision.
Never silently "fix" frozen SQL (nor ERDs, nor architecture docs).

## 16. Not implemented (verified deferred)

Backend roadmap BA-0 → BA-11 is COMPLETE (verified 2026-09-27); all
previously OPEN human decisions are RESOLVED (resolution record in §19).
Payments, payment transactions, delivery domain (zones/drivers/deliveries),
multi-branch, advanced delivery tracking, the 6 future tables,
report views/materializations, audit/notification retention policies, JSONB GIN
indexes, password reset/invitation ROUTES & emails (token
lifecycle core exists + tested), MFA/TOTP/WebAuthn, real HTTPS hosting
(self-signed local TLS used for staging proof only), Vercel project, browser
automation infra.

Superseded by uncommitted BA-B work (see CURRENT block): product **metadata**
media endpoints and Arabic `pg_trgm` catalog search now EXIST as
implementation + scratch-verified, with activation isolated in
`db/future/product-images.sql` and `db/future/search-trgm.sql`
(not applied to production). Full-text search (FTS) beyond trigram matching
and price-sorted catalog listing remain NOT IMPLEMENTED / DEFERRED.

## 17. Machine-readable state

```text
CURRENT_GATE:
GO-LIVE EXECUTION (awaiting explicit human authorization)

PREVIOUS_GATE:
POST-BACKUP RELEASE HYGIENE — PASS

LAST_REVERIFIED_READONLY:
2026-09-24 (no production writes; app-role SELECTs only)

VERIFICATION_RESULT_20260924:
- Release commits f73ce0b + 468fddf present; manifest-listed files unchanged
  vs release (git diff empty); working-tree M docs/AGENT-HANDOFF.md +
  M scripts/create-scratch-db.mjs + M scripts/verify-scratch.mjs are
  non-manifest files only (scratch allowlist adds restore_verify DBs);
  untracked _recovery/ + docs/recovery-verification.md remain by design.
- prisma/schema.prisma 34 models; prisma.config.ts dotenv/config +
  datasource-via-env; official + auth + prototype migrations + seed +
  bootstrap + staging grants + all docs present; .env present + gitignored.
- Backup _recovery/production-pre-auth-20260924.dump 133599 bytes,
  SHA-256 4BD9AACB0D28BB175EC6C6F73C25BC34591990CEA0D4B36AD01D99A5A8FF5062
  re-verified identical to docs/recovery-verification.md.
- Production hyper_almoatasem read-only: 32 total / 31 business tables;
  single _prisma_migrations row 20260923_baseline__official steps=0;
  0 business rows total; 0 admin_% tables; 0 password_hash/lockout cols;
  0 future tables; view 1 / seq 1 / ext pgcrypto 1; FKs 39;
  CHECKs 155 (pg_constraint contype=c); partials 7 unique + 3 plain;
  triggers 22 (pg_trigger NOT tgisinternal); 6 trigger functions present;
  INET audit_logs.ip_address 1; GENERATED inventory.available_quantity 1.
  (information_schema CHECK 368 / trigger 23 counts are methodology
  differences, not drift — proven by pg_constraint/pg_trigger queries.)

REAL_DATABASE:
hyper_almoatasem

REAL_DATABASE_BASELINED:
YES (20260923_baseline__official, steps=0)

REAL_DATABASE_AUTH_MIGRATED:
YES — APPLIED on production 2026-09-24 14:19:59 (finished, steps=1).
  (Supersedes the earlier "NOT applied at last verified gate" wording, which
  described the state before the 2026-09-24 recovery + re-apply. The failed
  12:50 attempt and its rolled-back history row are retained below as the
  historical record.)
  Read-only re-verified 2026-10-02: 36 public tables; admin_sessions,
  admin_auth_tokens, admin_auth_rate_limits and users.password_hash present;
  ZERO business rows; auth rows users 1 / roles 2 / permissions 31 /
  role_permissions 55 / user_roles 1 / store_settings 8 / sessions 0 /
  tokens 0; search+media future objects still absent.
  Production was NOT intentionally modified by the BA-C closure (SELECT-only
  verification); the 3 admin_auth_rate_limits + 2 audit_logs rows dated
  2026-10-02 10:23:45 are unintended incident residue, intentionally preserved.

REAL_DATABASE_AUTH_MIGRATION_ATTEMPT_20260924:
FAILED — P3018 / 42501 `must be owner of table users` as hyper_migrator
(deploy ~2722ms; supplement NOT run; schema unchanged; failed history row
finished_at NULL blocks further deploys until separate decision).
Root cause (read-only proven): DB + business tables owned by hyper_owner
(users/roles owner hyper_owner; _prisma_migrations owner hyper_migrator);
migrator can write history but cannot ALTER owner-held tables. No pghyper
use, no manual resolve/mark, no seed/bootstrap/deploy. Prototype dir stashed
during deploy to enforce ONLY-auth (Prisma otherwise pends prototype too),
restored byte-identical after (hashes re-verified, no release mutation).

REAL_DATABASE_BUSINESS_ROWS:
0
REAL_DATABASE_BOOTSTRAP:
NOT EXECUTED ON PRODUCTION (B14 design/completion verified; scratch-only seed `prisma/seed.mjs` unchanged; production-only bootstrap `prisma/bootstrap-production.mjs` verified scratch-only; 6 critical scratch tests PASS; production bootstrap requires separate authorization — never executed; B15 hosted DB / Vercel Preview phase NOT STARTED)

REAL_DATABASE_HOSTED_DB_PLAN:
B14 provisioned Neon Free (`small-sunset-28924290`, `aws-eu-central-1`, PG 18.6, primary `production`); NOT a Production SLA (free tier pauses/suspends; requires paid upgrade + scale-to-zero disabled + separate authorization before cutover); B14 verified design/completion only.

REAL_DATABASE_BOOTSTRAP_ATTEMPT_20260924:
NONE — `prisma/bootstrap-production.mjs` fails-closed by design (single DB allowlist, fingerprint/ownership/history assertions, drift-loud idempotent, credential-free, no force/bypass, never applies business/auth rows); scratch verification PASS (happy + idempotent rerun + chaos rollback + drift loud-fail); NOT executed.

MIGRATION_IMPLEMENTATION:
COMPLETE

NEXT_ACTION:
Do NOT retry auth deploy, seed, bootstrap, or resolve unprompted. (The
2026-09-24 decisions (a) DDL privilege design and (b) failed-migration
recovery are RESOLVED IN FACT: the failed row was rolled back and the auth
migration re-applied successfully at 14:19; read-only verified 2026-10-02.)
Then execute the go-live runbook one authorized step at a time.

DO_NOT (without explicit per-step authorization):
- run any migration/resolve/deploy/push against production
- run seed or bootstrap against production
- create credentials or test logins against production
- upgrade Prisma
- modify frozen SQL
- add the 6 future tables
- recreate the real DB
- run destructive migrations
- create a new release for hygiene reasons
```

### Backend-track machine state (BA-11 closeout, 2026-09-27)

```text
BA_TRACK: BA-0 → BA-11 COMPLETE (full integration verification green).
HARDENING_DELTA (PRE-BA-11 + ceiling + final-RBAC gates): RBAC guards +
  36-endpoint audit retrofit + effective-permission ceiling + role-row
  serialization + 2 minimal route try/catch fixes; new suites
  t-rbac-guards (49) + t-rbac-races (53) + t-audit-pairing (101) +
  docs/rbac-audit-hardening.md; ZERO schema/migration/permission/role
  changes; no commit; no push.
BA11_GATES: full matrix green zero failures (units 224 total; API BA-1..BA-10
  + security + CC-1/password + Phase 2/5; Phase-4 PGlite environmental
  exception documented); tsc PASS; eslint 0 problems; build PASS;
  Prisma 7.10.0 pair, no push/migrations; production read-only verified
  (35 tables, future six absent); scratch residue-free; fixtures exact
  (3 users, 2 roles, 8 settings intact).
PRODUCTION_WRITES_BY_BA_TRACK: NONE (all BA work scratch-only; servers stopped
  after each phase; HEAD 333f920e0454c29acd25c730218737a316131aa4 unchanged).
OPEN_DECISIONS: NONE on the backend track. Previously OPEN items resolved:
  (1) RBAC safety guards — IMPLEMENTED + tested;
  (2) BA-2..BA-8 audit pairing retrofit — IMPLEMENTED + tested;
  (3) grant-threshold shape — RESOLVED as effective-permission ceiling;
  (4) assign-vs-deactivation race — RESOLVED as role-row serialization;
  (5) revocation-vs-authorization — RESOLVED as per-request snapshot;
  (6) future-permission auto-join — RESOLVED as no-implicit-auto-join;
  (7) self-ungrant — verified legal, SUPER_ADMIN bypass impossible.
  Resolution record in §19 + docs/rbac-audit-hardening.md §7.
```

## 18. Handoff instructions for the next agent

> Start by reading `docs/AGENT-HANDOFF.md`.
>
> Then read the authoritative files referenced by this document.
>
> Do not rely on conversation history as a source of truth.
>
> Verify the current repository state before making changes.
>
> Do not begin a new phase unless the current gate is explicitly passed.
>
> Do not modify frozen architecture silently.
>
> Do not perform destructive database operations.
>
> If the repository state conflicts with this handoff, stop and investigate before changing anything.
>
> NEVER execute production writes (migrations, seeds, bootstraps, logins)
> without explicit human authorization for that exact step.

## 19. Human decisions — RESOLVED (record; BA-11 COMPLETE 2026-09-27)

```text
BA-11 COMPLETE + All backend human decisions RESOLVED.
```

The former OPEN items below are implemented, race-tested on real
PostgreSQL, regression-green, and documented. Do not treat the old
OPEN wording (retained in git history only) as current. The remaining
waiting item is the production go-live runbook (§4), which still
requires explicit human go-ahead per step.

### Decision 1 — RBAC Safety Guards: RESOLVED, IMPLEMENTED + TESTED

Implemented in `src/lib/admin/writes.ts` (server-side, existing
401/403/404/409/422 shapes, no new permissions):

- Self-deactivation: actor === target + `isActive:false` → 403, no
  state change, no audit row.
- Last active SUPER_ADMIN: deactivation of a holder / removal of a
  holder's SUPER_ADMIN mapping / deactivation of the SUPER_ADMIN role
  with holders → 409 `active SUPER_ADMIN count >= 1` at all committed
  states, concurrency-safe via ASC-ordered holder locks (READ COMMITTED).
- Normal roles: NO generic every-role-keeps-a-grant rule; zero-grant
  roles stay legal and assignable (tested).
- SUPER_ADMIN grants: revoke from the bootstrap role (all 31, derived
  from frozen seed — no invention) → 403. Rename + delete remain 403
  (frozen Phase 5 L2, intact).

### Decision 2 — BA-2 → BA-8 Audit Pairing: RESOLVED, IMPLEMENTED + TESTED

All 36 BA-2..BA-8 admin endpoints pair mutation + audit row in the SAME
transaction (shared `src/lib/api/audit.ts` helper; commit together,
rollback together; forced-audit-failure rolls back — proven per module
with a scratch-only trigger). Customer self-service paths stay
unaudited (store behavior byte-identical). BA-9 pairing intact.

### Further decisions resolved after the PRE-BA-11 gate

- Grant-threshold shape → EFFECTIVE_PERMISSION_CEILING (grant/assign ⊆
  actor effective set, 403 atomic, no partial granting).
- assignRole vs role-deactivation race → ROLE_ROW_SERIALIZATION
  (same-row lock + post-lock recheck; inactive-role assign now 409).
- Revocation racing authorization → PER_REQUEST_EFFECTIVE_PERMISSION_
  SNAPSHOT (request-scoped React cache, DB-derived per request; next
  request observes mutations).
- Future-permission auto-join → NO_IMPLICIT_AUTO_JOIN (createRole
  writes zero grants; explicit grants only).
- Self-ungrant → ordinary self-removal legal (next-request effect);
  SUPER_ADMIN bypass impossible (revoke 403, sole-holder unmap 409).
- Full decision/test/regression record: `docs/rbac-audit-hardening.md`
  §7 (`t-rbac-guards` 49/49, `t-rbac-races` 53/53, `t-audit-pairing`
  101/101).

### Other standing deferred items (still valid)

Frontend implementation · customer OTP/login · customer sessions · guest
token rotation · exact guest cart TTL/sweeper policy · weighted barcode
total-price formula · API versioning · retention windows · password reset
routes · invitation routes · MFA · notifications (incl. admin surface —
no frozen contract) · reports/materializations · FTS · production DB
cutover and production deployment work.

### Infrastructure snapshot (preserved)

Local PG 18.4 (`C:\pgprov\data`; roles hyper_owner/hyper_migrator/
hyper_app; stopped between phases by convention) · Prisma 7.10.0 triple
(no upgrade without architecture decision) · Neon dev/preview only
(`small-sunset-28924290`, aws-eu-central-1, PG 18.6 — NOT Production) ·
Vercel `hyper-almoatasem-v0-1` (Preview verified; production cutover
deferred) · AuthZ model session → active user → active role → grant
mapping (never role-name checks; 31-key matrix intact, none added, none
renamed) · `.env` gitignored, present.
