# FE-3 — Catalog & Search Report (2026-10-13)

> Production frontend work (read-only operations). No backend/contract/seed change, no commit/push,
> no handoff edit. Local PostgreSQL started/stopped inside this session for read-only verification
> (baseline restored); zero writes by FE-3 code or tests. Local dev DB is EMPTY (0 categories/products
> verified via read-only API probes) — expectations below account for that honestly.

## A. Repository Safety

- `D:\Hyper_el-moatasem` · `master` · `83253fe9…` == `origin/master` (before/after).
- Added: `src/lib/frontend/listing-params.ts`, `src/app/actions/catalog.ts`, `src/components/store/`
  `{filter-panel,load-more,store-shell}.tsx`, `src/app/{categories,c/[id]/[slug],brands,brand/[id]/[slug]}`
  pages, `src/lib/frontend/__tests__/listing-params.test.ts`,
  `src/components/store/__tests__/catalog.test.tsx`, `e2e/fe3-catalog.spec.ts`, this report.
- Evolved (FE-2 pieces, behavior preserved + retested): `storefront-reads.ts` (+paged/brand/category
  readers), `/search` (filters/sort/load-more added; guided states kept), homepage (shell reuse + linked
  tiles + index links), `globals.css` (+1 token). Untouched: backend/openapi/schema/admin/prototype/FE-1.

## B. Implementation Summary

- Routes: `/categories`, `/c/[id]/[slug]` (UUID fetch, display-only slug, canonical 301, unknown→404),
  `/brands`, `/brand/[id]/[slug]` (same contract, FP-09 D08), `/search` (extended, noindex kept).
  No PDP/cart/checkout built (FE-4+); cards link-free (no broken detail routes — documented interim).
- Listings: filters category/brand/type/inStock/price-window (all schema-verified), sorts
  name/created_at + relevance/newest (no price sort — verified absence, never offered).
- Pagination: opaque keyset + "load more" append via bound server actions (bounded 12; enrichment capped);
  no page numbers/totals (contract forbids invention); cursor kept OUT of URL (page-1 canonical).
- URL state: filters/sort/query synced (push discrete, form-submit prices), clear keeps query, refresh/back
  restore; malformed values sanitized (never crash/500).
- SEO: per-page titles/descriptions from live names; listings indexable + canonical-slug redirects;
  search noindex; no OG/structured beyond verified fields; no sitemap generation.

## C. Backend Capability Evidence (all BACKEND-CONFIRMED from code, no assumed endpoint)

| Capability | Source | Params | Fields | Decision |
|---|---|---|---|---|
| Product listing | `listProducts` (queries.ts:132) | categoryId(+subtree)/brandId/type/min/max/inStock/active/sort/dir/cursor/limit≤100 | ListItem + variants/images/stock via dedicated reads | Supported |
| Category listing | `listCategories` (:50) | search/parent/active/sort/cursor | id/name/slug/desc/image | Supported |
| Brand listing | `listBrands` (:79) | search/active/sort/cursor | id/name/slug/logo | Supported |
| Search | `searchProducts` (search.ts:151) | q 2..120/sort relevance-newest/same filters/keyset cursors | SearchHit (no price — enriched) | Supported |
| Pagination | take limit+1 → nextCursor|null (all four) | Opaque cursor, forward-only, no totals | `nextCursor` | Supported (keyset) |
| Sorting | `SORT_FIELDS` name/created_at; `SEARCH_SORTS` relevance/newest | As listed | Ordered rows | Supported (no price sort) |
| Price filter | `priceFilterSchema` (decimal ≤2dp, >0) | minPrice/maxPrice | Windowed rows | Supported |
| Offers feed / autocomplete / popularity / counts | Zero hits (route inventory + FP03-C2) | — | — | NOT-SUPPORTED (omitted, documented) |

## D. Large Catalog Handling

- Page size 12 everywhere; enrichment ≤8 products × (1 variant + gallery + stock view) per initial page,
  12×3 per load-more (bounded, server-side, no client fan-out; no full-catalog fetch/store/scan anywhere).
- Keyset forward-only; cursor reset on filter/sort change; no totals/page numbers shown.
- Known perf note: category pages fan out ~37 small reads; acceptable server-side, flagged for future
  batching if listings grow (no backend change proposed).

## E. UX and States

Loading (route + button pending) / Empty (guided, per section) / Error (per-section isolation + retry-by-
reload) / Partial (hero survives source failure) / invalid-URL sanitize / no-results / OOS-visible cards /
RTL + bdi prices + 44px targets + labeled controls + error announcements. Back/forward restore via history
pushes; refresh keeps full URL state (cursor append restarts at page 1 — documented keyset limitation).

## F. Tests (all executed; env: local PG started/stopped, empty DB verified)

- `npx vitest run`: **37/37** (28 prior + 9 FE-3: URL parse/build/round-trip/sanitize ×6, panel push/clear ×2, load-more ×1).
- `npx playwright test e2e/fe3-catalog.spec.ts`: **8/8** (index, empty-honest, URL-state filter/sort/clear/back/refresh, brands+404s, search states, conditional load-more, no-badges, 4 viewports overflow-free).
- Regression: fe2-store 6/6 + foundation 4/4 + vitest prior suites green.
- `tsc` clean · `eslint` clean · `npm run build` PASS. Two real bugs found by tests and fixed (footer-wide
  locator masking empty state; dev-cold-start timeouts documented as 90s spec timeout).

## G. Known Limitations

- Empty local DB ⇒ data-paths (filter results, load-more append, OOS visibility) verified structurally +
  by unit contract, not against live rows; re-run suites where fixtures exist before release claims.
- Minimal `/search` facets (no autocomplete/popularity/counts — backend-absent); cursor pagination is
  append-only (no deep-linkable pages); sitemap/structured-data generation deferred; PDP/cart/checkout
  routes still FE-4+ (cards intentionally link-free).

## H. Final Status — `COMPLETE WITH EXPLICIT LIMITATIONS`

Acceptance A–F hold with evidence: real catalog/search/filter/sort/keyset/URL behavior on live reads,
honest states, no invented capabilities, full regression green. Limitations in §G (non-blocking,
environment- + contract-classified).

---

*End of FE-3 report — catalog browsing + search only; no commerce flows built.*
