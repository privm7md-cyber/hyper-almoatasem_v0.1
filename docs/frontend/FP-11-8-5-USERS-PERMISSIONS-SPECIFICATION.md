# FP-11.8.5 — Admin Users & Permissions UX Specification

> Classification: `SUPPORTED` / `UNSUPPORTED` / `UNVERIFIED`. Specification-only. Backend owns
> identity, roles, grants, and every guard below. D45 applies: hide-by-default, server authoritative.

## 1. User separation (verified)

- **Admin users** (`users` table): email + Argon2id password + server sessions (8h) + role mappings.
  Managed at `/admin/users*` (`users.view/manage`, `roles.manage` for mappings).
- **Customers** (phone + password, 30d sessions): read-dominant admin surface (`customers.view`:
  list/detail/addresses/scoped-register-convert) — NO password/session handling, NO credential reads.
- No unified admin-customer console (auth models, sessions, and permissions differ fundamentally).
  Customer-account flows (FP-11.7) are never embedded here.

## 2. Displayed fields (allowed only)

- Admin row: id, name, email, roles[], `isActive`, timestamps. Customer row: per `CustomerShape`
  (no hash — verified by construction). NEVER: password hashes, raw tokens, session secrets,
  `customerToken`, guest-order tokens.
- Roles: id/name/description/`isActive` + grants[] (permission keys) + members[].
- Permissions catalog: 31 keys (`roles.view` list) — display-only reference.

## 3. Roles & permissions matrix (from verified authorization)

- Seeded roles: SUPER_ADMIN (all 31) + STORE_ADMIN (24-grant subset). No new roles invented.
- No frontend-owned matrix: UI renders `permissions[]` from `GET /admin/session` + `roles.view`
  catalog; never a hardcoded parallel matrix.
- Store-owner boundaries: owner holds STORE_ADMIN grants only — CANNOT create/manage super admins,
  CANNOT grant beyond own effective set (ceiling → 403, atomic, no partial granting).
- Role-name checks never drive actions (permission keys do; `requireRole` exists for pages but routes
  enforce keys). Insufficient-evidence permission rows marked UNVERIFIED (none — matrix fully mapped
  in FP-11.8 §4).

## 4. Sensitive actions (all `users.manage` / `roles.manage` unless noted)

| Action | Who (contract) | Show when | Confirm | API | Refresh | Failure display |
|---|---|---|---|---|---|---|
| Create admin | holder of `users.manage` | permitted | Yes (irreversible identity) | `POST /users` | Re-list | 400/409-duplicate/403 |
| Deactivate user | `users.manage`, NOT self (403), NOT last-SUPER_ADMIN (409) | permitted + not-self | Yes | `PATCH /users/{id}` | Re-read | 403-self / 409-last-admin |
| Set password | `users.manage` | permitted | Yes (revokes all target sessions) | `POST …/password` | Re-read (never echo secret) | 400-policy/422/403 |
| Assign/remove role | `roles.manage` within ceiling | permitted | Yes for remove | roles-map routes | Re-read | 403-ceiling / 409-serialization |
| Create/edit role, grants | `roles.manage` | permitted | Yes for destructive | roles/grants routes | Re-read | 403/404/409 |
| SUPER_ADMIN revoke/rename/delete | NOBODY (403 by design) | Never shown as available | N/A | — | — | 403 (never attempted blindly) |

Secrets travel in the single request body only; never logged/returned/echoed. Confirmations never
substitute server auth.

## 5. Customer account notes (no OTP)

Customer auth = phone + password + server sessions (FP-11.7). OTP is deferred project-wide — never
rendered as primary or fallback in admin or account UX, and no admin flow assumes it.

## 6. Acceptance criteria (DEFINED — NOT EXECUTED)

- Admin/customer surfaces separated; allowed fields only; no secrets rendered.
- Matrix from live `permissions[]` + catalog; owner boundaries explicit; no invented roles/matrix.
- All 6 sensitive-action rows per table (guards 403/409 honored; secrets contained).
- No OTP anywhere. D45 visibility; Arabic RTL/a11y; confirmed-success-only.

---

*End of FP-11.8.5 — specification-only.*
