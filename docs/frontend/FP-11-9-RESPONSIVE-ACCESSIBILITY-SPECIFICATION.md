# FP-11.9 — Responsive Design & Accessibility Review Specification

> Freezes usage requirements across screen sizes and access needs. Changes no business rules.
> Specification-only. Design system: Tailwind defaults (no new numeric breakpoints), locked brand
> tokens, deferred Arabic font (CSS variable only — no font files/dependencies in this task).

## 1. Responsive (mobile / tablet / desktop)

- **Mobile:** key info + primary actions first; no overcrowding/over-shrinking; long tables → cards
  (identifiers preserved) or explicit horizontal scroll with sticky key column; primary actions
  reachable (sticky bars safe-area-aware); sidebar becomes non-blocking drawer (never covering content
  without dismiss).
- **Tablet:** use extra width for readability (2–3 col grids, full tables where they fit per §1
  table→card rule); never force a phone or desktop layout inappropriately (behavioral breakpoints
  from the existing system, no invented px values).
- **Desktop:** full tables/columns + admin density; clear visual hierarchy; no unneeded data;
  sensitive actions visible and reachable (permission-gated per D45).
- Verified basis: existing Tailwind setup + per-phase responsive rules (FP-11.1/11.2/11.4/11.5/11.7/11.8);
  undocumented needs: none found beyond what's specified (any new need → gap entry in FP-11.11 §G).

## 2. Arabic & RTL

- `dir=rtl` document-wide; RTL-consistent menus/fields/nav; text alignment + icon direction by meaning
  (directional icons mirrored; brand/technical symbols never).
- Order numbers, barcodes, mixed IDs: verbatim + `bdi`/unicode-bidi isolation (leading zeros and case
  preserved — §FP-11.8.2 barcode rule applies storefront-wide).
- Prices/quantities/units/numerals legible in tables and forms (exact decimal strings, unit-aware,
  Western numerals + `ج.م` per locked conventions). `direction: rtl` alone is NOT claimed sufficient
  for mixed-script runs — isolation rules above are normative.

## 3. Accessibility

- Labeled fields; named buttons (icon-only included); errors as TEXT (never color-only); visible
  keyboard focus; text/background contrast from locked pairs (`#FF7100` never body-text on white);
  44px mobile touch targets; understandable loading/success/failure announcements (`aria-live`,
  `aria-busy`); logical keyboard order; focus-to-error/success; important errors announced to AT;
  statuses never color-only (icon + text for stock/order/promo/pick states).
- WCAG referenced for evaluation only — no conformance level claimed without testing evidence.
- **Fonts:** single CSS font variable for future Arabic-font swap; no final Arabic font adopted, no
  font files/dependencies added here.

## 4. Acceptance criteria (DEFINED — NOT EXECUTED)

- 3 size classes behave per §1 (drawer non-blocking verified by interaction, tables→cards with IDs).
- RTL/mixed-script rules per §2 on every FP-11 screen family.
- All §3 requirements present; no WCAG level claimed. Font variable exists; no font shipped.

---

*End of FP-11.9 — specification-only.*
