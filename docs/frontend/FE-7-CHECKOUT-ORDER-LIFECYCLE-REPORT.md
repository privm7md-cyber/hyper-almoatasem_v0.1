# FE-7 — Checkout, Order Placement & Order Lifecycle Report (2026-10-13)

> Write-paths proven by mocked unit tests + contract audit only — NO live order/user/address creation
> (local DB untouched; empty local DB verified). No backend/contract change, no commit/push, no handoff edit.

## A. Repository Safety

- `D:\Hyper_el-moatasem` · `master` · `83253fe9…` == `origin/master` (before/after).
- Added: `src/app/actions/orders.ts` (FP03-G1 minimal adapter: place/cancel/decide),
  `src/lib/frontend/order-reads.ts`, `src/app/{checkout,order-confirmation/[id],orders,orders/[id]}/page(s)`,
  `src/components/store/{checkout-flow,order-actions}.tsx`, `src/app/actions/__tests__/orders.test.ts`.
- Evolved: `store-nav.tsx` (orders link enabled — routes now exist).
- Untouched: backend/openapi/schema/contracts/FE-1…FE-6 files (except nav wiring, retested).

## B. Implementation Summary

- `/checkout` (server shell + flow island): identity probe (session → saved addresses + default select;
  guest → inline city/phone/name form, no account creation); cart review from live echo; coupon +
  delivery fee via read-only estimate preview; NO payment step (no contract fields — verified absence);
  totals labeled estimate until creation.
- `placeOrder` server action: XOR-validated payloads, same-origin guard, endpoint-routed creation with
  session-cookie passthrough + cart-bearer header, idempotency key (stable per identical terms,
  regenerated on terms change), guest credential captured into `__Host-guest-order-<uuid>` (HttpOnly,
  Lax, Path=/, ≤90d) and NEVER returned/logged; replay resolves without credential (keep-same);
  transport failure stays ambiguous (no blind retry/new key).
- `/order-confirmation/[id]`: rendered ONLY from a readable order (id-only path); gated guidance otherwise.
- `/orders` (session list, newest-first; guests get login guidance — no phone listing) + `/orders/[id]`
  (dual-policy detail: items req/actual, finals, address snapshot, replacements with decide buttons,
  cancel where unpicked; 401/410/404 states distinct; no GPS/ETA/live claims).

## C. Backend Integration (BACKEND-CONFIRMED from code)

| Operation | Endpoint / mechanism | Contract notes |
|---|---|---|
| Estimate | `POST orders/estimate {lines,couponCode?}` | Read-only; `{subtotal,discountTotal,deliveryFee,total,coupon,lines,freeLines}` |
| Create | `POST orders` via adapter | XOR payloads; body key; 201 + one-time `guestOrderToken` / 200 replay; 400/401/404/409/422/429 |
| Read/list | Direct lib reads (RSC pattern) mirroring `GET orders[/{id}]` semantics | Ownership/masking/410 preserved |
| Cancel | Adapter → `POST …/cancel` | Unpicked-only; 409 picked; actor recorded |
| Decide | Adapter → `POST …/decide {action}` | approve/reject; 409 decided/race |
| Guest credential | HttpOnly order cookie → `x-guest-order-token` (adapter/server reads) | 90d; never URL/JS/storage/logs |

## D. Security / Privacy

- Raw guest credential: server-side only (creation capture → HttpOnly cookie); zero client/URL/log
  touchpoints (grep-verified); order-id-only paths; masking (foreign→404) preserved; no auto-linking
  of guest orders on later registration (no such call); cart/order/session secrets never interchanged.

## E. Testing Evidence

- Vitest adapter suite: **4/4** (cookie custody + flags, non-return of secret, replay-without-credential,
  ambiguous-transport, local XOR rejection with zero fetch).
- E2E `fe5-7-flows`: checkout-empty, orders-gate, unknown-id handling, viewports — green (8/8 with FE-5/6).
- Full: **64/64** unit · e2e **30/30** · `tsc`/`eslint` clean · build PASS · FE-1…FE-4 suites green.
- Caught & fixed live: `"use server"` sync-export build error; confirmation gating parity.
- NOT executed: live creation/cancel/decide (would write data — forbidden; mocked + contract proof only).

## F. Known Limitations

- Live order lifecycle unproven end-to-end here (empty DB + no-write policy); re-run where fixtures exist.
- Adapter loopback URL derives host per request (documented; dev/prod proto rule inside).
- No payment/tender selection (no contract — out of scope, no COD claim).
- Replacement staff-side propose flows stay admin/backend-side (customer decide only, per scope).

## G. Final Status — `COMPLETE WITH EXPLICIT LIMITATIONS`

Acceptance: guest/registered checkout, address rules, coupon/fee preview, idempotent guarded placement,
ambiguous-safe recovery, confirmation gating, dual-policy reads, cancel/decide wiring, honest states.
Unproven live: §F (policy-driven, documented).
