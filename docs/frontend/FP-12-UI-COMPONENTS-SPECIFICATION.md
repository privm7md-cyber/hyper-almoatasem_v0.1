# FP-12 — Reusable UI Components Inventory & Contracts

> Classification: `VERIFIED` (contract-backed) · `RECOMMENDATION` (needs owner review where noted) ·
> `UNSUPPORTED` (must not be built). Specification-only — no React/TS/CSS/Storybook files, no packages.
> Evidence hierarchy: implementation/tests > OpenAPI/schemas > approved decisions > prior FP specs.
> Statuses across FP-11 specs (D02/D05/D06, D12/D13/D17/D18, D21–D23, D24–D30, D31–D39, D40–D48) preserved.

## 1. How to read this document

- §2 groups components into the 5 required families (classification only — NOT a folder-structure mandate;
  final structure follows the existing App Router tree at implementation).
- Each component lists the 14 required fields (Name/Group/Purpose/Reuse/Props/Events/State/Data/
  Variants/States/A11y/RTL/Boundary/Tests). "Tests" names the proving suite, not a claim of passing.
- §3–§9 resolve each task-mandated component; §10 tokens; §11 reuse classes; §12 screens×components
  matrix; §13 conflicts/decisions register.
- Existing UI inventory (verified 2026-10-11): exactly ONE client component exists
  (`src/app/admin/login/LoginForm.tsx`, `"use client"` form pattern) + server-gated admin shell pages
  (`/admin`, `/admin/users`) + storefront boilerplate `page.tsx`. No component library, no API client,
  no zustand stores, no icon/font packages (Next 16.3.8 + React 19 + Tailwind v4 per FP-10).

## 2. Group overview

| Group | Members | Shared rule |
|---|---|---|
| Layout | StoreHeader (+SearchBox, CartIndicator internals), StoreNavigation (+MobileDrawer, BottomNav), PageContainer, StoreFooter, AdminLayout (+AdminSidebar, AdminTopbar), Breadcrumbs, Pagination | Structure only; never authorization, never prices |
| Commerce | ProductCard (composite) + ProductImage, ProductPrice, PromotionBadge, StockStatus, VariantSelector, AddToCartButton, CartItem, CartSummary, PieceQuantityControl, WeightSelector, QuantityStepper (internal primitive) | Display + confirmed-response flows; never pricing authority |
| Form & Interaction | FormField shell + TextField, PasswordField, PhoneField, SelectField, CheckboxField, TextareaField, FormFieldError, Button (variants), ConfirmDialog | Client pre-checks only; server authoritative |
| Data & Admin | DataTable, TableToolbar, SearchInput, FilterPanel, Pagination (shared with Layout), StatusBadge, per-row action slots | Server pages only; no client totals/sorts |
| Feedback & States | LoadingState, LoadingSkeleton, EmptyState, ErrorState, SuccessMessage, Alert | One shared set for store + admin; never failure-as-empty |

## 3. Layout components

### StoreHeader (Layout; used by all storefront pages)
Purpose: brand + search entry + account + cart access. Props: `{storeName, logoSrc|null}` (no
server data required; children slots for SearchBox/CartIndicator). Events: search-submit, nav-toggle.
State: controlled open/close by parent; mobile/desktop via Tailwind breakpoints (existing system).
Data: none directly (delegates). Variants: default; compact (checkout/account). A11y: `header` landmark,
named icon buttons (Arabic), visible focus, Esc closes mobile menu. RTL: logical properties, mirrored
chevrons only. Boundary: no badge counts, no session decisions (reads auth state passed from server
layout — never client token parsing). Tests: FP-11.1 AC-H7 + FP-11.9 (future).

### SearchBox (Layout/internal of header; also PDP/listing entry)
Props: `{initialQuery, action}` — submits GET to `/search` (verified contract: q 2–120, no
autocomplete endpoint — submit-only). Events: submit/clear. States: idle/pending(latest-wins
discard)/failure(retry keeps query). Boundary: never client-filters visible items as "search".

### CartIndicator (Layout/internal)
Props: `{totalQuantity|null, failed:boolean}` from confirmed cart reads only (FP-11.1 D05 total
quantity). Empty (0 lines) → guided affordance, never bare zero-as-error; failed read → stale badge,
never fake-empty, never invented count.

### StoreNavigation (Layout; FP-11.1 D02 top-level ≤6 + FP-11.2 drill-down)
Props: `{categories: {id,name,slug,parentId,sortOrder}[]}` from `GET categories` (live API).
Desktop inline nav + MobileDrawer + BottomNav (الرئيسية·الأقسام·السلة·الطلبات·الحساب — final order per FP-03 FP03-C1, owner-delegated; search via prominent header SearchBox, not a bottom tab).
Hierarchical drill-down via `parent=` filter (unbounded depth, never fixed-depth assumption).
Keyboard: roving focus, Esc, focus trap in drawer. Empty: nav section omitted (listing entries remain).
Invalid links: category not-found path (FP-11.2). Boundary: no popularity/bestseller entries (no source).

### PageContainer (Layout; all pages)
Props: `{width: sm|md|lg|full, gutter}` mapped to FP-10 spacing/gutter tokens. Special layouts only
with documented need. Boundary: no new measurements conflicting with tokens.

### StoreFooter (Layout)
Props: `{links: verified-routes-only[], policies: owner-approved-texts-only[]}` (FP-11.1 D06: zero
policy entries until approved source exists). No contact block (no storefront read path), no invented
links/fees/hours. Missing content → omitted, never placeholder.

### AdminLayout + AdminSidebar + AdminTopbar (Layout; admin only)
Props: `{admin: {name,email,roles}, permissions: string[]}` from `GET /admin/session`.
Sidebar/topbar render ONLY granted sections (D45 hide-by-default; server re-enforces). Mobile: drawer
non-blocking + dismiss. Boundary: visibility ≠ authorization (never sole gate). Existing shell pages
preserved (login/dashboard/users keep working).

### Breadcrumbs (Layout; PDP + admin details)
Props: `{trail: {label, href?}[]}` (category trail where resolvable, else back-to-listing fallback).
Preserves listing/search context where supported.

### Pagination (Layout + Data shared; ONE presentation component + endpoint-specific adapters)
Props: `{page: {items, hasMore}, onMore, pending, failed}` — the component renders navigation only.
Pagination behavior is endpoint-specific (Decision A closed): the presentation component NEVER imposes
a protocol; each endpoint gets an adapter translating its real wire format (table below) into this state.
Verified protocols — NO offset/page-number mechanism exists anywhere (grep-verified):
| Endpoints | Protocol | Request | Response meta | Evidence |
|---|---|---|---|---|
| Storefront catalog lists (products/categories/brands) + admin catalog equivalents | Opaque keyset cursors | `limit 1–100 d20`, `cursor` base64url (sort-field,id), `sort/dir` where offered | `meta{limit,nextCursor}`, `null`=end | `lib/api/validation.ts:31-42`, `lib/api/pagination.ts:3-85`, `lib/catalog/queries.ts:5-33` |
| Orders, customers, inventory, promotions, roles/permissions/users admin lists | Raw UUID cursors | `limit`, `cursor` uuid (`id gt/lt`), `take limit+1` | `nextCursor\|null` (derived), no totals | `lib/admin/queries.ts:17-148`, `lib/orders/queries.ts:30-78`, `lib/inventory/queries.ts:11-131`, `lib/promotions/queries.ts`, `lib/customers/queries.ts:10-37` |
| Catalog search | Search cursors | opaque `cursor` (tier/sim/id) | `nextCursor\|null` | `lib/catalog/search.ts:41-69,210-236` |
| Audit logs | UUID wire over `(created_at,id)` tuple | `cursor` uuid | `nextCursor\|null` | `lib/admin/queries.ts:140-148` |
ALL forward-only (no previous-page support); criteria change → cursor reset; malformed cursor →
400-mapped + refetch-from-start. Reused by every listing via its adapter. Boundary: never derives
counts, never re-sorts pages client-side, never promises jumps/pages the endpoint lacks.

## 4. Commerce components

### ProductCard (Composite; homepage/collections/listings/search)
Composes ProductImage + name + variant/unit line + ProductPrice + PromotionBadge (conditional) +
StockStatus + AddToCartButton. Props: `{product: ProductListItem, variant?: VariantShape,
price?: string|null, compareAt?: string|null, availability?: StockStatus, image?: GalleryShape}` —
each field optional-with-fallback because enrichment is per-card (FP-11.1/11.2 N+1 rules: bounded
counts, request cache per render, skeleton→progressive→per-card retry). Rules (binding): never
computes final price; never re-applies discounts; compare-at struck ONLY when variant payload returns
non-null (else omitted); PIECE (whole packs) vs WEIGHT (step presets) distinguished; stock from
verified reads only (fetch failure = unknown, never OOS, never buyable-by-default); neutral image
fallback; add targets exact `productVariantId`+quantity; feedback only post-confirmation; no ratings/
favorites (unsupported). A11y: article semantics, named add control, `aria-live` price/stock changes,
availability never color-only. Tests: FP-11.1 AC-H4/H5 + FP-11.2 AC-P1/P2 (future).

### ProductImage / ProductPrice / PromotionBadge / StockStatus (internal, promotable iff reused ≥3 screens)
- ProductImage: `{primary|gallery[0]|null}` → neutral fallback; fixed aspect slots (no shift).
- ProductPrice: `{price, unit}` paired always; per-kg equivalence display-only where helpful.
- PromotionBadge: renders ONLY backend-proven benefit (estimate-computed or compare-at-present);
  never computes eligibility/percent; expired/ineligible → hidden, no phantom badge.
- StockStatus: `{in_stock|low_stock|out_of_stock|unknown}` from inventory reads; icon + Arabic text.
Decision: keep internal to ProductCard until a third consumer needs one (anti-fragmentation rule §11).

### VariantSelector (Commerce; PDP + WEIGHT/PIECE cards where multi-variant)
Props: `{variants: sellable[], selectedId, onChange}`. Explicit choice required when >1 sellable;
single sellable may preselect (shown). Change re-resolves price/unit/availability/quantity options
from the new variant. Stale/invalid id → 404-mapped + first-sellable fallback with notice (never
silent substitution). Zero sellable → product-level OOS, add disabled.

### AddToCartButton (Commerce)
Props: `{productVariantId, quantity, disabled, reason?}` → `POST cart/items`. Pending spinner +
disabled duplicate guard; success only on 200 (indicator refresh from confirmed cart); failure mapped
message + retry. Boundary: never pre-confirms, never invents quantity rules.

### CartItem (Commerce; cart page rows)
Props: `{line: CartLineShape}` = productVariantId key + names + quantity + unitSnapshot +
unitPriceSnapshot|null + lineTotal|null + priceCheckedAt. Null price/total → "غير متاح + reprice"
(not zero, not last-price-as-final). Availability supplemental (inventory read, cached) or unknown.
Remove → DELETE-only (PATCH 0 forbidden). Reconciliation wholesale from mutation echo.

### CartSummary (Commerce)
Props: `{subtotal, lineCount, estimate?: EstimateResult|null, estimateAt?}`. Shows informational
subtotal (`استرشادي`) + optional labeled estimate block (expires on mutation); NEVER delivery/tax/
coupon/final-payable unless estimate-returned; unpriced-lines note. Boundary: no client money math
as authority.

### PieceQuantityControl + WeightSelector + QuantityStepper (Commerce)
Decision (§6.3): TWO specialized controls sharing one internal `QuantityStepper` primitive
(buttons/input/spinner/guard/a11y) — separates PIECE (integer packs, min 1, no invented max,
0-via-DELETE) from WEIGHT (step-valid presets only, e.g. 125g–1.25kg where step allows; free
decimals rejected with message; estimate labeled non-final) without duplicating interaction logic.
Variant/pack change = POST-new + DELETE-old (never cross-variant PATCH). Unit conversions display-only
and exact (no float). Units per L3 RESOLVED/LOCKED (FP-11.8.2 E13/E15/E16): sale/inventory units
PIECE/KG/GRAM only; LITER/ML are descriptive variant/package-size metadata only (never volume-selling,
never converted). Tests: FP-11.4 AC-CART-04/05 (future).

## 5. Form & Interaction components

Decision: ONE `FormField` shell (label/help/required/disabled/error-slot/`aria-describedby`/focus)
+ typed wrappers TextField, PasswordField (masked-default + reveal), PhoneField (R8 ladder 010-forms →
canonical `201XXXXXXXXX`; digits/`+` inputmode), SelectField, CheckboxField, TextareaField +
FormFieldError. Rationale: shared a11y/RTL/error behavior, type-specific keyboards and policies stay
separate. Boundary: fields never own commerce rules (lengths/formats mirror Zod boundary only).
Address fields fixed set (city/area/street/building/landmark/phone; NO governorate — frozen).
API errors mapped per code (400 field-fix, 401 login, 404 gone, 409 review+new-key, 422 rule,
429 backoff, 500 retry) — never raw codes/stacks/tokens.

### Button (Form; variants in ONE component)
Variants: Primary/Secondary/Danger/Ghost/Icon × states Loading/Disabled. Sizes from FP-10 field/button
scale; 44px touch minimum; Arabic accessible names (icon-only mandatory); duplicate-submit guard +
safe-retry restore; destructive → ConfirmDialog (which never decides permission — server does).
No new idempotency inventions (order key comes from checkout flow, not buttons).

### ConfirmDialog (Form)
Props: `{title, description, confirmLabel, danger?, pending, error?}` + focus trap/restore + Esc.
Used for clear-cart (D25 sheet), address delete, admin destructive ops. Boundary: confirmation ≠
authorization.

## 6. Data & Admin components

### DataTable (Data; all admin lists + optional dense storefront lists)
Props: `{rows, columns: contracted-fields-only[], keyOf, onRowOpen?, rowActions?, page, onMore}`.
Server pages only, consumed through the endpoint's adapter (§Pagination table above — UUID cursors
for admin lists, opaque for catalog, search cursors for search);
sorts offered iff server sorts exist (name/created_at; relevance/newest search); NO client totals,
NO client re-sort of any cursor page, NO full-catalog fetch, NO permission/action invention,
StatusBadge display-only (never transition authority). Mobile: cards (IDs preserved) or explicit
horizontal scroll. Keyboard: navigable rows, visible focus. 20k+ safe by construction.

### TableToolbar + SearchInput + FilterPanel (Data)
Bound 1:1 to contracted params (search/category/brand/type/price/inStock/q/sort/cursor/limit…);
server-applied pre-pagination only; change → adapter cursor reset; URL-held state (FP-11.2 §11); reset +
back-from-details restore; no-results ≠ failure. SearchInput: debounce + latest-wins + abort
(D46 pattern for admin lists). No guessed filters (discount/rating/price-sort excluded).

### StatusBadge (Data; shared store+admin)
Props: `{status, tone, label}` — label + style from APPROVED state sets only (order machine, replacement
machine, stock states, promo statuses). Never decides transitions/permissions.

### EmptyState / ErrorState / LoadingSkeleton (Data; shared — see §7, same components)

## 7. Feedback & States (ONE shared set)

LoadingState (`aria-busy`, layout-stable) · LoadingSkeleton (fixed slots; grid/card/detail variants) ·
EmptyState (guided CTA; confirmed-empty ONLY — never on failure/401/404) · ErrorState (mapped message +
safe retry; per-section isolation) · SuccessMessage (post-200/201 only) · Alert (non-critical warnings).
Mandatory 9 + S-STALE/S-GUEST/S-RATE/S-SUPPLEMENT (FP-11.4 §13) + admin 403-vs-401 distinction (D45).
No notification/realtime/offline systems (unsupported).

## 8. Tokens & identity (binding, not duplicating FP-10)

Colors exactly FP-10 (`#511D9C` primary, `#FF7100` emphasis-never-body, `#C2410C`, `#1B1530`,
`#EEE8F5`, `#FFF1E6`, `#15803D`, `#C62828`); spacing 4px-multiple scale; uniform field/button sizes;
Hover/Focus/Disabled states; contrast + non-color signals; FP-10 type scale; Tailwind v4 breakpoints
adopted (no invented px); single CSS font variable (Arabic font choice deferred — no files/deps).
Conflict check (required by task): NONE found between the §10 task table and FP-10 token table —
values identical; FP-10 remains authoritative (this doc references, never redefines).

## 9. Reuse classes & anti-duplication

- Primitive (Button, Field shell + typed inputs, Badge, Stepper, Skeleton): reused everywhere.
- Composite (ProductCard, CartSummary, DataTable, ConfirmDialog, Pagination): ≥2 screens each (matrix §10).
- Feature (FulfillmentPickRow, PromotionForm, RoleGrantMatrix, CheckoutAddressForm): single-flow only —
  NOT generalized.
- Layout (headers/navs/containers/footers/admin shell): per-surface, shared primitives inside.
- State (Loading/Empty/Error/Success/Alert): single shared set.
- Pre-existing, no rebuild: `LoginForm.tsx` pattern (keep; align new auth forms to its conventions).
- Screen×component matrix + per-candidate benefit/cost: §10 table (Reuse column + boundary notes).
- Duplication rule: 3rd use OR cross-surface need triggers extraction; two similar blocks stay separate
  rather than forcing one untestable mega-component.

## 10. Screens×components matrix

| Screen | Components (reuse) |
|---|---|
| `/` home | PageContainer, StoreHeader(+SearchBox, CartIndicator), StoreNavigation, ProductCard, PromotionBadge(conditional), Skeletons/States, StoreFooter |
| Categories/search/listings | + FilterPanel, DataTable-or-cards, Pagination, Breadcrumbs |
| PDP `/p/[id]` | + VariantSelector, Piece/Weight controls, AddToCartButton, StockStatus |
| `/cart` | CartItem, CartSummary, ConfirmDialog(clear), reprice affordance |
| Checkout | CheckoutAddressForm(feature), CartSummary, estimate block, single-flight submit Button (idempotency-key issuance lives in checkout flow, §FP-13 matrix), ConfirmDialog? (no fake steps) |
| Account `/account*` | FormFields, DataTable(orders), StatusBadge, ConfirmDialog(delete address) |
| Admin `/admin*` | AdminLayout, DataTable, TableToolbar/Search/Filter/Pagination, StatusBadge, ConfirmDialog, FormFields, per-§12 fulfillment/promotion/user forms (feature) |

## 11. Conflicts & owner decisions register

| ID | Topic | Finding | Status |
|---|---|---|---|
| FP12-C1 | Field architecture (shell+wrappers vs polymorphic) | Chose shell+wrappers (§5 rationale) | ADOPTED — TECHNICAL DEFAULT (this closure; conservative, no business impact) |
| FP12-C2 | QuantityControl shared-vs-split | Chose split + shared primitive (§4) | ADOPTED — TECHNICAL DEFAULT (this closure; separates PIECE/WEIGHT rules without duplication) |
| FP12-C3 | Sub-component promotion threshold | Internal until 3rd consumer (§4/§9) | ADOPTED — TECHNICAL DEFAULT (this closure; anti-fragmentation, non-binding on future extraction) |
| FP12-C4 | Tokens conflict task-table vs FP-10 | Checked: identical, no conflict | VERIFIED (no action) |
| FP12-C5 | Folder structure | Deferred to implementation (App Router first) | DEFERRED — intentionally non-binding (not a spec gap; no approval needed) |
| FP11-D41 | Address list ordering (default-first display) | Approved presentation-only record (FP-11.7:298); applies to address lists here | ACCEPTED/RESOLVED (no reopen; server order preserved, no page-only sorting) |
| FP11-D44 | Bounded per-row enrichment | Approved presentation-only record (FP-11.8:285); applies to ProductCard/DataTable enrichment | ACCEPTED/RESOLVED (no reopen; API-fields/static-metadata only) |
| FP11-L3 | Sale units vs size metadata | Direction A IMPLEMENTED + VERIFIED (FP-11.8.2 E13/E15/E16) | RESOLVED/LOCKED (PIECE/KG/GRAM sale units; LITER/ML metadata-only) |

No locked decision reopened; no approval claimed beyond the records cited.

## 12. Acceptance criteria (DEFINED — NOT EXECUTED)

- Inventory + per-component 14-field contracts complete (§§3–7); reuse justified per candidate (§§10–11).
- Commerce rules match FP-11.x contracts (no invented prices/discounts/quantities/ratings).
- D45 honored (visibility≠auth); states matrix implemented once and shared.
- Tokens identical to FP-10; font deferred; no new deps implied.
- Zero `.tsx`/CSS/Storybook created (verify via status).
- Pagination is endpoint-specific (protocol table in §Pagination); no universal protocol promised.
- Statuses unambiguous: C1–C3 ADOPTED, C4 VERIFIED, C5 DEFERRED (non-binding), D41/D44/L3 resolved per §11.

---

*End of FP-12 — specification-only, no implementation.*
