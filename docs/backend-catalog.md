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
