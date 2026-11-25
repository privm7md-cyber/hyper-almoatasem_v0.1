import { z } from "zod";
import { boundedThousandths, thousandthsText } from "@/lib/inventory/quantities";

export const stockImportRowSchema = z.object({
  row: z.number().int().positive(),
  code: z.string().trim().max(200),
  productCode: z.string().trim().max(200).default(""),
  quantity: z.string().trim().max(100),
  unit: z.string().trim().max(40),
  sourcePrice: z.string().trim().max(100).default(""),
}).strict();
export const stockImportSchema = z.object({
  source: z.string().trim().min(3).max(120),
  asOf: z.string().datetime({ offset: true }),
  location: z.literal("GLOBAL"),
  reason: z.string().trim().min(3).max(500),
  rows: z.array(stockImportRowSchema).min(1).max(20_000),
  dryRun: z.boolean().default(true),
  confirmed: z.boolean().optional(),
  previewReceipt: z.string().max(2048).optional(),
}).strict().refine(v => new Set(v.rows.map(r => r.row)).size === v.rows.length, "Duplicate source row numbers.");
export type StockImportInput = z.infer<typeof stockImportSchema>;
export type StockImportRow = z.infer<typeof stockImportRowSchema>;
export interface ImportTarget {
  id: string; productId: string; name: string; codes: string[];
  active: boolean; productType: string; sizeUnit: string | null;
  quantity: string | null; reserved: string; revision: string | null;
  price: string;
}
export interface StockDifference {
  row: number; code: string; variantId: string | null; name: string | null;
  before: string | null; after: string | null; delta: string | null;
  reserved: string | null; revision: string | null;
  status: "accepted" | "rejected"; errors: string[]; warnings: string[];
}

/** Codes are identifiers: never parse as numbers, strip zeros, or guess names. */
export function inventoryDifferences(rows: StockImportRow[], targets: ImportTarget[]): StockDifference[] {
  const byCode = new Map<string, ImportTarget[]>();
  for (const target of targets) for (const code of target.codes) byCode.set(code, [...(byCode.get(code) ?? []), target]);
  const result = rows.map((r): StockDifference => {
    const errors: string[] = [], warnings: string[] = [];
    const codes = [r.code, r.productCode].filter(Boolean);
    const matched = codes.map(code => byCode.get(code) ?? []);
    const ids = new Set(matched.flat().map(v => v.id));
    if (!codes.length) errors.push("MISSING_CODE");
    else if (codes.some(code => !/^[^\s\u0000-\u001f=+@]{1,64}$/.test(code) || /^\d+(\.\d+)?e[+-]?\d+$/i.test(code))) errors.push("INVALID_CODE");
    if (codes.length && matched.some(v => v.length === 0)) errors.push("PRODUCT_NOT_FOUND");
    if (ids.size > 1 || matched.some(v => v.length > 1)) errors.push("AMBIGUOUS_PRODUCT");
    const target = ids.size === 1 && matched.every(v => v.length === 1) ? matched[0][0] : null;
    let after: string | null = null;
    if (r.quantity === "") errors.push("UNKNOWN_STOCK");
    else if (r.quantity.startsWith("-")) errors.push("NEGATIVE_STOCK");
    else {
      try { after = thousandthsText(boundedThousandths(r.quantity)); } catch { errors.push("INVALID_QUANTITY"); }
    }
    if (target) {
      if (!target.active) errors.push("INACTIVE_OR_ARCHIVED");
      const stockUnit = target.productType === "PIECE" ? "PIECE" : target.sizeUnit;
      if (!stockUnit || (target.productType === "WEIGHT" && !["KG", "GRAM"].includes(stockUnit))) errors.push("UNRESOLVED_STOCK_UNIT");
      if (r.unit !== stockUnit) errors.push("UNIT_MISMATCH");
      if (after !== null && target.productType === "PIECE" && boundedThousandths(after) % 1000 !== 0) errors.push("FRACTIONAL_PIECES");
      if (after !== null && boundedThousandths(after) < boundedThousandths(target.reserved)) errors.push("BELOW_RESERVED_STOCK");
      if (r.sourcePrice && (!/^\d{1,8}(\.\d{1,2})?$/.test(r.sourcePrice) || Number(r.sourcePrice) !== Number(target.price))) warnings.push("PRICE_CONFLICT_REVIEW_ONLY");
    }
    return { row:r.row, code:r.code || r.productCode, variantId:target?.id ?? null, name:target?.name ?? null,
      before:target?.quantity ?? null, after, delta:after !== null && target?.quantity !== null && target?.quantity !== undefined ? thousandthsText(boundedThousandths(after) - boundedThousandths(target.quantity)) : null,
      reserved:target?.reserved ?? null, revision:target?.revision ?? null,
      status:errors.length ? "rejected" : "accepted", errors, warnings };
  });
  const counts = new Map<string, number>();
  for (const row of result) if (row.variantId) counts.set(row.variantId, (counts.get(row.variantId) ?? 0) + 1);
  for (const row of result) if (row.variantId && counts.get(row.variantId)! > 1) {
    row.errors.push("DUPLICATE_VARIANT"); row.status = "rejected";
  }
  return result;
}

/** Spreadsheet formula injection is neutralized in every exported cell. */
export function differencesCsv(rows: StockDifference[]): string {
  const cell = (value: unknown) => {
    const raw = String(value ?? "");
    return '"' + (/^[\s]*[=+\-@\t\r]/.test(raw) ? "'" : "") + raw.replaceAll('"', '""') + '"';
  };
  return "\uFEFF" + [["row","code","variant_id","status","before","after","delta","errors","warnings"],
    ...rows.map(r => [r.row,r.code,r.variantId,r.status,r.before,r.after,r.delta,r.errors.join(" | "),r.warnings.join(" | ")])]
    .map(row => row.map(cell).join(",")).join("\r\n");
}
