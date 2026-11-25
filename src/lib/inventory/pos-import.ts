// POS / Excel inventory import — stock + product-creation workflow (P0-A: inventory import and stock readiness).
//
// Scope:
//   • Column mapping: flexible header matching (Arabic/English aliases: الكود|code, الاسم|name,
//     الكمية|quantity|stock, وحدة|unit, السعر|price, المورد|supplier, الفئة|category).
//   • Matching: exact code match against product_codes (identifier rule: no fuzzy matching, no name guessing).
//   • Preview (default): stockRows + createdProducts + rejectedRows + priceConflicts + summary.
//   • Apply (confirmed): creates products for createdProducts (validated, audited) and applies
//     stockRows through previewOrApplyInventoryImport (its own guarded transaction).
//     Price conflicts are NEVER silently applied (review-only flags).
//
// Validation rules (no invented values; never auto-reclassifies existing products):
//   • Unknown code + no name → rejected PRODUCT_NOT_FOUND.
//   • Unknown code + name + KG/GRAM unit → product_type=WEIGHT, size_unit=unit.
//   • WEIGHT products must use KG/GRAM; PIECE: unit=PIECE, whole packs only.
//   • New products keep their source price as an unapplied review field; the stock row
//     carries sourcePrice for the price-conflict review only.
import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ApiError, conflict } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";
import { assertAdminPreviewWritesAllowed } from "@/lib/auth/admin-read-only-preview";
import { isWholePacks } from "@/lib/inventory/quantities";
import type { ImportFileTable } from "@/lib/inventory/import-file";
import { previewOrApplyInventoryImport } from "@/lib/inventory/import-service";
import { prisma } from "@/lib/db";
import { z } from "zod";

// ---- input schema ---------------------------------------------------------------

export const posImportInputSchema = z.object({
  source: z.string().trim().min(3).max(120),
  asOf: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(3).max(500),
  categoryIdDefault: z.string().uuid().optional(),
}).strict();
export type PosImportInput = z.infer<typeof posImportInputSchema>;

// ---- POS column mapping ---------------------------------------------------------

export interface PosColumn {
  row: number; code: string; productCode: string; name: string; quantity: string; unit: string;
  sourcePrice: string; category: string; supplier: string;
}
const ALIAS_GROUPS: Array<{ target: keyof PosColumn; aliases: string[] }> = [
  { target: "code", aliases: ["الكود", "كود", "code", "barcode", "باركود", "الرمز"] },
  { target: "productCode", aliases: ["كود إضافي", "alternate", "alternate_code", "alt_code", "alternate code"] },
  { target: "name", aliases: ["الاسم", "name", "product_name", "الاسم التجاري", "اسم المنتج"] },
  { target: "quantity", aliases: ["الكمية", "الرصيد", "quantity", "stock", "العدد", "quantity_unhealed"] },
  { target: "unit", aliases: ["وحدة", "unit", "الوحدة"] },
  { target: "sourcePrice", aliases: ["السعر", "سعر", "price", "source_price", "cost", "الثمن", "source price"] },
  { target: "category", aliases: ["الفئة", "فئة", "category", "category_name", "الفئة التصنيفية"] },
  { target: "supplier", aliases: ["المورد", "supplier", "المصدر المالي"] },
];
function matchColumn(header: string): keyof PosColumn | null {
  const h = header.trim().toLowerCase();
  if (!h) return null;
  for (const g of ALIAS_GROUPS) for (const a of g.aliases) if (h === a.toLowerCase() || h.includes(a.toLowerCase())) return g.target;
  return null;
}
export function mapPosColumns(table: ImportFileTable): PosColumn[] {
  const map = new Map<keyof PosColumn, string>();
  for (const header of table.headers) {
    const target = matchColumn(header);
    if (target) {
      const colon = header.indexOf(":");
      const num = Number(colon >= 0 ? header.slice(0, colon).trim() : "");
      if (Number.isFinite(num) && num >= 1) map.set(target, String(num));
    }
  }
  const pick = (row: string[], target?: string): string => {
    if (!target) return "";
    const c = Number(target) - 1;
    return c >= 0 ? row[c]?.trim() ?? "" : "";
  };
  return table.rows.map((r) => ({
    row: r.row,
    code: pick(r.cells, map.get("code")),
    productCode: pick(r.cells, map.get("productCode")),
    name: pick(r.cells, map.get("name")),
    quantity: pick(r.cells, map.get("quantity")),
    unit: pick(r.cells, map.get("unit")),
    sourcePrice: pick(r.cells, map.get("sourcePrice")),
    category: pick(r.cells, map.get("category")),
    supplier: pick(r.cells, map.get("supplier")),
  }));
}

// ---- preview ---------------------------------------------------------------------

export interface PosRejectedRow { row: number; code: string; reason: string }
export interface CreatedProductCandidate {
  code: string; productType: "PIECE" | "WEIGHT"; categoryName: string; categoryId: string;
  name: string; sizeUnit: string | null; sizeValue: string | null; price: string; supplier: string;
}
export interface PosPreview {
  stockRows: Array<{ row: number; code: string; productCode: string; quantity: string; unit: string; sourcePrice: string }>;
  createdProducts: CreatedProductCandidate[];
  rejectedRows: PosRejectedRow[];
  priceConflicts: Array<{ row: number; code: string; current: string; source: string }>;
  summary: { rows: number; stockRows: number; createdProducts: number; rejectedRows: number; priceConflicts: number };
}

const PRICE_RE = /^\d{1,8}(\.\d{1,2})?$/;
const CODE_RE = /^[^\s\u0000-\u001f=+@]{1,64}$/;

async function loadTargetsByCodes(codes: string[]) {
  const rows = await prisma.$queryRaw<Array<{ id: string; productId: string; name: string; codes: string[]; active: boolean; productType: string; sizeUnit: string | null; quantity: string | null; price: string }>>`
    SELECT v.id::text AS id, p.id::text AS "productId", p.name AS name,
           ARRAY(SELECT c.code FROM product_codes c WHERE c.product_variant_id=v.id ORDER BY c.code) AS codes,
           (p.is_active AND p.deleted_at IS NULL AND v.is_active AND v.deleted_at IS NULL) AS active,
           p.product_type AS productType, v.size_unit AS sizeUnit, i.quantity::text AS quantity, v.price::text AS price
    FROM product_variants v JOIN products p ON p.id=v.product_id
    LEFT JOIN inventory i ON i.product_variant_id=v.id
    WHERE EXISTS (SELECT 1 FROM product_codes c WHERE c.product_variant_id=v.id AND c.code=ANY(${codes}::text[]))`;
  const byCode = new Map<string, Array<{ id: string; productId: string; name: string; codes: string[]; active: boolean; productType: string; sizeUnit: string | null; quantity: string | null; price: string }>>();
  for (const t of rows) for (const c of t.codes) byCode.set(c, [...(byCode.get(c) ?? []), t]);
  return byCode;
}

async function defaultCategory(): Promise<{ id: string; name: string } | null> {
  const row = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT id::text AS id, name FROM categories WHERE parent_id IS NULL ORDER BY sort_order ASC, id ASC LIMIT 1`;
  return row[0] ?? null;
}

export async function posImportPreview(input: { categoryIdDefault?: string }, table: ImportFileTable): Promise<{ parsed: PosPreview }> {
  return { parsed: await computePreview(input.categoryIdDefault, table) };
}

async function computePreview(categoryIdDefault: string | undefined, table: ImportFileTable): Promise<PosPreview> {
  const rows = mapPosColumns(table);
  const allCodes = [...new Set(rows.flatMap((r) => [r.code, r.productCode]).filter(Boolean))];
  const targets = await loadTargetsByCodes(allCodes);
  const stockRows: PosPreview["stockRows"] = [];
  const rejected: PosRejectedRow[] = [];
  const created: CreatedProductCandidate[] = [];
  const priceConflicts: PosPreview["priceConflicts"] = [];

  const defaultCat = categoryIdDefault ? await prisma.category.findUniqueOrThrow({ where: { id: categoryIdDefault }, select: { id: true, name: true } })
    : await defaultCategory();
  if (!defaultCat) throw new ApiError("VALIDATION", "No category available; pass categoryIdDefault or configure a default root category.");

  for (const r of rows) {
    const rowNum = r.row;
    const codes = [r.code, r.productCode].filter(Boolean);
    if (!codes.length) { rejected.push({ row: rowNum, code: "", reason: "MISSING_CODE" }); continue; }
    if (codes.some((c) => !CODE_RE.test(c))) { rejected.push({ row: rowNum, code: codes[0], reason: "INVALID_CODE" }); continue; }
    const matched = codes.map((c) => targets.get(c) ?? []);
    const ids = new Set(matched.flat().map((t) => t.id));
    if (ids.size > 1 || matched.some((m) => m.length > 1)) { rejected.push({ row: rowNum, code: codes[0], reason: "AMBIGUOUS_PRODUCT" }); continue; }
    const target = ids.size === 1 ? matched[0][0] : null;
    if (r.quantity === "") { rejected.push({ row: rowNum, code: codes[0], reason: "UNKNOWN_STOCK" }); continue; }
    if (r.quantity.startsWith("-")) { rejected.push({ row: rowNum, code: codes[0], reason: "NEGATIVE_STOCK" }); continue; }
    const unit = r.unit.trim().toUpperCase();
    if (!target) {
      const name = r.name?.trim() ?? "";
      if (!name) { rejected.push({ row: rowNum, code: codes[0], reason: "PRODUCT_NOT_FOUND" }); continue; }
      if (unit && !["PIECE", "KG", "GRAM"].includes(unit)) { rejected.push({ row: rowNum, code: codes[0], reason: "UNIT_MISMATCH" }); continue; }
      const isWeight = unit === "KG" || unit === "GRAM";
      if (!isWeight && !isWholePacks(r.quantity.trim())) { rejected.push({ row: rowNum, code: codes[0], reason: "FRACTIONAL_PIECES" }); continue; }
      const sourcePrice = r.sourcePrice.trim();
      if (sourcePrice && !PRICE_RE.test(sourcePrice)) { rejected.push({ row: rowNum, code: codes[0], reason: "INVALID_PRICE" }); continue; }
      created.push({
        code: r.code || r.productCode,
        productType: isWeight ? "WEIGHT" : "PIECE",
        categoryName: (r.category || defaultCat.name).trim(),
        categoryId: defaultCat.id,
        name,
        sizeUnit: isWeight ? unit : null,
        sizeValue: null,
        price: sourcePrice || "0.00",
        supplier: r.supplier.trim(),
      });
      continue;
    }
    // Matched: price-conflict review only (never applied automatically).
    const sourcePrice = r.sourcePrice.trim();
    if (sourcePrice && !PRICE_RE.test(sourcePrice)) { rejected.push({ row: rowNum, code: codes[0], reason: "INVALID_PRICE" }); continue; }
    stockRows.push({ row: rowNum, code: r.code, productCode: "", quantity: r.quantity.trim(), unit, sourcePrice });
    if (sourcePrice && sourcePrice !== target.price) priceConflicts.push({ row: rowNum, code: codes[0], current: target.price, source: sourcePrice });
  }
  // Duplicate matched codes: same barcode on two POS rows → reject both (mirrors the stock pipeline's DUPLICATE_VARIANT).
  const dupSeen = new Map();
  for (const row of stockRows) dupSeen.set(row.code, (dupSeen.get(row.code) ?? 0) + 1);
  const stockRowsFinal = [];
  for (const row of stockRows) {
    if ((dupSeen.get(row.code) ?? 0) > 1) rejected.push({ row: row.row, code: row.code, reason: "DUPLICATE_VARIANT" });
    else stockRowsFinal.push(row);
  }
  return {
    stockRows: stockRowsFinal,
    createdProducts: created,
    rejectedRows: rejected,
    priceConflicts,
    summary: { rows: table.rows.length, stockRows: stockRowsFinal.length, createdProducts: created.length, rejectedRows: rejected.length, priceConflicts: priceConflicts.length },
  };
}

// ---- apply -----------------------------------------------------------------------

async function uniqueSlug(db: Prisma.TransactionClient | typeof prisma, name: string): Promise<string> {
  const base = name.trim().replaceAll(/[^A-Za-z0-9._-]+/g, "-").replaceAll(/^-+|-+$/g, "").toLowerCase().slice(0, 180) || "product";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${randomUUID().slice(0, 6)}`;
    const taken = await db.product.findFirst({ where: { slug: { equals: candidate, mode: "insensitive" } }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw conflict("Could not allocate a unique slug for the new product.", null);
}

export async function posImportApply(input: PosImportInput, table: ImportFileTable, actorId: string) {
  assertAdminPreviewWritesAllowed();
  const parsed = posImportInputSchema.parse(input);
  const preview = await computePreview(parsed.categoryIdDefault, table);
  for (const p of preview.createdProducts) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(712019, 3)::text`;
      const slug = await uniqueSlug(tx, p.name);
      const productId = randomUUID();
      const variantId = randomUUID();
      const cat = (await tx.category.findUniqueOrThrow({ where: { id: p.categoryId }, select: { id: true } }));
      const dup = await tx.product.findFirst({ where: { name: { equals: p.name, mode: "insensitive" } }, select: { id: true } });
      if (dup) throw conflict("This product already exists; confirm whether it was created by this import.", { productId: dup.id });
      const productUnit = p.productType === "WEIGHT" ? (p.sizeUnit ?? "KG") : "PIECE";
      const saleStepGrams = p.productType === "WEIGHT" ? 125 : null; // chk_products_weight_rule: WEIGHT needs >0 step
      await tx.$executeRaw`INSERT INTO products (id,name,slug,category_id,product_type,unit,sale_step_grams,is_active)
        VALUES (${productId}::uuid,${p.name}::text,${slug}::text,${cat.id}::uuid,${p.productType}::text,${productUnit}::text,${saleStepGrams}::int,true)`;
      await tx.productVariant.create({ data: { id: variantId, productId, name: p.name, sizeValue: p.sizeValue, sizeUnit: p.sizeUnit, price: new Prisma.Decimal(p.price || "0.00"), isActive: true } });
      await tx.productCode.create({ data: { productVariantId: variantId, code: p.code, type: "INTERNAL_CODE" } });
      await auditInTx(tx, { action: "pos.product_create", userId: actorId, entityType: "products", entityId: productId,
        oldValues: null, newValues: { name: p.name, categoryId: cat.id, productType: p.productType, sizeUnit: p.sizeUnit, sizeValue: p.sizeValue, price: p.price, supplier: p.supplier, source: parsed.source }, reason: parsed.reason });
    });
  }
  const stockRows = preview.stockRows;
  const stockInput = {
    source: parsed.source,
    asOf: parsed.asOf,
    location: "GLOBAL" as const,
    reason: parsed.reason,
    rows: stockRows,
    dryRun: true,
  };
  const stockPreview = stockRows.length ? await previewOrApplyInventoryImport({ ...stockInput, dryRun: true }, actorId) : null;
  const stock = stockPreview ? await previewOrApplyInventoryImport({ ...stockInput, dryRun: false, confirmed: true, previewReceipt: stockPreview.previewReceipt ?? undefined }, actorId) : { applied: false, importId: null, summary: { total: 0, accepted: 0, rejected: 0 } };
  return { created: preview.createdProducts.length, stock, preview };
}
