# BA-10 Integration / Concurrency / Idempotency — verification record

> Verification + hardening phase only. No features, no schema/migration/
> permission/role changes, no audit retrofit (HD-1), no BA-11. All races
> run on real PostgreSQL (READ COMMITTED + row locks + ASC ordering —
> never SERIALIZABLE, mutexes, or mocks). Scratch-only; production
> untouched.

## 1. Human decisions applied (binding)

- HD-1: BA-2..BA-8 admin writes NOT retrofitted with audit pairing.
  BA-9 mutation+audit atomicity tested as implemented.
- HD-2/HD-3: no new permissions, roles, tables, columns, indexes,
  constraints, triggers, migrations. Verified by tree scan + test runs.
- HD-4: no new idempotency keys. Surfaces classified only:
  orders = explicit key; cart = partial-UQ + status convergence;
  coupons = usage UQ + conditional bumps; replacements = partial UQ +
  PROPOSED gate; admin users/grants = pair UQs (409s); settings = LWW
  key model; audit = read-only.
- HD-5: no transaction wrapper/retries/SERIALIZABLE/mutexes (static
  search clean — only prohibition comments mention them).
- HD-6: scratch only, residue verified zero, fixtures exact.

## 2. New suites (all real PG)

| Suite | Covers | Result |
|---|---|---|
| `t-xmodule.mjs` | X1 price→cart snapshot + drift; X2 no-side-effects; X3 adjust-vs-checkout; X4 approve-vs-reserve (both arrival orders); X7 approve+checkout+cancel trio with hold conservation; X8 RBAC deactivation mid-session (401/403, per-request) | 17/17 |
| `t-atomicity.mjs` | A1 coupon+promo+stock-short rollback (orders/usages/discounts/counters/holds/movements/cart all clean); A2 approve-short rollback (proposal/line/holds intact); A3 duplicate grant (409 + no audit row); A4 invalid setting (422 + no audit + value kept); A5 mutation+audit pair commit | 18/18 |
| `t-idempotency-matrix.mjs` | Coupon order replay identical (rows/counters/usages frozen); same-key-diff-cart 409 + nothing new; cart convergence | 9/9 |
| `t-deadlock.mjs` | D1 opposed 2-line checkouts ×5 (all 201, fast); D2 order-vs-approval shared unit ×5 (single winner, coherent) | 2/2 |

Non-drivable micro-steps (post-release failures with all CHECKs satisfied
by construction) are code-reviewed, not test-driven — stated, not claimed.

## 3. Cross-module matrix (outcome)

- Catalog↔Cart/Orders: snapshots frozen at write; drift rejects 409 with
  cart ACTIVE, zero order/reservation residue.
- Inventory↔Orders: adjust-vs-checkout single winner; predicates hold
  (`reserved ≤ quantity`, never negative).
- Inventory↔Replacements: approve-vs-reserve single winner, exactly 1.000
  held either arrival order.
- Orders↔Coupons/Promotions: BA-8 R1/R3 re-verified (single usage, SKIP).
- Orders↔Replacements↔Inventory: trio settles coherently under every
  interleaving; holds conserved; no double release/reservation.
- Admin RBAC: deactivation (user or role) takes effect on the next
  request (401/403), never 500.

## 4. Deadlocks

Opposed lock orders across carts, orders, approvals, and coupon rows
complete without deadlock errors (40P01/deadlock-word absence asserted);
deterministic ASC ordering everywhere frozen-required. No new global
locking strategy introduced; none needed.

## 5. BA-9 audit atomicity

Committed mutations always pair their audit row; failed mutations
(duplicate grant, mistyped setting) leave neither state nor audit
changes. BA-2..BA-8 explicitly NOT retrofitted per HD-1.

## 6. Session findings (honest)

- Two suite-authoring header bugs found by the suites themselves (guest
  token as `cookie`; cookie string vs object) — fixed in test code only;
  product code never at fault.
- One stale-hold contamination from an early crashed debug run was
  caught by exact-value asserts, reset directly on scratch, and both
  affected suites re-verified leak-free twice.
- One `t-customers-concurrency` single assert failed under rate-window
  pressure, then passed clean twice — environmental, not a regression.
- Full-suite bursts exhaust the frozen login buckets (IP 30 / account 10
  per 15 min, fail-closed generic 401 by design); runs were scheduled
  across rollovers. Pre-existing suites crash (rather than exit) on
  auth failure — left as-is (strictness, not BA-10 scope).
- One Phase-2 run hit the harness's own random-ID collision
  (pre-existing flake) — re-run green.
- Skipped with reason: 120-race embedded-PG gate (admin-blocked OS user;
  frozen SQL byte-identical) and CC-1 TZ rerun (auth untouched).

## 7. Files

- New: `scripts/api/{t-xmodule,t-atomicity,t-idempotency-matrix,t-deadlock}.mjs`;
  this doc.
- Modified: none in `src/` (zero product-code changes in BA-10).
- Untouched/protected: everything else, incl. `docs/AGENT-HANDOFF.md`,
  `docs/release-manifest.md`, all frontend.

## 8. Deferred to BA-11+

Anything requiring new contracts: cross-domain exhaustive matrices
beyond this scope, notification flows, finalize mechanics, and the
reported open items (last-grant/self-edit guards, BA-2..BA-8 audit
pairing decision).

---

# BA-11 — Full Backend Integration Verification (2026-09-27)

> Verification-only gate over BA-0..BA-10 + resolved RBAC decisions
> (effective-permission ceiling, role-row serialization, per-request
> snapshot, no-implicit-auto-join, ordinary self-ungrant legal).
> No features, no schema/migration/permission/role changes, no Frontend.
> Real PostgreSQL scratch; production read-only verified, never written.

## BA-11.1 Route inventory (76 files)

Store 22 files / 26 handlers: catalog 9 GET + inventory 2 GET (public
reads); `identify` POST (public by frozen no-OTP design);
cart 7 (guest-bearer XOR customerId); orders 7 (estimate public
preview; detail/cancel/replacements/decide customer-ownership scoped).
Admin 54 files: every handler carries `denyUnless`/`checkPermission`/
`adminOrDeny` + exact permission string (81 permission-protected; session
GET/DELETE authenticated-admin; session POST public login). Totals:
public 14 · customer 13 · authenticated-admin 2 · permission-protected 81.
No sensitive endpoint relies on frontend hiding. Known frozen-scope
observations (reported, not changed): UUID-as-bearer customer routes,
`customers.view`-gated admin customer writes (no `customers.manage`
split), public identify as customer-UUID oracle (no OTP in scope).

## BA-11.2 End-to-end flows (all green on real PG)

A catalog→cart→order (snapshots/totals/reservation/checkout),
B weighted steps (valid/invalid), C promo+coupon exact-integer checkout
(limits, allocation, usages), D BXGY (paid/free lines, reservations),
E replacement (approve/reject, transfer, READY, no double release/
reserve, picked-line protection), F cancel (allowed states release +
audit; forbidden states 409), G identity (ladder, concurrent
same-phone convergence, upgrade, email UQ, address ownership/defaults) —
covered by t-orders/t-cart/t-customers/t-replacements/t-promotions/
t-inventory/t-atomicity/t-audit-pairing/t-xmodule/t-idempotency-matrix,
all passing (see BA-11.5).

## BA-11.3 Security re-verified

CC-1 8/8 · password 9/9 · session/inactive-user/role behavior ·
effective grants · SUPER_ADMIN protections · ceiling · serialization ·
revoke races (t-rbac-guards 49/49, t-rbac-races 53/53). Error matrix:
400/401/403/404/409/422/429/500 via one `statusForCode` map, asserted
across suites. No-leak: allowlist serializers (no hash/session/token
fields), generic 500s, `noSecrets` asserts on admin/public/store bodies,
sanitized audit payloads.

## BA-11.4 Invariants holding

`quantity = available + reserved` (no negative/oversell/loss) ·
one-winner idempotency (replay identical, diff-terms 409, concurrent
single execution) · mutation+audit atomicity (success pairs, failure
rolls back, forced-audit-failure rolls back) · append-only audit ·
ownership XOR · lock-order acyclic (inventory/cart/orders/replacement/
coupon ASC; RBAC holder-ASC + single roles-row; deadlock suite 2/2, R8
mixed contention zero 500s).

## BA-11.5 Full regression (real PG unless noted)

Units: foundation 26, admin 22, cart 28, customers 40, inventory 34,
orders 16, promotions 34, replacements 24 (all PASS, no DB). API:
catalog 53 · inventory 84+18 · customers 66+8 · cart 50+13 · orders
54+15 · replacements 54+12 · promotions 58+13 · admin 80+8 ·
xmodule 17 · atomicity 18 · idempotency 9 · deadlock 2 · rbac-guards 49 ·
rbac-races 53 · audit-pairing 101 · CC-1 8 (all PASS). Frozen PGlite:
Phase 2 77/77 · Phase 5 50/50 · Phase 4 environmental exception
(PGlite 0.4.3 `rowCount: undefined`; real-PG promo coverage green;
harness untouched). `tsc` PASS · `eslint` 0 problems · `npm run build`
PASS. Prisma CLI + client 7.10.0, no push/migration/architecture change.

## BA-11.6 Database contract (production read-only)

35 tables (31 + 3 auth + migrations history); future six absent; 1 view
(`product_stock_status`); 1 sequence (`order_number_seq`); zero business
rows in products; owner identity intact; migration history = baseline
finished + auth-foundation unfinished (recorded failed-deploy state,
untouched). `db/` + `prisma/` zero diff; no migrations added.

## BA-11.7 Honest findings

- Rate buckets (IP 30 / account 10 per 15 min, fail-closed 401) forced
  window-spaced batches; one mid-gate batch legitimately re-ran clean.
- One D2 setup incident: a rate-blown run skipped solo-restore and left
  the scratch owner roleless; detected by exact-state asserts, repaired
  with one conditional fixture re-insert, suite hardened (skip-isolation
  + DB-verified restore), re-verified 53/53. Production never involved.
- One R7 design correction during verification: 3-holder cross-race may
  legitimately yield 200/200 (guard correct — owner survives); test
  isolated to two holders for the deterministic 200/409 proof.
- One route bug fixed (minimal, tied to verification): role-mapping
  DELETE lacked try/catch so the 409 guard escaped as 500 — same class
  as the earlier grants-route fix; full matrix re-greened after.

---

# BA-B — Catalog + Search + Product Media (verification record)

> No frozen-schema change. New DB objects live in `db/future/`
> (scratch-verified, never production-applied, never in
> `prisma/migrations`). No frontend. Full matrix green (below).

## BA-B.1 Pagination (corrected + proven)

Catalog lists used `id > cursor` under name/created_at sorts (wrong rows
— proven by counterexample). Replaced with exact keyset over
(sort-field, id): opaque base64url cursors, direction-matched tiebreaks,
malformed → 400 (`src/lib/api/pagination.ts`; catalog migrated; other
modules audited — all id-anchored, correct as-is). Suite
`t-bab-catalog.mjs`: duplicate-name walks (asc+desc), invalid cursors,
mid-walk deactivation — zero duplicates, full coverage.

## BA-B.2 Filters

Price window (single-variant `some`, inverted → 400), `inStock`
tri-state (both directions real), category subtree (recursive CTE),
existing search/category/brand/type. Promotion filter UNSUPPORTED;
price sort deferred via documented OPEN_DECISION (no product-level price
in schema; sellable-min-price recommended basis).

## BA-B.3 Search

Engine: pg_trgm + `hyper_norm_ar()` + functional GIN indexes; FTS
rejected (no Arabic stemmer). Normalization folds + strips per-token ال
(chr()-spelled, RTL-proof; two live bugs caught this way: digit-eating
alignment + U+0668/U+0670 mixup). Tiers: exact-code pin (4) > exact (3)
> prefix (2) > similarity ≥ 0.2 (1) > brand/category (0); keyset pages
on (tier, sim, id). 20k-row evidence: Bitmap Index Scan proven by
EXPLAIN; API latencies recorded in-suite. LIKE wildcards escaped;
dangling-bind 42P18 found + fixed (per-branch param ownership).

## BA-B.4 Media

`product_images` (product-level gallery metadata only; mime allowlist
excl. SVG; paired dims; partial-UQ single primary). Raw-SQL CRUD (no
Prisma model change); admin register/update/delete audited; public
gallery with deterministic fallback. Primary switch: pre-lock +
clear-then-set (single-statement flips race to deterministic 500 —
reproduced, fixed, 6/6 clean rounds). No provider, no binary upload.
Endpoints fail LOUD without migration objects (deployment prerequisite).

## BA-B.5 Regression

`t-bab-catalog` 46/46 · `t-ba-a-contract` 45/45 (incl. OpenAPI coverage
of search/media/health) · full BA-0..BA-11 matrix re-green (catalog 53
through races 53, CC-1 8, Phase 2/5 77/50, Phase-4 65/65 post-harness
fix) · `tsc`/`eslint`/`build` PASS. Scale seed
(`scripts/api/seed-bab-scale.mjs`, deterministic 20k) inserted,
benchmarked, then `--clean` removed; residue zero verified. One
transient: single latency-bound failure on cold start, green on all
subsequent runs (reported, not hidden). Pre-existing 09-26 residue
(BA11A products, idempotency customer) found + removed.
