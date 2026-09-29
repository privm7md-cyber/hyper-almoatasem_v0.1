# RBAC + Audit Hardening (PRE-BA-11)

Targeted architecture-hardening phase implementing the two human-authorized
decisions. No BA-11, no Frontend, no unrelated features. No schema,
migration, permission, or role changes. No production writes.

## 1. Approved human decisions (implemented)

- **Decision #1 — RBAC safety guards**: self-deactivation guard, last-active-
  SUPER_ADMIN guard (concurrency-safe), SUPER_ADMIN grant protection derived
  from frozen bootstrap sources without invention.
- **Decision #2 — audit pairing retrofit**: every BA-2 → BA-8 admin mutation
  pairs its audit row in the SAME database transaction (commit together,
  rollback together). No post-commit writes, no background jobs, no
  eventual consistency.

## 2. RBAC guards (exact)

All in `src/lib/admin/writes.ts`, layered on top of existing authorization
(`checkPermission` first; no new permissions; existing 401/403/404/409/422
shapes via `fail()`).

### 2.1 Self-deactivation — 403

`patchUser`: `isActive === false` with target id equal to the authenticated
actor id throws `FORBIDDEN ("Administrators cannot deactivate their own
account.")` before any transaction opens — no state change, no audit row.
Closest existing semantics: the frozen SUPER_ADMIN rename/delete 403s.

### 2.2 Last active SUPER_ADMIN — 409, concurrency-safe

Invariant at all committed states: `active SUPER_ADMIN count >= 1`, where
active = user `is_active` AND `deleted_at IS NULL` AND role `is_active` AND
`deleted_at IS NULL` AND mapping row exists (frozen effective-grant rule).

Guarded operations (each rejects with `CONFLICT ("Operation would leave no
active SUPER_ADMIN.")` when the target is a holder and no other holder
survives):

- `patchUser` deactivation (`isActive === false`).
- `removeRole` when the mapping targets the SUPER_ADMIN role and the user
  is active (inactive users and non-SUPER_ADMIN mappings unaffected).
- `patchRole` deactivation of the SUPER_ADMIN role while any active holder
  exists (locked role row + holder count in-tx).

Concurrency model (READ COMMITTED, smallest change): one statement locks
every active holder (`users` + `user_roles` rows) in ASC user-id order
before the check — `lockActiveSuperAdminHolders`. Concurrent guarded
operations serialize on the same rows in the same order (no cycle, no
deadlock); the loser re-evaluates after the winner commits and receives
409. No SERIALIZABLE, no app mutex, no global/distributed lock, no retry
loop. The holder query joins `roles` but locks only `u, ur` (disjoint from
the role-row lock), so guard paths cannot deadlock each other.

### 2.3 SUPER_ADMIN grant protection — 403

Bootstrap source (`db/phase5-seed-example.sql` + `prisma/seed.mjs`): the
SUPER_ADMIN role (`02800000-0000-7000-8000-000000000001`) is granted every
row of `permissions` explicitly (all 31, no bypass flag). Every one of its
grants is therefore a required administrative grant — derived, not
invented. `removeGrant` rejects revocation from the SUPER_ADMIN role
(by name, matching the frozen rename/delete guards) with `FORBIDDEN
("The SUPER_ADMIN role grants cannot be revoked.")` before any write —
no state change, no audit row. Normal roles are unaffected and keep
zero-grant reachability (verified G6). No generic every-role-keeps-a-grant
rule was created, per the authorization.

One route fix: `DELETE .../grants/[permissionId]` had no try/catch, so the
403 `ApiError` escaped as 500; it now uses the standard `fail()` mapping
(identical to every other write route; 404/200 paths unchanged).

### 2.4 Deliberately NOT invented (threshold/scope)

Frozen sources fix the protected *set* (all 31) but not a *threshold*
shape (deny-any vs deny-last). Deny-any-removal was chosen as the minimal
rule that guarantees administrability under all interleavings and matches
the existing total-row-protection precedent. Future-permission auto-join,
role-deactivation-besides-holders, and self-ungrant rules remain unlegislated.

### 2.5 Grant threshold — RESOLVED as EFFECTIVE_PERMISSION_CEILING

```text
GRANT_THRESHOLD:
EFFECTIVE_PERMISSION_CEILING

RULE:
target permissions must be a subset of actor effective permissions;
any out-of-ceiling permission rejects the whole operation with 403.
```

Human-authorized privilege-escalation prevention, implemented in
`src/lib/admin/writes.ts` (`assignGrant`, `assignRole`) with zero new
authorization machinery: both routes already hold the actor's current
effective key set (`auth.admin.permissions`, computed once per request by
the frozen `getCurrentAdmin` — active user ∧ active role ∧ mapping ∧
active permission), which is passed into the writers.

- **Grants** (`POST .../roles/[id]/grants`): the granted permission's key
  must be an element of the actor's effective set, else 403 before any
  tx (no mutation, no audit, no partial granting — single-permission
  endpoint, so any miss rejects the whole operation).
- **Assignment** (`POST .../users/[id]/roles`): the target role's
  effective set — active role's grants of active permissions (inactive
  roles grant nothing: empty set) — must satisfy
  `targetRoleEffective ⊆ actorEffective`, else 403 pre-tx (no mapping,
  no audit). `users.manage` alone never suffices for an arbitrarily
  privileged role.
- **SUPER_ADMIN unchanged**: full-set actors (owner) pass every ceiling
  check; last-holder/self/revoke guards intact; no second hierarchy.
- **Zero-grant roles unchanged**: empty set ⊆ anything — still assignable
  (verified).
- Check-then-act is request-scoped (READ COMMITTED), same class as all
  existing authorization. The residual below is now formally resolved as
  per-request snapshot semantics — see §7.2 (no lock upgrade, which would
  duplicate the frozen model; no version columns, which frozen
  architecture forbids).

Tests: `t-rbac-guards` §C (16 asserts) — held-grant 201, missing-grant
403 ×2 perms (zero mutation/audit), concurrent double-miss 403/403,
zero-role assign 201, outside-role assign 403 (zero mapping/audit),
subset-role assign 201, owner-assign-rich 201. Suite total 49/49.

## 3. Audit pairing scope (matrix)

Shared helper `src/lib/api/audit.ts` (`auditInTx` — byte-identical SQL to
the BA-9 helper, which now imports it; no second system). Actor is always
the server-side authenticated admin id (`ADMIN` actor; `user_id` NOT NULL).
Customer self-service writes (store cart/orders/decide/cancel, customer
approve) stay unaudited — not admin mutations — so store behavior is
byte-identical. BA-9 surfaces already paired (unchanged). BA-1 auth audit
untouched.

| Module | Endpoint | Mutation | Audit action / entity | Tx boundary |
|---|---|---|---|---|
| Catalog | POST/PATCH brands | INSERT/UPDATE brands | brands.create/update / brands | new tx wraps write + audit |
| Catalog | POST/PATCH categories | INSERT/UPDATE categories | categories.create/update / categories | new tx wraps write + audit |
| Catalog | POST/PATCH products | INSERT/UPDATE products | products.create/update / products | new tx wraps write + audit |
| Catalog | POST/PATCH variants | INSERT/UPDATE variants | variants.create/update / product_variants | new tx wraps write + audit |
| Catalog | PATCH variants price | UPDATE variant + INSERT price history | variants.price / product_variants | existing tx + audit INSERT |
| Catalog | POST/PATCH/DELETE codes | INSERT/UPDATE/DELETE codes (+primary switch) | codes.create/update/delete / product_codes | new/existing tx (switch moved in-tx) + audit |
| Inventory | POST adjust | UPDATE qty + INSERT movement | inventory.adjust / inventory | existing tx + audit INSERT |
| Inventory | POST reserve/release | reserved bump (no movement, §J) | inventory.reserve/release / inventory | existing tx + audit (entity id via RETURNING; 409/404 paths untouched) |
| Inventory | POST commit | UPDATE qty/reserved + SALE movement | inventory.commit / inventory | existing tx + audit INSERT |
| Inventory | PATCH threshold | UPDATE low_stock_threshold | inventory.threshold / inventory | new tx wraps write + audit |
| Customers | PATCH customer | UPDATE customers | customers.update / customers | new tx wraps write + audit |
| Customers | POST register | guard UPDATE (hash never audited) | customers.register / customers | tx now wraps guard UPDATE + audit |
| Customers | POST/PATCH/DELETE addresses | INSERT/UPDATE/DELETE address (+default switch) | addresses.create/update/delete / customer_addresses | existing/new tx + audit |
| Orders | POST admin cancel | release holds + counters + history + status | orders.cancel / orders | existing tx + audit (STAFF only) |
| Replacements | POST propose | INSERT proposal (+UNAVAILABLE flip) | replacements.propose / order_item_replacements | existing tx + audit (STAFF only) |
| Replacements | POST withdraw | PROPOSED→CUSTOMER_REJECTED | replacements.withdraw / order_item_replacements | existing tx + audit (STAFF only) |
| Replacements | POST auto-accept | R10 materialization | replacements.auto_accept / order_item_replacements | existing tx + audit (after approveSteps, single INSERT) |
| Promotions | POST/PATCH/DELETE | INSERT/UPDATE/DELETE promotions | promotions.create/update/delete / promotions | new tx wraps write + audit |
| Promotions | PUT rules / buy-get | upsert singleton rows | rules.update / promotion_rules; buyget.update / promotion_buy_get_rules | new tx wraps upsert + audit |
| Promotions | POST/DELETE targets | INSERT/DELETE target | targets.create/delete / promotion_targets | new tx wraps write + audit |
| Coupons | POST/PATCH/DELETE | INSERT/UPDATE/DELETE coupons | coupons.create/update/delete / coupons | new tx wraps write + audit |

Action naming follows the frozen `<entity>.<verb>` convention
(`chk_audit_action`); entities are table-scoped strings ≤ 40 chars;
payloads are sanitized business-metadata allowlists (names, slugs, prices,
quantities, status transitions, `{credential:"set"}`-style facts — never
hashes, tokens, secrets, credentials, or full bodies). Write routes that
used `denyUnless` now use `adminOrDeny` (identical 401/403, plus actor);
`promotions/[id]` and `coupons/[id]` PATCH gates now also yield the actor
(empty-body PATCH falls back to the request-cached admin; auth semantics
otherwise unchanged).

Preserved exactly: R3/R7 predicates, ASC lock order, reserveBatch
(service-only, unaudited), BA-8 counters/rollback/pricing, R10 steps and
single-winner semantics, idempotency replay, order numbering, coupon
window gates, A21 referenced-immutability, RESTRICT behavior.

## 4. Tests

- `scripts/api/t-rbac-guards.mjs` — G1..G6 (33 asserts) + ceiling §C
  (16 asserts), total **49/49**: self 403, final single 409 (foreign
  actor), two-holder transition 200 + audit, concurrent cross-deactivation
  race (exactly one 200 + one 409, never zero, single audit), grant revoke
  403 (+ concurrent double 403, grants intact), normal-role zero-grant 200,
  ceiling grant/assign matrix above.
- `scripts/api/t-audit-pairing.mjs` — per-module A/B/C plus concurrency
  (mutation race, mutation+read, reserve conflict with winner-only audit,
  RBAC-mutation race): success pairs, business-failure residue-free,
  forced-audit-failure via a scratch-only BEFORE INSERT trigger (created
  and dropped inside the harness; absence re-verified) rolling back all
  seven modules' mutations with 500 + zero residue.
- Customer-path cleanliness verified: store cancel and customer approve
  paths commit with zero admin-audit rows (byte-identical store behavior).

## 5. Regression results

Real PostgreSQL (`hyper_almoatasem_scratch`), final build, sequential with
rate-bucket spacing (frozen IP 30 / account 10 per 15 min — bursts across
suites exhaust buckets with fail-closed 401s, so a mid-run batch was
re-run clean in a fresh window; no failure was hidden behind scheduling).

- New `t-rbac-guards`: **33/33**.
- New `t-audit-pairing`: **101/101**.
- BA-1 `t-foundation`: 26/26. BA-2 `t-catalog`: 53/53.
- BA-3 `t-inventory-unit` 34 + `t-inventory` 84 + `t-inventory-concurrency` 18.
- BA-4 `t-customers-unit` 40 + `t-customers` 66 + `t-customers-concurrency` 8.
- BA-5 `t-cart-unit` 28 + `t-cart` 50 + `t-cart-concurrency` 13.
- BA-6 `t-orders-unit` 16 + `t-orders` 54 + `t-orders-concurrency` 15.
- BA-7 `t-replacements-unit` 24 + `t-replacements` 54 + `t-replacements-concurrency` 12.
- BA-8 `t-promotions-unit` 34 + `t-promotions` 58 + `t-promotions-concurrency` 13.
- BA-9 `t-admin-unit` 22 + `t-admin` 80 + `t-admin-concurrency` 8.
- BA-10 `t-xmodule` 17 + `t-atomicity` 18 + `t-idempotency-matrix` 9 + `t-deadlock` 2.
- CC-1 `t-cc1-lockout`: 8/8. Password `t-password`: 9/9.
- Phase 2 PGlite: 77/77. Phase 5 PGlite: 50/50.
- Phase 4 PGlite: NOT GREEN (environmental — see §6). The same coupon /
  concurrency behavior is covered on real PG by `t-promotions` (58),
  `t-promotions-concurrency` (13), `t-atomicity` A1 and
  `t-idempotency-matrix` — all green above.
- `tsc --noEmit` PASS. `eslint src` 0 problems. `npm run build` PASS.
- Scratch residue: zero test users/roles/customers/carts/orders/items/
  replacements/usages/movements; zero non-fixture-actor audit rows;
  fixtures exact (inventory 500/300/0, 3 users, 2 roles, 8 settings);
  no temp trigger/function; zero sessions. No production writes.

### 5.1 Ceiling-phase security re-verification (same build lineage)

After the ceiling change (only `assignGrant`/`assignRole` + 2 route
call-sites; domain code untouched): `t-rbac-guards` 49/49,
`t-audit-pairing` 101/101, `t-admin` 80/80, `t-admin-unit` 22/22,
`t-admin-concurrency` 8/8, `t-atomicity` 18/18, `t-foundation` 26/26,
`t-idempotency-matrix` 9/9, `t-xmodule` 17/17, `t-cc1-lockout` 8/8,
`tsc` PASS, `eslint` 0 problems, `build` PASS. Scratch verified clean
again (same zero-residue bar). Rate-bucket spacing applied between
batches; no failure hidden behind scheduling.

### 5.2 Final-gate re-verification (role-row serialization + route fix)

After Decision A (`assignRole`/`patchRole` row-lock rework) and the
role-mapping DELETE route `fail()` fix: `t-rbac-races` 53/53,
`t-rbac-guards` 49/49, `t-foundation` 26/26, `t-admin-unit` 22/22,
`t-admin` 80/80, `t-admin-concurrency` 8/8, `t-atomicity` 18/18,
`t-audit-pairing` 101/101, `t-idempotency-matrix` 9/9, `t-xmodule`
17/17, `t-deadlock` 2/2, `t-cc1-lockout` 8/8, `tsc` PASS, `eslint` 0
problems, `build` PASS. Scratch verified clean again. Domain suites
provably unaffected (changed paths are assign/deactivate/grant-only;
store/owner actors never touch them — ceiling passes, locks uncontended).

## 6. Phase-4 PGlite failure (environmental, pre-existing)

`db/tests/run-phase4-tests.js` aborts in the coupon block
(`COUPON_EXHAUSTED` on first use, then `INSUFFICIENT`, then harness
`HARNESS ERROR`). Root cause, proven by direct probe: PGlite 0.4.3 (pinned
in `package-lock.json`) returns `rowCount: undefined` for UPDATEs in this
environment (result shape is `{rows, fields, affectedRows}`) — the frozen
harness gates coupon bumps and reserve bumps on `rowCount`, so every
conditional bump "fails". `db/`, `db/tests/`, and the lockfile are
byte-identical to the frozen baseline (no diff); sibling PGlite suites on
the same engine pass (Phase 2: 77/77, Phase 5: 50/50). The frozen harness
was deliberately NOT modified to fit the environment. Counts across runs:
42–64 PASS then deterministic coupon collapse (nondeterministic onset —
environmental flake, not test logic).

## 7. Final RBAC hardening — all residuals resolved

### 7.1 Decision A

```text
ROLE_ASSIGNMENT_DEACTIVATION_CONCURRENCY:
ROLE_ROW_SERIALIZATION
```

`assignRole`: BEGIN → `LOCK roles row FOR UPDATE` → re-read `is_active`
+ grants → inactive ⇒ 409 `"Role is not active."` → ceiling on the
re-read set → insert mapping → audit → COMMIT. `patchRole` (every edit,
not only SUPER_ADMIN): BEGIN → lock the same row → re-read → existing
safety checks on re-read state → update → audit → COMMIT. The race is
closed transactionally: same-row lockers serialize; the loser
re-evaluates after the winner commits (READ COMMITTED). No mutexes, no
retry loops, no SERIALIZABLE, no optimistic checks.

Global lock order (deterministic, acyclic by construction): (1) holder
protocol — ASC `users`+`user_roles` locks, never `roles` rows
(`patchUser`-deactivate, guarded `removeRole`); (2) exactly one `roles`
row per tx (`patchRole`, `assignRole`); (3) lock-free single-row UQ
writes (`assignGrant`/`removeGrant`/role create/delete); audit INSERT
always last in-tx. Single-row locks + one ASC multi-row order ⇒ no
deadlock cycle; R8 confirms empirically (mixed contention, zero 500s).

Changed behavior (mandated): assigning an inactive role is now 409
(previously silently allowed). No existing suite assigned inactive roles
(full matrix green).

### 7.2 Decision B

```text
AUTHORIZATION_SEMANTICS:
PER_REQUEST_EFFECTIVE_PERMISSION_SNAPSHOT
```

Verified against the architecture: `getCurrentAdmin` is React `cache()`
— request-scoped, DB-derived on every request; sessions re-validated per
request (revoked/expired/inactive user); repo-wide grep proves no
global/process RBAC cache (only the request cache + a rate-limit pruning
note). Invariant: permission checks are authoritative for the current
request; concurrent RBAC mutations affect subsequent requests. No
permission-version columns, no session-revision tables (both would
violate the frozen architecture). R5/R6 prove next-request observation
(403 after revoke/deactivate, 201 after restore) and consistent
concurrent interleavings (every response matches its pre- or
post-revocation snapshot; audits == 201s).

### 7.3 Decision C

```text
FUTURE_PERMISSION_GRANTS:
NO_IMPLICIT_AUTO_JOIN
```

`createRole` writes zero grants (test-verified: fresh role grant count
is 0); grants exist only via explicit `assignGrant` (ceiling-checked);
the seed is explicit. SUPER_ADMIN keeps its explicit full-grant
bootstrap semantics. No code change required or made — documented as a
future-safe rule without adding schema or permissions.

### 7.4 Decision D — self-ungrant (verified, no new rule)

Ordinary self-removal stays legal: removing a grant from your own role
is 200, and the loss is observed next-request (403) per snapshot
semantics; user/role active state is untouched. SUPER_ADMIN bypass is
impossible: revoke 403, sole-holder mapping removal 409, deactivation
guards intact. No new permission, no hardcoded lists beyond the
established SUPER_ADMIN protection. Self-lockout (e.g. removing your own
`roles.manage`) remains the actor's foot-gun — documented, not guarded.

### 7.5 Verification — `t-rbac-races` 53/53

R1 assign-wins · R2 deactivation-wins (409, zero/zero) · R3 6 raced
rounds (valid pairs only, consistent state+audits) · R4 duplicate-grant
convergence (single row + single audit) · R5 revoke race (ordered +
6 raced rounds, consistent) · R6 deactivation race (ordered + 4 raced
rounds) · R7 safety re-runs (self 403/403, holder 200/409 never-zero,
revoke 403/403) · R8 mixed contention (no 500, outcome-consistent state
and audits) · D1–D2 + zero-join + 401/403/404/409 matrix with no-leak
bodies.

## 8. Remaining items (genuinely open)

- BA-11 full backend verification (COMPLETE 2026-09-27 — full matrix
  green; record in `docs/backend-integration.md` BA-11 section).
- Frontend, OTP/login, notifications surface, production cutover (unchanged).
- Phase-4 PGlite suite: environmental failure carried (§6) — same-PG
  coverage green; frozen harness untouched by design.
- Shared-scratch note (informational): BA-2..BA-8 regression suites
  predate audit pairing and leave owner-actor audit rows their cleanups
  don't remove (established BA-9 model: owner-actor history stays); new
  suites assert relative before/after counts on shared fixture entities,
  absolute counts only on suite-private entities. Test cleanup deletes
  only the suite's own rows — never historical records.
