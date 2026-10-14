# FE-6 — Customer Identity & Addresses Report (2026-10-13)

> Identity flows against live contracts; credential-creating operations proven by mocked unit tests
> only (no test users/addresses created — local DB untouched). No backend/contract change, no
> commit/push, no handoff edit.

## A. Repository Safety

- `D:\Hyper_el-moatasem` · `master` · `83253fe9…` == `origin/master` (before/after).
- Added: `src/app/{login,register,account,account/addresses}/page.tsx`,
  `src/components/store/{login-form,register-form,address-book,logout-button}.tsx`,
  `src/lib/frontend/account-reads.ts`, `src/components/store/__tests__/identity.test.tsx`.
- Evolved: `store-nav.tsx` (account link enabled — route now exists; orders stays pending FE-7).
- Untouched: backend/openapi/schema/admin/prototype/contracts.

## B. Implementation Summary

- `/login` (phone+password → session endpoint; HttpOnly cookie set by backend; generic 401 message;
  no secret stored; success → `/account` + refresh). Existing admin `LoginForm` untouched (separate flow).
- `/register` (phone+firstName+password → 201 auto-session; 409 → login guidance; 429 backoff message;
  no OTP/verification invented; password policy stays server-side).
- `/account` (server viewer via `account-reads.ts` RSC pattern; guest state honest — no fake data).
- `/account/addresses` (list + create + set-default + delete; city+phone required; no governorate field;
  ownership server-enforced with masked 404s; list refreshes post-mutation).
- Logout (DELETE session → home; guest-cart bearer intentionally preserved — separate lifecycle).

## C. Backend Integration (BACKEND-CONFIRMED)

| Flow | Endpoint | Contract notes |
|---|---|---|
| Login | `POST customers/session` | Generic 401 always; cookie + `{customer,customerToken,expiresAt}` |
| Register | `POST customers/register` | 201 + session; 409 duplicate; 429 buckets; policy 12..128 server-side |
| Me | `GET customers/session` | `{customer, addresses}` or 401 |
| Logout | `DELETE customers/session` | Revoke + clear; always 200-shaped |
| Addresses | `GET`/`POST` + `GET`/`PATCH`/`DELETE /{id}` | Self-scoped; isDefault with 409 race; hard delete (snapshots preserved) |

Guest never forced to register; no guest orders linked on registration (no such call exists in these flows).

## D. Security / Privacy

- Passwords: login-time only, never stored/logged; masked inputs; generic failures (no oracle).
- Sessions: HttpOnly only; client never reads/duplicates tokens (verified: no `customerToken` storage).
- Addresses: self-scope by construction; foreign → 404 (verified contract, no probing performed).
- No OTP/reset invented; no PII in URLs/logs.

## E. Testing Evidence

- Vitest `identity.test.tsx`: **6/6** (empty-submit guard, login payload+nav+zero-storage, 401 generic,
  409→login link, address default-badge + DELETE call, required-fields + no-governorate).
- E2E `fe5-7-flows`: login validation, register render (no OTP promises), account guest state — green.
- Full: **64/64** unit · e2e **30/30** total · `tsc`/`eslint` clean · build PASS · no regressions.

## F. Known Limitations

- Live login/register/address writes unproven (no test identities created — policy; mocked proof only).
- Ownership-error paths mapped from contract, not triggered live. Session-expiry mid-flow relies on
  contract 401 handling (specified, untriggered live).

## G. Final Status — `COMPLETE WITH EXPLICIT LIMITATIONS`

Acceptance: login/register/session/guest-separation/account/addresses/default/ownership per contract;
no OTP/reset invented; no credentials exposed. Unproven live: §F (policy-driven, documented).
