# FE-10E — Admin Promotions & Coupons Report (2026-10-14)

> Promotion/coupon CRUD shells mapped 1:1 to contracted endpoints; discount math stays
> server-side (UI shows `estimatedDiscount` / `finalDiscount ?? estimatedDiscount` strings).
> No backend/contract change, no commit/push, no handoff edit.

## A. Repository Safety

- `D:\Hyper_el-moatasem` · `master` · `83253fe9…` == `origin/master` (before/after).
- Added: `src/app/admin/{promotions,promotions/[id],coupons,coupons/[id]}/page.tsx`,
  `src/components/admin/{promotion-forms,coupon-forms,coupon-patch-form}.tsx`.
- Fixed live: coupon-usage `discountAmount` → contracted `finalDiscount ?? estimatedDiscount`.
- Untouched: backend/openapi/schema/storefront/FE-10A–D files (regression-tested).

## B. Implementation Summary

- Promotions: keyset list (active filter where contracted) + detail with patch form
  (name/window/priority/active per `promotionPatch` contract) + create/delete via `AdminAction`.
- Coupons: list + detail with usage feed (order-linked rows, exact-string discounts, no math),
  patch form (per `couponPatch` contract), create/delete; usages read-only (`…/[id]/usages`).
- Rule builders NOT invented: conditions/effects edited only through contracted fields;
  unsupported rule shapes render as read-only (no fake editors).

## C. Backend Integration (BACKEND-CONFIRMED from code)

| Operation | Endpoint family | Contract notes |
|---|---|---|
| Promotions | `GET/POST /api/admin/promotions`, `GET/PATCH/DELETE …/[id]` | `promotions.view/manage` |
| Coupons | `GET/POST /api/admin/coupons`, `GET/PATCH/DELETE …/[id]` | `coupons.view/manage` |
| Usages | `GET …/coupons/[id]/usages` (keyset, read-only) | Guest-order rows have NULL customer |

## D. Security / Privacy

- Write gates re-verified server-side; coupon codes displayed (operator-owned secrets, per
  contract — never logged); no discount computation client-side.

## E. Testing Evidence

- `tsc`/`eslint` clean · build PASS (all 4 routes compile) · vitest **64/64** ·
  Playwright **37/37**.
- NOT executed: live promotion/coupon writes (forbidden here).

## F. Known Limitations

- No campaign analytics (no aggregate source — same honesty rule as dashboard).
- No coupon bulk-generate UI (no contracted endpoint — verified absence).

## Verdict

**FE-10E COMPLETE WITH EXPLICIT LIMITATIONS** (contract-mapped shells; live promo ops
deferred to a fixture-capable environment).
