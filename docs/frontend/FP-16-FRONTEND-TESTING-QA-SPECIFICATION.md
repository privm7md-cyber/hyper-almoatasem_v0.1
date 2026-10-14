# FP-16 — Frontend Testing & Quality Assurance Specification

> Classification: `RESOLVED — EXISTING CONTRACT` · `ADOPTED — TECHNICAL DEFAULT` ·
> `OWNER DECISION REQUIRED` (sparingly) · `UNVERIFIED / BLOCKED BY EVIDENCE`.
> Specification-only — no test files, packages, scripts, CI, or runs. Nothing here claims a test passed.

## 1. Purpose, scope and non-goals

Defines how the Hyper Al-Moatasem frontend will be validated (component, integration, E2E,
security, performance, responsive/visual/a11y) using verified existing tooling plus explicitly
proposed additions. Non-goals: writing/running tests, installing packages, CI changes, backend
changes, DB writes, FP-17–FP-20. FP-15 file organization not found — no FP-15 paths assumed.

## 2. Verified testing baseline

| Capability | Existing evidence | Current status | FP-16 decision |
|---|---|---|---|
| Component testing | No framework, no DOM/React utils, no component tests in repo | ABSENT | Propose Node-harness-first for pure logic (§4); DOM/component runner is a future tooling decision (§16) |
| Integration testing | ~45 `scripts/api/t-*.mjs` suites (node, scratch-gated) + `route-coverage.mjs` | VERIFIED — PRESENT AND USED (backend/API level) | Reuse pattern + suites for contract evidence; add frontend-side integration layer later |
| Browser/E2E testing | No framework, no scripts | ABSENT | Plan journeys (§7) as future work; no tool chosen here |
| API mocking | None (suites hit live scratch backend by design) | ABSENT | Document mock-vs-live split (§6); no mock lib adopted now |
| Accessibility checks | None (no axe/pa11y; manual rules in FP-11.9/FP-12) | ABSENT | Manual-first + future automation decision (§11) |
| Visual regression | None (no snapshots/config) | ABSENT | Requirements + stability conditions only (§11) |
| Performance measurement | None (no lighthouse/vitals tooling) | ABSENT | Metrics + approach, no targets without baseline (§10) |
| Coverage reporting | None configured | ABSENT | No blanket percentage (see §14); record per-suite results instead |
| CI integration | `.github/workflows/ci.yml` (backend-ci: tsc + eslint zero-tolerance + unit + PGlite + build, hermetic only; live matrix explicitly LOCAL-only) | VERIFIED — PRESENT AND USED | Reuse as-is; frontend suites join only when hermetic or separately gated |
| Fixtures/factories | Deterministic scratch fixtures + per-suite cleanup contracts; `seed-bab-scale.mjs`, `create-scratch-db.mjs`, `scratch-env.mjs`, `verify-scratch.mjs` | VERIFIED — PRESENT AND USED | Reuse conventions (§13) |
| Scratch isolation | Suite-level allowlist + `REFUSED_DB` fail-closed (never production) | VERIFIED — PRESENT AND USED | Mandatory for every future DB-touching suite (§13) |

Tooling truth: `package.json` has NO test runner, NO DOM/E2E/a11y/visual/perf/coverage packages
(verified manifest read; Next 16.3.8 + React 19.2.8 + zod + zustand-unused). Backend suites run via
plain `node scripts/api/t-*.mjs` (+ `ts-resolve-hook.mjs` for TS imports). Zero frontend tests exist.

## 3. Test pyramid and responsibilities

Five primary layers (responsive/visual + a11y are CROSS-CUTTING dimensions applied inside layers,
not separate layers — decided: avoids duplicating every scenario across 7 tracks):

| Layer | Proves | Does NOT prove | Best at catching | Environment | Mode |
|---|---|---|---|---|---|
| 1. Component | Props→render, states, callbacks, guards, labels/focus | Backend behavior, integration wiring | Visual logic, a11y defects, double-submit | Node/DOM harness (future tool) | Automated |
| 2. Frontend/API integration | Correct contract use (shapes, errors, retry rules) | Live backend correctness | Mapping drift, error handling | Mocked + contract-checks; optional live scratch | Automated |
| 3. E2E browser (small, critical only) | Representative journeys end-to-end | Exhaustive coverage | Cross-layer wiring breaks | Isolated non-prod env | Automated, few |
| 4. Security/authorization | Presentation flows + integration checks (backend suites stay authoritative) | Backend enforcement (already covered) | Leaks, conflated 401/403, stale private data | Mocked + scratch | Automated |
| 5. Performance/compatibility | Access patterns, render costs, key metrics | Backend load behavior | N+1, jank, layout cost | Fixtures + measured env | Measured, few |

Backend suites (`t-catalog/cart/orders/promotions/customers/replacements/inventory/admin/rbac-guards-races/idempotency/concurrency/*`) remain the authority for business behavior — frontend layers
must not duplicate them; a frontend integration check suffices where the contract is the question.
Mocks never prove backend behavior (stated per matrix row).

## 4. Component testing strategy (source: FP-12 contracts)

Components (verified names — FP-12 §§3–7): ProductCard (+ProductImage, ProductPrice,
PromotionBadge, StockStatus internal), VariantSelector, QuantityControl (Piece/Weight),
AddToCartButton, TextField (+Password/Phone/Select/Checkbox/Textarea), StatusBadge, DataTable,
ConfirmDialog, EmptyState, ErrorState (+Loading/Success/Alert, Pagination, Breadcrumbs, layouts).
Coverage per component: props→render; empty/missing optionals; invalid presentation input;
loading/disabled/success/error states; keyboard + labels/focus; callbacks; UI-level double-submit
guard; RTL/responsive where relevant.
Separation rule (binding): AddToCartButton proves callback + pending + guard — never reservation;
ProductPrice proves display of supplied data — never promo math; QuantityControl respects
PIECE/WEIGHT contract rules (whole packs; step-exact presets; LITER/ML metadata-only) — never
product-specific invented limits. Test cases + evidence expectations per component in the traceability
matrix (§15); files to be created in a future implementation task (not here).

## 5. Frontend/API integration testing (source: OpenAPI + FP-13 matrix)

Operation-to-test matrix (condensed; full per-op rows in §15): catalog reads/search/filters/sorts/
cursor-only pagination/empty/400/stale-wins; variant select + price/stock/compare-at honesty +
reconciliation; cart context/add/update/remove/reject/totals/guest-auth separation/expiry/ambiguity
per FP-13 idempotency (add NOT safe-retry; same-key order resolve; no invented recovery); order
payload/address/confirm-on-200-only/ambiguity/order-display/no-duplicate-beyond-guarantee (no
payments/recovery/statuses invented); admin reads/mutations/403/stale/concurrent-edit per FP-14.
Three modes, never conflated: (1) mocked responses (frontend logic only), (2) contract checks
(request/response shape vs OpenAPI + FP-13), (3) optional live-scratch smoke (needs §13 safety).
Mocked passes never claimed as backend proof.

## 6. End-to-end browser journeys (small, high-value; not executed)

- **A — Guest shopping:** open → search/browse → valid variant+qty → add → server-authoritative cart
  review → supported address → submit → confirmed outcome (no assumed routes beyond FP-09/FP-11).
- **B — Authenticated:** phone/password login → session verify → permitted reads → logout/expiry
  (no OTP/reset assumed).
- **C — Admin workflow:** admin login → permitted order → inspect → allowed state+permission action →
  server reconciliation (no invented workflow).
- Guest-order security: three secrets distinct; number/phone ≠ authorization; no credentials in URLs;
  no history-listing assumption; no invented recovery; actual header transport only.
- Isolation: dedicated non-prod env + identifiable fixtures/identities + test-owned setup/cleanup +
  deterministic prerequisites + secret hygiene + zero real notifications/financial effects; every
  DB-writing step proves its target via read-only identity check first (established convention).

## 7. Hypermarket commerce matrix

| Scenario | Frontend requirement | Backend authority/evidence | Layer |
|---|---|---|---|
| Piece product | Whole-pack unit + qty | Variant/unit contract | Component + integration |
| Weight product | Step-exact representation (125g–1.25kg only where supported) | Quantity/unit validation | Component + integration |
| Price change | Reconcile returned result, never stale-as-final | API mutation/estimate semantics | Integration (+E2E) |
| Stock out | Cached display ≠ authorization | Validation + mutation response | Integration |
| Applicable promotion | Display backend-provided result only | Promotion contract | Component + integration |
| Expired promotion | Never misrepresent as active | Promotion contract | Integration |
| Replacement | Display supported outcome only | Fulfillment/replacement contract | Integration (+E2E) |
| Order without replacement | Documented short-ship behavior | Accepted business rule | Integration |
| Repeated submission | Guard interaction; respect server guarantee | FP-13 idempotency matrix | Component + integration |
| Session expiry | No false authenticated state | Session contract | Integration + E2E |
| Guest-order access | No disclosure without credentials | Guest-order contract | Security + integration |

Units: PIECE/KG/GRAM sale units; LITER/ML metadata-only; exact decimal strings, no float rounding;
no frontend promo math. Each row: observable pass/fail + layer; none blocked by missing contract.

## 8. Security and authorization strategy

Levels: (1) presentation/access-flow tests, (2) API authorization integration checks,
(3) existing backend suites (`t-rbac-guards/races`, `t-store-idor`, `t-admin*`, `t-audit-pairing` —
VERIFIED present, reused as evidence). Covers: unauthenticated UI areas; unauthorized admin ops +
displayed outcomes; 401-vs-403 fidelity; no stale private data post-logout/identity-change;
session/guest-cart/guest-order separation; no credentials in URLs/logs; no password/bearer persistence;
untrusted-data rendering; no stack-trace leakage; no shared-cache leakage. Hiding ≠ enforcement;
no control-weakening for test ease; no live-production/external targets.

## 9. Performance and large-catalog strategy

20k+ products: endpoint pagination (cursor-only, verified), request-frequency/debounce/latest-wins,
card/image render cost, no full-catalog loads, admin-table loading, expensive interactions,
LCP/INP/CLS as candidate metrics WITHOUT targets or results (no baseline exists — targets need
evidence-based approval later). Tooling: none installed → gap recorded (§16); approach = synthetic
fixtures/sampled data + controlled env (never production catalogue, never destructive seed).
Frontend measurement only; backend load testing out of scope.

## 10. Responsive, visual, RTL, accessibility quality

Breakpoints/layouts from FP-10/FP-12 (Tailwind defaults; nothing invented): small/typical mobile,
tablet, laptop, wide desktop — nav/search, grids/cards, prices/badges, cart/checkout, dialogs, admin
tables/nav, states, Arabic RTL + mixed-script isolation. Visual regression: requirements + stability
conditions (fixtures, images, fonts, viewports) only — no tool/snapshots installed. A11y: names, error
association, keyboard, focus (incl. dialogs), alt text, icon names, contrast, non-color status,
touch targets; automation assists, manual verification required where stated; no compliance claimed.

## 11. Failure, retry and concurrency testing (bounds: FP-13 + FP-14)

Failures, malformed/contract-mismatched responses, validation/protected/transient-session rejections,
stale/cancelled/timeout/overlap/conflict/admin-race cases — assigned per layer (component/integration/
E2E/backend-existing). Standing distinctions: mocked≠live, abort≠server-cancel, timeout≠not-created,
loading-guard≠idempotency, stale-warning≠optimistic-concurrency. No invented codes/fields/headers/
endpoints.

## 12. Fixtures, cleanup and environment safety

Deterministic fixtures + dedicated identities + test-owned records + run isolation + cleanup-only-own +
secret hygiene + no real notifications/financial effects + mocked-vs-live separation + no ordering
dependencies — all per established suite conventions (`REFUSED_DB` allowlists, per-suite cleanup).
No records/seeds/DB changes in this phase. Missing infra → `BLOCKED BY ENVIRONMENT/INFRASTRUCTURE`,
never a workaround. Dev/test-only deployment constraints stand.

## 13. Failure severity and quality gates

`BLOCKER` (ship-stopper: data leak across users, unauthorized privileged action, corrupted totals,
duplicate orders from bad retry, broken critical journey) · `CRITICAL` (severe, workaround exists) ·
`HIGH`/`MEDIUM`/`LOW` (degrading). Evidence-required passes; flaky→quarantine-with-cause; skips
justified in writing; env blockers explicit; regressions traced to component/integration/workflow.
Coverage: NO blanket percentage (no existing threshold found in CI/scripts — verified absence);
quality goals required now, quantitative thresholds later by evidence. **Strategy closure ≠
implementation closure**: this document closes planning only; future runtime results stay unclaimed.

## 14. Traceability matrix (high-value excerpt; full rows reference §§4–11)

| Feature | Contract | Endpoint/op | Layer | Success | Failure/security | Evidence | Status |
|---|---|---|---|---|---|---|---|
| Product search + pagination | FP-11.2 | `GET search/products` + cursor | Integ. | Results + next page | 400/stale-wins | OpenAPI + suites | Specified |
| Variant select + price | FP-11.3 | variants/inventory reads | Comp.+Integ. | Honest display + reconcile | OOS/price-change | OpenAPI + suites | Specified |
| Cart add/update/remove | FP-11.4 | cart ops + XOR identity | Comp.+Integ. | Echo-reconciled totals | Reject/ambiguity rules | FP-13 matrix | Specified |
| Checkout submit | FP-11.5 | estimate + keyed create | Integ.(+E2E) | 200-confirmed display | Ambiguity, no dupes | FP-13 matrix | Specified |
| Login/session/guest | FP-11.7 | session/register/password | Integ.+E2E | Valid transitions | 401/expiry/separation | Backend suites | Specified |
| Admin fulfillment | FP-11.8.3 | 12 order ops + R2/R7 | Integ.(+E2E) | Server-confirmed state | 409-gate/races | Backend suites | Specified |
| Promos/coupons | FP-11.8.4 | config + checkout eval | Comp.+Integ. | Proven-benefit display | Expiry honesty | Backend suites | Specified |
| Users/roles/audit | FP-11.8.5/8.6 | grants + reads | Integ.+Sec | Guarded outcomes | 403/409 fidelity | Backend suites | Specified |
| RTL/a11y/visual/perf | FP-11.9/12 | Layout contracts | Cross-cutting | Matrix §10 | Manual where required | Specs (no tools) | Specified |

Status `Specified` = planning only; `existing test evidence` applies solely to backend suites cited.

## 15. Decision register

| ID | Question | Final status | Rationale / evidence | Impact / limitation |
|---|---|---|---|---|
| FP16-D1 | Pyramid shape + layers | ADOPTED — TECHNICAL DEFAULT | 5 layers + cross-cutting dims; mocks≠proof | Guides all suites |
| FP16-D2 | No new component-test framework now | ADOPTED — TECHNICAL DEFAULT | Zero existing usage to extend; Node-harness pattern proven for pure logic; DOM runner later | Component layer waits for tooling decision |
| FP16-D3 | Reuse backend suites as authority | RESOLVED — EXISTING CONTRACT | ~45 suites + CI + scratch gates verified present | No duplication |
| FP16-D4 | Mock/contract/live split | ADOPTED — TECHNICAL DEFAULT | Prevents false backend-proof claims | Per-matrix labeling |
| FP16-D5 | Small E2E set (A/B/C) | ADOPTED — TECHNICAL DEFAULT | Critical journeys only; no full-workflow invention | Future env needed |
| FP16-D6 | Commerce matrix layers | RESOLVED — EXISTING CONTRACT | Unit/step/price/stock rules verified | None |
| FP16-D7 | Security 3-level model | RESOLVED — EXISTING CONTRACT | Backend suites + contracts verified | No control weakening |
| FP16-D8 | Perf without targets | ADOPTED — TECHNICAL DEFAULT | No baseline exists; LCP/INP/CLS candidates only | Thresholds later |
| FP16-D9 | No coverage percentage | ADOPTED — TECHNICAL DEFAULT | No threshold in repo; per-suite evidence instead | Quantitative later |
| FP16-D10 | Fixture/cleanup conventions | RESOLVED — EXISTING CONTRACT | Suite allowlists + cleanup verified | Mandatory for new suites |

No OWNER DECISION REQUIRED: everything above resolves via evidence or conservative defaults.

## 16. Remaining blockers and evidence gaps

1. Component/DOM test runner choice — future tooling decision (blocks component-layer execution, not planning).
2. E2E framework + isolated env — future decision (blocks E2E execution).
3. A11y/visual/perf automation — future decisions (manual-first specified).
4. Performance baselines/thresholds — need measurements first.
None blocks FP-16 planning closure; all block only their respective future execution.

## 17. Acceptance criteria and closure checklist

- [x] Baseline table honest (§2 — absences stated, install ≠ usage).
- [x] Pyramid + responsibilities + backend-reuse rule (§3).
- [x] Component strategy from FP-12 names only (§4).
- [x] Integration matrix from OpenAPI/FP-13, no invented endpoints (§5).
- [x] E2E A/B/C + isolation without assumed routes (§6).
- [x] Commerce matrix with unit/contract fidelity (§7).
- [x] 3-level security reusing backend suites (§8).
- [x] Perf/RTL/visual/a11y without invented targets/tools (§§9–10).
- [x] Failure taxonomy per FP-13/14 bounds (§11).
- [x] Fixture/env safety per conventions (§12).
- [x] Severity + strategy-vs-implementation split + no blanket coverage (§13).
- [x] Traceability + decisions + blockers (§§14–16).
- [x] Docs-only: zero code/test/config/DB changes (verified §A below).

---

*End of FP-16 — specification-only; no tests written or run.*
