# Admin Auth Architecture — Hyper Al-Moatasem (implemented on scratch)

Custom admin authentication (no Auth.js / Better Auth): admin-only system with
an existing frozen RBAC model, DB-backed opaque sessions with true revocation,
and SQL-owned audit/integrity. Stack: Next.js 16 (App Router, `proxy.ts`),
Prisma 7.10 + `@prisma/adapter-pg`, PostgreSQL 18, Argon2id, Zod.

## 1. Password policy
12..128 chars, Argon2id (OWASP minimums: m=19456 KiB, t=2, p=1), automatic
unique salt per password (embedded in the hash encoding). No pepper. No
plaintext anywhere (never logged, never returned, never seeded).

## 2. Session lifecycle
Fixed 8h expiry (no sliding). Login mints a 256-bit opaque token; only its
SHA-256 hex is stored (`token_hash`, UNIQUE). Cookie `__Host-admin-session`
(HttpOnly, Secure in production, SameSite=Lax, Path=/, maxAge 8h). Validation:
token→hash→row must exist, unrevoked, unexpired (expiry gated in SQL),
user active + not deleted; touches `last_seen_at`. Logout revokes server-side
+ clears cookie. Logout-all / rotation / disable revoke all live rows.

## 3. RBAC flow
`getCurrentAdmin()` (per-request cached) loads user + active roles + active
grants. `requireAdmin()` (redirect login), `requirePermission(key)` (redirect
or 403 via `forbidden.tsx`), `checkPermission()` (data-returning variant for
actions/APIs). UI hiding is convenience only; every action/handler/page
enforces server-side. Disabled roles/users authorize nothing, effective
immediately (no session caching of grants).

## 4. Login flow
Zod → lowercase email → IP + account rate buckets → lookup → ALWAYS verify a
hash (real or constant dummy — timing-equal unknown path) → uniform generic
Arabic error → atomic fail bump (+15min lock at 5 consecutive) or atomic
success (reset + session + audit in one transaction, fail-closed).

## 5. Logout / revocation
Single revoke (idempotent), revoke-all, rotation revokes all, disable kills
live sessions via re-validation. Emergency revocation = revoke-all by user id.

## 6. Rate limiting
DB buckets `(bucket_key, window_start)` with 15-minute aligned windows:
per-IP 30, per-account 10. Single-statement atomic bump (no lost increments,
serverless-safe, no Redis). Opportunistic TTL cleanup. Account lockout (5
fails → 15min) is the hard stop; rate limits are the soft shield.
Semantics (verified): attempts are counted BEFORE password verification (both
buckets bump on every attempt, including unknown emails — the email string
itself is the account key); locked accounts keep consuming rate state;
success does NOT reset rate windows (only attempts/lock reset — windows decay
by TTL); IP rotation never bypasses per-account buckets + lockout; account
rotation never bypasses the shared IP bucket.

## 7. Account lockout
Atomic single-UPDATE bump + conditional lock; temporary only; generic user
message; race-tested for exact accounting (12 parallel → exactly 10 bumps at
the account cap, then locked).

## 8. Auth token lifecycle
`admin_auth_tokens` (INVITATION | PASSWORD_RESET): 256-bit random, hash-only
storage, TTLs (72h / 1h), atomic single-winner consume
(`used_at IS NULL AND expires_at > now()` in one UPDATE), purpose + owner
checked in the same statement. No emails/routes yet — lifecycle core tested.

## 9. Owner bootstrap procedure
`scripts/bootstrap-admin-password.mjs`: TTY-hidden prompt (or piped
password+confirmation in automation — never CLI args), policy check, Argon2id,
UPDATE of the EXISTING bootstrap identity (default owner email, `--email`
override), audit `auth.bootstrap_password_set`, all-or-nothing transaction.
Guards: URL-parse pre-check + live `current_database()` assertion; allowlisted
scratch DBs only; production/postgres/unknown refused with zero contact.

## 10. Security assumptions
- Attacker model: network + stolen DB dump (hashes resist offline cracking via
  Argon2id) + stolen cookie (revocable, short-lived) + malicious store admin
  (permission-bound, audited).
- Trust: server clock = DB clock (all security time-comparisons run in SQL —
  see driver note); TLS terminates correctly in front of the app (Secure
  cookies); env secrets stay out of git/logs.
- Driver quirk — ROOT CAUSE (proven live on PG 18.4 / Prisma 7.10 /
  @prisma/adapter-pg / Windows, server TZ Africa/Cairo): Prisma-decoded
  TIMESTAMPTZ values carry the wall-clock time stamped as UTC, i.e. shifted by
  exactly the server UTC offset AT THAT INSTANT (+2h winter EET, +3h summer
  EEST — DST-varying, so no constant correction is possible). Verified:
  storage exact, SQL `extract(epoch)` exact, node-postgres reads exact;
  only the Prisma Client decode path shifts. Rule (enforced in code): NEVER
  compare Prisma-returned timestamps in JS — every security time gate
  (lockout, session expiry, token expiry, rate windows) is decided by
  PostgreSQL (`... > now()` in the statement). Raw-`pg` reads are unaffected;
  writes via `now()` are unaffected.

## 11. RBAC matrix
SUPER_ADMIN 31/31; STORE_ADMIN 24/24 (excludes users/roles/settings manage +
audit view). Enforced per operation; verified over HTTP (200 vs 403).

## 12. Production deployment requirements
- `DATABASE_URL` (app role) + run `bootstrap-admin-password` equivalents
  through the approved production bootstrap process (NOT this CLI against
  production — it refuses by design).
- AUTH_SECRET-class material: NOT required (opaque sessions need no signing).
- Migrate first (baseline + auth foundation + supplements), then seed, then
  bootstrap owner, then smoke-login. No step is automatic.
