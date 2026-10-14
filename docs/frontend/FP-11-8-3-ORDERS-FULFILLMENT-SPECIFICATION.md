# FP-11.8.3 — Admin Orders, Fulfillment & Replacements UX Specification

> Classification: `SUPPORTED` / `UNSUPPORTED` / `UNVERIFIED` per §3 of the task.
> Specification-only — no implementation, no backend change, no approval claimed.
> Architectural rule: the backend is authoritative for data, prices, discounts, inventory,
> transitions, permissions, and commercial validity. D43/D45 (FP-11.8) apply throughout.

## 1. Order list screen (`orders.view`)

- **Data per row (all server-returned):** business `orderNumber` (`HM-YYYYMMDD-######`, display hero —
  UUID internal/support-only) · `createdAt` ISO → localized · customer snapshot
  (`customerNameSnapshot/customerPhoneSnapshot`; guest rows show inline contact — never invent a
  customer link for `customer_id NULL` orders) · `itemCount` per system definition (order-items rows
  incl. free lines as returned) · authoritative `totalEstimated` (never recomputed client-side) ·
  `status` (frozen names §3) · open-details action.
- **Search/filter (server-side only):** order-number search, customer search, `status` filter, date
  range (`dateFrom/dateTo`, inverted→400), keyset cursor pages (`limit`, `nextCursor|null`), refetch,
  criteria preserved on return-from-details (filters/sort in URL; cursor refetched from start).
  SUPPORTED: status/date/cursor per `adminOrderListQuerySchema` + store-verified list shape. No filter
  may depend on downloading all orders or on current-page-only data. UNSUPPORTED: totals/pagination
  counts, arbitrary text search beyond contracted fields (documented, not simulated).

## 2. Order details screen (`orders.view`)

- **أ. Order data:** number, `createdAt/updatedAt`, status, customer snapshot (name/phone), delivery
  snapshot block (`deliveryCity/Area/Village/Street/Building/Landmark/Phone` — immutable history,
  never live-address lookups), guest vs registered kind flag (credential-gated reads stay out of admin
  impersonation — admin views via `orders.view`, never as the customer).
- **ب. Items:** per-row product/variant names (snapshots), requested vs actual quantities, `unitSnapshot`,
  `unitPrice`, `estimatedTotal`/`finalTotal` (null until fulfillment sets them), `itemStatus`
  (PENDING/picked/UNAVAILABLE/REPLACED per frozen pairs), replacement link/state where present.
- **ج. Totals:** `subtotalEstimated`, `discountTotal`, `deliveryFee` (server-read), `totalEstimated`;
  later `subtotalFinal/totalFinal` when fulfillment sets them. Displayed as returned; display-only
  derivations labeled as such. No new total formula invented.
- **د. Actions:** every action below gated by §3 table (permission + state); hidden-by-default without
  permission (D45); disabled-with-reason on business-state block; 403/409 mapped; single-flight;
  success only on confirmed response + authoritative re-read.

## 3. Status machine (verified names — task shorthand corrected)

| Current | Proposed action | API support | Availability conditions | Server result |
|---|---|---|---|---|
| NEW | confirm (implicit at creation) | Creation tx (no UI action) | — | CONFIRMED |
| NEW/CONFIRMED | admin cancel | `POST …/cancel` (`orders.cancel`) | Unpicked lines only | CANCELLED + holds released once |
| CONFIRMED | prepare | `POST …/prepare` (`orders.update`) | — | PREPARING |
| PREPARING | pick line | `POST …/items/{itemId}/pick {actualQuantity}` (`orders.update`) | R7 envelope + step rules; PREPARING-only actuals | Line actual set |
| PREPARING | mark unavailable | `POST …/unavailable` (`orders.update`) | Short-ship rule L1 | Line UNAVAILABLE (+ replacement option) |
| PREPARING | propose replacement | `POST …/items/{itemId}/replacements` (`orders.update`) | Link-only, never overwrite | PROPOSED |
| PROPOSED | withdraw | `POST /replacements/{id}/withdraw` (`orders.update`) | PROPOSED-only | Withdrawn (409 if decided) |
| PREPARING | ready | `POST …/ready` (`orders.update`) | R2 gate: zero pending-pickable AND zero live PROPOSED | READY_FOR_DELIVERY |
| READY_FOR_DELIVERY | dispatch | `POST …/dispatch` (`orders.update`) | Sequential | OUT_FOR_DELIVERY |
| OUT_FOR_DELIVERY | deliver | `POST …/deliver` (`orders.update`) | Sequential | DELIVERED (terminal) |
| PREPARING | admin cancel | `POST …/cancel` (`orders.cancel`) | Unpicked-only; picked → 409 | CANCELLED |

**Name correction (recorded discrepancy):** the task's `READY` / `OUT_FOR_DELIVERY` shorthand is NOT
contractual — frozen names are `READY_FOR_DELIVERY` and `OUT_FOR_DELIVERY`
(`orders/state-machine.ts:12-18`; transitions `:24-31`). UI copy may abbreviate in Arabic labels but
must send/expect the frozen names. No invented transitions; unproven rows marked UNVERIFIED (none —
all rows above are SUPPORTED).

## 4. Preparation screen

- Per-line states from `itemStatus` + replacement state: requested (PENDING) / picked (actual set) /
  unavailable (UNAVAILABLE) / replaced (REPLACED) / proposed (linked PROPOSED). Quantities with
  `unitSnapshot`; WEIGHT actuals in variant `sizeUnit` decimal strings (no float); replacement info
  inline per line where linked.
- **Ready rule:** R2 gate evaluated server-side (`evaluateReadyGate`) — UI shows live counts
  (pending-pickable N, live-proposed M) but NEVER declares ready locally; `ready` 409 → re-read +
  show what's still pending. No local inventory reserve/commit accounting (backend owns holds).
- Refetch on any fulfillment mutation; stale 409 → authoritative re-read + conflict message.

## 5. Unavailability & replacements (short-ship L1 preserved)

- Original line → UNAVAILABLE → optional linked proposal (substitute variant/qty/price from contracted
  fields) → states PROPOSED → CUSTOMER_APPROVED / CUSTOMER_REJECTED / AUTO_ACCEPTED
  (`replacements/state-machine.ts:10-24`; terminal, no further transitions).
- Customer decide happens on storefront credentials (customer session / guest order token) — admin UI
  NEVER approves as customer (no impersonation). Admin surfaces: propose, withdraw, auto-accept
  preference (`POST …/auto-accept`), list/detail reads.
- No approval shown before server confirm; no new final price before the confirming operation;
  no invented replacement states; stage limits honored (decide only while PROPOSED; 409 thereafter).
- L1 business rule restated (not altered): unavailable-without-substitute ships short; the order
  completes without the line per backend rules — never a full-order block invented by the UI.

## 6. Acceptance criteria (DEFINED — NOT EXECUTED)

- List rows show only server fields; orderNumber hero; filters server-side; no full download; no counts.
- Details sections أ–د per contract; snapshots immutable; totals as returned.
- All 11 transition rows behave per table (incl. 409 illegal/repeat + re-read).
- Preparation states/gate/weighing per §4; ready never declared locally.
- Replacement lifecycle per §5; no impersonation; L1 preserved.
- D45 action visibility; single-flight; confirmed-success-only; Arabic RTL/a11y.

---

*End of FP-11.8.3 — specification-only.*
