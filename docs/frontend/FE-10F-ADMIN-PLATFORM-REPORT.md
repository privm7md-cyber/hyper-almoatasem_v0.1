# FE-10F — Admin Customers, Users, Roles, Settings & Audit Report (2026-10-14)

> Platform administration: customer directory + assisted registration, user CRUD + role
> attach/detach + credential provisioning, role + grant matrix, typed settings, read-only
> audit feed. Server owns all guards (self-escalation, last-SUPER_ADMIN, delete constraints,
> value coercion). No backend/contract change, no commit/push, no handoff edit.

## A. Repository Safety

- `D:\Hyper_el-moatasem` · `master` · `83253fe9…` == `origin/master` (before/after).
- Added: `src/app/admin/{customers,customers/[id],users/[id],roles,roles/[id],permissions,
  settings,audit-logs,audit-logs/[id]}/page(s)`; evolved `users/page.tsx` (kept list, added
  create + detail links); islands `customer-forms,user-forms,user-detail-forms,role-forms,
  setting-forms.tsx`; e2e `e2e/fe10-platform.spec.ts`.
- Fixed live: audit gate key `audit.view` → contracted `audit_logs.view` (route-verified);
  users-list unused `Metadata` import (lint).
- Untouched: backend/openapi/schema/storefront/FE-10A–E files (regression-tested).

## B. Implementation Summary

- Customers (`customers.view`): phone/name search + keyset list; detail with identity,
  addresses (default-flagged), and guest→registered password form (closest-capability
  mapping per route contract — no profile edits invented).
- Users (`users.view/manage`): create (name/email/phone), detail with name/active patch,
  password provisioning, role attach/detach (detach ×-buttons resolve ids server-side).
- Roles (`roles.view/manage`): create/patch/delete (409-with-members surfaced with guidance),
  grant attach/detach against the permission catalog, read-only member list.
- Permissions: read-only catalog (`roles.view` gate per route contract — no writes exist).
- Settings (`settings.view/manage`): full key catalog with per-key string-value edit;
  server coerces by `valueType`, rejections surfaced verbatim.
- Audit (`audit_logs.view`): newest-first feed with action/entityType filters + keyset;
  detail renders full old/new JSON (`dir=ltr` pre blocks); no writes exist.

## C. Backend Integration (BACKEND-CONFIRMED from code)

| Operation | Endpoint / mechanism | Contract notes |
|---|---|---|
| Customers | `GET /api/admin/customers[/{id}]`, `POST …/[id]/register {password}` | No password_hash in reads (by construction) |
| Users | `GET/POST /api/admin/users`, `PATCH …/[id]`, `POST …/[id]/password`, `POST/DELETE …/[id]/roles[/{roleId}]` | Self/demotion/last-admin guards server-side |
| Roles/grants | `GET/POST /api/admin/roles`, `PATCH/DELETE …/[id]`, `POST/DELETE …/[id]/grants[/{pid}]` | SUPER_ADMIN protection; 409 constraints |
| Settings | `GET /api/admin/settings`, `PATCH …/[key] {value}` | `assertSettingValue` coercion; keys fixed |
| Audit | `GET /api/admin/audit-logs[/{id}]` | (created_at DESC, id DESC); uuid cursor |

## D. Security / Privacy

- Passwords as write-only inputs (never rendered/stored/logged client-side); every write
  re-verified against its `.manage` permission server-side; customer password_hash
  unexposed by construction; audit actor/IP recorded backend-side.

## E. Testing Evidence

- New e2e `fe10-platform.spec.ts` **7/7** (all 6 new surfaces redirect unauthenticated +
  login render, no mock strings); vitest **64/64** · Playwright full **37/37** ·
  `tsc` clean · `eslint` clean · build PASS (21 admin page routes compile).
- Environment incident (closed): 6 FE-2/3/4 e2e failures mid-session traced to stopped
  local Postgres (`postgresql-x64-18` Stopped → `$transaction` blew up); after starting the
  local postmaster, full suite green — no code change involved. Local DB data state
  untouched (no migrations/seeds/writes by this session).
- NOT executed: authenticated admin mutations (no writable fixtures here).

## F. Known Limitations

- No row counts anywhere (no verified source — keyset-next links only).
- No user email/phone edit UI (patch contract covers name/active; email/phone excluded —
  verified absence, not omission).
- Member removal happens on user pages (role page members read-only by design).
- No audit export (no contracted endpoint).

## Verdict

**FE-10F COMPLETE WITH EXPLICIT LIMITATIONS** ( shell + gates proven live via e2e;
authenticated mutations deferred to a fixture-capable environment).
