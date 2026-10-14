# FP-18 — Performance, Frontend Security & SEO Specification

> Classification: `ADOPTED — TECHNICAL DEFAULT` (targets/methods) · `RESOLVED — EXISTING CONTRACT`
> (security boundaries). Targets are goals, never results — nothing measured or passed here.

## 1. Performance targets (official web.dev Core Web Vitals, verified this task)

Good thresholds at the **75th percentile**, segmented mobile + desktop
(source: web.dev vitals + thresholds articles): **LCP ≤ 2.5s · INP ≤ 200ms · CLS ≤ 0.1**.
Field data (CrUX/RUM, real traffic) is the compliance basis; lab (controlled devices/network) is the
pre-traffic proxy. No field traffic exists yet → no compliance claimable now.
Minimum lab conditions: representative mid-tier mobile + desktop, throttled + unthrottled runs,
20k-catalog category/search/listing flows, image-heavy grids. Catalog rules: cursor pagination only,
debounced/latest-wins search, bounded card enrichment, no full loads, no N+1, stale-discarding.
Admin tables: same discipline. Regression detection: repeat the lab set per release; deltas over
absolute vanity. Build time ≠ user performance. No custom API-latency targets (no basis — none invented).

## 2. Frontend security requirements

Secrets: server-side only (HttpOnly cookies; `__Host-` customer session; no `NEXT_PUBLIC_` secrets;
no tokens/phones in URLs/logs/errors — D35/D36 + G5 digest rules). Server-only boundary enforced
(build breaks on violation). Session/guest/order-credential separation (FP-11.5/11.7). 401 vs 403
fidelity; no stale private data post-identity-change; untrusted API data rendered safely (no
`dangerouslySetInnerHTML` without sanitization — none in repo today); generic error surfaces;
cache isolation per FP-14 (no shared authenticated caches). Dependency hygiene: audit on install,
pin versions, no new packages without need (this task adds none). No new backend security
architecture invented.

## 3. SEO policy (public vs private)

Public/indexable candidates: home, category/brand listings, PDPs (titles/descriptions from verified
fields; canonical URLs; not-found → 404; availability/price markup ONLY from authoritative payloads;
image alt from metadata). Private (never indexed): cart, checkout, account, orders, all `/admin/*`
(noindex + auth-gated). No sitemap/robots decisions beyond: do not index private areas; structured
data only where fields verified. Advanced metadata (OG images, hreflang) deferred, not assumed.

## 4. Acceptance (DEFINED — NOT EXECUTED)

Measurement method + regression tracking defined; security behaviors per §2; public/private boundary
per §3; metadata correctness rules; infra prerequisites (field traffic, image pipeline) explicit;
per-package vs final-hardening split per FP-16 (unit/integration early, full matrix late).

---

*End of FP-18 — specification-only, no implementation or measurement.*
