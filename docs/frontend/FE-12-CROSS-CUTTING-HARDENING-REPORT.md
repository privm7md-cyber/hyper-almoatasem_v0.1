# FE-12 — Cross-Cutting Hardening Report (2026-10-14)

> Audit-first hardening across storefront + admin. Three scoped changes (admin error
> boundary, two noindex fixes, admin axe tests); everything else verified-as-is with
> evidence. Zero backend/contract/DB changes, no commit/push, no handoff edit.

## A. Repository Safety

- `D:\Hyper_el-moatasem` · `master` · `83253fe9…` == `origin/master` (before/after).
- Changed by FE-12: `src/app/admin/error.tsx` (new), `src/app/admin/page.tsx` + `login/page.tsx`
  (robots noindex), `src/app/admin/__tests__/a11y.test.tsx` (new, 3 tests), this report.
- No new dependencies. Untouched: backend/openapi/Prisma/DB, `docs/AGENT-HANDOFF.md`.

## B. Findings & Disposition by Category

### B1. Security UX & protected data — PASS WITH LIMITATIONS
- Guest-order credential: server-only boundary intact — zero `x-guest-order-token` references
  in `src/components` beyond prohibition comments, enforced by existing request-body tests.
- Admin 401/403: fixed in FE-11 (`displayFailure`); storefront auth mapping audited and
  deliberately different (login 401 stays generic anti-oracle — tested; cart handles
  NOT_FOUND/UNAUTHENTICATED distinctly; register maps CONFLICT/RATE_LIMITED) — left intact.
- `forbidden.tsx` + per-page `requirePermission` + login redirect verified; denial screens
  carry no record contents.
- Limitation: live backend-authz enforcement unproven by policy (server-owned).

### B2. Browser storage & privacy — PASS
- Complete inventory (grep): exactly ONE production storage usage —
  `guest-cart-token.ts` (`hyper_cart_guest_token`, cart bearer only, 64-hex validated,
  never order credential/session, exception-safe). No sessionStorage/IndexedDB/cookies-in-JS.
- Login stores nothing client-side (tested: `localStorage.length === 0`); logout preserves
  only the cart bearer deliberately (separate lifecycle, server-scoped).
- No analytics/telemetry vendor exists (grep: sentry/posthog/analytics/gtag = zero) — none
  added; central failure seam documented: `normalizeFailure` in `api-client.ts`.

### B3. Session expiry & multiple tabs — PASS WITH LIMITATIONS
- Logout = server revocation + cookie clear, best-effort client with home navigation.
- No cross-tab invalidation signaling exists: a second tab can display stale protected data
  until navigation/refresh. No false-success risk (every mutation re-verified server-side;
  401s surface distinctly). No polling/ BroadcastChannel added — sessions are HttpOnly and
  invisible to JS, so client coordination would add complexity without a security gain.
- No OTP/reset/linking invented (no backend support — verified absence).

### B4. Race conditions & duplicate submissions — PASS
- 27 single-flight `if (pending) return` guards across every mutation island (admin + store,
  verified by grep); no auto-retry anywhere (`api-client`: "No retry" by design);
  409 = retryable-after-reread flag only, never auto-replayed (checkout documents
  never-blind-retry with a new idempotency key); order creation idempotent server-side.
- Rapid search/filter changes resolve through URL-keyed server renders (no stale-render
  path); no change warranted — no generic locking added.

### B5. API retries, timeouts, error handling — PASS WITH LIMITATIONS
- Classification complete (401/403/404/409/410/422/429/5xx + transport vs HTTP); no retry
  loops possible (no retry code); 429 has no `Retry-After` handling — safe by omission
  (nothing auto-retries); server messages preserved verbatim + FE-11 auth hints.
- Limitation: no read timeout bounds — a stalled network leaves loaders hanging; `AbortSignal`
  is plumbed in `apiRequest` but no caller passes one. Documented; wiring abort-on-unmount
  everywhere is deferred (no measured harm, risk of behavior change).

### B6. Error boundaries & failure isolation — PASS WITH LIMITATIONS
- **Added** `src/app/admin/error.tsx`: admin failures no longer blank the storefront (and
  vice versa); same honesty contract as root (shared `ErrorState`, safe reset, opaque digest,
  "no action was sent" copy). Auth gates (redirect/403) never reach boundaries.
- Covered by new axe test (retry action named). No other route segments — root boundary
  remains the backstop; raw stacks/secrets never rendered (verified pattern).

### B7. Monitoring & analytics — NOT APPLICABLE (deferred infra)
- No integration exists; none added (would need approval + vendor). Local handling only.
- Production implication: errors are user-visible-only, not centrally collected — owner decision.

### B8. Accessibility — PASS WITH LIMITATIONS
- New: axe-clean on admin dashboard, inventory (table+forms+movements), admin error boundary
  (3/3). Pre-existing: axe-clean foundation suite. Shared: `:focus-visible` ring, reduced-motion
  media query, 44px targets, landmarks/labels/roles verified in rendered output.
- Limitation: no manual screen-reader/keyboard-only pass performed here (AT unavailable);
  axe alone is not a conformance claim — stated in test files.

### B9. SEO & privacy boundaries — PASS WITH LIMITATIONS
- **Fixed:** dashboard + admin login metadata lacked `robots` — now `index:false, follow:false`;
  all 21 admin pages noindex (verified by grep). No sitemap/`robots.txt` files exist — none
  fabricated; public SEO rests on per-page titles/metadata; invalid routes → Arabic 404.
- Private surfaces (account/orders/admin) carry noindex; no private data in metadata observed.

### B10. Performance & large catalog — MEASURED IN FE-13
- No new dependencies; FE-11/12 client delta ≈ one pure function + one boundary file.
  Keyset-20 pagination preserved everywhere; no full-catalog client loads (verified pattern).
- Web-Vitals numbers not claimed from dev runs — measurement evidence lives in FE-13.

### B11. Cross-browser & device — recorded in FE-13
- Config supports installed Chrome only (`channel: "chrome"`); other engines NOT TESTED.
  Existing e2e viewport specs (320–1440 classes) re-run in FE-13.

## C. Testing Evidence (FE-12 session)

- New: admin axe suite 3/3 (dashboard, inventory, error boundary).
- Full: vitest **119/119** (24 files: 116 + 3) · `tsc` clean · eslint 0 errors ·
  build PASS · Playwright DB-independent 11/11 (DB-down environment; see FE-11 §G).

## D. Residual Limitations

- Cross-tab staleness display; read-timeout bounds; manual AT pass; monitoring infra;
  non-Chrome engines; live Web Vitals — all named above with impact, none hidden.

## Verdict

**FE-12 = COMPLETE WITH EXPLICIT LIMITATIONS.** Three scoped fixes landed with tests;
eight categories verified-as-is with grep/test evidence; four limitations + one deferred
infra item explicitly recorded. No invented coverage.
