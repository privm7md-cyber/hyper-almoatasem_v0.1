# FP-07 — Content & Media Strategy (Specification Only)

> Roadmap note: no FP-07 file existed (verified glob); FP-20 records FP-07 as future-ops numbering only.
> This file closes the content-strategy scope. It REUSEs FP-17 (image policy), FP-05 (commerce display),
> FP-11.1 (homepage sections), FP-04/FP-05 (approved copy) and ADDs only the missing matrices below.
> No CMS/upload/feed/CDN invented. No code, assets, deps, or config changed. Static review only.

## 1. Feature coverage matrix (FP-07 scope)

| ID | Requested feature | Roadmap ref | Existing spec | Coverage | Evidence | Action | Final status |
|---|---|---|---|---|---|---|---|
| FP07-F01 | Product naming/brand/unit/variant rules | Task §4.1 | FP-05 §§4–6 (display), serialize shapes | PARTIAL (field-truth table missing) | serialize.ts:20-118 | EXTEND (§2) | CLOSED |
| FP07-F02 | Description & fallback text | Task §4.1 | FP-05 (no-invent rule); FP-04 copy table | PARTIAL (fallback register missing) | ProductDetail.description nullable | EXTEND (§2 + §7) | CLOSED |
| FP07-F03 | Product images policy | Task §4.2 | FP-17 §§1–2; FP-10 §16; FP-12 neutral rule | PARTIAL (per-type rules thin) | media.ts:47-63; openapi:298-302 | EXTEND (§3) | CLOSED |
| FP07-F04 | Category/brand logos, hero, banners, gallery, favicon | Task §4.2 | FP-17 §3 (gaps noted) | PARTIAL (per-type policy missing) | BrandShape.logo nullable; no repo assets | EXTEND (§3) | CLOSED (conditional) |
| FP07-F05 | Home sections sourcing | Task §4.3 | FP-11.1 §§4–5 (hierarchy + E11/E15) | COMPLETE | FP-11.1 E11/E15 | REUSE (§4 pointer) | CLOSED |
| FP07-F06 | CMS Draft/Preview/Publish/Schedule/Audit | Task §4.4 | FP-11.1 E15 (no content namespace) | MISSING as matrix | Route inventory: no content routes | ADD (§5) | CLOSED (all-unsupported matrix) |
| FP07-F07 | Data-quality matrix | Task §4.5 | FP-05 §17 + FP-11.10 (scattered) | PARTIAL (unified matrix missing) | Same sources | EXTEND (§6) | CLOSED |
| FP07-F08 | Fallback copy register | Task §4.1/4.5 | FP-04 §19 + FP-05 D14 (approved); proposals scattered | PARTIAL (register missing) | Same | EXTEND (§7) | CLOSED (approved + marked proposals) |

## 2. Product content rules (field truth from `serialize.ts` + openapi; BACKEND-CONFIRMED)

| Field | Source field | Display | Empty handling | Invalid handling | Needed to display / to buy? | Admin editable? (perm-gated) | Acceptance |
|---|---|---|---|---|---|---|---|
| Product name | `ProductListItem.name` (required) | Full Arabic; wraps, never clips meaning | N/A (required at creation) | — | Both | products.update | Card/PDP show exact name |
| Slug | `.slug` (required) | URL + canonical redirect (FP-09 D01) | N/A | Mismatch → canonical redirect | Display (SEO) | products.update | Slug rules per FP-09 |
| Brand | `brand {id,name,slug} | null` | Name link iff non-null; hidden cleanly iff null (no invented brand) | Null brand ⇒ section omitted; search/nav unaffected (brand is facet, not gate) | Display | products.update (link) | Null-brand product renders, buyable |
| Brand logo | `BrandShape.logo: string | null` (URL metadata) | Logo image iff non-null URL | Neutral monogram-letter fallback (no invented logo) | Broken ⇒ fallback | products.update | Logo-or-fallback, never another brand's |
| Unit | `.unit` + `.saleStepGrams` | Verbatim sizeUnit; KG↔g display-only exact | N/A (sale units closed: PIECE/KG/GRAM) | Never inferred from name | Buy | products.update | FP-05 step rules |
| Variant name/size | `VariantShape.name/sizeValue/sizeUnit` | Explicit variant line | Variant required before add when choice exists | — | Buy | products.update | Per-variant identity |
| Description | `ProductDetail.description: string | null` (detail only) | Full text iff non-null | Fallback line (§7), NOT generated specs | — | Display aid | products.update | Null ⇒ fallback, never invented origin/ingredients/quality claims |
| Category | `{id,name,slug}` (+description/image on CategoryShape) | Trail + links | Uncategorized never displayed as categorized | — | Display/nav | products.update | Trail resolves |
| Metadata (timestamps) | createdAt/updatedAt | "Updated" hints only; never freshness claims | Omitted | — | Neither | No | No SLA implied |

No marketing-name invention; no origin/ingredient/nutrition/quality claims without a sourced field (none exists —
BACKEND-GAP if ever wanted; display stays silent, not creative).

## 3. Images & media policy (extends FP-17; media model `media.ts:47-63` BACKEND-CONFIRMED)

Model: `url/https-only + altText? + mimeType? + width?/height? + sortOrder + isPrimary`; gallery deterministic
(sort_order, id); primary = is_primary row else first row else null (never a broken URL).

| Type | Source | Primary rule | Gallery/order | Fallback | Ratio/crop | Broken handling | Alt | Lazy/priority | Dimensions | Optimization/CDN |
|---|---|---|---|---|---|---|---|---|---|---|
| Product images | `GET products/[id]/images` | Contract primary (atomic switch) | Deterministic order | Neutral placeholder, layout-stable | 4:3 contain, neutral bg (FP-10 §16) | Handler, no layout shift | altText ?? product name | Lazy below fold; PDP main eager | Reserved slots | No CDN assumed; remote domains need approval (none now) |
| Category images | CategoryShape.image (nullable) | Single | N/A | Neutral category tile | Same contain | Same | Category name | Lazy | Same | Same |
| Brand logos | BrandShape.logo (nullable) | Single | N/A | Letter-monogram fallback | Contain, no distortion | Same | Brand name | Lazy | Small fixed slot | Same |
| Hero/banners | Owner-approved static ONLY (none in repo) | N/A | N/A | Section omitted (no placeholder hero) | Per approved asset | N/A | Approved text | Per placement | Per asset | Same |
| Gallery (PDP) | Same product endpoint | Primary first, thumbs follow | Single image ⇒ NO fake gallery | Same product fallback | Same | Same | Per image | Thumbs lazy | Reserved | Same |
| Favicon/app icon | No approved asset (public/ holds framework SVGs only) | — | — | Framework default until approved | — | — | N/A | N/A | — | — |
| Empty-state art | No approved set | — | — | Typographic empty states (no invented illustration) | — | — | N/A | — | — | — |

Missing/broken image NEVER implies unavailable (content state ⊥ stock state). No multi-image assumption beyond the
returned gallery; no upload/transform service (BACKEND-GAP); `next.config.ts` has no `images` key (verified).

## 4. Home content sourcing (REUSE FP-11.1 §§4–5; no duplication)

Hierarchy: search prominence → categories (real only) → listings → hero/featured OPTIONAL (approved static or verified
source, else omitted) → promotions OPTIONAL (honest-empty, FP03-C2) → trust strip omitted (no verified source).
No popularity/bestseller (no source); no "newest" feed beyond created_at sorts where contracted; no admin-managed
featured (no field/op); no offers feed. Section matrix (goal/source/type/ordering/limits/empty/error/mobile/SEO) =
FP-11.1 §5 authoritative; this file adds nothing to it.

## 5. CMS support matrix (all rows VERIFIED ABSENT via route inventory — BACKEND-GAP, not a UI to build)

| Function | Data | API | Perm | Validation | States | Audit | Storefront effect | Preview w/o publish? | Schedule? |
|---|---|---|---|---|---|---|---|---|---|
| Draft / Preview / Publish / Schedule / Audit (content) | None stored | No content/banner/config namespace (FP-11.1 E15) | — | — | None exist | — | Static approved copy only | No | No |

Current UX: approved static copy in repo + conditional sections that omit cleanly; maintainable-static vs needs-CMS
split recorded in §6/§3 (hero/banners/policies = static-until-CMS). Future CMS is a backend+product scope, never a
precondition for honest launch.

## 6. Data-quality matrix

| Case | User sees | Product shown? | Buyable? | Purchase data sufficient? | Fallback? | Hide element? | Block purchase? | Detected by | Backend-data fault? | Logged as |
|---|---|---|---|---|---|---|---|---|---|---|
| Missing image | Neutral placeholder | Yes | Yes | Yes (image ≠ purchase data) | Yes (§3) | No | No | Render | Possibly | Display note, not error |
| Missing brand | No brand row | Yes | Yes | Yes | Omit section | Brand row only | No | Render | Possibly | Same |
| Missing category | No trail | Yes (orphan-safe) | Yes | Yes | Omit trail | Trail only | No | Render | Possibly | Same |
| Missing description | Fallback line (§7) | Yes | Yes | Yes | Yes | No | No | Render | Possibly | Same |
| Missing variant (choice exists) | Selector blocked | Yes | No (until choice) | No | No | No | Yes (gate) | Contract | Possibly | UX block |
| Incomplete (no price/unit/step) | Honest partial + disabled CTA | Yes | No | No | No | CTA only | Yes | Validation | Possibly | Same |
| Missing unit | Cannot price | Yes | No | No | No | Buy path | Yes | Validation | Possibly | Same |
| Invalid display field | Neutral/error per type | Per case | Per sufficiency | Per case | Per case | Element only | Iff purchase data | Validation/render | Possibly | Same |
| Missing promo metadata | No badge | Yes | Yes | Yes | None (never invent) | Badge | No | Evaluation | No (correct absence) | Same |
| Inconsistent naming | Exact stored names | Yes | Per data | Per data | No renaming | No | No | Review | Possibly | Content debt |

Rule: OOS display ≠ hiding (FP-05); purchase-blocking ONLY when purchase-necessary data is missing; never invent
variant/price/unit to unblock a sale.

## 7. Fallback copy register (approved vs proposal — D14/FP-04 strings untouched)

| State | Copy | Status |
|---|---|---|
| Missing description | «لا توجد تفاصيل إضافية لهذا المنتج حاليًا.» | COPY-PROPOSAL (no approved string covers it) |
| Missing brand section | Omitted silently (no copy) | Rule (no placeholder text) |
| Image missing | No copy (visual fallback only) | Rule |
| All commerce states (cart/price/stock/coupon/error) | FP-04 §19 + FP-05 D14 tables | COPY-APPROVED (verbatim, cited) |

## 8. Acceptance (DEFINED — NOT EXECUTED)

Coverage matrix complete (§1) · field-truth table (§2) · per-type media policy (§3) · home sourcing by reference
(§4) · CMS absence matrix (§5) · quality matrix (§6) · copy register (§7) · gaps explicit (§9) · no invented
CMS/upload/feed/CDN/assets · no FP-17/FP-05/FP-11.1 duplication (pointers, not copies).

## 9. Gaps (all BACKEND-GAP or OWNER-decision, none blocking honest launch)

No CMS · no upload/transform/CDN/domains · no brand assets/banners/policies source · no popularity/newness feeds ·
no generated descriptions · no multi-image guarantee. Each renders as honest-empty/omitted/fallback per above.

---

*End of FP-07 — specification-only, no implementation.*
