# BG-GUEST-ORDER — Final Decision Closure (Implementation-Ready Contract)

> **Phase:** BG-Guest-Order closure (decision only — NO implementation).
> **Authority:** Q1 TRUE ACCOUNT-LESS GUEST ORDER = LOCKED (PRODUCT-OWNER, non-reopenable).
> **Supersedes:** PROPOSED/OPEN items from `BG-GUEST-ORDER — FINAL GAP ANALYSIS & CHANGE DESIGN`
> (prior report remains the analysis record; THIS document is the locked contract).
> Items below marked LOCKED are final per closure rules §6.33 (no TBD/maybe/will-decide on
> implementation-necessary points).
> **Date:** 2026-10-07. **Repo state at closure:** `master`, HEAD `83253fe` == `origin/master`,
> 0 modified files (verified pre-work). No application code, migration, test, OpenAPI, config,
> dependency, commit, push, or `docs/AGENT-HANDOFF.md` change was made in this phase.
> **Evidence vocabulary:** VERIFIED (file read this phase) · DOCUMENTED (prior verified record).

## A. Re-verification summary (repository wins)

| Point | Result |
|---|---|
| `POST /store/orders` customer-only 401 | VERIFIED (`store/orders/route.ts:55-59` + test pin `t-store-idor.mjs:168`) |
| `orders.customer_id` NOT NULL + RESTRICT | VERIFIED (`schema.prisma:291-292`, `migration.sql:204,726`) |
| History writers hardcode CUSTOMER/STAFF; cancel union CUSTOMER\|STAFF + uuid-cast; serializer passthrough | VERIFIED (`orders/writes.ts:437,440,466,534`, `fulfillment.ts:112,377`, `serialize.ts:53-61`) |
| Frozen actor CHECK (`SYSTEM,CUSTOMER,STAFF` + SYSTEM→NULL-id else NOT NULL) | VERIFIED (`supplement.sql:92-93`) — GUEST amendment required, no blocker found |
| Closed error-code union (8 codes, no 410) | VERIFIED (`errors.ts:14-22`, `http-status.ts:10-29`) — 410 needs additive `GONE→410` mapping (locked, §F) |
| Log redaction is substring-based; any `*token*` key auto-dropped | VERIFIED (`log.ts:9-43`) — `x-guest-order-token` / `guestOrderToken` redacted with zero code change |
| IP via per-route `x-forwarded-for` first entry; DB-backed buckets shared across instances | VERIFIED (`session/route.ts:36-38`, `rate-limit.ts` pattern) — same trust posture adopted, no new risk class |
| `orderCreateSchema` strict: `addressId` UUID + optional key + coupon; serializer exposes orderNumber/snapshots/actuals/history | VERIFIED (`validation.ts:13-24`, `serialize.ts:66-92`) — guest reuses same shape |
| `addressInputSchema` field shapes; coupon null-customer path exists in estimate; guest token 256-bit/SHA-256; session TTL 30d | VERIFIED (`customers/validation.ts:68-80`, `checkout.ts:519-532`, `cart/session.ts`, `auth.ts:41`) |
| Queries use Prisma equality (no raw customer INNER JOINs on order reads); fulfillment has no customerId | VERIFIED (`orders/queries.ts`, `fulfillment.ts:37`) — nullability blast radius contained |

No conflict found between prior report and repository. No prior-report correction needed except
the deliberate replay reversal (§C).

## B. Locked decisions (final — all implementation-necessary points)

| ID | Decision | Status / Owner | Evidence |
|---|---|---|---|
| BGGO-D001 | Architecture Alt A: nullable `customer_id` + `guest_order_credentials` + inline address + shared commerce tx | LOCKED / ARCHITECT-OWNED | §A rows 1–3 |
| BGGO-D002 | Credential: per-order 256-bit opaque, SHA-256 hash-only, header `x-guest-order-token`, TTL 90d fixed no-sliding, multi-use, revocable | LOCKED / ARCHITECT-OWNED | token utils + session TTL pattern VERIFIED |
| BGGO-D003 | Guest address: inline payload (address shapes minus label/isDefault/ownership) → order snapshots only; zero `customer_addresses` rows | LOCKED / ARCHITECT-OWNED | `validation.ts:68-80`, snapshot cols VERIFIED |
| BGGO-D004 | Coupons: `coupon_usages.customer_id` nullable; `per_customer_limit` → 422 guest; global limits enforced | LOCKED / ARCHITECT-OWNED | `checkout.ts:519-532,726` VERIFIED |
| BGGO-D005 | History actor `GUEST` + NULL id; CHECK becomes SYSTEM→NULL / CUSTOMER→NOT NULL / STAFF→NOT NULL / GUEST→NULL | LOCKED / ARCHITECT-OWNED | writers + `supplement.sql:92-93` VERIFIED; SYSTEM-as-substitute rejected (dishonest attribution) |
| BGGO-D006 | Guest cancel/decide with GUEST actor; no `audit_logs` rows (self-service rule extends) | LOCKED / ARCHITECT-OWNED | cancel union + audit pairing VERIFIED |
| BGGO-D007 | NO auto-linking on later registration (same phone); no backfill; future linking = separate explicit feature | LOCKED / PRODUCT-OWNER | No contract conflict (linking impossible today); privacy/domain clarity |
| BGGO-D008 | No guest history listing V1; single-order access only; G002 untouched | LOCKED / ARCHITECT-OWNED | Scoping decision, no blocker |
| BGGO-D009 | Rate limits: `guest-order:ip` 10/15min create; `guest-order:read-ip` 60/15min reads; DB-backed table via existing helper; exceed → 429 | LOCKED / ARCHITECT-OWNED | rate-limit pattern + IP posture VERIFIED; anon-create risk justifies stricter-than-customer-IP-30 |
| BGGO-D010 | Expired → 410 Gone (additive `GONE→410` mapping); revoked/invalid → 401; unknown id → 404 | LOCKED / ARCHITECT-OWNED | closed union VERIFIED; additive mapping, no semantic change |
| BGGO-D011 | **Replay: KEEP SAME credential** (no rotation). Replay response carries NO token + `meta.replay:true, meta.guestTokenIssued:false`; client retains first-issued token | LOCKED / ARCHITECT-OWNED | Supersedes prior rotation proposal — see §C |
| BGGO-D012 | Lost token: no self-claim (number/phone insufficient); V1 support recovery = staff-verify facts + RBAC + explicit rotate (admin MUST endpoint) | LOCKED / ARCHITECT-OWNED | Recovery is the only path because of D011; kept high-assurance |
| BGGO-D013 | Admin revoke MUST + rotate MUST, under `orders.update`, audit-paired, raw never viewable (fresh issuance only on rotate response) | LOCKED / ARCHITECT-OWNED | Lifecycle (D012) requires rotate; revoke is non-optional control |
| BGGO-D014 | Frontend storage: `localStorage` keyed `guest-order-token:<orderId>`, explicit header attach, never URL; survives refresh/reopen; server expiry (410) authoritative | LOCKED / ARCHITECT-OWNED | Rejected: per-order HttpOnly cookie (ambient + clunky), sessionStorage (dies on reopen — breaks tracking), in-memory (dies on refresh). Non-ambient header = CSRF-safe; XSS posture = existing CSP/innerHTML discipline |
| BGGO-D015 | Request XOR: session XOR guest-context; both → 400; strict schemas; no `customerId` from clients ever | LOCKED / ARCHITECT-OWNED | Existing XOR discipline (`cart/owner.ts`) extended |
| BGGO-D016 | Security invariants SI-01…SI-12 (see §G) | LOCKED / ARCHITECT-OWNED | Threat model closed, no residual unknown |

## C. Replay reversal note (prior proposal superseded)

Prior report proposed rotation-on-replay. Re-evaluation per §6.13 (concurrent tabs/refresh races,
accidental invalidation of a buyer-held bearer, added state machine for zero threat-model gain —
replay requesters already prove same-cart ownership, so rotation buys nothing) reverses it:
**KEEP SAME**. Lost-response edge is covered by D012 recovery (rare × high-assurance path beats
common-case invalidation races). This is a decided trade-off, not an open point.

## D. Final API contract (no "implementation will decide" remaining)

- `POST /store/orders`: `addressId XOR guestAddress{city,area?,village?,street?,building?,landmark?,phone} + guestContact{name,phone}` (strict, both-present/different → 400 pattern); guest proven by `x-guest-token` cart owner; coupon rules per D004; idempotency header/body (header wins, mismatch → 400, missing → 400); success 201 + `data.guestOrderToken` (guest only); replay 200 + `meta.replay:true, guestTokenIssued:false`; errors 400/401/404/409/422/429.
- `GET /store/orders/[id]`, `POST /[id]/cancel`, `GET /[id]/replacements`, `POST /[id]/replacements/[rid]/decide`: session-owner XOR `x-guest-order-token`-for-this-id. Missing/invalid/revoked → 401; expired → 410; unknown id or cross-owner → 404; decided/picked-state violations → 409; semantic violations → 422.
- `POST /orders/estimate`: unchanged. Admin `orders/*`: unchanged behavior + "Guest" rendering. New: `POST /admin/orders/[id]/credential/revoke` (MUST) + `/rotate` (MUST) under `orders.update`, audit-paired, request `{}` strict, responses 200 (+ fresh `guestOrderToken` on rotate only).

## E. Final DB change set

1. `orders.customer_id` DROP NOT NULL (FK RESTRICT kept). 2. New `guest_order_credentials(order_id UNIQUE FK CASCADE, token_hash UNIQUE, expires_at, revoked_at NULL, created_at, last_seen_at)` + CHECK + partial live index. 3. `coupon_usages.customer_id` DROP NOT NULL. 4. History CHECK amendment (D005). 5. New `guest_order_rate_limits` (same shape as existing bucket tables). 6. Grants mirroring session-table pattern. No backfill; existing rows valid; single additive migration.

## F. Final security invariants

SI-01 order number never authorization · SI-02 phone never authorization alone · SI-03 credential scoped to one order · SI-04 never stored raw · SI-05 never creates customer session · SI-06 no customer-only surfaces for guests · SI-07 no cross-guest access · SI-08 no pricing/inventory/promotion authority change · SI-09 admin RBAC authoritative · SI-10 raw credentials never logged (field naming keeps auto-redaction) · SI-11 replay never issues without same-cart proof · SI-12 credential never elevates (no profile/address-book/history-listing access).

## G. Readiness gate (26/26 met)

Product locked · ownership locked · credential design locked · TTL locked (90d) · transport locked (header) · lifecycle locked · replay locked (keep-same) · lost-token locked (support-rotate) · revoke+rotate locked (MUST/MUST) · DB set identified · API fully designed · authorization defined (matrix in prior report §22, unchanged) · invariants defined · rates decided (10/60) · coupons decided · history actor decided · regression boundaries defined · fulfillment/pricing/inventory/promo/idempotency preserved · migration + rollback defined · test matrix defined · frontend contract defined · zero unresolved blockers.

## H. Implementation sequence (design only)

BGGO-I01 database → I02 domain/service → I03 authorization → I04 access/buckets → I05 OpenAPI → I06 tests (new `t-guest-orders` + `checkout-guest-only-401` expectation update, recorded) → I07 verification gate.

```text
BG-Guest-Order = READY FOR IMPLEMENTATION (pending in this closure report's final status §35)
```

## I. Change log vs prior report

Superseded: rotation-on-replay → keep-same (D011 + §C). Promoted to MUST: admin rotate (D013, forced by D011+D012). Newly locked: storage localStorage (D014), rates 10/60 (D009), 410 mapping note (D010), never-link PRODUCT-OWNER lock (D007), XOR model (D015). All prior PROPOSED → LOCKED; BGGO-D007/D008 OPEN → LOCKED.

## J. Owner acceptance — decider CHECK governance exception (2026-10-08)

Product/Project Owner explicitly approved the implementation-found exception flagged in the
post-implementation governance audit: amendment of exactly two constraints in
`prisma/migrations/20261008_guest_orders/supplement.sql` — `chk_repl_decider_type`
(whitelist + `GUEST`) and `chk_repl_decided` (`GUEST` + NULL `decided_by_id` allowed on
decided rows) — to record guest replacement decisions as `GUEST`/NULL, consistent with
locked BGGO-D005 and BGGO-D006. Scope is limited to these two constraints only; it is not
authorization for further Frozen SQL, business-logic, or architecture changes. Re-verified
at acceptance time: the two constraints in the migration file are byte-identical in intent
to the audited text (original clauses preserved verbatim, additive GUEST disjuncts only),
and no additional application, schema, or migration change accompanied this acceptance
(no commit/push made under this acceptance). Prior sections above are preserved unchanged
as the decision history.
