# FE-2 — Store Shell & Homepage Report (2026-10-13)

> Production frontend work (read-only operations). No backend/contract/seed change, no commit/push,
> no handoff edit. Local PostgreSQL was started/stopped inside this session for read-only verification
> (restored to prior stopped state afterwards); zero writes performed by FE-2 code or tests.

## A. Repository Safety

- `D:\Hyper_el-moatasem` · `master` · `83253fe9…` == `origin/master` (before/after).
- Added: `src/lib/frontend/storefront-reads.ts`, `src/components/store/*` (header/search/nav/footer/card
  + 1 test file), `src/app/search/page.tsx`, `src/app/page.tsx` (rewritten from boilerplate),
  `e2e/fe2-store.spec.ts`, this report. Edited: `src/app/globals.css` (added `--color-success` token only).
- Untouched: backend, openapi, schema, admin shell/login, prototype, FE-1 foundation files, handoff.

## B. Implemented UI (real paths)

- `StoreHeader` (server: wordmark text per D16-behavior + `SearchBox` island), `StoreNav` (client island
  for active-state only; FP03-C1 five items — cart/orders/account honestly disabled + "قريبًا", categories
  anchors to homepage `#categories`), `StoreFooter` (brand + promise + only real links `/`, `/search`),
  `SearchBox` (submit-only, q≥2, no per-keystroke fetch), `ProductCard` (server: name/brand/price+bdi/
  compare-at-if-non-null/stock-text/image-or-neutral-fallback; no add-to-cart, no ratings, no invented badges).
- Homepage `/` (server, force-dynamic): static hero (approved promise, no campaign) + independent
  `CategoriesSection` (top-level, ≤12) + `FeaturedSection` (recent-first, neutral title "منتجات من المتجر");
  Offers section OMITTED (no feed — FP03-C2, verified absence).
- `/search` (server, minimal honest results: q 2..120 via `searchProducts`, ≤12, active-only; guided
  empty/invalid/error states; no filters/sort/pagination UI — FE-3+ scope, documented).

## C. Real Data Integration (audited per operation before use)

| Section | Operation | Fields used | Public? | Status |
|---|---|---|---|---|
| Categories | `GET`-equivalent `listCategories` (server lib; top-level, name-asc, ≤12) | id/name/slug | Yes (active-only) | LIVE (server reads) |
| Featured | `listProducts` (created_at desc, ≤8, active-only) + bounded enrichment (variants×1 + images + `getProductStockStatus`) | ListItem + first-variant price/compareAt + primary url + `isInStock` | Yes | LIVE |
| Search | `searchProducts` (relevance, ≤12, active-only) + same enrichment | SearchHit + same | Yes (q≥2 enforced) | LIVE |
| Offers | None exists (route inventory + FP03-C2) | — | — | OMITTED by contract |

No invented endpoints/params (all args exist in `ListParams`/`ProductListFilter`/`SearchFilter`); no
absolute URLs; no credentials; reads only; prices/brands/images/stock all from authoritative payloads.

## D. State Handling

Per-section try/catch → honest empty/error with retry-by-reload; hero static (survives total source failure);
loading via route-level Suspense-free first paint + skeleton atoms available (streaming deferred — documented);
partial failure never blanks the page (verified by structure + e2e degrade test); no stack traces; empty ≠ error.

## E. Tests & Verification (all executed)

- `npx vitest run`: **28/28** (22 FE-1 + 6 FE-2 shell/card/search).
- `npx playwright test e2e/fe2-store.spec.ts`: **6/6** (shell, degrade, search ×3 states, 6-viewport overflow
  ≤1px, RTL+bdi, admin/prototype regression); `foundation.spec.ts`: **4/4** (no regressions).
- `tsc` clean · `eslint src` clean · `npm run build` PASS. Test env: local PG started for reads, stopped
  after (baseline restored); no seeds/writes; assertions data-agnostic (data OR honest states).
- a11y: RTL/lang assertions + bdi + live regions in unit/e2e scope; full AT audit remains process-deferred.

## F. Contract Alignment

Applied: FP-17 K/B/G/H/J/L (RSC reads, honest pricing/units, no invented feed/badges/routes), FP03-C1/C2,
FP-03 registry states, FP-05 (price authority, OOS visible, no client math), FP-07 (field truth, fallbacks),
FP-10/DS (tokens, contrast-safe pairs; orange wordmark kept as brand-mark exception per D16 reference),
FP-11.9 (RTL/bdi/44px), FP-13 §3 (no client fetch layer added), FP-18 (metadata, no fake domain).
Out of scope kept out: PDP/cart/checkout/orders/auth-flows/admin ops/adapter/analytics/payments/CMS.

## G. Final Status — `COMPLETE WITH EXPLICIT LIMITATIONS`

DoD A–E hold with evidence above. Limitations (non-blocking, pre-classified): minimal `/search` (no
facets/pagination UI); interim disabled nav items (routes are FE-3+); streaming skeletons deferred;
brand-mark orange exception documented; local-DB-dependent live reads (empty/error states cover absence).

---

*End of FE-2 report — storefront shell + homepage only; no commerce flows built.*
