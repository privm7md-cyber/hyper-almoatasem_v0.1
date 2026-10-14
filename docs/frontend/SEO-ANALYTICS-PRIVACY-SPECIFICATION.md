# SEO, Performance Budgets, Analytics & Privacy Specification

> Scope note: FP-18 covers Core Web Vitals targets, security boundaries, and the public/private SEO
> boundary (REUSED, not duplicated). FP-00-D037 locks the analytics taxonomy (provider DEFERRED, Q003).
> FP-03 registry holds per-screen SEO/analytics flags (REUSED). This file ADDs only: URL/SEO detail,
> budget deltas, the event taxonomy spec, and the privacy matrix. No provider/SDK installed, no code,
> no config. Static review only. Targets are goals, never measurements.

## 1. Feature coverage (this file's scope)

| ID | Feature | Existing | Coverage | Action | Final |
|---|---|---|---|---|---|
| SAP-F01 | Core Web Vitals + catalog perf rules | FP-18 §1 | COMPLETE | REUSE | CLOSED |
| SAP-F02 | JS/CSS/image/font budgets | FP-18 (absent beyond images) | MISSING | ADD (§3, PROPOSED targets) | CLOSED (targets, unmeasured) |
| SAP-F03 | URL/canonical/metadata/OG/structured/sitemap/robots/edge cases | FP-18 §3 + FP-03/FP-09 (slugs/canonical) | PARTIAL | EXTEND (§2) | CLOSED |
| SAP-F04 | Analytics event taxonomy spec | FP-00-D037 (names) + FP-03 (per-screen) | PARTIAL (no event-field spec) | ADD (§4) | CLOSED (provider deferred) |
| SAP-F05 | Privacy/data-minimization matrix + consent/retention | FP-00-D046 + FP-18 §2 (fragments) | PARTIAL (no matrix) | ADD (§5) | CLOSED (legal review flagged) |

## 2. SEO & URL detail (extends FP-18 §3; URL shapes per FP-09 D01)

| Page type | Index? | Canonical | Title/desc source | OG/structured | Required data | Fallback | Invalid handling |
|---|---|---|---|---|---|---|---|
| `/` home | Index | Self | Approved copy (static until CMS) | Basic OG (no invented image) | Sections per FP-11.1 | Omit unapproved sections | N/A |
| `/c/[id]/[slug]`, `/brand/[id]/[slug]` | Index | Canonical slug URL (mismatch → 301 to canonical; stale slugs resolve) | name + taxonomy fields | No product markup on listings | Live category/brand rows | Honest empty | Unknown id → 404 |
| `/p/[id]/[slug]` | Index iff sellable-data complete | Same canonical rule | name + description (iff non-null) | Product markup ONLY with complete authoritative price/availability (else omitted, never partial-false) | Variant + price + stock + gallery | Missing brand/desc per FP-07 (no markup from fallbacks) | Unknown/inactive → 404; OOS stays indexed with accurate availability, never delisted silently |
| `/search` (+query) | Noindex (result pages) | Self, params preserved | Query-echo title (sanitized) | None | q + filters | Guided empty | Invalid → guided empty, not 404 |
| `/offers` | Noindex until real feed | Self | Static | None | Feed (absent → honest empty) | Honest empty | N/A |
| Cart/checkout/account/orders/confirmation | Noindex + auth-gated | N/A | N/A | None | — | — | Auth-gated |
| All `/admin/*` | Noindex + auth-gated | N/A | N/A | None | — | — | 401/403 surfaces |
| Static `/pages/[slug]` | Index iff approved copy | Self | Approved copy | None | Copy | Noindex until approved | Unknown slug → 404 |
| Error pages | Noindex | N/A | Generic | None | — | — | Correct status codes (404/403/500) |

Sitemap/robots: sitemap lists indexable canonicals only (no private/auth/empty-query URLs); robots disallows
`/cart`, `/checkout`, `/order-confirmation/*`, `/orders*`, `/account*`, `/admin/*`, `/search` (query variants).
No sitemap/robots files exist in repo (verified absence: no sitemap/robots routes) — generation is future
implementation work, specified here. Trailing-slash: single normalized form (redirect, no duplicate indexing).
Arabic metadata from approved copy; no invented descriptions/slugs/prices.

## 3. Performance budget deltas (PROPOSED PERFORMANCE TARGETS — unmeasured, with verification method each)

Core Web Vitals + catalog rules = FP-18 §1 (unchanged). ADDITIONS (all PROPOSED, 20k-catalog mobile-first):

| Budget | Target | Verifies by |
|---|---|---|
| Initial JS (storefront, gz) | ≤ 170 KB | Lab bundle audit per release |
| CSS (gz) | ≤ 30 KB | Same |
| Image weight, listing viewport | ≤ 800 KB initial (reserved slots + lazy below fold) | Lab + traffic-light per template |
| Font | 1 variable file (Cairo, latin+arabic subsets) + system fallback; `font-display: swap` | Lab filmstrip (no swap-invisible text regressions) |
| Search interaction | First results paint ≤ 600 ms lab on mid-tier (debounced, latest-wins) | Lab interaction timing |
| Admin tables (1k-row window) | Keyset pages ≤ 500 ms lab render (no full loads) | Lab |
| API p50/p95 | No invented targets (FP-18 rule kept) — report only | RUM when traffic exists |

Slow-network: skeletons + staged enhancement; never blank; admin degrades to fewer columns (card fallback per
FP-11.9), never to fabricated aggregates.

## 4. Analytics event spec (taxonomy LOCKED D037; provider DEFERRED Q003 — no SDK)

Base rules: fire on server-confirmed facts where the event claims success (intent vs success split kept);
dedupe by (event, entity, idempotency outcome); never: passwords/tokens/secrets/phones/addresses/full
cart-or-order bodies/guest credentials in props; version `v1` in every payload; retention/consent UNDEFINED —
OWNER/LEGAL REVIEW REQUIRED before any collection starts.

| Event (D037 name) | Trigger (success-gated) | Required props | Optional | Source screen | Dedup | Privacy |
|---|---|---|---|---|---|---|
| view | PDP render with live data | productId, variantId | slug | S-PDP | Per view (no dedup) | Public catalog data only |
| search | Submit accepted (q≥2) | query (sanitized), filters | resultCount | S-SEARCH | Per submit | Query text only (no PII) |
| add | Server-confirmed add (echo) | productId, variantId, qty | unitPrice band? No — exact values stay server-side; send band only | PDP/card | Per confirmed add | No prices exact (banded) |
| remove | Server-confirmed remove | productId, variantId | — | Cart | Per confirmed remove | Same |
| checkout-start | Checkout entry w/ non-empty cart | cartSize band | — | S-CART→CHECKOUT | Per entry (not per render) | Bands only |
| checkout-complete | 201 creation ONLY | orderValue band, itemsCount band | — | S-CHECKOUT | Idempotency-key dedup | Bands only, never payload |
| coupon | Server-evaluated outcome | outcome (applied/refused), reasonClass | — | Checkout | Per evaluation | No codes |
| order (created) | Same 201 as complete (alias per D037; single fire) | Same bands | — | S-CHECKOUT | Same dedup key | Same |
| cancel / replacement-decided | Server-confirmed cancel/decide | orderId hash? No — opaque ref only + outcome | — | S-ORDER | Per confirmed op | Opaque refs only |
| auth-result | Login/register/logout/session-expiry outcomes | outcome class | — | Auth | Per attempt (rate-aware) | No credentials |

Per-screen planned flags in FP-03 registry stay authoritative for placement; this table defines payload/discipline.

## 5. Privacy matrix (D046 + FP-18 §2 binding; consent/retention need OWNER/LEGAL REVIEW)

| Data | UI use | Browser storage | Analytics | Logs | Admin display | Backend retains | NEVER in URL/telemetry |
|---|---|---|---|---|---|---|---|
| Phone | Display masked where possible | No (session cookie only) | No | No (D046) | Perm-gated full | Yes (identity) | Always |
| Address | Forms + snapshots | No | No | No | Perm-gated | Yes (snapshots) | Always |
| Order details | Owner reads | No | Bands only | No PII | Owner/perm only | Yes | Always |
| Guest-order token | Adapter-held HttpOnly (FP03-G1) | HttpOnly cookie only | No | No (auto-redaction) | Never shown | Hash only | Always |
| Guest-cart token | Header per request | Bearer (device-local) | No | No | N/A | Hash only | Always |
| Session credential | Cookie auto-sent | HttpOnly `__Host-` | No | No | Never shown | Hash/server row | Always |
| Password/auth material | Forms only | Never | No | No | Never | Hash only | Always |
| Audit rows | Admin reads | No | No | IS the log (server) | audit_logs.view | Append-only | Secrets never rendered |
| Coupon usage | Outcome display | No | Outcome class only | No PII | Aggregates only if exposed (counts are NOT exposed — FP-05 G2) | Yes | Always |

Consent management + retention schedule + legal-basis review: NOT defined anywhere in repo → OWNER/LEGAL REVIEW
REQUIRED before collection/retention claims. No legal-compliance claim made here.

## 6. Acceptance (DEFINED — NOT EXECUTED)

URL/canonical/metadata/OG/structured/sitemap/robots/edge table (§2) · budgets with methods (§3) · event spec
with dedup/privacy/version (§4) · privacy matrix + legal-review flags (§5) · zero provider/SDK/file claims ·
zero FP-18/D037 redefinition (pointers kept).

---

*End of SEO/Analytics/Privacy — specification-only, no implementation or measurement.*
