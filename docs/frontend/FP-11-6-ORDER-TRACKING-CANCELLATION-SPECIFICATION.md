# FP-11.6 — Order Tracking & Cancellation UX Specification

> Classification: `RESOLVED — EXISTING CONTRACT` · `ADOPTED — TECHNICAL DEFAULT`.
> Recovered scope (Outcome A): customer order status tracking + customer cancel flow, from FP-04
> journey + frozen order machine + cancel route + FP-11.7 pointers. No invented endpoints or states.
> Specification-only — no implementation.

## 1. Purpose and scope

Covers post-creation customer order tracking display and the customer-initiated cancel experience
for unpicked orders. Non-goals: fulfillment execution, admin operations, realtime tracking,
delivery-provider integration, ticketing/support, replacement execution mechanics.

## 2. Tracking display (read-only snapshots)

- **Guest:** order read via stored `guestOrderToken` (header transport only, never URL) + order id
  from the 201 creation response; 401 invalid/revoked, 410 expired, 404 unknown/foreign — each mapped
  distinctly. No history listing exists (contract absence — never implied).
- **Registered:** own order list (newest-first keyset) + owned detail; foreign ids 404 without leakage.
- **Timeline:** status history + per-line requested/actual quantities + frozen snapshots + business
  `HM-YYYYMMDD-######` number. Short-shipped lines render as short (final 0 at READY per frozen rule),
  never as customer-cancelled. Delivery snapshot display allowed; no ETA/proof invented.

## 3. Customer cancel flow

- Eligible states ONLY: NEW / CONFIRMED / PREPARING-unpicked via `POST /orders/{id}/cancel` (`{}`).
  Picked/further states → 409 with honest message + replacement/support pointers (no fake cancel).
- Explicit confirmation (destructive, irreversible) → single-flight submit → server-confirmed status
  adopted wholesale; 404/409 mapped; no optimistic cancelled state.
- Guest cancel uses the same route under the order credential; session/guest contexts never mixed.

## 4. States, accessibility, acceptance

Loading/skeleton → timeline + cancel affordance (state-gated) → empty (no orders) → 401/404/409/
410-gone states, each with retry-or-next-step; focus management, `aria-live` status announcements,
non-color status cues, RTL Arabic copy.
Acceptance (DEFINED — NOT EXECUTED): tracking renders only from contracted reads; cancel allowed
exactly in unpicked states; 409-picked honest; guest/session separation intact; no realtime,
integration, or proof invented.

---

*End of FP-11.6 — specification-only, no implementation.*
