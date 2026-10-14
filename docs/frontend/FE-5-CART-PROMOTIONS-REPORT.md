# FE-5 — Cart & Promotions Report (2026-10-13)

> Read-only cart operations against live contracts; write-paths proven by mocked unit tests only
> (no production writes — local DB untouched). No backend/contract change, no commit/push, no handoff edit.

## A. Repository Safety

- `D:\Hyper_el-moatasem` · `master` · `83253fe9…` == `origin/master` (before/after).
- Added: `src/app/cart/page.tsx`, `src/components/store/cart-view.tsx`, `src/components/store/__tests__/cart-view.test.tsx`.
- Evolved (justified, retested): `src/components/store/store-nav.tsx` (cart link enabled — route now exists),
  `src/lib/frontend/api-client.ts` (+explicit per-request `headers` for the cart bearer).
- Untouched: backend/openapi/schema/FE-1 shell/contracts.

## B. Implementation Summary

- `/cart` (server shell + `CartView` island): read/mutate via route handlers with owner
  (stored `x-guest-token` XOR auto-sent session); full-cart echo adopted wholesale (server truth).
- Operations: set-qty PATCH, remove DELETE, reprice POST, explicit merge POST (server decides; 401 without
  session surfaces login guidance), coupon preview via read-only estimate (reasons surfaced, removal = omit).
- PIECE/WEIGHT lines render unit-aware; totals informational (subtotal) + estimate preview (never final).
- Conflicts: 404/expired → fresh-mint path; validation/stock/409/422 → inline recovery, selection kept.

## C. Backend Integration (all BACKEND-CONFIRMED from code)

| Operation | Endpoint | Payload | Response | Auth | Errors |
|---|---|---|---|---|---|
| Read/mint | `GET`/`POST /api/store/cart` | — | `{cart}` / 201 `{cart, guestToken}` once | Neither→mint; XOR after | 400/401/404 |
| Set/remove | `PATCH`/`DELETE /items/{variantId}` | `{quantity}` / — | `{cart}` echo | Owner | 400/401/404/409/422 |
| Reprice | `POST /reprice` | — | `{cart, reprice:{repriced,dropped}}` | Owner | 404 (+dropped report) |
| Merge | `POST /merge` | — (server-derived target) | `{cart, merge}` | Session + guest token | 401/404/409 |
| Coupon preview | `POST /orders/estimate` | `{lines, couponCode?}` | `{…totals, coupon:{applicable,reason,amount}}` | Owner-agnostic | Per estimate contract |

## D. Security / Privacy

- Cart bearer: namespaced localStorage, header-only, shape-validated (FP-11.4 posture).
- Order credentials: zero touchpoints (grep-verified; separate lifecycle honored).
- Session: HttpOnly cookie, never read/duplicated client-side. No secrets in URL/logs/state.

## E. Testing Evidence

- Vitest `cart-view.test.tsx`: **6/6** (echo render, empty, expiry-mint, set-PATCH payload, coupon-refusal
  honesty, order-credential absence). Full suite: **64/64** with FE-1…FE-4 suites green.
- E2E `fe5-7-flows`: cart fresh-start state green; no cart writes executed live (policy).
- `tsc`/`eslint` clean · `npm run build` PASS · FE-2…FE-4 suites green (no regressions).

## F. Known Limitations

- Live cart mutation unproven against real rows (empty local DB + no-write policy — mocked proof only).
- Merge UX relies on server verdicts (no session detector client-side; 401 guides to login).
- No cart badge in header (no count endpoint — honest omission).

## G. Final Status — `COMPLETE WITH EXPLICIT LIMITATIONS`

Acceptance: guest/registered paths per contract, PIECE/WEIGHT correct, echo-truth totals, conflict-safe
recovery, persistence/merge per rules, zero unintended writes. Unproven live: §F (environmental, documented).
