# FE-1 — Foundation Implementation Report (2026-10-13)

> Specs implemented from the LOCKED contract (FP-17 + FE-0 + FP-10/DS/FP-12/EDGE). No backend/contract
> change, no commit/push, no handoff edit. Production behavior untouched except the documented shell
> upgrades below (all contract-mandated).

## A. Repository Safety

- `D:\Hyper_el-moatasem` · `master` · `83253fe9…` == `origin/master` (before/after).
- Pre-existing state preserved (26 tracked M + prior ?? groups). This task added: `src/components/ui/*`
  (6 files), `src/lib/frontend/*` (api-client + 2 test files), `src/app/{not-found,error}.tsx`, layout +
  globals edits, `vitest.config.ts` + `vitest.setup.ts` + `playwright.config.ts`, 5 unit test files,
  `e2e/foundation.spec.ts`, `package.json`/`package-lock.json` (dependency adds only — versions below),
  this report. No file deleted/renamed; no backend/openapi/schema/config touched.

## B. Existing Foundation Audit

- Found: root layout (en/latin boilerplate), bare globals.css (Geist vars + dark query), 3 admin pages +
  LoginForm/action (kept byte-identical — still passes), no components/api-client/error-states/tests.
- Reused: LoginForm + loginAction + proxy + forbidden pattern (untouched); FP-10 token values verbatim;
  FP-12 component semantics; FP-13 §3 placement (`src/lib/frontend/`); envelope + 9-code taxonomy.
- Built (nothing duplicated): shell i18n/font/tokens, 6 primitives, states set, internal toast, form atoms,
  api-client + normalizer, root error/not-found, metadata foundation.
- Not needed: global-state lib, toast lib, HTTP lib, form lib, Storybook, showcase route (tests suffice),
  dark mode, CMS/analytics/payment code.

## C. Implemented Foundation (real paths)

- `src/app/layout.tsx`: `lang="ar"` + `dir="rtl"`, Cairo (arabic+latin 400–700, swap) + Geist Mono kept,
  title template + brand-promise description, single justified `ToastProvider`.
- `src/app/globals.css`: locked palette + semantic + shape/elevation/motion/z tokens (dark query removed
  per single-theme contract), visible focus, reduced-motion, Cairo-first stack.
- `src/components/ui/`: `button.tsx` (5 variants, 2 sizes, loading+aria-busy, 44px, submit opt-in),
  `field.tsx` (label/required/hint/error + describedby/invalid), `card.tsx` (semantic section/article),
  `states.tsx` (spinner/skeleton/loading/empty/error — empty≠error), `toast.tsx` (4 kinds, live regions,
  manual dismiss, errors persist, max 4, secrets never rendered by construction), `container.tsx`
  (page widths + title scale).
- `src/lib/frontend/api-client.ts`: relative-path-only fetch, envelope parsing per respond.ts, 9-code
  mirror of http-status.ts, `retryable` = 409/429 only, no retry/cache/secrets; `normalizeFailure`
  (abort/network/JSON/HTTP). `src/app/{not-found,error}.tsx`: Arabic surfaces on shared states.

## D. Contract Alignment

Applied: FP-17 K (arch split), FP-10 tokens/type/contrast/motion rules, FP-12 semantics, FP-13 envelopes +
server/client split (type-only code import), FP-14 (no client authority), EDGE/FP-05/06 (no pre-confirm
claims; retryable flags), FP-11.9 (RTL/bdi-ready, 44px, live regions), FP-18 (metadata, no fake domain).
Deferred (specified-future): FP03-G1 adapter build, domain services, CMS/analytics/payment, sitemap/robots
generation, manual AT/field metrics. Zero deviations from locked requirements.

## E. Testing Evidence (all executed this session)

- `npx vitest run`: **22/22 green** (button 5, field 2, states 4, toast 2, api-client 8, axe 1). Two real
  product bugs found BY tests and fixed: Button dropped `onClick` (rest never spread); toast-timer
  assertions needed `act()`. One wrong test target fixed (aria-busy container).
- `npx playwright test` (installed Chrome channel, aut-started dev): **4/4 green** (ar/RTL shell, Cairo
  computed font, admin login render, prototype banner, Arabic 404 with 404 status).
- `npx tsc --noEmit`: clean. `npx eslint src`: clean. `npm run build`: PASS (prototype + admin + root intact).
- Regression: admin/login + prototype + API routes build; no DB/backend writes (foundation tests are
  mocked/DOM-only; e2e is read-only GETs). RTL verified in-render (dir/lang assertions + Arabic queries).

## F. Dependencies

- Pre-existing: Next 16.3.8, React 19, TS strict, Tailwind v4, Prisma 7.10.0, zod, zustand-unused.
- Added (minimal, justified): `lucide-react@1.55.0` (D12 icons for toast/states) + dev
  `vitest@3.2.7` (v5 needs @types/node≥22 — repo pins v20, so v3 pinned instead), `@testing-library/react`
  16, `@testing-library/jest-dom`, `jsdom`, `axe-core@4.14.0`, `@playwright/test@1.64.0` (channel:chrome —
  no browser download). No unrelated version touched (verified diff: additions only).

## G. Known Limitations

- Out of scope by design: storefront/admin features, FP03-G1 adapter build, domain clients, providers,
  payments, CMS/uploads, sitemap/robots files, metadataBase domain (no official domain — documented env need).
- Cairo loads via Google Fonts at build (network-verified this session); offline builds fall back to system
  stack (same CSS, documented).
- Axe gate ≠ WCAG conformance; manual AT + field metrics still required at implementation (stated in tests).
- Toast viewport is global (root) — feature-level policies (which message where) belong to FE-2+ screens.

## H. FE-1 Acceptance Status — `COMPLETE WITH EXPLICIT LIMITATIONS`

Met: shell/i18n/font/tokens/components/states/toast/forms/api-client/errors/a11y/SEO foundations usable +
tested (22 unit + 4 e2e + tsc/eslint/build green) + no regressions + report. Unmet: none required.
Limitations: §G (non-blocking; all pre-classified as specified-future or process).

---

*End of FE-1 report — foundation only; no storefront features built.*
