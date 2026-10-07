# ADR — Customer Authentication (Phase 2.5)

> Decision record for storefront customer authentication. Phone + password
> with server-side opaque sessions. OTP/phone-verification/password-recovery
> explicitly deferred (no provider exists).

## Decision

**Registered Customer = phone + Argon2id password; sessions are
server-side opaque rows (`customer_sessions`); guests stay token-based
and never authenticate.**

## Why

* The schema already carried `password_hash` + `is_registered` (frozen
  Phase-2 customer model) and a staff-assisted upgrade path — credentials
  were the designed direction; this phase completes it for self-service.
* Admin auth proves the pattern on this stack (Argon2id OWASP minimums,
  5→15min lockout, DB rate buckets, hashed opaque sessions, SQL-side
  time gates). Reuse beats invention; admin and customer planes stay
  isolated (separate tables, buckets, cookies).
* Stateless HMAC (Phase 2) could not revoke: logout was cookie deletion,
  password change could not invalidate sessions, disable had no effect.
  Revocation needs server state — hence one new table, no more.

## Alternatives considered

* **OTP/SMS:** rejected — no provider exists; building one is a product
  decision with billing/operations surface far beyond this phase.
* **Keep HMAC + phone bootstrap:** rejected — leaves the herited
  limitation (phone knowledge ⇒ session) intact; no revocation.
* **Passwordless/magic-link:** rejected — needs email/SMS delivery all
  the same; recorded as future.
* **Reuse `admin_auth_rate_limits` / audit rows:** rejected — isolation;
  audit FKs reference users(id) and ADMIN actors.

## What was built

* Migration `20261006_customer_auth` (dual-artifact): `customers` +=
  `failed_login_attempts`/`locked_until`; new `customer_sessions`
  (hash-only tokens, expiry, revocation, inet IP shell) and
  `customer_auth_rate_limits`; CHECKs, partial live index, trigger reuse.
  Scratch-applied + verified; never production.
* `lib/customers/auth.ts`: register (guest-row conversion included),
  login (uniform 401, dummy-timing, DB-side lockout), password change
  (revokes all sessions), all mirroring the admin core.
* `lib/customers/session.ts`: DB-backed create/validate/revoke +
  `requireCustomer` (unchanged contract for all storefront routes).
* Routes: `POST register`, `POST session` (= login),
  `DELETE session` (real revoke), `PATCH password`, `GET session`;
  `identify` downgraded to lookup/bootstrap (never mints).
* Policy: 12..128 (reused), no complexity rules; generic failures;
  registration duplicate → 409 (accepted enumeration surface).

## Security boundary

Authentication proof = possession of the password (verified Argon2id) at
login/register time, or a live unrevoked server-side session afterwards.
Phone knowledge alone, customerId knowledge alone, and guest tokens grant
nothing authenticated.

## Future (explicitly NOT built)

OTP/SMS provider, phone-ownership verification, password recovery,
registration spam controls (CAPTCHA/verification), multi-device session
management UI, customer auth audit trail (FK-blocked today).
