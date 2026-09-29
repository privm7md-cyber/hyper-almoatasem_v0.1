# Backend Application Foundation — BA-1 record

> What BA-1 built and why. No domain modules (BA-2+ untouched). No schema,
> migration, seed, or production changes. All behavior below is covered by
> `scripts/api/t-foundation.mjs` (26 unit tests, no DB) and
> `scripts/auth/t-cc1-lockout.mjs` (3 static guards + 5 HTTP cases A–E on
> scratch, re-runnable under any server TZ for case F).

## 1. CC-1 fix (required first, done)

**Root cause:** `src/lib/auth/login.ts` fail path branched on
`new Date(row.locked_until).getTime() > Date.now()` — a JavaScript comparison
of a Prisma-decoded TIMESTAMPTZ. On this stack the decode shifts instants
later by the server UTC offset (proven, DST-varying), so a 15-minute lockout
could read as ~3h15m. This contradicted the locked rule that all security
time-gates are enforced in SQL.

**Fix (architectural, not a workaround):** the fail-path UPDATE now
`RETURNING failed_login_attempts, (locked_until IS NOT NULL AND
locked_until > now()) AS locked_now` — the lock decision is computed by SQL
against the post-UPDATE row with `now()`. No application clock, no timezone
arithmetic, no decoded-timestamp comparison participates in the decision.
Semantics preserved exactly: threshold crossing (5 fails → 15 min lock),
atomic bump (single UPDATE, row lock), same audit branching (`nowLocked`
drives `auth.account_locked` vs `auth.login_failure`).

**Why it preserves the frozen contract:** threshold, duration, rate policy,
session policy, RBAC, and schema are untouched; the only change is WHERE the
already-SQL-owned predicate is evaluated (in the statement instead of after
it). The `usable` pre-check was already SQL-decided and is unchanged.

**Tests:** A (no lockout → ok), B (live lock → generic 401), C (expired →
ok), D (16-minutes-expired lock succeeds — the exact 15min-vs-3h15m
regression), E (2s live lock rejects; attempts bump to exactly 4 without
extending; gate clears after sleep), F (identical 8/8 under server
`TZ=Pacific/Kiritimati`), plus 3 static guards (no JS Date on `locked_until`
in the lock path; SQL boolean in RETURNING; no TZ arithmetic). Suite:
`node scripts/auth/t-cc1-lockout.mjs --db <scratch> --port <port>` against a
built server pointed at an allowlisted scratch DB; refuses otherwise.

## 2. Shared API foundation (`src/lib/api/`)

New pure modules (no DB, no network, no secrets inside):

- `errors.ts` — `ApiError` + stable codes (VALIDATION, UNAUTHENTICATED,
  FORBIDDEN, NOT_FOUND, CONFLICT, BUSINESS_RULE, RATE_LIMITED, INTERNAL) +
  `businessRule` / `conflict` / `normalizeError` (unknown → generic
  INTERNAL). Deliberately no LOCKED code (lockout stays 401-generic per
  frozen login behavior) and no checkout-specific code.
- `http-status.ts` — code→status map extending (never contradicting) the
  existing 400/401/403 usage: 404, 409, 422 (business-rule), 429, 500.
- `respond.ts` — `{ data, meta }` / `{ error: { code, message, details } }`
  envelopes with 200/201 helpers. Existing `/api/admin/session` keeps its
  own `{ ok, ... }` shape — never rewritten by these helpers.
- `validation.ts` — Zod primitives only (existing library): UUID, strict
  objects (unknown fields rejected), idempotency-key wire shape (mirrors
  frozen CHECK), positive-decimal quantity wire shape, bounded pagination
  (default 20, max 100, id cursor). Business rules stay in domain services.
- `idempotency.ts` — contract decision helper (proceed/replay/conflict) +
  standard 409 raiser. Storage stays in owning flows; order/replacement
  idempotency itself is BA-6/BA-7 work.
- `concurrency.ts` — deterministic ASC lock-order helper + PG deadlock/
  serialization classifier (re-read, never blind re-fire).
- `log.ts` — JSON event logger with centralized secret-key redaction
  (password/hash/token/cookie/URL/key substrings, case-insensitive).
- `ts-resolve-hook.mjs` (in `scripts/api/`, test-only) — maps extensionless
  relative imports to `.ts` so the Next-correct sources run unmodified under
  plain-node tests. Never imported by production code.

Not built (no genuine gap found): auth helper (exists: `getCurrentAdmin`),
authorization helper (exists: `requireAdmin/requirePermission/requireRole/
checkPermission`), transaction wrapper (would hide boundaries — rule
documented instead: business operation owns its tx; Prisma `$transaction`
direct), rate-limit changes (none; semantics verified compatible with CC-1).

## 3. Boundaries preserved

- 3-layer validation (Zod boundary → domain → DB-only enforcement) intact.
- Prisma vs raw SQL per gaps doc; no SQL-only behavior moved to JS
  (CC-1 moved a decision the other way: JS → SQL).
- Idempotency/concurrent foundations preserved; no blanket
  `ON CONFLICT DO NOTHING` in product paths.
- Security posture preserved (same-origin, generic errors, dummy-hash path,
  audit pairing, cookie flags all untouched).

## 4. Testing strategy (BA-1)

- `scripts/api/t-foundation.mjs` — 26 unit asserts, no DB/server, exit 2 on
  failure. Run: `node scripts/api/t-foundation.mjs`.
- `scripts/auth/t-cc1-lockout.mjs` — 3 static + 5 HTTP cases, scratch-only
  guard, cleans up its own rows. Run per header.
- Existing suites: `scripts/auth/t-password.mjs` (offline hash/policy part),
  frozen `db/tests` suites (SQL-only, unaffected by app-layer diff).
- Rule: every future BA module ships behavior tests before its phase closes;
  frozen asserts are never weakened.
