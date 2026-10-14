# FP-11.8.7 — Admin Common States UX Specification

> Unified state model for all admin screens (supplements FP-11.8 §17 with per-state contracts).
> Specification-only. Backend authoritative in every row.

## 1. State matrix (minimum required)

| State | What the user sees | Can continue? | Refetch? | Retry safe? | Could it have executed? | Preserved for retry |
|---|---|---|---|---|---|---|
| `Loading` | Clear skeleton/spinner; screen usable except in-flight control | Partially | No | N/A | No | Form input |
| `Empty` | `لا توجد بيانات` + filter-vs-system emptiness distinguished where provable (filters active → filter-empty; else system-empty) | Yes | No | N/A | No | Filters |
| `Error` | Understandable message + retry where safe/relevant | Yes | Optional | Only idempotent reads | No | Input + filters |
| `Unauthorized` (401) | Login prompt; no data/actions shown; session flow | After login | Yes | Yes | No | Non-sensitive input |
| `Forbidden` (403) | `غير مصرح` + back-to-dashboard; stale grants → session refresh + UI re-evaluation | Yes | Session + record | No (must not re-fire to "test") | No | Input |
| `Not Found` (404) | `غير موجود أو غير متاح` from actual response (unknown≡foreign, never leaked) | Yes | No | N/A | No | List state |
| `Validation` (400/422) | Field/action-bound Arabic errors where details suffice | Yes | No | After fix only | No | Full form |
| `Conflict` (409) | State/constraint message + authoritative re-read + updated view; never blind overwrite | Yes | Mandatory | Only after re-read + user confirm | No (rejected) / race-loser rules per flow | Input where safe |
| `Success` | Confirm ONLY after backend 200/201, then trusted re-read rendered | Yes | Done | N/A | Yes (confirmed) | — |
| `Network Timeout` | `لم نتأكد من النتيجة` — neither success nor failure assumed | Limited | Mandatory first | ONLY via safe mechanism below | **Yes — must assume possible** | Key/context |

## 2. Timeout & sensitive-operation rule

After an ambiguous timeout on a mutating admin call (adjust/cancel/pick/propose/password/grant):
1. Re-read authoritative state FIRST (record/session). 2. Resubmit ONLY if the effect is absent AND
the operation is idempotent or explicitly re-armed by the contract (adjust-by-delta is NOT idempotent —
re-read deltas, never blind-fire). 3. No invented Idempotency-Key or dedup mechanism (none contracted
for admin mutations — stated, not worked around).

## 3. Per-sensitive-operation mapping

| Operation family | Sensitive states & deltas |
|---|---|
| Orders/fulfillment (§FP-11.8.3) | 409-gate → pending list; timeout → re-read order before re-fire; cancel → single-arm only |
| Promotions/coupons (§FP-11.8.4) | 409-duplicate → fix identity; disable irreversible-notice; usages read-only |
| Users/roles (§FP-11.8.5) | 403-ceiling/409-last-admin → no retry-as-escalation; password → body-only secret discipline |
| Catalog/pricing/inventory (§FP-11.8.2) | 409-UQ/predicate → fix + refetch; no optimistic price/stock |

## 4. Acceptance criteria (DEFINED — NOT EXECUTED)

- All 10 states implemented per matrix (6 questions each answered in behavior).
- Timeout rule per §2 (no blind resubmit of deltas/cancels/picks; re-read-first).
- Per-family deltas per §3. D45 + FP-11.8 §17 consistent; Arabic RTL/a11y throughout.

---

*End of FP-11.8.7 — specification-only.*
