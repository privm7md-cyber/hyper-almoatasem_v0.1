# FP-14 — Application State & Data Management Specification

> Classification: `RESOLVED — EXISTING CONTRACT` · `ADOPTED — TECHNICAL DEFAULT` ·
> `OWNER DECISION REQUIRED` (used sparingly) · `UNVERIFIED / BLOCKED BY EVIDENCE`.
> Specification-only — no contexts, hooks, stores, clients, caches, or components implemented.
> Evidence hierarchy: implementation/tests > OpenAPI/schemas > approved decisions > prior FP specs.

## 1. Purpose, Scope and Non-Goals

Defines state ownership, data lifecycle, freshness, and reconciliation for the Hyper Al-Moatasem
storefront + admin console so a future implementer follows verified contracts without inventing
business rules, cache guarantees, auth behavior, retry policies, or concurrency mechanisms.
In scope: server/UI/auth/commerce state (§4), architecture choice (§5), product/variant lifecycle
(§6), caching (§7), cart (§8), sessions (§9), races (§10), admin concurrency (§11), invalidation
(§12), network semantics (§13). Non-goals (§16 list): no code, stores, libraries, clients, backend/
DB changes, merges, auth endpoints, payments, inventory semantics, optimistic-concurrency protocol,
global cache directives, FP-15/16, production work.

## 2. Repository and Architecture Baseline

- Stack (verified `package.json:12-36`): Next.js **16.3.8**, React 19.2.8, Prisma 7.10.0, zod 4.6.5,
  Tailwind v4, TypeScript 5. **zustand ^5.0.15 installed but imported nowhere in `src/`**
  (grep-verified) — available, unused.
- Version triple (verified 2026-10-11, §7.1): manifest `next: 16.3.8` pinned exact
  (`package.json:16`) · lockfile `node_modules/next 16.3.8` (`package-lock.json`, lockfileVersion 3) ·
  installed `node_modules/next/package.json` version `16.3.8` — CONSISTENT, no conflict.
- Single config file (`next.config.ts` only): security headers + `experimental.authInterrupts` only —
  NO `cacheComponents` key, NO cache/fetch/revalidation keys, NO `images` remote config. No route
  segment cache exports (`dynamic`/`revalidate`/`fetchCache`/`dynamicParams`) anywhere in `src/`
  (grep-verified). No middleware (`src/middleware.ts` absent).
- No TanStack Query / SWR / Redux. No `fetch(` calls, no `force-cache`/`no-store`/`revalidate`
  directives anywhere in `src/` (grep-verified). No middleware (`src/middleware.ts` absent).
  `next.config.ts`: headers + `experimental.authInterrupts` only — no cache/fetch configuration.
- UI inventory: one Client Component (`src/app/admin/login/LoginForm.tsx`, `useActionState` over a
  Server Action); server-gated admin shell; boilerplate storefront `page.tsx`; root layout is
  unmodified starter (`lang="en"`, Geist latin-only — RTL/Arabic layout change belongs to
  implementation, not this phase).
- Server-only discipline: ~25 `src/lib/*` modules carry `import "server-only"` (all writes, services,
  sessions, RBAC, db); pure exceptions importable anywhere: `cart/totals`, `promotions/engine`,
  `admin/policy`, `orders/state-machine`, `customers/phone`, `inventory/quantities`,
  `auth/reg-phone-bucket`, plus validation/serialize files.
- Backend facts re-verified this turn: admin sessions 8h (`auth/session.ts:16`), customer sessions
  30d server-side (`customers/session.ts:24`, `customers/auth.ts:41`); order idempotency keys UNIQUE
  with same-cart replay / 409-different-terms (`orders/writes.ts:172-202,524-529`,
  `orders/queries.ts:83-86`); guest→customer merge endpoint exists
  (`app/api/store/cart/merge/route.ts`, `cart/writes.ts:338`); estimate is a read-only dry run
  (`orders/estimate/route.ts:1-6`, `promotions/checkout.ts:414`); guest-order credential 90d fixed,
  header-only, hash-at-rest (`orders/guest-access.ts:26-30`, openapi `:114-117`); cart mutations
  return the reconciled cart (`cart/items/route.ts`, `cart/writes.ts:225-258`).

## 3. Evidence Hierarchy and Verified Capabilities

Contract-backed (READ the code/contract, not reports): §2 inventory above; FP-13 retry/idempotency
matrix (order create VERIFIED dedup; cart-add NOT idempotent — aggregates; estimate repeatable but
never same-guaranteed; login/register/admin mutations NOT idempotent); FP-11.4 cart echo + XOR
identity; FP-11.5 estimate-vs-creation authority + 90d credential; FP-11.7 session/guest separation;
FP-11.8.2 GENERATED availability + movement-paired inventory; FP-04 fulfillment lifecycle.
Next.js 16 behavior per official docs v16.4 (same major line as installed 16.3.8; minor gap
disclosed — behavior below is major-line stable): server `fetch` default
`auto no cache` (per-request in dev; build-time single fetch unless request-time APIs force dynamic);
`force-cache` opt-in matching URL+method+headers+body (200s only); `next.revalidate`/`tags` lifetimes;
same-GET memoization within ONE render pass only (AbortSignal opts out; never in Route Handlers);
dev HMR fetch cache caveat. `cacheComponents`/PPR posture: RESOLVED — see §7.1 (no longer UNVERIFIED).

## 4. Four State Categories and Ownership

| Category | Owner / source of truth | Freshness taxonomy (mandatory labels) |
|---|---|---|
| **Server state** (products, variants, categories, search, prices, promos, inventory, cart, orders, addresses, account, admin data) | Backend only. Rendered values are *last-known* until a confirmed response replaces them. | `last-known` · `refreshing` · `confirmed-latest` · `freshness-unknown` · `unauthorized-to-display`. A 200 is never permanently current; a cache hit never proves current stock. |
| **UI state** (menus, tabs, dialogs, disclosures, local filters, unsubmitted form edits) | Owning component (local). Shared ONLY with a proven multi-component need (§5). | Local-only; must never silently become persisted commercial/account data. |
| **Authentication state** (`unknown`→`guest`/`authenticated`/`expired`/`error`; frontend labels, NOT backend enums) | Server session checks only. Local storage, old user objects, phone numbers, cart ids, or cached responses NEVER prove validity. Network failure during verification ⇒ `error`, never auto-`guest`/`unauthenticated`. | Transitions require verified evidence per §9. |
| **Commerce state** (selected variant/qty/weight, in-flight mutation, checkout interaction, unconfirmed request) | User intent (temporary) vs persisted cart vs confirmed totals — three distinct slots. | Selections never imply confirmation; backend alone approves prices, discounts, holds, replacements, transitions. |

No global store is assumed (§5).

## 5. State/Data Management Architecture Decision

Selected minimum architecture (no new dependencies):

1. **Server-rendered reads** — RSC + permitted server-only utils (existing pattern: admin pages via
   `requireAdmin`/`requirePermission`; public catalog reads likewise). No new mechanism.
2. **Browser interactions** — (a) verified Server Actions where present (`loginAction`/`logoutAction`
   only), else (b) `fetch` to supported HTTP endpoints. `src/lib/storefront/` stays PLANNED
   (FP-13), never referenced as existing.
3. **Freshness** — §7 matrix + §12 events; no blanket policy.
4. **Shared client state** — none assumed; URL-as-state for listing/search/filter/pagination
   (FP-11.2 §11 pattern); contexts only if implementation proves a coordination need (deferred, not designed here).
5. **Presentation state** — component-local always unless §4 sharing bar is met.
6. **Commerce mutations** — exact backend contract per op (FP-13 matrix); reconcile response;_FP-13
   retry rules; no invented keys/guarantees.
- zustand: available-but-REJECTED (no proven need; React primitives + URL + RSC suffice; avoids bundle/
  boundary/duplication cost). Revisit only on demonstrated need at implementation.
- Server-only modules stay out of every client dependency graph (build-enforced by the import itself).

## 6. Product and Variant Lifecycle (Romi cheese walkthrough)

1. Resolve `productId` (+`variantId` when multi-variant) from route params against
   `GET products/[id]` (+`…/variants`); unknown/inactive → not-found (never crash, never substitute).
2. Fetch via RSC server read; render FP-12 skeletons while unavailable.
3. Render verified data or error/not-found; gallery fallback when images absent.
4. Local-only weight/qty selection (e.g. Romi 250g of a KG-step product): presets offered ONLY where
   `preset % saleStepGrams == 0` for THAT product (FP-05/FP-11.3 rules); step-exact free input otherwise.
5. Client mirror-validation (formats/enums/steps) — never a substitute for server validation.
6. Submit `POST cart/items {productVariantId, quantity}` (exact decimal strings; PIECE whole packs,
   WEIGHT step multiples; LITER/ML only as descriptive `sizeUnit` metadata per L3 — never sale units).
7. Pending row state + duplicate-submit guard → adopt mutation echo (full cart) or supported re-read.
8. Failures: 400 shape / 422 step-unit-price / 404 gone / 401 session / 409 conflict — mapped message,
   selection preserved, retry allowed; ambiguous timeout → re-read cart BEFORE re-adding (add
   aggregates — blind re-POST doubles quantity).
9. Shared summaries/badge reconcile from the confirmed cart object wholesale (no field patching).
10. Display stays consistent with the confirmed outcome; stale snapshots never presented as current.

| Stage | Authority | Temp client state | Mutation | Reconcile | Failure | Invalidation | Evidence |
|---|---|---|---|---|---|---|---|
| Resolve/fetch | Backend | — | GETs | Render or not-found | Retry reads only | Criteria change refetches | openapi catalog paths |
| Select qty/weight | Contract (+mirror UI check) | Selection | None | — | Inline message | Selection edits are free | FP-05/FP-11.3 |
| Add to cart | Backend | Intent + pending | `POST cart/items` | Full-cart echo | Mapped + preserved | Badge/summary replaced | `cart/writes.ts`, FP-11.4 |
| Price moved since PDP | Backend | Stale display | Reprice/estimate/creation | New authoritative values + review gate | Never auto-accept drift | Estimate invalidated | FP-11.4 D30, FP-11.5 |
| Checkout totals | Backend | Review draft | Estimate (preview) → create (authority) | Creation response only | 409 → new key + review | Post-mutation invalidation | FP-11.5, FP-13 matrix |

Price-change rule: never force old prices into carts/orders; never promise old-price guarantees;
surface server-identified changes with review; invent no price-change codes/fields/comparisons.
Estimate ≠ final; fulfillment actuals surface only from confirmed order data.

## 7. Caching and Freshness Policy

| Data category | Authority | Freshness risk | Policy decision | Invalidation/refresh trigger | Isolation | Evidence/status |
|---|---|---|---|---|---|---|
| Static images/assets | Asset origin | Lower | Static caching ONLY if pipeline+versioning verified at implementation | Asset/version change | Public as appropriate | UNVERIFIED (no pipeline inspected) |
| Categories | Backend | Medium | Endpoint-specific, explicit justified policy | Catalog change / defined revalidation | Public only | Contract + §12 |
| Product details | Backend | High (price/stock) | Endpoint-specific; display ≠ purchase proof | Mutation / revalidation policy | No protected data | Contract + §12 |
| Prices/promos | Backend | High | Never authorize purchase from stale values | Mutation/response flow | No cross-context bleed | FP-11.5/13 |
| Inventory | Backend | High | Revalidate via commerce flow (`GET inventory/…`, reprice, estimate) | Mutation / fresh read | Cached ≠ reserved | FP-11.8.2, FP-13 |
| Cart | Backend | High | Identity-scoped (session XOR guest bearer) | Every mutation + recovery reads | Strict customer/guest split | FP-11.4 |
| Orders | Backend | High | Private + refreshed | Status ops + subsequent reads | Principal/permission isolation | FP-11.5/11.7 |
| Account/addresses | Backend | High | Private + refreshed | Mutation / session change | Never cross-identity | FP-11.7 |
| Admin data | Backend | High | Permission+identity-aware | Mutation / permission change / refresh | Never cross-context | FP-11.8 + RBAC |

Mandatory rulings: (1) static cache only with verified pipeline; (2) catalog caching only under
explicit justified policy; (3) display data ≠ purchase authorization; (4) stale never overrides
rejection; (5) personalized/privileged data never in shared caches; (6) cart/order scoped to verified
identity+mechanism; (7) session-dependent rendering reviewed against Next 16 semantics — RSC ≠
automatically cacheable/isolated; (8) no `force-cache`/static/persistent behavior for sensitive data
without verified isolation (session-gated reads MUST NOT be force-cached: match includes headers but
relying on that is forbidden here); (9) no indiscriminate `no-store` as strategy substitute;
(10) no invented invalidation API (only `revalidateTag`/segment semantics IF adopted at
implementation — planned, not present); (11) client state never invalidates server cache without a
verified connection. Unresolvable freshness items stay UNVERIFIED (asset pipeline; see §7.1 for the
resolved `cacheComponents`/PPR posture).

### 7.1 Next.js Cache Configuration Verification (2026-10-11)

Observed in repo: single `next.config.ts` (headers + `experimental.authInterrupts`; no cache keys);
no segment cache exports; no `fetch` cache options anywhere in `src/`; installed Next.js 16.3.8
(triple-consistent per §2). Official docs consulted (v16.4 line, minor gap to 16.3.8 disclosed):
[fetch reference](https://nextjs.org/docs/app/api-reference/functions/fetch) (defaults, opt-in
caching, memoization, HMR caveat) and [cacheComponents reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents)
(opt-in flag + `partialPrefetching`; v16.0 stabilized from experimental; PPR subsumed).
Findings: `cacheComponents` is OPT-IN and absent here ⇒ feature off; legacy `experimental.ppr` flag
and `experimental_ppr` segment config were REMOVED in v16 (NOT APPLICABLE as settings); PPR-style
partial-prerender behavior ships only inside `cacheComponents` ⇒ effectively absent here
(VERIFIED — DISABLED, no behavior assumed beyond the classic App Router model above).
Consequences for this spec: §7 matrix and rulings stand unchanged (they never assumed the flag);
ruling (8)'s session-gated `force-cache` ban is confirmed necessary (docs: opt-in cache matches
include headers/cookies — relying on that separation is exactly what the ban forbids);
memoization/HMR statements in §3/§10 confirmed as stated. No config change made or proposed.

## 8. Cart Consistency and Mutation Reconciliation

- **Context by identity** (exact backend behavior): authenticated → server session cart; guest →
   cart bearer (`x-guest-token` semantics per FP-11.4); expired session → re-auth path (401, never
   silent guest-downgrade); network/server failure during session check → `error` state, cart untouched,
   retry offered. Three credentials never interchanged (session / cart bearer / order credential —
   the last belongs to post-creation order access only, never cart ops; order-credential persistence is the
   planned HttpOnly adapter per FP-03 FP03-G1 §7b — localStorage forbidden for order secrets; order detail reads
   stay private per-request with no shared-cache placement).
- **Update/remove sequence** (§6 steps 1–9 +): intent → pending → single-flight guard → supported
  mutation → echo/recovery-read adoption → badge+summary wholesale replace → failure preserves safe
  intent only → confirmed vs pending vs uncertain visibly distinct. Rapid same-item edits: serialize +
  coalesce to latest intent (debounce/guard reduces calls; NO transactional guarantee claimed —
  last-writer-wins per backend semantics).
- **Echo/totals:** mutations return the reconciled cart representation — adopt it; where an op returns
  less, use the supported follow-up read (documented per op at implementation; no shape assumed across
  ops). Totals follow estimate-vs-creation semantics; shared UI never recomputes authoritative money.
- **Failed/ambiguous:** confirmed rejection vs validation failure vs pre-receipt network failure vs
  lost-response timeout — four distinct states; FP-13 matrix governs retry (same-key order resolve;
  cart GET-first; admin re-read-first; no blind destructive retry; no invented cart-recovery
  endpoint/key).
- **Login transitions:** guest→customer merge exists ONLY via the verified merge endpoint/contract
  (FP-11.4); never implied auto-merge; guest orders never attach to accounts by login (UNVERIFIED
  beyond the merge contract — marked, not assumed).

## 9. Authentication and Session Lifecycle

Transitions (`unknown` initial): valid check → `authenticated`; missing/expired/proven-invalid →
`expired` (re-auth path); network/server error → `error` (retry; never downgrade); logout → session
revoked client-wide → `guest` baseline for browsing (cart bearer separate). Login success requires
the session-establishing response (never local profile inference); login failure keeps prior state +
mapped message. 401 vs 403 vs network errors handled per contract (never conflated). No account data
renders before authorization evidence. Credentials: phone+password login + server sessions;
guest-cart bearer for carts; per-order credential (header-only, never URL; persisted only via the planned
HttpOnly adapter per FP-03 FP03-G1) for order access;
no password/hash storage in browsers; no secrets in bundles; no OTP/reset/recovery invented.
Identity changes (login/logout/expiry/switch/unverifiable): clear/isolate ALL identity-scoped
client representations (cart view, account, addresses, orders, admin data) BEFORE showing the new
identity; never touch server-side business records on client reset (no cart/order deletion implied).

## 10. Request Races and Stale Response Protection

Policy: every read carries a monotonic sequence + input context; responses arriving for a superseded
sequence/context are discarded (latest-wins); `AbortController` signals cancel in-flight fetches where
the fetch layer supports it (per Next.js docs, signal opts out of memoization) — abandoning a READ is
safe; abandoning a MUTATION proves nothing about the server (explicitly stated in UI copy where shown).
Coverage: search keystrokes, variant/product navigation, repeated cart edits, identity changes,
mid-read expiry, refresh-over-refresh, admin filter/pagination changes. No backend ordering guarantee
claimed — this is frontend response handling only.

## 11. Administrative Concurrent Editing

Verified backend posture: NO ETag/`If-Match`/revision/optimistic-locking mechanism exists anywhere in
`src/` (grep-verified); protection = row locks + 409 guard conflicts (last-SUPER_ADMIN rule
`admin/writes.ts:181-188`, unique violations `:140`, serialization). Therefore: NO frontend promise
of lost-update prevention. Advisory flow only: preserve unsaved input → surface the verified 409 →
re-read latest → show stored-vs-proposed side by side → require explicit re-review + resubmit. Never
invent status codes, headers, revisions, endpoints, or recovery APIs. Residual risk stated plainly:
concurrent admin overwrites are possible; the UI reduces but cannot eliminate them.

## 12. Invalidation and Reconciliation Matrix

| Event | State under review | Policy | Provided by |
|---|---|---|---|
| Cart mutation success | Cart/badge/totals | Adopt echo / supported re-read | Backend + future UI |
| Cart mutation rejection | Pending + displayed cart | Reconcile to confirmed outcome | Backend + future UI |
| Server-identified price/stock change | Product/cart display | Show + require review (D30 pattern) | Backend + future UI |
| Login success | Session/private/cart context | Reverify session; explicit merge only | Backend + future UI |
| Logout | Account/address/order/cart view | Clear identity-scoped view state | Future UI (no server writes implied) |
| Session expiry | Session-gated data + pending ops | Stop trusting session; re-auth path | Backend + future UI |
| Identity switch | All identity-scoped state | Isolate/clear before new identity renders | Future UI |
| Order created | Cart/confirmation/summaries | Follow creation response + post-creation contract | Backend + future UI |
| Order status action | Detail/status | Refresh/adopt verified result | Backend + future UI |
| Admin mutation success | Detail/list views | Re-read; never overwrite newer server values | Backend + future UI |
| Permission/authz rejection | Protected views/data | Honor outcome; refresh visibility | Backend + future UI |

No row invents server-side invalidation; "future UI" = required implementation work, not existing code.

## 13. Loading, Error, Retry and Recovery Semantics

Initial loading · success · valid-empty · confirmed-not-found · validation rejection · auth failure ·
authz failure · rate limiting (15-min buckets, backoff) · network interruption · server failure ·
stale display · mutation pending/success/rejection/ambiguous — each with FP-12 presentation mapping
(referenced, not redefined). Meanings enforced: empty ≠ failure; 401 ≠ 500; session-error ≠ guest;
pending ≠ confirmed; displayed total ≠ confirmed total; timeout ≠ business failure. Retry/idempotency
per FP-13 matrix; blind retries of unsafe mutations forbidden.

## 14. Decision Register

| ID | Decision | Contract or default? | Why appropriate | Business impact | Implications | Evidence | Status |
|---|---|---|---|---|---|---|---|
| FP14-D1 | Four-category ownership + freshness labels | Contract-derived | Mirrors backend authority + session realities | None | Labels required in every data UI | §2–§4 evidence | RESOLVED — EXISTING CONTRACT |
| FP14-D2 | RSC-first reads; fetch-mutations; `storefront/` planned | Contract + default | Matches existing patterns; zero new deps | None | No client lib until 3rd reuse | §2 inventory | RESOLVED — EXISTING CONTRACT |
| FP14-D3 | No global store; URL-as-state; local-first | Default | No proven coordination need; avoids boundary/duplication cost | None | Contexts only on proven need | Zero store imports | ADOPTED — TECHNICAL DEFAULT |
| FP14-D4 | zustand available-but-rejected | Default | Installed yet unused; primitives suffice | None | Revisit on demonstrated need | `package.json:22` + zero-import grep | ADOPTED — TECHNICAL DEFAULT |
| FP14-D5 | Product lifecycle incl. Romi flow | Contract | Exact backend semantics end-to-end | None | Preset/step/price rules as specified | FP-05/11.3 + routes/schemas | RESOLVED — EXISTING CONTRACT |
| FP14-D6 | Cache matrix + 11 mandatory rulings | Mixed | Balances 20k+ perf vs staleness/leakage | None | Explicit policies per category | Next docs v16.4 + contracts | RESOLVED — EXISTING CONTRACT (UNVERIFIED rows marked) |
| FP14-D7 | Cart model (echo, XOR identity, merge-only, retry rules) | Contract | Exact mutation semantics | None | §8 sequences mandatory | FP-11.4/11.5/13 + routes | RESOLVED — EXISTING CONTRACT |
| FP14-D8 | Five-state auth lifecycle + isolation | Contract | Prevents downgrade leaks + cross-identity display | None | Transition evidence rules | Session impl + FP-11.7 | RESOLVED — EXISTING CONTRACT |
| FP14-D9 | Latest-wins + AbortSignal races | Default | Native, no deps, matches streams | None | Per-read seq/context required | Next docs + FP-11.2 §11 pattern | ADOPTED — TECHNICAL DEFAULT |
| FP14-D10 | Advisory-only admin concurrency | Contract (absence verified) | No mechanism exists to promise more | None | 409-driven review flow | Absence grep + `admin/writes.ts` | RESOLVED — EXISTING CONTRACT |
| FP14-D11 | Event→data matrix (§12) | Mixed | Traceable reconciliation per event | None | "Future UI" rows are work, not code | Contracts per row | RESOLVED — EXISTING CONTRACT |
| FP14-D12 | FP-12 presentation reuse (no redefinition) | Default | Single source for visuals | None | Data/state meanings bound here | FP-12 §§7/17 | ADOPTED — TECHNICAL DEFAULT |

No OWNER DECISION REQUIRED items: every material choice resolves from contracts or conservative
defaults without touching product/business behavior. (Stated explicitly per §14 instructions.)

## 15. Implementation Requirements and Explicit Non-Goals

Requires implementation (future, authorized separately): RSC reads per §5; fetch mutations per FP-13;
URL state; sequence-guarded reads; echo reconciliation; auth lifecycle + isolation resets; advisory
concurrency flow; event-matrix behaviors; FP-12 presentation bindings. Explicitly NOT required and
NOT authorized here: any code/store/library/client/action/handler; backend/DB/OpenAPI changes;
migrations/seeds; merges/auth/payment/inventory/concurrency-protocol inventions; global cache
directives; FP-15/16; production work.

## 16. Acceptance Criteria

- §17 architecture/ownership bullets: satisfied by §§4–5 + register (source-of-truth per category ✓).
- Caching bullets: matrix + 11 rulings cover isolation/freshness/invalidation labeling; no unsupported
  freshness claimed (UNVERIFIED rows explicit).
- Cart/commerce bullets: §6 + §8 (real contracts, echo reconciliation, ambiguity taxonomy, FP-13 retry
  alignment, no invented merge/association, backend money).
- Auth bullets: §9 (server-proven validity, no false downgrade, credential separation, no leaks).
- Concurrency bullets: §10 (no silent overwrite, abort≠cancel proof, admin honesty) + §11.
- Scope bullets: contracts cited throughout; future-vs-existing labeled (§§5/12/14/15); statuses
  consistent; no hidden ambiguity; docs-only; tree intact (verified §18).

## 17. Remaining Blockers and Evidence Gaps

1. Asset pipeline/versioning for static-cache claims — UNVERIFIED (narrowed this turn: product images
   are external https URL references, metadata-only, no storage provider, no upload flow per
   `catalog/media.ts:8-14`; but no `images` remote config in `next.config.ts` and no `next/image`
   usage verified — CDN/remote-pattern policy needs build-time inspection at implementation; blocks
   nothing — default is no static caching).
2. `cacheComponents`/PPR posture — RESOLVED this turn (VERIFIED — DISABLED; legacy PPR flags NOT
   APPLICABLE in v16; see §7.1). Removed from UNVERIFIED.
3. Cross-device/session-portability semantics — not in scope of any inspected contract; untouched.
4. No owner-approval blockers: all decisions above are contract/default-resolved by design.

## 18. Closure Report and Verification Checklist

- [x] Full document re-read (this section included).
- [x] Keyword sweep: `pending` (mutation-pending states only; never pending decisions), `unverified` (only in UNVERIFIED labels + §17),
  `cache`/`no-store`/`force-cache` (only §7 + Next-docs grounding), `retry`/`idempotent` (only
  FP-13-aligned matrix language), `guest`/`session`/`cart` (credential separation enforced),
  `concurrency` (only verified guards + advisory flow).
- [x] All implementation/API claims trace to §2–§3 evidence gathered this turn.
- [x] Future mechanisms labeled planned (§§5/7/12/14/15).
- [x] No cache timing invented (no durations anywhere except backend TTLs/JWT-free session lifetimes
  quoted from code: admin 8h, customer 30d, guest-order 90d).
- [x] Cart/auth agree with FP-13; FP-12 reused not redefined.
- [x] No FP-15/16 content (planning/testing strategies untouched; zustand decision is §5-scoped).
- [x] No contradictions/duplicated decisions found on re-read.
- [x] Git status vs initial: only the new FP-14 file added (verified below).
- [x] No formatters/generators run.
- [x] No runtime/UI/production verification claimed.
- [x] Targeted cache-config verification pass (this turn): version triple consistent; no cache keys
  or segment exports in repo; v16.4-line docs confirm fetch defaults + opt-in `cacheComponents` +
  removed legacy PPR flags; §7.1 added; §17 PPR item resolved; no other sections altered for this.

---

*End of FP-14 — specification-only, no implementation.*
