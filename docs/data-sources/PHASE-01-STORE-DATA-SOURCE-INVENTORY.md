# PHASE 01 — STORE DATA SOURCE INVENTORY

**Project:** Hyper Al-Moatasem — هايبر المعتصم
**Phase:** 01 — Store data sources inventory, POS discovery & data-lineage audit
**Mode:** READ-ONLY discovery. No business data, DB, API, source, or historical report was modified.
**Date:** 2026-10-16
**Report path:** `docs/data-sources/PHASE-01-STORE-DATA-SOURCE-INVENTORY.md`

---

## 1. Executive Summary

**What was found:** 4 real POS price/item exports (XLSX) at `D:\` + their 4 PDF renderings on
the Desktop — all four describe the **same 10,271-item universe** with different column sets.
Zero POS software exists on this machine (no install, no shortcuts, no registry entry); the POS
itself lives elsewhere, so **report-menu discovery inside the POS was impossible** — the
exports are the only POS-side evidence available.

**Most important confirmed facts:**

1. **10,271 actual data records, proven** — sheet `ورقة1` has 10,275 rows; row 1 = header;
   3 rows (2,3,4) carry no code (residual warehouse rows); **10,271 rows carry a code** — the
   exact figure previously quoted as "preliminary" is now measured, not estimated.
2. **All four files share an identical code set** (10,266 unique codes, zero difference) →
   they are 4 views of **one item master**, not 4 independent sources. This is the strongest
   lineage proof in this phase.
3. **The "code" is predominantly a real EAN-13 retail barcode** — 9,697 codes are 13 digits,
   of which **9,679 pass the EAN-13 checksum (99.79% of them)**; the top GS1 prefix is `622`
   (Egypt) covering 7,885 items (76.7%). This is strong evidence of genuine commercial
   barcodes, but still **not** POS-confirmed (no independent barcode report was accessible).
4. **Two conflicting price lists exist** — `سعر بيع قطاعي` (sector price) differs from
   `سعر البيع` (general sell) in **2,058 of 10,265 comparable rows (20.05%)**; median sector
   price is 7.7% higher; extremes reach ×10.62 and ×0.375. Which list is authoritative is an
   **owner decision**, not a technical finding.
5. **Taxonomy is nearly absent** — the `قسم` (department) column is filled in only
   **500 of 10,271 rows (4.87%)** across 27 distinct values; `فرع` (branch) is 100% empty;
   `مخزن` is 100% a single value (`مخزن المحل`).
6. **Real data-quality defects exist** — 5 duplicated barcodes (each mapped to 2 different
   product names), 2 corrupted codes (one float in scientific notation `9.40862230058737e+16`,
   one Arabic garbage string), 18 EAN-13-shaped codes failing the checksum, 383 negative
   stock balances, 2 absurd "total sold" values, and date cells in the future (max
   2026-12-03 vs file date 2026-10-15).

**What is unknown:** the item list's completeness (cannot be proven without the POS
item-definition report), price currency/approval, whether the sector or general sell price is
the approved customer price, barcode-vs-PLU classification per item, and any brand, image,
unit, or weight-step source.

---

## 2. Scope, Environment & Constraints

| Item | Value |
|---|---|
| Repo / branch / HEAD | `D:\Hyper_el-moatasem` · `preview/fe11-fe13-verified` · `7596ac7d0ec5a465081430f4eafce94b1becf2d2` |
| Working tree at start | 2 pre-existing modified (incl. protected `docs/AGENT-HANDOFF.md`) + 3 untracked; preserved unchanged |
| Tools used | Python 3.12.14 (codex-runtime) + `openpyxl` (read-only, `data_only`) + `pdfplumber`; PowerShell (process/service/path inspection only) |
| Filesystem reads | `D:\` root, Desktop, Downloads, Documents, `C:\Users\MEGA` (xlsx/xls/csv sweep) |
| Local PostgreSQL | **Unavailable** — `pg_ctl status` → `no server running`, 0 processes. Not started (prohibited). |
| POS software | **Not installed on this machine** (registry uninstall keys, Start Menu, Program Files all checked) |
| Access databases | 8 × `.accdb` found in `Documents` but **unreadable** — no ACE/Jet OLEDB provider installed, and files lack the OLE2 header (`Standard ACE DB` at offset 4 with no `D0CF11E0` magic) |
| Secrets handling | No passwords, tokens, connection strings, or customer/order data read or recorded |

**Analysis method (reproducible):** every count below comes from reading the workbook with
`openpyxl` in `read_only=True, data_only=True` mode. "Data rows" = rows whose `الكود` cell is
non-empty after whitespace/NFKC normalization. Denominators are stated with every percentage.
No file was modified; no workbook was opened in a writable/save mode.

---

## 3. Data Source Register

| Source ID | Name | Path | Type | File modified | Extract date in report | Scope | Records | Key columns | Origin | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| SRC-01 | `عر بيع قطاعي.xlsx` | `D:\عر بيع قطاعي.xlsx` | XLSX | 2026-10-15 20:21 | **none found** | Retail price **by sector** | **10,271** | code, قسم, فرع, مخزن, item, sector sell price | POS export | AVAILABLE |
| SRC-02 | `سعر بيع وشراء.xlsx` | `D:\سعر بيع وشراء.xlsx` | XLSX | 2026-10-15 20:18 | **none found** | Buy + sell price, current balance | **10,271** | code, قسم, فرع, مخزن, item, buy price, sell price, current balance | POS export | AVAILABLE |
| SRC-03 | `بدون اسعار.xlsx` | `D:\بدون اسعار.xlsx` | XLSX | 2026-10-15 20:09 | **none found** | Movements without prices | **10,271** | code, قسم, فرع, مخزن, item, prev balance, total sold, current balance | POS export | AVAILABLE |
| SRC-04 | `المصنف1.xlsx` | `D:\المصنف1.xlsx` | XLSX | 2026-10-15 19:04 | **none found** | Item master view (dated) | **10,271** | date, code, قسم, item, مخزن, sell price, prev balance, total sold, current balance, expiry | POS export | AVAILABLE |
| SRC-05..08 | 4 × PDF renderings | `C:\Users\MEGA\Desktop\*.pdf` | PDF | 2026-10-16 08:19–08:20 | none | Print renderings of SRC-01..04 | 219 pages each | same columns, barcodes rendered in scientific notation | Excel→PDF conversion | AVAILABLE (degraded) |
| SRC-09 | `ilovepdf_converted.zip` | `C:\Users\MEGA\Desktop\` | ZIP | 2026-10-16 08:20 | — | Archive of 3 of the 4 PDFs | 3 entries | — | iLovePDF | AVAILABLE |
| SRC-10..17 | `Database1..8.accdb` | `C:\Users\MEGA\Documents\` | Access | 2026-10-14 19:57–20:04 | — | **unknown** | unreadable | unreadable | unknown | **NOT READABLE** (no ACE provider) |
| SRC-18 | Store PostgreSQL DB | `.env` `DATABASE_URL` (value not read) | DB | — | — | Store runtime data | — | catalog/inventory/orders | Next.js backend | **UNAVAILABLE** (service down) |
| SRC-19 | Store API (OpenAPI + routes) | `docs/openapi.yaml`, `src/app/api/**` | API contract | committed | — | Live storefront data | n/a | products/variants/codes/categories | Repo | AVAILABLE (contract only) |

**Comparison of the 4 sources:** identical record count (10,271), identical code set
(10,266 unique; `only-in-X` = 0 for every pair), and only **4 name mismatches** — exactly the
4 duplicated-barcode codes. No version conflicts exist between them; they are complementary
column views of one master.

---

## 4. Price-File Deep Inspection (SRC-01 `عر بيع قطاعي.xlsx`)

### 4.1 Workbook structure
- Sheets: `ورقة1` (visible, 10,275 × 10), `ورقة2` (visible, 1 × 1 — empty), `ورقة3` (visible, 1 × 1 — empty). No hidden sheets.
- Row 1 = header. Rows 2–4 contain only `مخزن المحل` in the store column with **no code, no name, no price** (residual/filtered rows).
- **Data rows = 10,271** (rows with a non-empty `الكود`). This is the proven figure.
- Columns A, B, I, J are blank across the sheet (4 unused columns).

### 4.2 Column dictionary (SRC-01)

| # | Actual header | Likely meaning | Type | Non-empty | Empty | Notes |
|---|---|---|---|---|---|---|
| A | *(blank)* | — | — | 0 | 10,274 | unused |
| B | *(blank)* | — | — | 0 | 10,274 | unused |
| C | `الكود` | Item code | text/number | 10,271 | 3 | 10,269 numeric; 2 non-numeric (see 4.5) |
| D | `قسم` | Department | text | **500** | 9,771 | 27 distinct values; non-contiguous fill |
| E | `فرع` | Branch | — | **0** | 10,274 | entirely empty |
| F | `مخزن` | Warehouse/store | text | 10,274 | 0 | single value `مخزن المحل` |
| G | `الصنف` | Item name | text | 10,271 | 0 | leading/trailing spaces present |
| H | `سعر بيع قطاعي` | Sector retail price | number | 10,271 | 0 | 0.5 – 900, median 32, 240 distinct |
| I,J | *(blank)* | — | — | 0 | 10,274 | unused |

Non-price file additions: SRC-02 adds `سعر الشراء`, `سعر البيع`, `رصيد حالي`; SRC-03 adds
`رصيد سابق`, `اجمالي مباع`, `رصيد حالي`; SRC-04 adds `التاريخ` and `الصلاحية` and shifts
columns by one.

### 4.3 Does the file cover all POS items? — **NOT PROVEN**
- No report title, branch filter, price-list ID, or extraction date is present in any cell or
  in the PDF pages (searched for date/branch/page markers: **zero matches**).
- No report row/page cap is visible (219 PDF pages × ~47 rows ≈ 10,293, consistent with a full
  dump rather than a truncated top-N).
- **No independent item-definition report was accessible** (POS software absent), so the file
  cannot be compared against a second item count.
- Verdict: **`نطاق الملف الكامل غير مثبت`** — plausible and internally consistent, but unproven.

### 4.4 Are the prices current/approved? — **NOT PROVEN**
- No extraction date, no effective date, no price-list name/ID anywhere in the 4 workbooks or
  the PDF headers. The only date evidence is file modified time (2026-10-15).
- Two different prices coexist for the same item (see 4.6) with **no list identifier**.
- Verdict: **date unknown; current approval unproven.**

### 4.5 Is the "code" a barcode or an internal code?
- 9,697 codes (94.42%) are exactly 13 digits; **9,679 pass the EAN-13 check digit (99.79%)**.
- GS1 prefixes: `622` → 7,885 (Egypt), `762` → 155, `677` → 154, `869` → 140, `628/629` → 135 each, `961` → 131, `201` → 121.
- 574 codes are **not** 13-digit: lengths 7 (130), 12 (114), 11 (89), 8 (75), 4 (58), 2 (57), 5 (43), plus a few longer. **161 are short numeric** (2–6 digits) such as `22` (لمارسكر خشن1كجم), `2454` (ملبن حبل), `2010111` (لانشون بيف) — these look like **internal/PLU-style codes**, not EAN.
- No separate barcode column exists in any file → item↔barcode↔PLU mapping is **not proven**.
- Verdict: **barcodes strongly probable for the 9,697; PLU/internal probable for the short codes; unconfirmed by an independent POS barcode report.**

### 4.6 Duplicates & conflicts
| Check | Count | Evidence |
|---|---|---|
| Unique codes | 10,266 (5 codes appear twice = 5 extra rows) | e.g. `6223000083833` rows 2926/2927 |
| Same code → same name | 1 (`6223000082393`, "فيروز خوخ1لتر", prices 12 and 11) | conflicting price for identical name |
| Same code → **different** names | 4 codes / 8 rows | `6223000083833` (امستل زيرو / امستيل زيرو330مل), `745760993574` (استيفيا سكر ظرف / فريدى سكر ستيفيا25كيس), `5053990137565` (برنجل حراق130جم / برينجلز الحار 130جم), `5449000298195` (كوكا كولا2.5لتر / كوكاكولاا2.5لتر) — **same barcode, two products** |
| Same name → different codes | **111** names (e.g. "ملح الخير" → 2 codes) | legitimate multi-SKU/pack, not an error by itself |
| Sector price ≠ general sell price | **2,058 / 10,265 (20.05%)**; 2,047 higher, 11 lower | median ratio 1.077 |
| Extremes | ×10.62 (`6224010274527` "سي فود دولفن500جم": sector 85 vs sell 8), ×0.375 (`8225044136016`: 60 vs 160) | likely data-entry or list-semantics errors |
| Buy price = 0 | 28 rows | incomplete cost data |
| Sell price < buy price | 99 rows | selling below cost |
| Negative current balance | **383** rows (min −135.5) | impossible stock |
| Absurd total sold | 2 rows (`6222035243489` → 6,222,035,243,587; `6223001085928` → 622,300,114) | quantity field corruption |

### 4.7 Present vs absent fields
| Field required by store | In price file? | In another source? | Verdict |
|---|---|---|---|
| Item code | ✅ `الكود` | ✅ all 4 | AVAILABLE |
| Commercial barcode | ⚠️ same column as code, unproven | ❌ no separate field | UNPROVEN |
| Item name | ✅ `الصنف` | ✅ all 4 | AVAILABLE |
| Description | ❌ | ❌ | **MISSING** |
| Category | ⚠️ 500/10,271 only | ⚠️ same | **DATA MISSING (95.1%)** |
| Brand | ❌ | ❌ | **MISSING** |
| Sector sell price | ✅ | ✅ | AVAILABLE (authority undecided) |
| General sell price | ❌ | ✅ SRC-02 | AVAILABLE (authority undecided) |
| Cost/buy price | ❌ | ✅ SRC-02 (28 zeros) | AVAILABLE (partial) |
| Compare-at / previous price | ❌ | ❌ | **MISSING** |
| Unit / sale type (PIECE/WEIGHT) | ❌ | ❌ | **MISSING** (inferable from names only) |
| Size/weight/volume | ⚠️ inside name text only | same | **PARTIAL (text only)** |
| Stock quantity | ❌ | ✅ SRC-02/03/04 | AVAILABLE (quality issues) |
| Item status (active/inactive) | ❌ | ❌ | **MISSING** |
| Item date | ❌ | ✅ SRC-04 `التاريخ` | AVAILABLE (defective) |
| Expiry | ❌ | ⚠️ SRC-04 `الصلاحية` = 7 values only | **DATA MISSING** |
| Branch | ⚠️ column empty | same | **DATA MISSING** |
| Currency | ❌ (EGP implied only) | ❌ | **UNPROVEN** |
| Images | ❌ | ❌ | **MISSING / source not found** |

**Name-derived size signals (heuristic evidence only, not a field):** 4,680 names contain `جم`,
767 `كجم`, 1,943 `مل`, 563 `لتر`, 42 `حبة/عدد`, 26 `كرتون/علبة`. ≈47% of names carry a
measurable unit — usable for later PIECE/WEIGHT classification **only with owner-approved rules**.

---

## 5. POS (Cashier Program) Discovery

| Screen / report sought | Discovery scope actually performed | Result |
|---|---|---|
| POS application installed | Registry uninstall keys (HKLM 64/32-bit), Start Menu (all `.lnk`), `Program Files`, `Program Files (x86)` | **NOT INSTALLED on this machine** |
| POS report menus (price / stock / items / barcodes / sections / units / promos / PLU / price lists / item status) | Cannot navigate — no POS application present | **NOT DISCOVERED (no access route)** |
| Item-definition report (for coverage proof) | — | **NOT ACCESSIBLE** |
| Inventory/stock report | SRC-02/03/04 carry balance columns (equivalent content obtained from exports instead) | AVAILABLE via export |
| Barcode report | — | **NOT ACCESSIBLE** |
| Units/conversions report | — | **NOT ACCESSIBLE** |
| Weight/PLU data | — | **NOT ACCESSIBLE** (short codes only hint at PLU) |
| Promotions/discounts report | — | **NOT ACCESSIBLE** (no promotion fields in any export) |

**Conclusion:** the POS runs on other hardware/accounts. Its report menus, report filters,
price-list definitions, and export parameters could not be inspected, so POS-side metadata
(report name, branch, date, item scope) is **unverifiable from this environment**. The 4 XLSX
exports are the only POS-side evidence, and per the phase rules no write/export operation was
performed against any system.

---

## 6. Store Database & API Inventory (source-level evidence)

Authoritative models (`prisma/schema.prisma`) the storefront expects:

| Data type | Model | Fields the storefront needs |
|---|---|---|
| Categories | `Category` | `name`, `slug`, `parentId`, `isActive`, `sortOrder` |
| Brands | `Brand` | `name`, `slug`, `logo` |
| Products | `Product` | `name`, `slug`, `categoryId`, `brandId`, `productType` (PIECE\|WEIGHT), `unit` (PIECE\|KG\|GRAM\|LITER\|ML), `saleStepGrams` |
| Variants | `ProductVariant` | `name`, `sizeValue`, `sizeUnit`, `price`, `compareAtPrice`, `costPrice`, `isActive` |
| Barcodes | `ProductCode` | `code` VARCHAR(64) (leading zeros preserved), `type` (BARCODE\|INTERNAL_CODE), `isPrimary` |
| Images | `ProductImage` | `url`, `altText`, `mimeType`, `size`, `sortOrder`, `isPrimary` |
| Inventory | `Inventory` | `quantity`, `reservedQuantity`, `lowStockThreshold` (DB-generated availability) |

**Data existence evidence:** the local PostgreSQL instance is **down** (`pg_ctl: no server
running`) and restart is prohibited, so **no row-count proof is available**. What is proven is
**contract + code readiness**: catalog/search/lookup API routes exist and compile
(`/api/store/catalog/products|variants|categories|brands|codes/lookup|search`, admin catalog
write routes), and the frontend read layer is implemented. Prior audits recorded a
development DB state with an empty catalog; production/staging row counts are **unknown**.

**Frontend field demand vs POS export availability:**

| Store field | Available in POS exports? |
|---|---|
| name, code | ✅ |
| category | ⚠️ 4.87% only |
| brand | ❌ |
| productType (PIECE/WEIGHT) | ❌ (inference only) |
| unit + saleStepGrams | ❌ (name text only) |
| price | ✅ two conflicting lists |
| compareAtPrice | ❌ |
| costPrice | ✅ partial (28 zeros) |
| barcode type (BARCODE vs INTERNAL_CODE) | ❌ (single column, unproven) |
| inventory quantity | ⚠️ available but defective (383 negatives, 2 corrupted totals) |
| images | ❌ |

---

## 7. Source Relationship Map (match confidence)

| Relationship | Confidence | Basis | Risk if used as-is |
|---|---|---|---|
| SRC-01 ↔ SRC-02/03/04 = same item master | **CONFIRMED** | identical 10,266-code set, 4 name diffs only | none — column-join on `الكود` is safe |
| `الكود` (13-digit, checksum-valid) ↔ EAN-13 barcode | **PROBABLE** | 9,679 valid check digits, GS1 country prefix `622` | wrong assumption on the 574 non-EAN rows |
| Short numeric code (2–6 digits) ↔ internal/PLU | **PROBABLE (weak)** | length/format only; no POS barcode report | misclassifying PLU as barcode breaks scanning |
| Item ↔ `variant` | **PROBABLE (weak)** | no size column; sizes live inside the name text | wrong unit/step per item |
| Item ↔ `category` | **UNPROVABLE from exports** | 95.13% of rows have no department | forced mis-categorization |
| Item ↔ `brand` | **NO DATA** | no brand field anywhere | requires another source or manual mapping |
| Sector price ↔ customer price | **OWNER DECISION REQUIRED** | 20.05% divergence between the two lists | wrong price on 1 in 5 items |
| Item ↔ image | **NO SOURCE FOUND** | — | catalog without photos |
| Balance ↔ live store inventory | **PROBABLE (weak)** | POS export balances, not the storefront DB | stale/defective stock |

**Proposed (not executed) join key:** `الكود` as a string, preserving leading zeros and the
exact raw characters — *not* numeric conversion, because 1 code is already stored as a float
(`9.40862230058737e+16`) and 2 are non-numeric.

---

## 8. Data Quality Summary (denominators stated)

| Metric | Value | Denominator |
|---|---|---|
| Data records per file | 10,271 | rows with non-empty code |
| Unique codes | 10,266 | 10,271 records |
| Duplicated codes | 5 (1 same-name, 4 different-name) | 10,271 |
| Names with >1 code | 111 | 9,838 non-empty names |
| EAN-13 shaped | 9,697 (94.42%) | 10,271 |
| …checksum-valid | 9,679 (99.79%) | 9,697 |
| Non-EAN codes | 574 (5.59%) · short numeric 161 | 10,271 |
| Corrupt codes | 2 (scientific-notation float; Arabic garbage) | 10,271 |
| Category filled | 500 (4.87%) · 27 values | 10,271 |
| Branch filled | 0 (0%) | 10,271 |
| Warehouse | 1 value for 100% of rows | 10,271 |
| Sector ≠ sell price | 2,058 (20.05%) | 10,265 comparable |
| Buy price = 0 | 28 (0.27%) | 10,264 |
| Sell < buy | 99 (0.96%) | 10,264 |
| Negative balance | 383 (3.73%) | 10,266 |
| Positive balance (in-stock proxy) | 3,697 (**36.0%**) | 10,266 |
| Zero balance | 6,186 (60.3%) | 10,266 |
| Item dates present | 8,776 parsed · 1,495 empty | 10,271 |
| Item date range | 2019-01-10 → **2026-12-03** (future vs file date) | 10,271 |
| Expiry values | 7 | 10,271 |
| Names carrying a size token | 4,680 جم / 767 كجم / 1,943 مل / 563 لتر | 10,271 |
| Prices | sector: 240 distinct, integers in 10,125 rows · sell: 294 distinct, 1-decimal in 10,008 | 10,271 |

---

## 9. Unknowns Register (no guessing)

| # | Question | Why unresolved | Evidence needed |
|---|---|---|---|
| U-01 | Does the file cover **all** POS items? | no POS item-definition report; POS not on this machine | POS "item definition" export for the same date |
| U-02 | Are the prices current/approved? | no extraction date, no price-list ID, two conflicting lists | POS price-list report + owner confirmation |
| U-03 | Which price is customer-facing (sector vs general)? | 20.05% divergence, no list semantics | owner decision + POS price-list config |
| U-04 | Is each `الكود` a barcode, PLU, or internal code? | single undifferentiated column | POS barcode/PLU report |
| U-05 | Currency? | no currency field; EGP inferred from market context only | owner/POS currency setting |
| U-06 | Branch & warehouse scope | branch empty, single warehouse value | POS report filter parameters |
| U-07 | Unit / PIECE vs WEIGHT / weight step | no unit fields; name text only | owner classification rules or POS unit report |
| U-08 | Brand source | no brand field in any export | supplier/brand master list |
| U-09 | Category taxonomy | only 27 names on 4.87% of rows | owner taxonomy decision + mapping |
| U-10 | Product images | no source discovered anywhere | image source or photography plan |
| U-11 | Expiry dates | only 7 values present | POS expiry/batch report if required |
| U-12 | Item status (active/inactive) | no status column | POS item status report |
| U-13 | What are the 8 `.accdb` files? | unreadable (no ACE provider, no OLE2 header) | Access/ACE environment or the producing tool |
| U-14 | Current store DB row counts | local PostgreSQL down; restart prohibited | access to a running staging/production DB |
| U-15 | The 4 duplicated barcodes: which product is correct? | two names per code in the source itself | owner/POS review |

---

## 10. Phase-01 Closure Standard

| Criterion | Status |
|---|---|
| Price file searched by literal name and variants | ✅ found at `D:\عر بيع قطاعي.xlsx` (+3 sibling exports) |
| Record count proven | ✅ 10,271 (method documented) |
| Column dictionary produced | ✅ (SRC-01 + additions in SRC-02/03/04) |
| Duplicates/conflicts/gaps analyzed | ✅ (§4.6, §8) |
| POS reports searched beyond the price file | ⚠️ attempted; **POS not present in this environment** — boundary documented, not assumed |
| Every store data type mapped to a source | ✅ (§6, §7) |
| API contracts and models inspected | ✅ |
| Relationships graded with confidence | ✅ (§7) |
| Unknowns recorded without guessing | ✅ (§9) |
| Report created | ✅ this file |
| No business data / DB / app / contract modified | ✅ confirmed |

---

## 11. Constraints & Limitations of This Phase

- The POS program itself was inaccessible → all POS menu/report/filter metadata is unknown;
  nothing was asserted about the POS beyond the four exports and their structure.
- The 8 Access databases could not be opened (no ACE/Jet provider; files also lack the OLE2
  container header). They remain a **potential unexplored source**, not a null result.
- No live database read was possible (service down; restart prohibited) → **zero row-count
  proof** for the store's own catalog.
- No report date, branch, or price-list identifier exists in any export; file modified time is
  the only temporal evidence and it does **not** prove data freshness.
- Analysis covered 4 XLSX files only; no customer, order, or personal data was read.

---

## 12. Phase Status

**مكتملة مع قيود موثقة (Complete with documented limitations).**

The store-side discovery is exhausted to the limit of this environment: four real POS exports
were located, opened, and fully characterized (10,271 records each, one shared item master),
two price lists and their conflicts are quantified, data-quality defects are enumerated with
evidence, and every required field is mapped to a source or explicitly marked missing.
The two limits — POS software absent and local database down — are environmental, and both
are documented as blocking evidence rather than resolved by assumption.
No import, pricing, stock, or database action was performed, and none is proposed here as
already decided.