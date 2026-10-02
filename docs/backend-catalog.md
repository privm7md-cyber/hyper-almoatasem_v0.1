# BA-2 Catalog — implementation record

> Backend APIs only. No frontend. No BA-3+. No schema/migration changes.
> All catalog behavior verified on scratch (`hyper_almoatasem_scratch`,
> rebuilt deterministically for this phase); production untouched.

## Endpoints

Storefront (public, active-only rows, prices included for display):

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/store/catalog/categories` | list (search, parent, sort, cursor) |
| GET | `/api/store/catalog/categories/[id]` | get one |
| GET | `/api/store/catalog/brands` | list (search, sort, cursor) |
| GET | `/api/store/catalog/brands/[id]` | get one |
| GET | `/api/store/catalog/products` | list (search, category, brand, type, sort, cursor) |
| GET | `/api/store/catalog/products/[id]` | get one + taxonomy |
| GET | `/api/store/catalog/products/[id]/variants` | variants of a product |
| GET | `/api/store/catalog/variants/[id]` | get one (no cost basis) |
| GET | `/api/store/catalog/codes/lookup?code=` | global code → variant + product |

Admin (session + RBAC; reads `products.view`):

| Method | Route | Permission | Purpose |
|---|---|---|---|
| GET/POST | `/api/admin/catalog/categories` | view / create | list (explicit active filter) + create |
| GET/PATCH | `/api/admin/catalog/categories/[id]` | view / update | get + edit + deactivate (no hard delete) |
| GET/POST | `/api/admin/catalog/brands` | view / create | same shape as categories |
| GET/PATCH | `/api/admin/catalog/brands/[id]` | view / update | same shape |
| GET/POST | `/api/admin/catalog/products` | view / create | list + create (weight-rule checked) |
| GET/PATCH | `/api/admin/catalog/products/[id]` | view / update | get + edit (type/unit/step immutable) |
| GET/POST | `/api/admin/catalog/products/[id]/variants` | view / create | scoped list + create |
| GET/PATCH | `/api/admin/catalog/variants/[id]` | view / update | get (with cost) + edit (not price) |
| PATCH | `/api/admin/catalog/variants/[id]/price` | update | price + history row, one tx |
| POST | `/api/admin/catalog/codes` | create | create code |
| GET/PATCH/DELETE | `/api/admin/catalog/codes/[id]` | view / update / delete | detail, type/primary edit, hard remove |

## Authorization decision (documented, uses only frozen keys)

Taxonomy has no dedicated keys in the frozen 31-key matrix, so category /
brand / product / variant / code operations map onto the product
capabilities: reads → `products.view`; creates → `products.create`;
updates → `products.update`; deactivation and code removal →
`products.delete`. STORE_ADMIN holds all of these (none excluded);
SUPER_ADMIN holds all. Permission mapping lives in the routes, not in a
parallel system. Storefront reads are public but force active-only rows at
the query level; admin reads take an explicit active filter.

## Validation / errors / responses

- Zod strict boundary on every route (malformed UUID → 400, bad
  pagination/enum → 400, blank/spaced code → 400); unknown parents →
  422; unknown ids → 404; duplicates (slug, variant name, code, primary
  race) → 409 via constraint mapping (never raw DB errors).
- BA-1 envelope `{ data, meta }` / `{ error: { code, message, details } }`
  on all new routes; existing session route shape untouched.
- Weight rule mirrored in domain (WEIGHT↔KG/GRAM+step / PIECE↔PIECE+no
  step); variant compare/size rules mirrored; DB CHECKs remain sole
  enforcers. Slug derived (lowercase/hyphenate, Arabic-safe) when omitted.
- Codes: trim-only normalization (case preserved — global UNIQUE is
  case-sensitive). Primary switch is one atomic UPDATE scoped to the
  variant. Variant `price` changes only via `/price` (history row same tx);
  product type/unit/step immutable after creation.
- Decimals serialize via Prisma `Decimal.toString` (trailing zeros
  normalized away, e.g. `"130.00"` → `"130"` — numerically exact; clients
  parse as decimal, never string-compare). `costPrice` admin-only, never
  in storefront shapes.

## Barcode behavior

`GET .../codes/lookup?code=` resolves the global UNIQUE to variant +
product + taxonomy. Verified live: `2010106` (INTERNAL_CODE, primary) →
Romi Cheese loose-KG variant with price basis + size info; surrounding
whitespace trimmed and resolves; unknown → 404; blank → 400. Response
carries NO computed weighed total — the weighed-pricing formula stays
deferred per BA-0 (OPEN decision); price basis + `saleStepGrams` are
present for the future formula.

## Weighted-product boundary (implemented vs deferred)

- Implemented: PIECE/WEIGHT distinction end-to-end, weight-rule validation,
  step snapshots, counting-unit storage, KG/gram precision, loose-variant
  modeling, price-basis exposure.
- Deferred (explicit, no behavior invented): weighed-barcode price formula;
  per-weight variant generation; any inventory quantity in catalog
  responses (no stock data leaves catalog endpoints — BA-3 owns it;
  out-of-stock products stay listed).

## Pricing boundary

- Reads: variant `price`/`compare_at_price` on all detail shapes.
- Writes: price changes ONLY through the price endpoint (tx + history
  row, `changedBy` = acting admin). `compare_at_price`/`cost_price` edits
  skip history (history tracks `price` only, per frozen convention).
- No cart/order/coupon/promotion pricing anywhere in BA-2.

## Tests (`scripts/api/t-catalog.mjs`, scratch-only, self-cleaning)

53/53 PASS on rebuilt `hyper_almoatasem_scratch` (frozen schemas + fixtures
+ seed + 3 test users), covering: storefront lists/gets/filters/search/
pagination/validation/404s; barcode 2010106 (+trim/unknown/blank, no-total
proof); anon 401s; roleless 403s; store/owner 200s; inactive-user 401;
category/brand/product/variant/code CRUD; duplicates → 409 ×4; weight-rule
and unknown-parent → 422; price update + history-row proof; primary switch
+ old-primary cleared; code delete + 404s.

## Regression (all green)

- BA-1 foundation 26/26 · CC-1 lockout 8/8 (+8 TZ rerun) · t-password 9/9
- Frozen suites (reinstalled for this run, byproducts removed after):
  Phase 2: 77/77 · Phase 4: 65/65 · Phase 5: 50/50
- `tsc --noEmit` PASS · `eslint` on new/changed files PASS · `npm run build` PASS
- Auth regression: login/logout/session/lockout/rate-limit/RBAC covered by
  the passing suites above; no auth file modified in BA-2.

## Files

- New: `src/lib/catalog/{validation,serialize,queries,writes}.ts`,
  `src/lib/api/route-auth.ts`, 20 route files under
  `src/app/api/{store,admin}/catalog/`, `scripts/api/t-catalog.mjs`,
  this doc.
- Modified: none outside BA-2 scope.
- Scratch test bed (`hyper_almoatasem_scratch`, disposable) rebuilt
  deterministically: DROP → create → phase1→seed→phase2→phase4→phase5 →
  auth migration+supplement → history markers → bootstrap seed → 3 test
  users with piped test passwords. No production contact at any point.

---

# BA-B additions (pagination / filters / search / media / detail)

> BA-2 history above is preserved. Everything below is BA-B work on the
> same frozen catalog tables (no frozen-schema change). New DB objects
> live in `db/future/` (scratch-verified, never production-applied,
> never in `prisma/migrations`).

## Pagination (BA-B2, corrected)

List cursors were `id > cursor` independent of sort (wrong rows under
name/created_at sorts — proven by counterexample). Replaced with exact
keyset over (sort-field, id): opaque base64url cursors `{v:1,s,id}`,
direction-matched id tiebreaks, malformed → 400. Shared helper
`src/lib/api/pagination.ts` (encode/decode/order/where builders);
catalog lists migrated; other modules keep UUID cursors (documented
follow-up, out of BA-B scope). Product detail adds `description`
(additive; list shapes byte-identical).

## Filters (BA-B2)

Product listing adds: price window (`minPrice`/`maxPrice` on one
sellable variant — single `some`, never split across variants;
inverted window → 400), `inStock` tri-state (`true` = sellable in-stock
variant exists; `false` = none exists; absent = no filter — both
directions real, never ignored), category subtree (recursive CTE
expansion, unknown root matches nothing). Promotion filter:
documented UNSUPPORTED (evaluation owns it). `name` + `created_at`
(+ search `relevance`/`newest`) are the real sort options.

```text
OPEN_DECISION: price sorting basis (BA-B closure, intentionally deferred).
WHY: no product-level price exists in schema (prices live per variant);
any basis is derived. Clean implementation needs either duplicated filter
logic in raw SQL (two sources of truth) or a new DB object (migration) —
both exceed BA-B without new architecture.
AFFECTED_ENDPOINTS: product listing + search (no price sort exposed;
unknown sort values answer 400 — no placeholder).
SAFE_CURRENT_ALTERNATIVE: name + created_at (+ search relevance/newest),
all deterministic with keyset pages.
RECOMMENDED BASIS (future): sellable-min-price = MIN(v.price) over active,
non-deleted variants (matches storefront "from" semantics and order
snapshot economics where customers pay variant prices).
```

## Search (BA-B3)

Engine: pg_trgm similarity + `hyper_norm_ar()` + functional GIN
indexes (`db/future/search-trgm.sql`); FTS rejected (no Arabic stemmer
shipped). Normalization folds alef-forms/ؤ/ة/ه/ى/ي, strips tatweel +
tashkeel, strips per-token leading ال (≥2 letters remain), collapses
spaces — display text untouched; chr()-spelled (RTL-proof; caught and
fixed a digit-eating bug this way). Tiers: exact-code pin (4) > exact
name (3) > prefix (2) > similarity ≥ 0.2 (1) > brand/category (0);
within tier similarity DESC, id ASC; keyset pages on (tier, sim, id).
Route: `GET /api/store/catalog/search` (q required ≥2 chars; sort
relevance|newest; same filters as listing; 400 on empty/short/bad
cursor). 20k-row evidence: Bitmap Index Scan proven by EXPLAIN;
API-observed latencies recorded in test output.

## Media (BA-B4)

`product_images` (db/future/product-images.sql): product-level gallery
metadata only (url/https-only, alt, mime allowlist incl. NO svg,
paired dims, sort, is_primary + partial UQ). Raw-SQL CRUD (no Prisma
model change); admin register/update/delete (products.update/delete,
audited); public gallery endpoint with deterministic fallback
(primary ?? first ?? null). Atomic primary switch (pre-lock + clear
then set — single-statement flips race to deterministic 500 under
concurrency, proven). No provider, no binary upload (register-only;
signed upload is future). Endpoints 500 LOUD without the migration
objects (deployment prerequisite, documented — never silent).

## Visibility (unchanged, restated)

Inactive products/variants stay hidden on storefront, visible to admin
with explicit filters; out-of-stock products STAY LISTED (no stock data
in catalog responses — BA-3 owns it via inventory endpoints +
`product_stock_status`). No `is_available` column, no duplicate flags.
