# FE-0 — Frontend Architecture Audit (Static, Read-Only — 2026-10-13)

> Scope: audit only. No source/backend/contract change, no installs, no DB-touching tests, no commit/push.
> Method: static file inspection (glob/grep/read) + safe read-only checks (`tsc --noEmit`, `eslint src`).
> Live-API suites were NOT run (they write to scratch DB — out of audit scope); their beaujolais-Daoperation1465-9a76-4dd8-954b-6cf48fb08337 is cited, never claimed as re-verified here.

## A. Executive Summary

The repo is a backend-complete Next.js 16.3.8 App Router app with **no production storefront**: 98 API
`route.ts` + health, 4 production pages (`/`, 3 admin), 14 isolated prototype pages, 1 production client
component (`LoginForm`), one Server Action module (`app/actions/auth.ts`), one `proxy.ts` (presence-check
only), `forbidden.tsx`, and `src/lib/` (13 domain dirs, `server-only` in 24 files). There is no API client,
no store, no cache directives, no analytics, no test runner, no `error/loading/not-found` conventions, and
no `src/components|hooks|types|features|services` dirs. Alignment: backend patterns ALIGNED; storefront
UI layers NOT-IMPLEMENTED (expected — FE-1 scope, not a defect); 3 LOW recommendations + 2 INFORMATIONAL
notes + 1 UNVERIFIED (import cycles, no tooling). No CRITICAL/HIGH/contract breach found.

## B. Repository Baseline

- Root `D:\Hyper_el-moatasem` · branch `master` · HEAD `83253fe9…` == `origin/master` (verified, unchanged).
- Status at audit: 37 lines (26 pre-existing tracked M + 11 ?? groups) — nothing touched by this audit.
- Files inspected: full `src/app` route inventory (116 route-bearing files), `src/lib` tree, `src/prototype`,
  `package.json`, `tsconfig`, `eslint.config.mjs`, `next.config.ts`, `.env.example`, CI workflow, root file
  list, FP-17 + referenced specs (FP-00/02/03/04/05/06/09/11.x/12/13/14/16/18/20 + closure reports).
- Commands run: `tsc --noEmit` → CLEAN · `eslint src` → CLEAN (both re-verified this session, read-only).
  NOT run: live-API suites (DB writes), build (prior evidence stands; not needed for a file audit).

## C. Current Architecture Map

- **App Router (§FE-0.1):** layouts: root (`app/layout.tsx`, `lang="en"`, Geist latin) + prototype only —
  no admin layout, no route groups, no parallel/intercepting routes. Pages: `/` boilerplate (NOT-IMPLEMENTED
  storefront), `/admin`, `/admin/login`, `/admin/users` (minimal shell). Prototype: 14 pages under
  `/prototype` (isolated, mock-only). API: 98 `route.ts` (`store/*` + `admin/*` + `health`) + `proxy.ts`
  (`/admin/:path*` cookie-presence UX guard; real authz server-side). `forbidden.tsx` exists. MISSING:
  `template|loading|error|global-error|not-found|middleware` (none in repo — verified by glob).
- **Rendering (§FE-0.2):** production client code = `LoginForm.tsx` only (`useActionState` → `loginAction`);
  everything else RSC by default. Prototype = 18 client files (justified interactivity). `server-only` in
  24/≈40 lib files (verified count). No Suspense, no `"use server"` outside `actions/auth.ts`. No unjustified
  wide client boundary (only client code that exists is interactive by nature).
- **API/data access (§FE-0.3):** NO client, NO fetch wrapper, NO axios, NO baseURL, NO generated types —
  verified by repo-wide grep (zero `fetch(` in `src/`). Patterns observed: RSC → server-only lib → Prisma
  single factory (`lib/db.ts:26`); mutations via Server Action (admin login/logout only) else direct route
  handlers (exercised by tests, no production client caller yet). Envelopes `{data,meta}` / `{error}`.
  No timeout/retry/cache code anywhere. Data-flow per operation = FP-13 §1 (normative, unchanged).
- **Folders (§FE-0.4):** `src/{app,lib,prototype}` ONLY. `lib/` = admin, api, auth, cart, catalog,
  customers, inventory, orders, promotions, replacements, db*.ts (13 domain areas + shared api). No
  components/hooks/types/features/services/api/providers/styles dirs — nothing misplaced because nothing
  exists yet; customer/admin UI overlap: none in production code (prototype keeps `src/prototype/` separate).
  Import cycles: UNVERIFIED (no madge-class tooling; mitigated: tsc + production build pass).
- **State/cache (§FE-0.5):** `useState/useContext` ONLY in prototype (`store.tsx` + pages); server sessions
  (customer 30d, admin 8h — lib code); guest bearers (backend-issued); zero zustand/SWR/storage/cache-directive
  usage (grep-verified; zustand installed-unused per FP-14). FP03-G1 adapter UNBUILT (no `__Host-guest-*`
  cookie code in `src/app` — verified absence). Ownership matrix: UI/form/mock → prototype context (ephemeral);
  session/guest/commerce → server (per FP-14); no client store claims backend truth anywhere.
- **Auth (§FE-0.6):** admin `LoginForm` + `loginAction/logoutAction` + per-route server checks; customer
  phone+password routes; proxy = presence redirect only; guest flows backend-only (per-order header, 90d);
  no OTP (verified absence, per contract); login/logout semantics per FP-13 §4/FP-14 §9 (unchanged).
- **Permissions (§FE-0.7):** 97 guard call sites across admin `route.ts` (`denyUnless` reads /
  `adminOrDeny` / `checkPermission` writes: `orders.view/update/cancel`, `products.*/prices.*`,
  `inventory.view/adjust`, `customers.view`, `promotions.*/coupons.*`, `users.*/roles.*`, `settings.*`,
  `audit_logs.view`). UI-visibility evidence: prototype gates (mock) + D45 rule (docs); production admin
  pages gate via `requireAdmin`/permission checks per FP-13 (pattern cited, not re-audited line-by-line).
  Hiding ≠ enforcement holds (crafted requests fail closed — backend contract).
- **Validation/forms (§FE-0.8):** zod backend-only (zero hits in `src/app` UI); `LoginForm` = native
  (`required`, `type=email`, autocomplete) + server validation via action state; no RHF/yup. Wire-shape
  vs business-rule split holds (no frontend price/stock/coupon math in production code — none exists).
- **Errors (§FE-0.9):** no `error.tsx`/`global-error` (verified absence); per-route try→`fail()` envelopes
  (≈307 `route.ts` catch sites); `forbidden.tsx` for 403; prototype-local notice states. Recovery semantics
  live in contracts (FP-13 §5, EDGE matrices), not in missing boundaries — no invented handling claimed.
- **Analytics/integrations (§FE-0.10):** zero analytics/tracking/monitoring/CDN/CMS/payment/SDK code
  (grep-verified) — all NOT-FOUND, matching MVP decisions (provider OFF, no payment/CMS). Env surface:
  `DATABASE_URL` + `REG_RATE_LIMIT_PHONE_SECRET` only (`.env*` gitignored; values never printed).
- **Types/deps/env/tests (§FE-0.11):** Next 16.3.8 / React 19 / TS strict (0 errors) / ESLint flat+core-web-vitals
  (0 problems) / Tailwind v4 / Prisma 7.10.0 / zod / argon2 / pg / server-only / zustand-unused. NOT present:
  Cairo files, lucide-react, vitest/RTL/playwright/axe configs, sitemap/robots/manifest/SW, `images` remote
  config, CSP, test/typecheck npm scripts (scripts: dev/build/start/lint/postinstall). CI `backend-ci`
  hermetic (typecheck+lint+unit+PGlite+build; live matrix stays local by design).

## D. Contract Alignment (TO-BE = FP-17 A–M; statuses computed from the rows below, not asserted)

| ID | Domain | Contract requirement | Current implementation | Evidence | Alignment | Gap / risk → recommendation |
|---|---|---|---|---|---|---|
| AL-01 | Routes/layouts | FP-03 sitemap + FP-09 IA URL rules | 98 API routes + 4 pages + proxy + forbidden; no storefront pages | Route inventory (§C) | ALIGNED (backend) · NOT-IMPLEMENTED (storefront UI — expected) | None (FE-1 scope) |
| AL-02 | Server/client boundaries | FP-13 §3 RSC-first, actions for auth | LoginForm+auth.ts only; 24 server-only libs; no stray client code | Grep counts (§C) | ALIGNED | None |
| AL-03 | API/data-access layer | FP-13 §3 future `src/lib/storefront/` (PLANNED) | No client/fetch layer (verified absence) | Zero-`fetch` grep | NOT-IMPLEMENTED (expected) | Build per FP-13 at FE-1 (REC-01) |
| AL-04 | Feature/folder structure | FP-00-D061: `(shop)+(account)+admin`, `src/components`, `src/lib/frontend` | `src/{app,lib,prototype}` only; D061 unstarted | Tree (§C) | NOT-IMPLEMENTED (expected) | Adopt D061 at FE-1 (REC-02) |
| AL-05 | State/cache ownership | FP-14 (server truth; no client authority) | No client store; sessions/bearers server-side | Grep (§C) | ALIGNED | None |
| AL-06 | Guest-order adapter | FP03-G1 (planned HttpOnly adapter) | Absent in `src/app` (verified) | Absence grep | NOT-IMPLEMENTED (specified) | Build per §7b at FE-1 (REC-03) |
| AL-07 | Auth flows | FP-13 §4 / FP-14 §9 (phone+password, no OTP, 3 secrets) | Admin action + customer routes; proxy UX-only | Code + contracts | ALIGNED | None |
| AL-08 | RBAC enforcement | 31-key matrix, server gates | 97 call sites, per-op keys | Grep sample | ALIGNED | None |
| AL-09 | Validation split | Wire-shape client, business server | Zod backend-only; native login fields | Grep | ALIGNED | None |
| AL-10 | Error/edge UX | EDGE + FP-11.10 + FP-13 §5 | Per-route envelopes; no `error.tsx`/loading/not-found conventions | Absence verified | PARTIALLY-ALIGNED (handlers exist; conventions don't) | Add conventions at FE-1 (REC-04, LOW) |
| AL-11 | Analytics/privacy posture | Provider OFF; D046 secrecy | Zero tracking code; 2-var env | Grep + .env.example | ALIGNED | None |
| AL-12 | Types/deps/tests | Strict TS, pinned deps, FP-16 strategy | tsc+eslint clean; no runners installed | Runs (§B/G) | ALIGNED (code) · NOT-IMPLEMENTED (test automation — process) | Install per FP-16 at FE-1 (REC-05) |
| AL-13 | Brand/visual/components/content | FP-02/07/08/10/12 + DS | Specs closed; zero production UI to contradict them | File inventory | ALIGNED (no contradiction possible yet) | None |
| AL-14 | Arabic-first shell | `lang="ar"`+RTL at implementation (FP-10) | `lang="en"` + Geist latin (boilerplate kept) | layout.tsx:23 | PARTIALLY-ALIGNED (documented constraint, implementation-owned) | Fix at FE-1 shell (REC-06, LOW) |
| AL-15 | Security headers/CSP | 3 API headers; CSP deferred w/ rule | next.config.ts as specified | File read | ALIGNED | None (page CSP at FE-1 w/ frontend) |
| AL-16 | Import hygiene | No cycles breaking boundaries | UNVERIFIED (no tooling) | tsc+build pass (partial mitigation) | UNVERIFIED | Add check at FE-1 (REC-07, LOW) |

## E. Proposed Architecture (recommendations only — nothing implemented)

Target tree (evidence-based; reuses FP-00-D061, the one authoritative structural decision in force):
`src/app/(shop)/…` + `(account)/…` + `admin/…` + `prototype/` (kept isolated until deploy-exclusion gate);
`src/components/` (design-system primitives + feature components per FP-12 reuse rule);
`src/lib/frontend/` (server-safe fetch helpers, error normalizer, guest-header attach — never importing
server-only DB/RBAC libs into client); `src/lib/*` unchanged (backend authority); colocated
`*.test.*` per FP-16 at FE-1. Per-item rationale/effect/alternative in findings (REC-01…REC-07).
What stays: everything backend (`src/lib`, all `route.ts`, proxy semantics, envelopes, guards);
`forbidden.tsx` pattern; `LoginForm`+`auth.ts` pattern for future auth forms.

## F. Findings & Priorities

| ID | Domain | Description | Evidence | Contract | Severity | Impact | Recommended resolution → files | Decision? | Status |
|---|---|---|---|---|---|---|---|---|---|
| FE0-F01 | Conventions | No `error.tsx`/`loading.tsx`/`not-found.tsx` | Absence verified (§C) | EDGE/FP-11.8.7 | LOW | Inconsistent failure/loading UX at FE-1 | REC-04: add conventions at FE-1 | No | OPEN-FOR-FE-1 |
| FE0-F02 | Shell | `lang="en"` + latin-only font | layout.tsx:2-24 | FP-10 Arabic-first | LOW | SR/pronunciation; documented since FP-10 | REC-06: fix in FE-1 shell | No | OPEN-FOR-FE-1 |
| FE0-F03 | Hygiene | Import cycles uncheckable | No tooling in repo | — | LOW | Hidden coupling risk | REC-07: add check at FE-1 | No | UNVERIFIED |
| FE0-F04 | Deps | zustand installed-unused | package.json + zero-import grep | FP-14 (available) | INFORMATIONAL | None today | Use or drop at FE-1 | FE-1 choice | NOTED |
| FE0-F05 | Prototype | Ships in build; deploy-exclusion is a future gate | Build output + FP-15 report | FP-17 exclusions | INFORMATIONAL | Accidental prod shipping if gate skipped | Honor gate pre-deploy | No | NOTED |
| FE0-F06 | Tests | No runner installed | Root list + package.json | FP-16 strategy | INFORMATIONAL | Automation gap is process, not code | REC-05 at FE-1 | No | NOTED |

No CRITICAL/HIGH. No MISMATCH (nothing implemented contradicts the contract). NOT-IMPLEMENTED items
(AL-01/03/04/06/12) are expected pre-FE-1 scope, each with its REC pointer — not defects.

## G. Verification Evidence

- Executed (safe, read-only): `git rev-parse` + `status` (baseline §B); full glob/grep/read inventory
  (§C counts); `npx tsc --noEmit` → 0 errors; `npx eslint src` → 0 problems.
- NOT executed (with reason): live-API suites (write to scratch DB — audit must not mutate data);
  `npm run build` (prior PASS evidence stands; rebuild adds no audit signal); browser/tooling installs
  (explicitly forbidden); secret/env value inspection (names only, per §C).
- Assumptions: none load-bearing; every gap cell cites presence/absence evidence or is marked UNVERIFIED.

## H. FE-0 Exit Criteria

Map understood ✓ (all 12 domains reviewed) · gaps traceable ✓ (AL + F tables) · proposed map
contract-compatible ✓ (D061-based) · owner input needed: none to start FE-1 (RECs are implementer-scoped;
no product/business choice outstanding in architecture) · undecidable without more evidence: import-cycle
hygiene only (REC-07 tooling at FE-1). **Status: COMPLETE.**

---

*End of FE-0 — audit only; no code, contract, or dependency changed.*
