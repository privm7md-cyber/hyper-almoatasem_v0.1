# BA-9 Admin APIs — implementation record

> Backend APIs only. No frontend. No BA-10+. No schema/migration changes.
> All behavior verified on scratch (`hyper_almoatasem_scratch`, reused from
> the BA-8 build); production untouched (every test connection is
> allowlisted to scratch names only; the Next server under test pointed at
> scratch).

## 1. Existing admin inventory (verified, untouched)

BA-2..BA-8 already expose: catalog (11 routes), coupons (2), customers
(5), inventory (9), orders (3) + order-replacements (2), promotions (6),
replacements (2), session (1). BA-9 adds nothing there — cross-domain
admin behavior is re-verified by running those suites, not by rebuilding
them.

## 2. Genuine BA-9 gaps (Phase 5 domain, previously no routes)

| Domain | New routes | Permission |
|---|---|---|
| users | GET list, GET one, POST create, PATCH edit, POST `[id]/password`, POST `[id]/roles`, DELETE `[id]/roles/[roleId]` | `users.view` reads, `users.manage` writes, `roles.manage` grants |
| roles | GET list, GET one, POST create, PATCH edit, DELETE, POST `[id]/grants`, DELETE `[id]/grants/[permissionId]`, GET `[id]/members` (BA-F: read-only member listing for the delete-held constraint) | `roles.view` reads, `roles.manage` writes |
| permissions | GET list, GET one (reads only — no write key exists) | `roles.view` (documented mapping) |
| settings | GET list, GET one, PATCH value | `settings.view` / `settings.manage` |
| audit_logs | GET list, GET one (immutable — no PATCH/DELETE routes) | `audit_logs.view` |
| notifications | none | still deferred (no frozen admin surface) |

## 3. Permission handling (31 keys intact)

No new permission, no rename, no `customers.manage` split. Two
documented closest-capability mappings (BA-4 precedent): permission
registry reads under `roles.view`; user-role assignment/removal under
`roles.manage` ("manage roles and grants"). SUPER_ADMIN holds all 31
explicitly (no bypass flag anywhere — enforced via effective grants).

## 4. Frozen rules implemented

- Unified users table; email lowercase + unique; phone partial-UQ;
  soft-delete consistency; role mappings UQ + RESTRICT; grants UQ +
  RESTRICT; settings typed values (BOOLEAN/INTEGER/NUMERIC/TEXT/JSON
  mirrored at the boundary, DB CHECK enforces); audit append-only with
  actor pairing + namespaced actions.
- SUPER_ADMIN-row protection (writer discipline, Phase 5 L2): rename and
  delete answer 403. No other safeguard is frozen.
- No user hard-delete endpoint (history pins actors via RESTRICT —
  deactivation is the lifecycle). No permission writes (no key).
- Settings keys fixed (no create/delete); `delivery.default_fee` format
  preserved for the BA-6 consumer (read-verified, never corrupted).
- Passwords: existing Argon2id policy+hash reused; lockout reset +
  revoke-all in-tx; secrets never logged/returned/stored otherwise.

## 5. Audit (new writes only)

Every BA-9 mutation pairs an audit_logs row in the same tx (actor ADMIN,
sanitized allowlist payloads) via a tx-bound raw INSERT matching
audit.ts (that helper is not tx-bound). BA-2..BA-8 admin writes predate
this pairing and are NOT retrofitted (would change frozen-tested tx
behavior — reported as a known gap for human decision, §8).

## 6. Errors (BA-1 envelopes)

400 malformed/strict-unknown; 401 anonymous; 403 roleless + protected
SUPER_ADMIN mutations; 404 unknown/scoped-missing; 409 duplicates +
RESTRICT-held deletes; 422 policy/type/semantic violations; 500 generic
only.

## 7. Prisma vs raw SQL

- Prisma: all reads/writes except audit.
- Raw SQL only for: audit INSERTs (tx-bound) and audit SELECTs (the
  AuditLog model is inet-poisoned — proven gaps-doc finding; ip cast to
  text). UUID-string cursors throughout; date bounds compared in SQL
  (CC-1 rule).

## 8. Tests

| Suite | Result |
|---|---|
| `scripts/api/t-admin-unit.mjs` (policy mirror, bounds) | 22/22 |
| `scripts/api/t-admin.mjs` (HTTP on scratch) | 80/80 |
| `scripts/api/t-admin-concurrency.mjs` (create/assign/activate/settings races) | 8/8 |
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
| BA-8 `t-promotions-unit.mjs` | 34/34 |
| BA-8 `t-promotions.mjs` (scratch) | 58/58 |
| BA-8 `t-promotions-concurrency.mjs` | 13/13 |
| CC-1 `t-cc1-lockout.mjs` (scratch) | 8/8 |
| `t-password.mjs` | 9/9 |
| Phase 2 / 4 / 5 functional | 77/77, 65/65, 50/50 |
| `tsc --noEmit` / ESLint (0 warnings) / `npm run build` | PASS |

Races: duplicate user/assignment single-winner + 409s; competing
activation/settings writes converge consistently. Skipped with reason:
240+120 frozen embedded-PG batteries (SQL byte-identical,
admin-blocked runner) and CC-1 TZ rerun (auth untouched).

## 9. Session findings (honest)

- Rate buckets (IP 30 / account 10 per 15-min window, fail-closed generic
  401 by design) require scheduling full-suite runs across rollovers —
  workflow note, not a product issue.
- One Phase-2 run hit the harness's own random-ID collision
  (pre-existing flake) — re-run green.

## 10. Files

- New: `src/lib/admin/{policy,validation,serialize,queries,writes}.ts`;
  `users[/[id][/password|/roles[/[roleId]]]]`, `roles[/[id][/grants[/[permissionId]]]]`,
  `permissions[/[id]]`, `settings[/[key]]`, `audit-logs[/[id]]` routes;
  `scripts/api/{t-admin,t-admin-concurrency,t-admin-unit}.mjs`; this doc.
- Modified: none outside BA-9 scope.
- Untouched/protected: `db/*`, `prisma/*`, auth/API/BA-1..BA-8 behavior,
  `docs/AGENT-HANDOFF.md`, `docs/release-manifest.md`, all frontend.

## 11. Open contract decisions (reported, not invented)

- No last-SUPER_ADMIN-grant guard, no self-deactivation/self-ungrant
  guard, no SUPER_ADMIN deactivation guard exists frozen — all stay
  permitted; human decision required if wanted.
- BA-2..BA-8 admin writes lack paired audit rows (frozen Phase 5 §4
  states the rule) — retrofit would change frozen-tested tx behavior;
  human decision required.
- Notifications admin surface stays deferred (no frozen contract).
