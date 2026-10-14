# FE-9 — Replacement Proposal Display Report (2026-10-14)

> Display-only sequencing/pricing/decider rendering on the FE-7/FE-8 order detail — NO new
> endpoints, NO backend/contract change, no commit/push, no handoff edit. The decide adapter
> (`decideReplacementAction`) is FE-7's; FE-9 adds zero wire behavior.

## A. Repository Safety

- `D:\Hyper_el-moatasem` · `master` · `83253fe9…` == `origin/master` (before/after).
- Evolved: `src/app/orders/[id]/page.tsx` (proposal rows), verified
  `src/app/actions/orders.ts:decideReplacementAction` (unchanged, `{action: decision}` body).
- Untouched: backend/openapi/schema/contracts/FE-1…FE-8 files (regression-tested).

## B. Implementation Summary

- Sequential proposal rows: `replacements[]` rendered in server order (proposal sequence is
  server-owned; client does not renumber or reorder).
- `priceDifference` display: shown only when non-zero (`!== "0.00"` — exact string comparison,
  no float math, no invented "free/same-price" badges); currency label `ج.م`, `<bdi>`-wrapped.
- `decidedByType` rendering: decided rows show `القرار: طاقم/عميل`; PROPOSED rows show decide
  buttons instead (no decider label invented for undecided rows).
- Decide buttons unchanged (approve/reject → adapter → typed errors; 409 decided/race surfaced).

## C. Backend Integration (BACKEND-CONFIRMED from code)

| Operation | Endpoint / mechanism | Contract notes |
|---|---|---|
| Decide | `POST …/replacements/{rid}/decide {action}` (FE-7 adapter, untouched) | approve/reject; 409 decided/race |
| Display | Embedded `replacements[]` fields only | No new fields consumed |

## D. Security / Privacy

- No change to credential flow, masking, or logging. Zero client-side price computation.

## E. Testing Evidence

- Adapter unit suite (`src/app/actions/__tests__/orders.test.ts`) **4/4** incl. decide path;
  full regression vitest **64/64** · Playwright **37/37** · `tsc`/`eslint` clean · build PASS.
- NOT executed: live propose→decide round-trip (no writable fixtures here).

## F. Known Limitations

- Price formatting trusts server strings verbatim (no locale rounding — SAP honesty rule).
- No per-unit delta breakdown (no contract fields — verified absence, not omitted).

## Verdict

**FE-9 COMPLETE WITH EXPLICIT LIMITATIONS** (display-only; live round-trip deferred to a
fixture-capable environment).
