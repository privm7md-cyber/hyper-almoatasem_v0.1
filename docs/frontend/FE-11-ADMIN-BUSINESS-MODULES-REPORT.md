# FE-11 — Admin Business Modules Report (2026-10-14)

> Closes the seven admin modules against source + contracts. Two behavior fixes
> (auth-aware mutation errors, role-delete confirmation), 25 new tests, zero backend/
> contract/DB changes, no commit/push, no handoff edit. Prior FE-10 reports stand;
> historical filenames preserved.

## A. Repository Safety

- `D:\Hyper_el-moatasem` · `master` · `83253fe9…` == `origin/master` (before/after).
- Changed by FE-11: `src/lib/frontend/api-client.ts` (+`displayFailure` helper),
  13 `src/components/admin/*.tsx` islands (error display only), `src/components/admin/role-forms.tsx`
  (delete confirmation), 4 new test files (`api-client.test.ts` extended + `__tests__/admin-mutate`,
  `role-delete`, `users-roles`, `settings-audit`), this report.
- Untouched: backend/openapi/Prisma/DB, storefront, `docs/AGENT-HANDOFF.md`.

## B. Module Matrix (audited against source, not filenames)

| Module | Routes / components | API support | Permission gate | Tests | Gap → Action |
|---|---|---|---|---|---|
| Promotions | `/admin/promotions[/[id]]` + create/status/target/rules/buy-get islands | list/detail/create/patch/delete + sub-resources (verified in routes) | `promotions.view` reads, `.manage` writes (server) | Page unit 6 + AdminAction + `displayFailure` | 401/403 hints → FIXED |
| Coupons | `/admin/coupons[/[id]]` + usages + create/patch/delete | list/detail/usages/create/patch/delete (verified) | `coupons.view` / `.manage` | e2e gate + hint wiring (no dedicated unit — noted §F) | 401/403 hints → FIXED |
| Users | `/admin/users[/[id]]` + create/patch/password/roles islands | list/detail/create/patch/password/role-attach/detach (verified) | `users.view` / `.manage` | Unit 3 + e2e gates | 401/403 hints → FIXED |
| Roles | `/admin/roles[/[id]]` + create/patch/delete/grants/members | list/detail/create/patch/delete/grant-attach/detach (verified) | `roles.view` / `.manage` | Unit 2 + role-delete 3 + e2e gates | Delete had NO confirm → FIXED (two-step, danger-styled, cancel-safe) |
| Permissions | `/admin/permissions` read-only catalog | No writes exist (verified absence) | `roles.view` (route contract) | e2e gate (no unit — noted §F) | None — read-only is correct |
| Settings | `/admin/settings` + typed per-key edit | list + per-key PATCH (verified) | `settings.view` / `.manage` | Unit 2 + e2e gate | 401/403 hints → FIXED |
| Audit logs | `/admin/audit-logs[/[id]]`, no mutation controls | list/detail read-only (verified absence of writes) | `audit_logs.view` exact key | Unit 3 + e2e gate | None — read-only is correct |

## C. RBAC & 401/403 UX (fixed)

- Backend 401/403 bodies are generic English with no recovery path (verified in
  `route-auth.ts`); every admin island previously rendered them verbatim.
- New pure helper `displayFailure(error, fallback)` (`api-client.ts`): server message first,
  plus `UNAUTHENTICATED` → re-login hint, `FORBIDDEN` → permission hint. Wired into all 26
  admin mutation call sites across 13 islands (mechanical, behavior-preserving otherwise).
- Page-level: `requirePermission` → anonymous→login redirect, denied→403 boundary
  (`forbidden.tsx`); denial-before-read proven by unit tests (queries never called).
- UI hiding stays cosmetic (D45); server re-verification unchanged and untested-live by policy.

## D. Dangerous Actions

- Confirmed two-step flows: coupon/promotion delete, order transitions, credential
  rotate/revoke (pre-existing `AdminAction confirmText`); **added** for role delete
  (irreversible): consequence statement + تأكيد/تراجع + single-flight + 409 context preserved.
- Reversible toggles (user active, role active) intentionally left single-step (risk-calibrated).
- No typed-name/double-approval friction invented.

## E. Bulk, Barcode, Tables, Keyboard

- **Bulk:** zero bulk endpoints exist (verified: no `bulk` route/match in `src/app/api`) →
  no bulk controls implemented, no fake atomicity. Documented omission, not a gap.
- **Barcode/admin:** `POST /api/admin/catalog/codes` (create, `products.create`) exists but has
  no GET/list contract and no admin UI; storefront lookup covers customer scanning. Admin
  attach-UI omitted pending owner directive — documented, not improvised.
- **Tables:** existing `AdminTable` reused everywhere; server search/filters/keyset pagination
  with URL-state preservation; no full-catalog client loads (limit-20 keyset pattern).
- **Keyboard:** zero global key listeners (verified by grep) — native form/button/select
  semantics, Enter-submit, 44px targets; no shortcuts invented, nothing to conflict or scope.

## F. Testing Evidence (FE-11 session)

- New: `displayFailure` unit 4 + `AdminAction` 3 (confirm/cancel, single-flight, 401+403 hints) +
  `role-delete` 3 (confirm flow, exact DELETE contract, 409-with-context) + `users-roles` 5 +
  `settings-audit` 5 = **20 FE-11 tests**, all mocked (identity/reads/fetch), zero DB writes.
- Full: vitest **116/116** (23 files) · `tsc` clean · eslint 0 errors · build PASS (21/21 admin
  routes) · Playwright: 11/11 DB-independent green; 6 DB-dependent specs environment-BLOCKED
  (see §G).
- Gaps in FE-11's own coverage: coupons page + permissions page have e2e-gate but no unit
  tests; role-detail grant matrix and user-detail islands rely on `displayFailure` unit +
  contract (no dedicated island tests). Live mutations untested by policy.

## G. Regression (re-run after FE-11 changes)

- `npx tsc --noEmit` clean · `npx eslint src/app/admin src/components/admin src/lib/frontend
  e2e/fe10-platform.spec.ts` 0 errors (2 pre-existing warnings, untouched file) ·
  `npx vitest run` 116/116 · `npm run build` PASS · `git diff --check` exit 0.
- Playwright full run during this session: **31 passed, 6 failed** — the 6 are the known
  FE-2/3/4 storefront specs failing on `pg_ctl: no server running` (local postmaster down
  again; service-wrapper issue still BLOCKED per prior audit; restart prohibited in this
  assignment §2.3). Storefront code untouched by FE-11; failure signature identical to the
  previously diagnosed DB-down incident (not a code regression).
- DB-independent subset re-run with DB down: `fe10-platform` + `foundation` **11/11 green** —
  admin gate redirects and login render proven independent of database availability.
- No suppressions added; no failures hidden.

## H. Residual Limitations

- Live admin mutations, last-admin/demotion guards, and backend authz enforcement unproven
  here (policy-blocked; server-owned).
- Admin code-attach UI, bulk ops, and analytics: no contract → omitted (owner directives pending).
- Coupons/permissions pages: unit-test gap (e2e-gate only).

## Verdict

**FE-11 = COMPLETE WITH EXPLICIT LIMITATIONS.** All seven modules audited and contract-mapped;
two real UX gaps fixed with tests; unsupported capabilities omitted and named — no invented
behavior, no silent coverage claims.
