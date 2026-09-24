# PHASE 5 — IMPLEMENTATION NOTES (final database: administration domain)

> What was built. No frozen (Phase 1/2/4) file was modified — verified by content
> scans (zero promotion/admin DDL in frozen schemas) and regression suites.

## Migrations (raw SQL, ordered — repo convention)

| # | File | Purpose |
|---|---|---|
| 7 | `db/phase5-schema.sql` | **NEW** — 8 tables + gated CHECKs + 16 indexes + 3 updated_at triggers (reuses frozen `set_updated_at()`) |
| 8 | `db/phase5-seed-example.sql` | **NEW** — 2 roles, 31 permissions, explicit matrix (31/24), 8 settings, bootstrap owner (identity only) |
| — | `db/tests/run-phase5-tests.js` | **NEW** — 50-test suite (PGlite, real PG): constraints, matrix, audit, settings typing, inbox, cross-domain, counts |

Apply strictly in order after files 1–6.

## Implementation pins (inside approved contracts, no arch change)

1. **Settings JSON validation is CASE-guarded** (`CASE value_type ... WHEN 'JSON' THEN
   cast ... END`): only the matching branch evaluates, so TEXT rows never touch the cast;
   invalid JSON under JSON type raises, which rejects the write — enforcement by rejection.
2. **Partial unique indexes don't appear in `pg_constraint`** (they're indexes, not table
   constraints) — the C-UQ count test asserts 6 table UNIQUEs + documents the phone partial
   separately. Same posture as frozen suites.
3. **Notifications carry no `updated_at`** (`read_at` is the only mutation, by design);
   mappings/registry/audit rows likewise have `created_at` only.
4. Test-only shims (never shipped): PGlite `pgcrypto` line neutralised in-memory + stub
   `gen_random_uuid()` (explicit UUIDs everywhere).

## Test results

* `npm run test:phase5` → **50 passed, 0 failed**, covering: users/roles/permissions
  formats + uniqueness + soft-delete, mapping UQs + RESTRICT directions, 31-key matrix
  (SUPER_ADMIN 31/31, STORE_ADMIN 24/24 with 7 security keys excluded, disabled role/user
  authorize nothing), audit pairing + JSONB + immutability shape, settings typing
  (valid ×5 kinds, mistyped ×4 rejected, dup key), inbox isolation + CASCADE semantics,
  no-`admin_*` proof, frozen CHECK spot-checks (weight rule, code UQ), object counts
  (8 tables, 6 FKs, 6+1 uniques).
* Regressions: Phase 2 suite **77/77** green; Phase 4 suite **65/65** green (re-ran:
  unaffected — separate files, no shared objects beyond frozen `set_updated_at()`).

## Known limitations (honest)

* L1 — RBAC concurrency needs no embedded gate: all races reduce to declarative UQ +
  RESTRICT (proven on live engine); no shared-counter contention domain exists here.
* L2 — audit sanitizer, effective-grant evaluation, SUPER_ADMIN-row protection, and
  retention sweeps are writer/app discipline + review (documented in final architecture).
* L3 — password/session mechanics intentionally absent (auth decision deferred);
  `users` carries identity only — login is impossible until the auth phase lands.
