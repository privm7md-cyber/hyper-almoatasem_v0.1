# Edge Cases & Error Experience — Unified UX Contract

> Method: REUSE FP-11.10 (11 scenarios), FP-13 §5 (retry/idempotency matrix), FP-04 §17 (30 journey rows),
> FP-05 §13b (commerce mapping), FP-06 §15 (ops matrix), FP-03 §7b + FP-14 (credential/cache rules),
> FP-11.9 (responsive/RTL/long-content). This file ADDs only: unified operation-aware HTTP map (§1),
> offline statement (§3), multi-tab matrix (§6), partial-response rules (§8), long-content/zoom rules (§9),
> the Error-ID recovery matrix (§10), and the critical-journeys table (§11). No code. Static review only.
> Never a bare Toast for failures that need inline/page treatment (mapping below governs).

## 1. Unified HTTP-to-UX map (operation-aware; codes never mean one thing everywhere)

| Code | Storefront meaning (by op) | Admin meaning (by op) | Treatment | Preserve | Refetch? | Retry? | Re-auth? | Never claim |
|---|---|---|---|---|---|---|---|---|
| 400 | Field/shape error (cart set, coupon normalize, address, search q, cursor) | Filter/param shape error | Inline field/message | Inputs | No | After fix | No | Valid request |
| 401 | Session/guest-credential missing/invalid/revoked (op-specific) | Admin session missing/invalid | Login prompt / access-required; guest: support path | Non-sensitive | Yes (post-login) | After login | Yes | Guest recovery |
| 403 | N/A customer scope (foreign reads mask as 404) | Perm missing; stale-grant → refresh `GET /session` | Forbidden page (exists); never fake-empty | Context | Perm refresh | No (re-fire forbidden) | No | Access |
| 404 | Unknown/inactive/foreign (masked) | Unknown/foreign | Not-found + safe path back | Context | Fresh mint (carts) / relist (addresses) | No | No | Existence |
| 409 | Drift/stock/lock/picked/decided/race (op-specific) | Illegal transition/race/guard | Conflict banner + cause + re-read | Everything | Yes | Same-key / after-fix only | No | Overwrite |
| 422 | Business-rule refusal (weight step, coupon, envelope, settings type) | Same + type violations | Rule message + fix path | Inputs | Yes | After fix | No | Bypass |
| 429 | Only where bucketed (register, guest create/read); coupon-dedicated UNVERIFIED | Buckets per contract | Backoff notice | Everything | Yes | With backoff | No | Wait duration |
| 500 | Generic server failure | Same | Generic + retry, stale badge | Everything | Yes | Reads yes; writes re-read-first | No | Internals |

## 2. Commerce conflicts (REUSE FP-05 §13b + FP-04 §17 — binding, not copied)

Price/promotion/coupon/qty/OOS/dead-variant/merge/inventory/decided-replay: preserve useful input, re-fetch
stale data, never show stale prices as confirmed, never auto-rewrite a purchase, re-confirm where FP-05 requires,
stop when data unavailable. Refetch ≠ user consent to a price change.

## 3. Network, slow network & offline

No offline mode exists (no Service Worker, manifest, or background-sync in repo — verified absence): the app is
online-only. Slow: skeletons + staged content, no blank screens. Loss-before-submit: preserved inputs + retry.
Loss-after-submit / timeout-unknown: uncertainty state + operation-specific idempotent recovery (same-key order
replay; cart GET-first; admin re-read-first; destructive never blind). Partial response: §8. Reconnect: manual
retry + revalidation (no invented auto-sync). Loading-too-long: staged timeout message + retry (never silent stall).

## 4. Duplicate clicks & requests

Single-flight + disabled-during-submit + idempotency keys where contracted (orders create; cart add aggregates by
design — intended, not a bug); coupon re-apply = re-evaluation (safe); decide/inventory-ops = re-fetch-first
(never blind); admin transitions = 409-guarded. Button-disabling is UX polish; the contract (not the button)
prevents duplication.

## 5. Session & credential expiry (REUSE FP-03 §7b, FP-04 §17, FP-14 — matrix inline)

Customer 30d / admin 8h / guest-cart bearer (device-local) / guest-order 90d credential: distinct states for
missing/invalid/expired per context (401 vs 410 vs access-required); order credential survives logout and cart
expiry (separate lifecycles); number/phone never substitute; expiry mid-read/mutate/checkout/create/admin-act ⇒
§1 rows + resume paths; messages never leak security detail.

## 6. Multi-tab & concurrent updates (ADD — no broadcast mechanism exists; revalidation only)

| Case | Detection | Refresh mechanism | UI behavior |
|---|---|---|---|
| Cart changed elsewhere | Next read/mutation response differs | Adopt server echo on every response | Replace displayed cart wholesale; flag the change |
| Login/logout elsewhere | Next gated call 401 / session check | Re-check session on visibility-regain + before writes | Re-gate UI; preserve non-sensitive drafts |
| Session expiry | 401 | Same | Login + resume |
| Price/stock moved | Reprice/estimate/mutation rows | Revalidate before transacting | Old→new disclosure; re-confirm gate |
| Perm revoked / role off | 403 after visible UI | Refresh `GET /session`, re-evaluate visibility | Forbidden state; failed act stays failed |
| Order moved | 409 / changed read | Re-read authoritative row | Truth banner; re-gate actions |
| Decided elsewhere | 409 decided | Re-fetch proposal row | Recorded-state message |
| Inventory moved | Mutation outcome | Re-read | Outcome message |
| Concurrent checkout submit | Idempotency replay/409 | Same-key resolve | Single-effect messaging |

No BroadcastChannel/SharedWorker claims; no instant sync invented.

## 7. Refresh, back/forward & deep links (REUSE FP-03 §6 + FP-09 §F — binding)

URL holds discovery/pagination only (never secrets/PII/keys); query preserved; scroll/context restored PDP↔results;
forms preserved where non-sensitive; server-reloadable vs unrestorable distinguished per screen (FP-03 registry);
back/refresh never duplicates ops (idempotency + re-read rules); dead resources → not-found/mint/relist paths;
deep links authorized per route policy (credential-header for guest orders, never URL tokens).

## 8. Partial response & missing data (ADD — fallback vs purchase-gate split)

Required-but-missing purchase data (price/unit/step/variant/stock-decision) ⇒ gate the purchase path (disabled CTA
+ reason); optional-missing (image/brand/description/category-trail) ⇒ FP-07 fallbacks. Unknown enum/status ⇒
neutral fallback + retry (never raw codes; never a tradable entity from a guess). Shape mismatch ⇒ error state,
never silent coercion.

## 9. Broken image & long content (REUSE FP-11.9 + FP-07 §3/§6; rules inline)

Broken/missing ⇒ neutral layout-stable fallback (never another product's image; never OOS implication). Truncate
only non-financial, non-unit, non-status text (names/descriptions/addresses with expand/tooltip + keyboard/SR
access); money/unit/status/validation text always fully visible. Mixed Arabic/Latin isolated (`bdi`); barcodes/IDs/
phones verbatim LTR. 200% zoom + smallest viewport functional (layout reflows, no clipped CTA).

## 10. Error recovery matrix (IDs; copy approved FP-04 §19/FP-05 D14 or COPY-PROPOSAL marked)

| ID | Context | Trigger (evidenced) | Source | Copy | Treatment | Preserve | Revalidate | Retry | Dup risk | Security | Recovery | Acceptance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| E-HTTP | Any | §§1–2 per code/op | API | Mapped message | Inline/page per §1 | Per §1 | Per §1 | Per §1 | Per op | No internals/leaks | Per §1 | Code+op behavior |
| E-NET | Any | Transport/timeout (§3) | Network | Retry affordance + stale badge | Inline + banner | All | Yes | Reads yes; writes resolve-first | Guarded | — | Resolve path | Uncertainty shown |
| E-SESS | Authed flows | 401/expiry (§5) | Auth | Login + resume | Page/inline | Non-sensitive | Post-login | After login | None | No detail | Resume | No false-authed state |
| E-GUEST | Guest order | 401/410/missing (§5) | Credential | Access-required/expired + support | Page | Nothing protected | No | No (staff path) | None | Number/phone ≠ proof | Support path | Zero disclosure |
| E-CONF | Mutations | 409 per op (§§1–2) | API | Cause + re-read | Banner | All | Yes | Same-key/after-fix | Guarded | — | Re-read first | Truth displayed |
| E-CART | Cart ops | Step/stock/merge/dead (§2) | API | Per-line outcome | Inline | Rest of cart | Yes | Latest-intent | By design (add sums) | — | Adopt echo | Echo adopted |
| E-CPN | Coupon | §2 + FP-05 §10b | API | Approved/passthrough | Inline | Code + cart | Yes | New code/fix | None | — | Re-evaluate | No pre-confirm claim |
| E-MTAB | Multi-tab | §6 cases | Browser+API | Truth banner | Banner + replace | Drafts | Yes | Per case | Per case | — | Revalidate | Newest wins |
| E-RBD | Refresh/back/deep | §7 cases | Browser+API | Path/guidance | Inline/page | Per screen | Per screen | Never blind | Guarded | No URL secrets | Safe path | No duplicate ops |
| E-PART | Partial data | §8 cases | API | Fallback or gate | Inline | Context | Yes | Yes | None | — | Fallback/gate | No guessed entity |
| E-MEDIA | Images | Broken/missing (§9) | Content | None (visual) | Placeholder | Layout | Per-row | Yes | None | — | Retry row | Layout stable |
| E-LONG | Long/zoom | §9 cases | UI | Full text where critical | Wrap/expand | — | No | N/A | None | — | Expand | Critical info visible |

## 11. Critical journeys acceptance (26; specified-only — maps to FP-16 §6 A/B/C + FP-04/FP-06 ACs)

| # | Journey | Preconditions | Actor | Screens | APIs | Success | Errors | Responsive/RTL/a11y | Privacy | Recovery | AC source | State |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1–3 | Browse→Product→Cart; Weighted→Cart; Promotion→Cart | Live catalog | Visitor | Home/listing/PDP/cart | Catalog/search/cart/inventory | Echo-confirmed cart | OOS/drift/step/400-404 | FP-11.9 | Public data | Re-read/retry | FP-04 AC1–7; FP-16 §7 | Specified |
| 4–6 | Coupon→Checkout; Guest→Order; Registered→Order | Cart + identity | Guest/customer | Cart/checkout/confirm | Estimate/orders/addresses | 201 only | 400/404/409/410/422 | Same | Bands, no PII | Same-key resolve | FP-04 AC8–12; FP-05 | Specified |
| 7–10 | Address→Checkout; price/stock conflict; confirm refresh/back; details+status | Session/guest contexts | Both | Checkout/confirm/orders | Same + reads | Confirmed states | Ambiguity/409/stale | Same | Owner-only | Resolve-first | FP-04 AC; FP03-G1 | Specified |
| 11–13 | Replacement approve/reject; cancellation | PROPOSED / unpicked | Customer | Order detail | Decide/cancel | Confirmed outcome | 409/410/404 | Same | Owner-only | Re-fetch | FP-06 AC04–06; CANCEL | Specified |
| 14–15 | Admin login; perm denial | Admin creds / lacking grant | Admin | Admin shell | Session/RBAC | Gated workspace / forbidden | 401/403 | Same + density | No enum | Resume/refresh session | FP-11.8; FP-16 §8 | Specified |
| 16–18 | Catalog edit; inventory adjust; prep + actuals | Perms + PREPARING | Staff | Admin catalog/inv/orders | Catalog/inventory/fulfill | 200-confirmed writes | 400/404/409/422 | Same | — | Re-read; never blind | FP-06 AC09–12; §13b | Specified |
| 19–21 | Promo/coupon mgmt; role assign; audit review | Perms | Admin | Admin surfaces | Promo/coupon/users/audit | Confirmed writes/reads | 403/404/409 | Same | Secrets never rendered | Re-read | FP-11.8.x | Specified |
| 22–24 | Multi-tab stale; session-expiry-during-write; long-text/zoom/small | Concurrent contexts | Any | Any | Per screen | Truth displayed | Stale/401/overflow | FP-11.9 asserted | Per matrix | Revalidate | §6/§9; FP-16 §10 | Specified |
| 25–26 | Broken image/missing data; (reserved: payment-callback — no backend) | Content gaps | Visitor | Listing/PDP | Catalog/media | Fallback/gate | 404-partial | Same | — | Row-retry / gate | FP-07 §6; §8 | Specified (#26 N/A — no backend) |

## 12. Acceptance (DEFINED — NOT EXECUTED)

Unified map (§1) · commerce/ops bindings (§2) · offline statement (§3) · duplicates (§4) · expiry matrix (§5) ·
multi-tab (§6) · refresh/back/links (§7) · partial rules (§8) · media/long rules (§9) · ID recovery matrix (§10) ·
26 journeys mapped (§11) · zero invented ops/copy/endpoints · zero FP-04/05/06/11.10 redefinition (pointers kept).

---

*End of Edge Cases & Error Experience — specification-only, no implementation or testing.*
