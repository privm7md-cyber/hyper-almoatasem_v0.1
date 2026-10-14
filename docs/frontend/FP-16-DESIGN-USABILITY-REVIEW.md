# FP-16 — Design & Usability Review (Prototype-Based, Static + Render-Verified)

> Method: static code review of all 19 prototype files + dev-server render checks (HTTP + banner/content
> markers via curl). NO browser tooling exists in repo (no playwright/puppeteer — verified absence), so no
> viewport screenshots, interaction runs, or measurements were performed; viewport claims below are
> code-inspection only and labeled as such. Heuristic judgments are estimates, not measurements.

## 1. Coverage reviewed

Customer chain (home → category → product PIECE/WEIGHT/OOS → cart → checkout guest → confirmation → order +
replacement approve/reject), admin chain (login ok/fail → dashboard gate → catalog incl. empty → inventory
adjust + invalid → orders → order detail incl. 403 demo), 16 scenarios, demo-state toggles, reset paths.

## 2. Findings register

| ID | Screen | Location | Problem | Repro | Current | Expected (contract) | Severity | Task impact | Disposition | Action | Retest |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FP16-F01 | All (header) | layout.tsx brand line | Orange `#FF7100` small text on white (2.76:1 — FAILS FP-10 body-text rule) | Open any screen | Orange "(تجريبي)" | Text-orange `#C2410C` (5.18:1) | HIGH (contract breach) | Readability | FIXED-IN-PROTOTYPE | Hex → `#C2410C` | tsc/eslint/build/curl 6/6 banner ✓ |
| FP16-F02 | Home/cart/confirmation | 3 links wrapping `<button>` | Nested interactive (`<a><button>`) — invalid HTML, SR/keyboard hazard | Inspect/button-tab | Nested | Styled link, no nesting | HIGH | A11y correctness | FIXED-IN-PROTOTYPE | Links styled as buttons directly | Same suite ✓ |
| FP16-F03 | Category/product/orders links | Inline text links | Touch targets < 44px on mobile | Inspect small viewport (static) | Inline links | ≥44px targets or padded hit areas | LOW | Mobile ease | DOCUMENTED-LIMITATION (primary CTAs already ≥44px; text links unchanged in mock) | None (documented) | N/A (static) |
| FP16-F04 | Weight PDP | Custom grams input | No client-side stock cap (huge grams accepted in mock) | Type 99999 | Accepted locally | Server 409 in production; mock disclaims | MEDIUM (mock fidelity) | Could mislead reviewer | DOCUMENTED-LIMITATION (scope: mock mirrors step rule only; stock caps are server truth) | None | N/A |
| FP16-F05 | Cart clear | Clear action | No confirm dialog (FP-06 D09 advisory) | Tap clear | Instant clear | Confirm per advisory | LOW | Accident risk | DOCUMENTED-LIMITATION (advisory, not locked) | None | N/A |
| FP16-F06 | Admin inventory | Qty input | No PIECE/WEIGHT step enforcement in mock demo | Type decimals | Accepted | Envelope/step in production | MEDIUM (mock fidelity) | Same as F04 | DOCUMENTED-LIMITATION | None | N/A |
| FP16-F07 | All | Root `<html lang="en">` | Screen readers get wrong language default (prototype sets `dir`+`lang="ar"` on wrapper only) | Inspect HTML | lang en | lang ar at implementation | MEDIUM | SR pronunciation | DOCUMENTED-LIMITATION (shared boilerplate; not changed — production work) | None | N/A |
| FP16-F08 | Viewports | All screens | No viewport testing executed (no browser tooling) | N/A | Static classes only | 360/390/768/1280 checks | OWNER-DECISION (process) | Unknown responsive defects | DOCUMENTED-LIMITATION | None in this task | Not performed |

Clarity/price/weight/cart/checkout/confirm/admin walkthroughs (§§10–11 checklist): PASS by inspection — names +
units explicit; OOS text-based (never color-only); compare-at labeled reference-only; badges labeled scenario;
weight presets + step errors + estimate disclaimers present; add-to-cart 44px + mock feedback; empty-cart guidance;
guest-no-account explicit; no forced OTP; fees labeled mock; confirmation vs tracking separated; replacement
awaiting/approve/reject distinct; no credentials shown; admin mock-labeled; forbidden demo explicit; no visual
clutter blocking tasks (heuristic estimate).

## 3. Mobile/Desktop/RTL check (static, sizes NOT executed)

Inspected for: horizontal overflow (flex-wrap + max-widths + no fixed-wide tables — none found), price/CTA
clipping (min 44px CTAs; inline links per F03), focus (native controls; default visible focus — no custom ring
in mock), tab order (DOM order = visual RTL order), mixed-script (prices/units as plain strings; no bidi
isolation spans in mock — noted: production needs `bdi` per FP-11.9; added as F09 LOW below), status non-color
cues (text in all states ✓), labels/validation text (Field + role=alert ✓), dialogs/sheets (none in mock except
admin drawer absence — N/A), sticky regions (none).
F09-LOW: mock lacks `bdi` isolation on mixed runs — DOCUMENTED-LIMITATION (production rule stands in FP-11.9).

## 4. Retest evidence

tsc CLEAN · eslint CLEAN · `npm run build` PASS (14 prototype routes) · dev-server 6/6 banner-present 200s
(home, weight PDP, cart, checkout, order, admin order) · server stopped (Node 0). No browser/AT/zoom/measurement
executed (tooling absent — stated, not implied).

## 5. Acceptance (per §14)

Customer + admin chains reviewed as far as tooling allows · weight/promo/guest/replacement reviewed ·
mobile/desktop/RTL reviewed statically with sizes unexecuted (documented) · defects registered with severity +
repro · F01/F02 fixed + re-verified · open items stay explicit · no contract file edited to fake success ·
no WCAG/interview/measurement claims.

## 6. Closure addendum (closure task 2026-10-13 — final states, all evidenced)

| ID | Prior state | Re-verification / action | Final state |
|---|---|---|---|
| F01 (orange text) | FIXED | Hex `#C2410C` confirmed in layout.tsx:35 + render (text-orange heading in captures) | FIXED-AND-RETESTED |
| F02 (nested buttons) | FIXED | Precise `<Link>…</Link>`-block scan: 0 nested buttons across 19 files | FIXED-AND-RETESTED |
| F03 (link targets) | DOCUMENTED-LIMITATION | Fixed: global `.proto-main a` hit-area rule (layout `<style>`); re-shot 390 clean | FIXED-AND-RETESTED |
| F04/F06 (mock fidelity) | DOCUMENTED-LIMITATION | Kept: mock scope by design (server truth stands); no mock change that could imply authority | ACCEPTED-MVP-LIMITATION |
| F05 (clear confirm) | DOCUMENTED-LIMITATION | Kept: FP-06 D09 advisory, mock simplification | ACCEPTED-MVP-LIMITATION |
| F07 (root lang) | DOCUMENTED-LIMITATION | Kept: shared production boilerplate; change belongs to implementation, not prototype | ACCEPTED-MVP-LIMITATION |
| F08 (viewports) | OWNER-DECISION (process) | CONVERTED to executed evidence: Chrome headless + CDP emulation, captures at 320/375/390/768/1280/1440 inspected (no overflow/clipping/overlap; RTL/prices/badges legible) + 3 CDP click-proofs (weight-add notice, checkout field errors, replacement reject) | FIXED-AND-RETESTED (method noted: no AT/users/traffic) |
| F09 (bdi) | DOCUMENTED-LIMITATION | Fixed: `<bdi>` on customer price runs (home/PDP/cart/order lines); admin density out of mock scope | FIXED-AND-RETESTED |

Viewport evidence set: `cdp-320-home`, `cdp-375-home`, `fix-390p`, `cdp-390-checkout/order`, `v768-cat`,
`v1280-home`, `v1440-home` (inspected ✓) + `act-add3/checkout3/reject3` interaction proofs (EVAL-verified
CLICKED-BOTH/SUBMITTED/REJECT-CLICKED with matching UI states). Environment note: headless Chrome clamps
plain `--window-size` below ~500px — sub-500 captures used CDP device emulation (documented method, honest
evidence). Shots live outside the repo (Temp dir) by design — no binary bloat committed.

---

*End of FP-16 review — prototype review only; production UX NOT validated.*
