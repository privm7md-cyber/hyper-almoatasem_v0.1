# FP-11.11 — Screen-Design Phase Closure Review

> Review tool, not auto-proof of work. Each item classified from evidence. Specification-only.
> Backend Capability Mapping (§B), Gaps & Conflicts Register (§C), and Checklist (§A) below.

## A. Closure checklist (evidence-linked)

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Homepage, categories, search | VERIFIED | FP-11-1 (D02/D05/D06 closed) + FP-11-2 (D12/D13/D17/D18 approved): hierarchy, keyset, submit-only search, bounded cards |
| 2 | Product details, variants, weight | VERIFIED | FP-11-3 (D21–D23 approved) + FP-11.8.2 §E6: variant authority, step-exact presets, estimate honesty |
| 3 | Cart, order review, checkout | VERIFIED | FP-11.4 (D24–D30 closed) + FP-11.5 (D31–D38 closed, D39 BLOCKED documented): XOR identity, full-cart echo, idempotent submit, A/B/C ambiguity |
| 4 | Orders + customer account | VERIFIED | FP-11.7 (D40/D41/D42 approved): session model, keyset history, address CRUD + default-409, register rate limiting (G5 live), no invented profile/OTP |
| 5 | Admin dashboard, products, stock, prices | VERIFIED | FP-11.8 (D43/D44/D45 approved) + FP-11.8.2 (D46–D48 approved; L3 implemented): honest dashboard, keyset catalog, variant pricing, movement-paired inventory |
| 6 | Fulfillment, replacements, offers | VERIFIED | FP-11.8.3 (frozen machine + R2 gate + replacement lifecycle + L1) + FP-11.8.4 (4 verified types, no invented analytics/feed) |
| 7 | Users, permissions, audit | VERIFIED | FP-11.8.5 (31-key matrix, guards) + FP-11.8.6 (append-only reads, secret-free) |
| 8 | Loading/empty/error/success states | VERIFIED | FP-11.8.7 (10-state matrix + timeout rule) + per-phase state sections + FP-11.10 matrix |
| 9 | Mobile/tablet/desktop behavior | VERIFIED | FP-11.9 §1 (+ per-phase responsive rules); no invented breakpoints |
| 10 | Every action mapped to real API | VERIFIED | §B mapping below; per-spec §15/§16/API-mapping sections; no unmapped important action found |
| 11 | No fake prices/discounts/data | VERIFIED | Authority rules per phase (variant price, full-cart echo, estimate-vs-creation, snapshot-only reads); G-P1 + D39 + L-gaps documented, never worked around |
| 12 | No implementation/deploy/migration in design | VERIFIED | Zero app-code diffs by spec tasks (status-tracked); AGENT-HANDOFF.md untouched throughout; no commit/push claimed |

Prior-phase gap found during this review: FP-11.7 §7 referenced admin-dashboard decision ID `D43`
in a customer-profile note — corrected in the D40 closure task (unrelated display-only text, no
contract impact). No other prior-phase deficiency detected; scope not expanded to fix anything else.

## B. Backend Capability Mapping (excerpt — full maps live in each spec)

| Domain | Requirement | Endpoint / Operation | Data/state used | Permissions/conditions | Result |
|---|---|---|---|---|---|
| Catalog browse | List/search/filter/page 20k+ | `GET /catalog/products` (+ admin mirror) | ListItem fields; opaque cursor; no totals | Public / `products.view` | SUPPORTED |
| Product detail | Detail + variants + images + stock | `GET products/{id}`, `…/variants`, `…/images`, inventory reads | Variant price basis; gallery fallback shape | Public / `products.view` + `inventory.view` | SUPPORTED |
| Pricing (admin) | Change variant price | `PATCH /variants/{id}/price {price,reason?}` | 2dp string; compare-at 422 guard; history+audit tx | `products.update` | SUPPORTED |
| Inventory | Reads + adjust/reserve/release/commit + threshold + movements | 6 routes (§FP-11.8.2 E2) | GENERATED available read-only; manual types only | `inventory.view` / `inventory.adjust` | SUPPORTED |
| Cart | Draft cart lifecycle | mint/resolve/read/add/set/remove/clear/merge/reprice | Full-cart echo; XOR identity; step rules | Guest bearer XOR session | SUPPORTED |
| Checkout | Address + estimate + idempotent create + credential | addresses CRUD, `POST estimate`, `POST orders` + key | Snapshots; 409-drift/stock; keep-same credential | Session XOR guest bearer | SUPPORTED |
| Account | Login/register/profile/orders/addresses/password/logout | 6 customer routes + orders reads | 30d sessions; lockout + isolated buckets (login IP30/acct10, register IP30/phone-digest10); generic 401s, generic 429s | Session (self-scoped) | SUPPORTED |
| Fulfillment | Prepare/pick/OOS/propose/decide/ready/dispatch/deliver/cancel | 12 admin routes (§FP-11.8.3) | Frozen machine; R2 gate; R7 envelope | `orders.view/update/cancel` | SUPPORTED |
| Promotions | Config + coupons + usages | promo CRUD/rules/targets/BXGY + coupon CRUD/usages | 4 types; autos+coupon at checkout | `promotions.*/coupons.*` | SUPPORTED |
| Users/roles/audit | Admin identity + grants + log reads | users/roles/grants/members/password + audit reads | Ceiling/serialization/guards; append-only log | `users.*/roles.*/audit_logs.view` | SUPPORTED |
| Metrics/analytics | Dashboard numbers, alerts, feeds | — (no route) | — | — | UNSUPPORTED (D43 honest dashboard) |
| Barcode search | Global code search (admin) | — (GET by id only) | — | — | UNSUPPORTED (L1) |
| Price timeline | History reads | — (write-only) | — | — | UNSUPPORTED (L2) |
| Totals/counts | Result counts | — (keyset only) | — | — | UNSUPPORTED (L4) |
| Upload/bulk/CSV/scale | Binary/bulk workflows | — (metadata only) | — | — | UNSUPPORTED (L5) |
| LITER/ML volumetric | Volume-unit lifecycle (Direction A implemented) | `productUnitSchema` boundary-3; variant metadata-5; docs aligned | Display per restriction retired → boundary enforced | Closed (this task) |
| OTP/recovery | Any OTP/password-reset | — (deferred project-wide) | — | — | UNSUPPORTED |
| Payments | Methods/capture/status | — (future tables only; COD-only scope retained) | — | — | UNSUPPORTED (deferred) |

## C. Gaps & Conflicts Register

| ID | Kind | Description | Evidence | Impact on closure | Needs owner? |
|---|---|---|---|---|---|
| G-P1 | Gap | No promotion-change event stream (mid-cart expiry learned via reprice/estimate/creation only) | Promotions engine (no events API) | Documented constraint; UI behavior specified without it | No (constraint recorded) |
| D39 | Gap → resolved | Guest recovery satisfied by existing staff-assisted design: once-only issuance + keep-same replay (`orders/route.ts:126-132`, `writes.ts:200`) + admin rotate/revoke (`orders.update` + audit, one tx) + isolated buckets (10/60) + 401/410 semantics + t-guest-orders 66/66 re-verified this task | Recovery path exists; safe UX retained | No (verified, no change) |
| L1–L5 | Gaps | Per FP-11.8.2 E13/E15 (L1/L2/L4/L5 accepted; L3 implemented+verified this task — see below) | Route inventories | L1/L2/L4/L5 closed-scope; L3 closed by implementation | L3 done; others accepted |
| L3 | Implemented + verified | Direction A: `productUnitSchema` (PIECE/KG/GRAM) at Zod boundary, variant `sizeUnit` metadata preserved (5), openapi already aligned, no migration; unit 16/16 + live 400/400/201 green + catalog 56/56 | Boundary narrowed 422→400 per established enum-input contract | Closed (this task) |
| G5 | Implemented + verified (HMAC-hardened) | Isolated `reg:` buckets (IP 30 + HMAC phone 10 /15min, secret-bound, fail-closed, no migration); generic 429; duplicate semantics preserved; unit 9/9 + live 14/14 (HMAC-bound, no-fallback, fail-closed-500, isolation) + customer-auth 37/37; IP trust environment-dependent (phone bucket independent); env: local secret Git-ignored in `.env.local` (live-proven), Preview-only variable registered by metadata (active deployment NOT proven to consume it) | Abuse surface closed (IP = anti-casual only until edge verified) | Closed (this task) |
| G1–G4/B1 | Gaps | Profile-edit/reset/session-list/deletion; metrics API — all rendered as unsupported, no fake UI (B6 split out below) | FP-11.7 §17; FP-11.8 §20 | Rendered as unsupported; no fake UI | Review acceptance |
| B6 | Gap (distinct row) | No admin MFA/OTP/self-service password recovery (admin provisioning via audited `users.manage` is NOT recovery) — dev/testing accepted limitation; NOT evidence of production readiness | Route inventory (no MFA/OTP/reset routes); FP-11.8 §20 | Unexposed surface stays unrendered | Accepted (dev/test scope) |
| B7 | Gap → accepted | No product-row hard-delete route exists (`products.delete` covers codes/images only); Restrict FKs would block product deletion regardless — product-delete UI out of scope | Route inventory; `schema.prisma` Restrict relations | No delete invented; per-response fallback retained | Accepted (verified absence) |
| Q-PAY | Business scope retained | Payment-neutral checkout retained (no payment step/UI per verified zero fields/routes; FP-04 "COD display only" stays a display convention, not a confirmed policy); online/refunds deferred; estimated-vs-final distinction preserved | FP-00-Q002; FP-11.5 D37; `orderCreateSchema` (no payment fields) | Checkout payment-neutral; blocks nothing | Retained (this task) |
| C-UNIT | Ambiguity → closed | LITER/ML discrepancy resolved by Direction A implementation (see L3 row): boundary narrowed, metadata preserved, docs aligned | §E15–E16 evidence matrix + this task | Contract consistent; interim rule retired | Closed (this task) |
| C-NAME | Doc conflict (corrected) | Task §4 shorthand `READY` vs frozen `READY_FOR_DELIVERY` (+`OUT_FOR_DELIVERY`) | `orders/state-machine.ts:12-18` | Corrected in FP-11.8.3 §3; no rule changed | No (resolved by evidence) |
| D41/D44 | Presentation decisions → approved | D41 default-first display; D44 bounded enrichment — within defined limitations (server order preserved; API-fields/static-metadata only) | Respective registers | Zero contract impact | Approved (this task) |

No doc↔backend conflict was resolved by silent rule change; C-NAME/C-UNIT are evidence-resolved or
explicitly routed. No fabricated resolutions.

Corrected gap inventory (25 rows): G-P1, D39, Q-PAY, L1, L2, L3/C-UNIT, L4, L5, G5, G1, G2, G3,
G4, G6, B1, B2, B3a (metadata-only), B3b (field parity, build-time), B4, B5, B6, B7, D41, D44, C-NAME
(B6 split out separately; C-UNIT is the L3 alias — one gap, not two; nothing missing).

## D. Phase verdict

FP-11 screen-design phase: **specification-closed with documented constraints** — 12/12 checklist
items VERIFIED at specification level (evidence-linked above). Gap-resolution implementation (this
task, owner-authorized): L3 boundary + G5 rate limiting live with suites green (catalog-unit 16/16,
catalog 56/56, register-ratelimit 14/14 incl. HMAC-bound/no-fallback/fail-closed-500 proofs,
customers-unit 49/49, customer-auth 37/37, guest-orders 66/66, orders 54/54,
cart 50/50, promotions 58/58, route-coverage pass, tsc/eslint/build/prisma clean — all on isolated
scratch, zero production touch). G5-HMAC follow-up: HMAC-bound phone buckets (`REG_RATE_LIMIT_PHONE_SECRET`,
fail-closed, rotation-orphans-counters) verified live + unit; IP trust documented environment-dependent
(phone bucket independent). Production readiness is explicitly NOT claimed. FP-12 not started.

---

*End of FP-11.11 — specification-only.*
