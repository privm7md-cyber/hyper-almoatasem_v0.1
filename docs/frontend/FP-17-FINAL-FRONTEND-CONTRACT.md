# FP-17 — Final Frontend Contract (Assembly, NOT a Rewrite)

> Purpose: single assembly point for the implementation-ready frontend contract. Scope: everything below
> by REFERENCE (file + section); new prose only where a gap/decision needs recording. Date: 2026-10-13.
> Verified in this stage: prototype execution (FP-15) + static review (FP-16) + doc consistency re-check.
> NOT verified: runtime production behavior, measurements, owner approvals listed in §OPEN.
> Status: **FRONTEND CONTRACT = LOCKED** (closure task, 2026-10-13 — see Closure Decision Log).
> Meaning: V1 scope + specs are consistent and approved as the future-implementation reference, with the
> explicit exclusions listed below. NOT production completion, NOT adapter built, NOT measured.

## A. PRODUCT CONTRACT → FP-05 (§§3–9: units PIECE/KG/GRAM, variant identity, price/stock authority,
> estimates non-final) + FP-11.8.2 (L3 boundary) + FP-02 (units table). Frontend displays; backend decides.

## B. UX CONTRACT → FP-03 (sitemap/registries/nav/guest-credential FP03-G1) + FP-04 (J1–J9 journeys,
> guest-vs-registered matrix, idempotency) + FP-09-IA (URLs/cursors) + FP-11.x (screens). Confirmation ≠
> tracking; login never auto-merges/links; guest flows per FP03-G1.

## C. BUSINESS UX CONTRACT → FP-05 (cart/price/promo/coupon/weighted/4b/9b/10b/11b/13b matrices,
> D14 approved copy) + FP-04 §17. Open/non-supported items stay explicit (feed/sort/autocomplete/OTP).

## D. OPERATIONS CONTRACT → FP-06 (§§5b–21b: 7 states, R2 gate, short-ship, re-propose sequence,
> totals rule, no-settlement/no-tracking/no-assignment) + FP-11.8 family. No invented transitions/perms.

## E. BRAND CONTRACT → FP-02 (positioning/axes/promise/differentiation/no-gos) + BRAND-STRATEGY-v1
> (LOCKED source). Banned claims list binding (cheapest/fastest/best, fake urgency/discounts).

## F. DESIGN SYSTEM → FP-10 (palette/tokens/type/spacing/radius/icons-pending/a11y) + FP-08 (mark rules,
> photo doctrine) + DESIGN-SYSTEM-SPECIFICATION (added tokens/components) + FP-12 (inventory).
> Pending approvals stay pending (font D01/D02, neutrals D06, icons D12, logo asset D16).

## G. SCREEN SPECIFICATIONS → FP-03 §5 registry (30 screens, 22 fields) + FP-11.x detail specs.
> States/access/responsive/RTL/SEO/analytics/privacy per screen as registered.

## H. CONTENT / MEDIA CONTRACT → FP-07 (field truth, per-type media, home sourcing, CMS-absent matrix,
> quality matrix, copy register) + FP-17-IMAGES (source policy). Mock-content bounds per FP-15 banner rule.

## I. ACCESSIBILITY / RTL CONTRACT → FP-11.9 + FP-10 §§9/20 + DS §?/FP-12 + FP-16 §§2–3 (review limits).
> Tested: static + render only; NOT tested: viewports, AT, zoom, WCAG conformance.

## J. SEO / PERFORMANCE / ANALYTICS / PRIVACY → SEO-ANALYTICS-PRIVACY-SPEC (URLs/budgets/events/privacy)
> + FP-18 (vitals/security/boundary) + FP-00-D037 (taxonomy locked, provider Q003 open) + FP-16 §9.
> Budgets are targets; no SDK/consent-manager implemented; legal review open.

## K. TECHNICAL ARCHITECTURE → Next 16.3.8 + React 19 + Tailwind v4 + Prisma 7.10.0 (verified
> package.json); RSC-first reads, route-handler mutations (FP-13 §3); server-only boundary (~25 modules);
> sessions (customer 30d/session-cookie, admin 8h) + guest bearers + FP03-G1 adapter (PLANNED, not built);
> prototype (`/prototype`, `src/prototype/`) isolated from production flows. Deps: no additions in this
> task (zustand present-unused; no test/browser packages).

## L. ERROR / EDGE-CASE CONTRACT → EDGE-CASES-ERROR-EXPERIENCE (§§1–11, E-IDs, 26 journeys) + FP-11.10
> + FP-13 §5 + FP-04 §17 + FP-05 §13b + FP-06 §15. Online-only (no SW); uncertainty never shown as success.

## M. ACCEPTANCE CRITERIA → Per-domain ACs live in their specs (FP-04 §24 GWT, FP-05 AC-01–23, FP-06
> AC01–25, FP-10 AC01–20, FP-12 §12, FP-11.x criteria); journeys mapped in EDGE §11 + FP-16 §6. Criteria
> are specification-level; future frontend tests prove them (FP-16 testing strategy).

## Traceability matrix (domain → primary source → section → state → prototype → FP-16 → AC → gaps → owner?)

| Domain/decision | Primary source | Section | State | Prototype relation | FP-16 result | Linked AC | Gaps/conflicts | Owner? |
|---|---|---|---|---|---|---|---|---|
| Product/units/price/stock | FP-05 | §§3–9, 4b | LOCKED/spec-closed | Demonstrated (mock) | §§10.1–10.3 pass (static) | AC-01–11 | OOS-feed/sort absent (deferred) | No |
| IA/nav/routes/guest-access | FP-03 | §§3–7b | CLOSED (C1/G1 delegated) | Mirrored (mock nav) | Nav inspected | Registry AC | None open | No |
| Journeys/checkout/idempotency | FP-04 | §§5–17, §24 | Spec-closed | Exercised (mock) | §§10.4–10.6 pass (static) | GWT 1–20 | OTP/reset absent | No |
| Commerce/coupon/weighted | FP-05 | §§9b/10b/11b/5b | Spec-closed + G-limits | Demonstrated | Promo/weight reviewed | AC-01–23 | G2/G3/G6 residuals | Copy (G6) |
| Ops/fulfillment/replace | FP-06 | §§5b–21b | Spec-closed + G-limits | Admin chain mocked | §11 pass (static) | AC01–25 | G3/G8 deferred mech. | Only if settlement ever built |
| Brand/promise/no-gos | FP-02 + BRAND | Full / §§8–12 | LOCKED | Voice followed | No cheap/luxury/noise found | §2.10 | Superiority evidence (non-blocking) | No |
| Visual identity/tokens | FP-10 + FP-08 | §§4–20 / §§2–3 | CLOSED (D01/D02/D06/D12 decided V1; D16 behavior closed, asset go-live) | Tokens mirrored | F01 fixed; closure log | AC01–20 | Copy residuals adopted V1 | No |
| Components | FP-12 + DS | Full / §3 | Spec-closed | Atoms mirrored | Nesting fixed (F02) | §12 | Avatar/combobox/popover deferred | No |
| Content/media/CMS | FP-07 + FP-17 | Full | Spec-closed, CMS absent | Placeholders honest | Copy/placeholder pass | §8 | CMS/assets/feeds | Assets as sourced |
| Screens registry | FP-03 §5 | 30 screens | Spec-closed | 1:1 mirrored | Screen walk pass | Per-screen | Conditional screens | Content-gated only |
| A11y/RTL/responsive | FP-11.9 + FP-10 | Full | Rules closed; viewports TESTED (320/375/390/768/1280/1440); AT/zoom unmeasured | Static patterns + captures | F03 fixed; F07/F09 documented | §4 | AT/zoom/WCAG deferred | No (process) |
| SEO/perf/analytics/privacy | SAP spec + FP-18 | Full | Targets undisputed; viewports tested; provider OFF (MVP); legal go-live | N/A (no impl) | Viewport evidence (closure) | §6 | sitemap/robots gen. future | Provider: no (out-of-scope); legal: go-live |
| Tech arch/sessions | FP-13 §3 + FP-14 | Full | Verified pattern | Isolated (grep-proven) | Isolation verified | FP-13/14 | FP03-G1 adapter unbuilt | No |
| Errors/edge/multi-tab | EDGE + matrices | §§1–11 | Spec-closed | States demonstrated | States inspected | §12 + journeys | Offline by design | No |
| Testing strategy | FP-16 (testing) | §§1–17 | Planned, unexecuted | N/A | N/A | §17 | Runner/framework absent | Process |

## Consistency review (executed this stage)

Product/price/stock, PIECE/WEIGHT, guest-checkout↔guest-access, no-auto-link, promo-data honesty, order
states, replacement-vs-ops, RBAC keys, RTL/responsive-vs-identity, error-vs-commerce rules, prototype-only
labeling, targets-vs-measurements, OPEN markings — all re-checked across the assembled sources: **no material
conflict found**. Two non-material notes: (1) FP-10 §25 phase-numbering remark stands (resolved by
non-colliding filenames); (2) FP-16 F03/F07/F09 prototype-only limits do not contradict production rules.

## Closure Decision Log (closure task 2026-10-13, delegated authority — history preserved, nothing rewritten)

| Item | Old state | Current decision | Why | Refs | Future change | Blocks LOCKED? |
|---|---|---|---|---|---|---|
| D01/D02 typography | OWNER approval (Cairo rec + Plex alt) | DECIDED-FOR-FRONTEND-V1: Cairo variable (arabic+latin) primary + Cairo Latin + Geist Mono code/IDs + system fallback stack | Logo-informed FP-10 rec; single file; reversible; no files installed now | FP-10 §7 | Swap family only by new decision | No |
| D06 neutrals | OWNER approval (§5 hexes) | DECIDED-FOR-FRONTEND-V1: adopt §5 proposed values as V1 defaults | Contrast precomputed (§6); additive only | FP-10 §§5–6 | Value change needs decision | No |
| D12 icons | OWNER approval (Lucide rec) | DECIDED-FOR-FRONTEND-V1: Lucide single system, 16/20/24, RTL rules per §18; install deferred to implementation | No conflict; zero install now | FP-10 §18 | Library swap needs decision | No |
| D16 logo | Asset open | DECIDED (behavior): wordmark-text + neutral placeholders in V1; production vector asset = GO-LIVE-REQUIREMENT | No approved asset in repo (verified) | FP-08 §2/§4 | Asset arrival enables real mark | No (contract) |
| Q003 analytics | Provider open | OUT-OF-SCOPE-FOR-MVP: provider OFF; taxonomy stays future design contract; prototype collects nothing (verified: zero beacons in code) | No provider/backend | FP-00-D037; SAP §4 | Provider choice = separate decision + legal | No (contract) |
| Q002 payments | Method open | OUT-OF-SCOPE-FOR-MVP: no selector/integration; checkout implies no payment (verified: zero payment fields in order validation; prototype has no payment step) | Contract absence | validation.ts; FP-11.11 Q-PAY | Payment contract + approval | No (contract) |
| CMS/media/feeds | Future | OUT-OF-SCOPE-FOR-MVP: static-approved sources only | FP-07 matrices | FP-07 | Backend + scope decision | No |
| Copy proposals (FP05-G6, 3 strings) | Owner review | DECIDED-FOR-FRONTEND-V1 (adopted verbatim: inactive-product, WEIGHT-estimate label, cart-bearer access-required) | Small, reversible, brand-voice-consistent; no legal/commercial claim | FP-05 §17c; BRAND voice | Copy swap needs review | No |
| Legal/retention/consent | Review open | GO-LIVE-REQUIREMENT (unchanged — no legal claim made; V1 display rules per SAP §5 stand) | Cannot self-approve legal | SAP §5 | Legal review pre-launch | No (contract; yes for go-live) |
| FP03-G1 adapter build | Specified, unbuilt | DEFERRED-TO-FUTURE-INTEGRATION (spec closed; acceptance below) | No production adapter in scope | FP-03 §7b | Build per AC below | No (contract) |
| Viewport/AT/WCAG/perf measurement | Untested | TESTED (viewports) + DEFERRED (AT/WCAG/traffic-metrics) | Evidence: 320/375/390/768/1280/1440 captures + 3 CDP interactions (closure report) | FP-15/16 reports | Tooling/traffic at build | No (contract) |
| Production secrets/deploy | Open | GO-LIVE-REQUIREMENT (unchanged) | Out of contract scope | — | Separate ops decision | No (contract; yes for go-live) |

Adapter future-build acceptance (unbuilt — proves the spec, not an implementation): HttpOnly order cookies
set server-side on creation only; `x-guest-order-token` attached server-side per order; raw token never reaches
client JS/URL/logs/analytics (§7b A–F behaviors); 401/410/404 mapping preserved; login/logout/cross-order
isolation per §7b E–F; multi-cookie behavior documented; no backend change required.

## OPEN decisions remaining (only go-live/future items — none blocks the V1 contract)

Legal review · production secrets/deploy · adapter build · provider selections (analytics/payment/CMS if ever
wanted) · traffic-based measurement · brand-asset arrival. All classified above with their gates.

## §19 lock verdict (closure task — all 9 conditions re-checked)

1 Domains covered ✓ · 2 no material conflicts (re-check §Consistency + closure evidence) ✓ · 3 flows specified,
zero critical gaps (deferred items have safe UX + explicit gates) ✓ · 4 zero BLOCKERs; HIGHs fixed + retested;
viewport gap converted to executed evidence ✓ · 5 V1-scope decisions closed in the log above; remainder are
go-live/future by classification, not contract blockers ✓ · 6 refs clear ✓ · 7 limits documented ✓ ·
8 prototype-only separated (banner + FP-15 report) ✓ · 9 docs-vs-implementation separated ✓.
**Verdict: FRONTEND CONTRACT = LOCKED** (2026-10-13, closure delegation; meaning and exclusions as stated
in the header — V1 reference for future implementation, not production completion).

---

*End of FP-17 — assembly only; no contract rewritten, no decision locked by this file.*
