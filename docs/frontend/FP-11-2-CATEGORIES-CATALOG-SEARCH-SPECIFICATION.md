# FP-11.2 — Categories, Catalog & Search UX Specification

> Classification: `VERIFIED` (repo/openapi evidence below) · `LOCKED` (existing approved decision) ·
> `RECOMMENDATION` (proposed, needs owner review) · `NEEDS OWNER DECISION` · `UNSUPPORTED`
> (capability absent) · `NOT VERIFIED` · `DEFERRED`. Specification only — no implementation claimed.

## 1. Executive summary and verdict

**Verdict: `SPECIFICATION COMPLETE — OWNER APPROVALS RECORDED (D12, D13, D17, D18)`.**
Category browsing (hierarchy via `parentId`, top-level filter, admin-managed `sortOrder`), catalog
listings (verified filters, name/created_at sorts, opaque keyset pages), search (q 2–120,
relevance/newest, keyset pages, no autocomplete), product-card data contracts, cart indicator
behavior, responsive/RTL/a11y rules, and a 28-state matrix are fully specified from verified
contracts. Owner-approved 2026-10-09: D12 ordering, D13 empty-category display, D17 orchestration,
D18 search UX. Remaining owner-supplied inputs (curated imagery/policy texts) are content
dependencies, not open decisions. No popularity, price-sort, offers-feed, autocomplete, or
cross-device claims invented.

## 2. Scope and non-goals

In scope: category index/hierarchy/ordering, listing pages, search UX, filter/sort audits,
keyset pagination architecture, product cards in results, URL/history preservation, responsive/RTL/
a11y, state matrix + microcopy, endpoint mapping, decision register, acceptance criteria. Non-goals:
implementation, CSS/components, backend changes, data seeding, CMS,autocomplete construction,
FP-11.3+, deploy, commit.

## 3. Repository/API evidence

| # | Capability | Evidence | Status | Constraint |
|---|---|---|---|---|
| E1 | Category list + detail | openapi `GET catalog/categories`, `categories/{id}`; `parent` = UUID\|`"null"` filter (`validation.ts:95`, `queries.ts:50-60`) | VERIFIED | No popularity/curation field |
| E2 | Category shape | `{id,name,slug,description,image,parentId,isActive,sortOrder,createdAt,updatedAt}` (`serialize.ts:18-44`); `sortOrder` admin-managed, default 0 | VERIFIED | No product counts; server sorts name/created_at only |
| E3 | Product list | openapi `GET catalog/products` (search/category-subtree/brand/type/price-window/inStock; OOS listed) | VERIFIED | No totals; cursor pages only |
| E4 | List fields | `ProductListItem`: id/name/slug/productType/unit/saleStepGrams/isActive/category{}/brand{} (`serialize.ts:68-97`); detail adds `description` | VERIFIED | **No price/compareAt/stock/image in list/detail** |
| E5 | Search | openapi `GET catalog/search` (q 2–120 required; relevance/newest; opaque v:2 cursor; 400 short/bad) | VERIFIED | No autocomplete/suggestions endpoint |
| E6 | Sorts | Listing `SORT_FIELDS = [name, created_at]` + asc/desc (`validation.ts:56-65`); search `SEARCH_SORTS` | VERIFIED | No price/popularity sort anywhere |
| E7 | Pagination | Opaque keyset cursors, limit 1..100 default 20, take-limit+1, `nextCursor null` = end | VERIFIED | No page numbers/totals; cursors opaque |
| E8 | Variants | `products/{id}/variants`, `variants/{id}`: id/productId/name/sizeValue/sizeUnit/price/compareAtPrice/isActive | VERIFIED | Price lives only here |
| E9 | Images | `products/{id}/images` → `{primary, gallery}`; empty array when none | VERIFIED | Per-product call; may be empty |
| E10 | Availability | `inventory/products\|variants/{id}` → quantity/reserved/available strings; status `in_stock/low_stock/out_of_stock` derived (`serialize.ts:5-19`) | VERIFIED | Per-product/variant call |
| E11 | Brands | `GET brands`, `brands/{id}`: id/name/slug/logo/isActive | VERIFIED | Listing page is a design choice |
| E12 | Codes lookup | `GET codes/lookup?code=` → variant match / 404 | VERIFIED | Cashier/barcode aid, not customer search box |
| E13 | Cart read/mutate | Full-cart read + mutation responses; XOR identity; 400/401/404/409/422 mapped | VERIFIED | Indicator derives from confirmed cart |
| E14 | Rate limits | Login buckets only (`rate-limit.ts`); nothing on public catalog/search reads | VERIFIED | No 429 handling needed on discovery |
| E15 | Error envelope | `{error:{code,message,details}}`; VALIDATION→400 … RATE_LIMITED→429, GONE→410 | VERIFIED | Map codes, never raw codes |
| E16 | Deps/conventions | Next 16.3.8, React 19, zod, zustand, Tailwind v4; RSC default; no fetch library | VERIFIED | RSC fetch + handlers; no SWR/RQ assumptions |

## 4. Category index and hierarchy

Top-level = `parent=null` filter; children via `parent=<uuid>`; inactive rows excluded storefront-side;
slugs display/canonical only (detail fetch by UUID). Depth unbounded in model — UI supports arbitrary
nesting via recursive drill-down, never assuming a fixed depth. Unknown/inactive id ⇒ not-found.
Empty category ⇒ honest empty state (never hidden silently). Category without products is valid data,
not an error. No popularity, counts, merchandising order, or images invented (image field used only
when backend returns non-null).

## 5. Catalog/listing UX

Reusable listing contract for category results, search results, and brand results (where page built):
title + context (category/brand/query chip), result rows, supported filter bar, supported sort
control, keyset “load more”, URL-held state, invalid-param sanitization (drop unknown keys, clamp
limit, default sort on bad value — all client-side, contract-compatible). Result counts NEVER shown
(no totals exist; showing “N results” from a loaded page is forbidden). Listing implies nothing
about completeness. Mobile: drawer filters + sticky sort bar; tablet/desktop: inline filter rail;
RTL logical order; keyboard-operable controls with visible focus.

## 6. Search UX

Submit-only (no autocomplete — unsupported; no client-side suggestion simulation). Empty query ⇒
guided empty state (no API call). `q` validated client-side to 2..120 before send (400-avoidance,
not a behavior change). Results preserve `q` + filters in URL; reload/share re-executes; back from
PDP restores scroll + params. No-results ⇒ adjust/filters suggestion (distinct from transport
failure → retry keeping query). In-flight: debounce submit + latest-wins discard; failure ⇒ retry.
Keyboard: Enter submits, Esc clears field. Barcode box is NOT customer search (codes/lookup is a
cashier aid; exposing it as customer search is UNSUPPORTED).

## 7. Filter audit and supported-filter decision

| Candidate | Supported? | Param/scope | Notes |
|---|---|---|---|
| Category (subtree) | VERIFIED | `category` UUID; server-side pre-pagination | Include |
| Brand | VERIFIED | `brand` UUID | Include |
| Type PIECE/WEIGHT | VERIFIED | `type` | Include |
| Price window | VERIFIED | `minPrice`/`maxPrice` decimal strings | Variant-price semantics (any-match); include with honest labeling |
| Availability | VERIFIED | `inStock` true/false | Sellable + available>0 semantics; include |
| Search text (in listing) | VERIFIED | `search` | Include where useful |
| Discount/offers-only | UNSUPPORTED | — | Exclude; no endpoint (see FP-11.1 offers rule) |
| Rating/popularity | UNSUPPORTED | — | Exclude entirely |
| Price sort | UNSUPPORTED | — | Exclude; sorts are name/created_at (+relevance/newest in search) |

Rule: a filter ships iff server-applied pre-pagination with verified params; never client-filter a
loaded page while implying catalog-wide filtering; never fetch-all to simulate filtering.

## 8. Sorting audit and supported-sort decision

Supported: listing `name`/`created_at` × asc/desc; search `relevance` (default)/`newest`. Each sort
documents: exact value, default, server-side stable order, cursor compatibility (cursor invalidates
on sort/filter change → reset), invalid value → default. Price ascending/descending, bestsellers,
trending, “most popular”: UNSUPPORTED — never offered, never locally simulated.

## 9. Pagination and large-catalog behavior

Keyset-only: initial batch (default 20, cap 100) → “load more” appends via opaque `nextCursor`;
`null` = end (disable control, no spinner loop). Failed next-page ⇒ inline retry preserving
loaded items. Criteria change ⇒ cursor reset + fresh fetch. Stale/invalid cursor ⇒ 400-mapped
message + refetch from start. Back-navigation restores scroll + params (no re-fetch if cache valid
per §11 rules; prices/stock always revalidated before commerce actions). No numbered pages, no
arbitrary jumps, no immutability promise across requests (catalog is live). Deep links with cursors:
best-effort restore, degrade to first page on stale cursor — never an error wall.

## 10. Product-card behavior and data dependencies

Card = §6 FP-11.1 contract (name/image-variant/unit/price/availability/add + compare-at/promo only
from verified payloads). Listing cost per card: list row + variants + inventory + images calls
(E4–E7, E10); no batch endpoint exists (verified absence). Mitigations within contract: per-render
request cache/dedup, skeletons with fixed slots, progressive fill, per-card retry, bounded initial
counts (§11), independent section failure. PIECE: sellable variant required (never assume single
variant), whole-pack quantities. WEIGHT: backend-supported gram presets per `saleStepGrams` only;
estimate shown, never final; per-kg clarity. «غير متوفر»: visible + disabled add where contract
blocks; missing image: neutral fallback. Add-to-cart: pending → server-confirmed success → failure
retry; duplicate-submit guard; indicator from confirmed cart response (total quantity, FP-11.1
closure); never pre-confirm success.

## 11. URL/history/state preservation

In URL: `q`, `category`, `brand`, `type`, `minPrice`, `maxPrice`, `inStock`, `sort`, `dir`, `cursor`,
`limit`. Transient: scroll (restored, not serialized), pending input, per-card enrichment. Direct
links supported for listings/search (re-execute on load). Back/forward restores params + scroll.
Refresh re-runs the query (fresh truth). Filter/sort change resets cursor. Invalid/stale params
sanitized, never crash. No secrets/session/guest tokens in URLs (FP-04 rule).

## 12. Responsive, RTL, and accessibility requirements

Mobile: single column → 2-col cards ≥360px, 44px targets, bottom nav intact, drawer filters, sticky
sort only if non-occluding. Tablet: 3-col, condensed header. Desktop: 4–6 col, inline filters.
No invented px breakpoints (Tailwind v4 defaults at build; behavior specified, not values). RTL:
`dir=rtl`, logical properties, Arabic-first copy, Latin SKUs/numbers/prices isolated (`bdi`);
directional icons mirrored, brand/technical symbols never. A11y: named controls, labelled steppers,
announced status/price changes, focus-visible order, error association, non-color-only stock states,
skeleton `aria-busy`. No WCAG conformance claimed without testing.

## 13. State matrix and proposed Arabic microcopy

| # | State | Trigger → UI → action → scope |
|---|---|---|
| 1–3 | Index loading/success/empty | fetch → skeletons/list/guided-empty (“لا توجد أقسام متاحة حاليًا”) → retry/browse; local |
| 4 | Index error | transport → section error, rest intact → retry; local |
| 5 | Category empty | zero products → honest empty + sibling/parent path; local |
| 6 | Invalid category | unknown/inactive id → not-found; local |
| 7–10 | Listing loading/results/empty/failure | fetch → skeletons/rows/empty-with-adjust/error-retry; local |
| 11–13 | Cursor loading/failure/end | next-page → inline spinner / retry-keeps-items / disabled “لا مزيد من النتائج”; local |
| 14–16 | Search idle/pending/success | untouched box / spinner + latest-wins / results; local |
| 17–18 | Search no-results/invalid | no match → adjust suggestion / short query → guided message; local |
| 19 | Rate-limited search | only if backend 429s (no evidence on public reads) → NOT VERIFIED path; generic retry wording if ever observed |
| 20 | Search failure | transport → retry-keeps-query; local |
| 21 | Filter/sort pending | applying → disabled controls + spinner; local |
| 22 | Unsupported filter/sort | n/a (never offered) — guarded by omission |
| 23 | Missing image | null/404 → neutral fallback; local |
| 24 | Unavailable | stock/state → «غير متوفر» + disabled; local |
| 25–27 | Add pending/success/failure | mutation → spinner / confirmed badge / error+retry; indicator from confirmed cart; local |
| 28 | Partial card-data failure | enrichment fail → row with retry, grid intact; local |

Microcopy is proposed (RECOMMENDATION) except FP-04/FP-05 locked strings, which prevail on conflict.

## 14. API-to-UX mapping

Categories list/detail/parent-filter → index/hierarchy · products list (filters/sorts/cursor) →
listings · search (q/sorts/cursor) → results · products/[id]+variants+images+inventory → PDP/card
enrichment · brands → optional brand pages · codes/lookup → cashier aid (not customer search) ·
cart read/mutate/merge/reprice → indicator + states · estimate → coupon/preview (checkout scope).
Absent: offers/promotions/coupons-list/content/settings/delivery/profile/profile-edit/payments/
popularity/price-sort/autocomplete/batch endpoints.

## 15. Decision register

| ID | Topic | Evidence | Decision/recommendation | Alternatives | Impact | Status | Owner? |
|---|---|---|---|---|---|---|---|
| FP11-D11 | Category index source | E1 + parent filter | Top-level + drill-down from live API | Static list (rejected) | Correctness | VERIFIED | No |
| FP11-D12 | Category ordering | sortOrder exposed; server sorts name/created_at | Client (sortOrder, name) within fetched top-level; max 6 homepage | Popularity (rejected: no source) | Deterministic UX | OWNER-APPROVED (2026-10-09) | Approved |
| FP11-D13 | Empty categories | Valid-data finding | Show with honest empty listing | Hide all (rejected: valid data) | Honesty | OWNER-APPROVED (2026-10-09) | Approved |
| FP11-D14 | Listing filters offered | §7 audit | category/brand/type/price/inStock/search only | More (rejected: unsupported) | Correctness | VERIFIED | No |
| FP11-D15 | Sorts offered | §8 audit | name/created_at (+relevance/newest search) | Price/popular (rejected) | Correctness | VERIFIED | No |
| FP11-D16 | Pagination model | Keyset verified | Cursor load-more + URL state rules | Numbered pages (rejected) | Feasibility | VERIFIED | No |
| FP11-D17 | Card data orchestration | E4–E10, no batch endpoint | Bounded + cached + progressive + per-card retry | Prefetch-all (rejected) | Performance | OWNER-APPROVED (2026-10-09) | Approved |
| FP11-D18 | Search UX | E5, no autocomplete | Submit-only + debounce + latest-wins | Suggestions (rejected) | Correctness | OWNER-APPROVED (2026-10-09; contract part VERIFIED) | Approved |
| FP11-D19 | Barcode in customer UI | Codes endpoint is cashier aid | Not exposed as customer search | Expose (rejected: misleading) | Scope honesty | VERIFIED | No |
| FP11-D20 | Brand pages | Brand endpoints exist | Optional index/detail pages | Skip (if thin assortment) | Discovery | RECOMMENDATION | No* |

\*Starred item (FP11-D20, brand pages) remains a non-binding presentation default with zero
contract impact; it is NOT owner-approved. Owner-visible content inputs (curated imagery/policy
texts) remain owner-supplied per prior phases. D12, D13, D17, D18 were recorded owner-approved on
2026-10-09 per explicit owner authorization for those four IDs only.

## 16. Acceptance criteria

- AC-C1: category index renders live top-level data with hierarchy drill-down; unknown id ⇒ not-found.
- AC-C2: ordering follows (sortOrder, name) deterministically; no popularity claims.
- AC-C3: empty categories show honest empty listings, never hidden as errors.
- AC-S1: q validated 2..120 client-side; empty ⇒ guided empty without API call.
- AC-S2: sorts limited to relevance/newest; invalid ⇒ default; cursor resets on criteria change.
- AC-S3: no autocomplete implied anywhere.
- AC-F1: only §7 filters offered; each server-applied pre-pagination.
- AC-F2: no price/popularity sort offered or simulated.
- AC-O1: keyset load-more appends without duplicates; end state disables; failure retries preserving items.
- AC-O2: invalid/stale cursor ⇒ 400-mapped message + fresh refetch, never crash.
- AC-P1: cards show server price/stock/images only; compare-at only when returned; OOS visible + disabled.
- AC-P2: PIECE whole-pack vs WEIGHT step-presets honored; estimates never final.
- AC-P3: add-to-cart states + duplicate guard + indicator from confirmed response.
- AC-U1: full filter/sort/cursor state in URL; reload/share/back/refresh behave per §11.
- AC-U2: no secrets/tokens in URLs.
- AC-R1: mobile/tablet/desktop/RTL/a11y behaviors per §12; bottom nav intact.
- AC-T1: all 28 states reachable with specified trigger/UI/action/contract.
- AC-X1: zero app-code/dependency changes (verify via status).

## 17. Explicit unsupported/unverified capabilities

No offers/promotions/coupons-list/content/settings/delivery/profile-edit/payments endpoints; no
popularity/bestseller source; no price sort; no autocomplete; no batch fetch; no totals; no cross-
device cart/token claims; cart echo shape re-verified at build; footer policies pending owner input.

## 18. Dependencies and recommended future work

None required for specification completeness. Future backend candidates (not requested, only
recorded if valuable): dedicated offers feed, product-count facets, price-sort contract, batch
variant/inventory/images fetch, slug-based detail lookup. No phase proposed or started.

## 19. Clear verdict and readiness assessment

```text
SPECIFICATION COMPLETE — OWNER APPROVALS RECORDED (D12, D13, D17, D18)
```

D12, D13, D17, and D18 are owner-approved as recorded above; none affects contracts or locked
decisions. Content inputs (imagery/policy texts) stay owner-supplied per prior phases.
Implementation, FP-11.3, and any later work untouched.
