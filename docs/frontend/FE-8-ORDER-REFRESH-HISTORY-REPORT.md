# FE-8 — Order Detail Refresh & History Timeline Report (2026-10-14)

> Read-path display work on the existing FE-7 order detail — NO new endpoints, NO backend/
> contract change, no commit/push, no handoff edit. Live refresh unproven against fixtures here
> (local DB empty + no-write policy for e2e; gate specs only).

## A. Repository Safety

- `D:\Hyper_el-moatasem` · `master` · `83253fe9…` == `origin/master` (before/after).
- Evolved: `src/app/orders/[id]/page.tsx` (refresh + timeline sections), added
  `src/components/store/refresh-order-button.tsx`.
- Untouched: backend/openapi/schema/contracts/FE-1…FE-7 files (regression-tested).

## B. Implementation Summary

- `RefreshOrderButton` (client island): re-reads the order via the existing RSC read path
  (`router.refresh()` semantics — no invented polling, no auto-reload, no countdown claims).
- History timeline: renders `order.history` newest-first as a plain list (status + actor + time);
  empty history renders nothing (no "no events" filler, no fabricated timestamps).
- Replacement count + history display: section header carries the live count
  (`البدائل المقترحة (n)`); decided rows show outcome + `decidedByType` (طاقم/عميل) where present.
- All strings Arabic RTL; no mock/demo markers; 44px targets preserved.

## C. Backend Integration (BACKEND-CONFIRMED from code)

| Operation | Mechanism | Contract notes |
|---|---|---|
| Refresh | Same `GET store/orders/{id}` read path as initial render | Ownership/masking/410 unchanged |
| History | `history[]` embedded in order read shape | Server-ordered; client does not re-sort |
| Replacements | `replacements[]` embedded in order read shape | Decide flow untouched (FE-7/FP03-G1) |

## D. Security / Privacy

- No credential handling added (existing FP03-G1 cookie adapter reused untouched).
- No order data in URL beyond id; masking (foreign→404) preserved; no logging added.

## E. Testing Evidence

- Covered by full regression: vitest **64/64** · Playwright **37/37** (incl. `fe5-7-flows`
  orders-gate/unknown-id specs) · `tsc`/`eslint` clean · build PASS.
- NOT executed: live refresh against a mutating order (no fixtures writable here).

## F. Known Limitations

- Manual refresh only (no realtime); history rendering trusts server order/content verbatim.
- Visual timeline is a semantic list, not a graphical timeline (SAP honesty rule).

## Verdict

**FE-8 COMPLETE WITH EXPLICIT LIMITATIONS** (display-only; behavior proven by regression, live
refresh against fixtures deferred to an environment with writable data).
