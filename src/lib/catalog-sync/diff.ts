import type { Prisma } from "@prisma/client";
import type { PreviewRow, RowStatus, SyncManifestOperation, SyncPreview } from "./types";
import { readLiveProductCode } from "./read-catalog";
import { prisma } from "@/lib/db";
import { canonicalDecimal } from "@/lib/catalog/price";
import { randomUUID } from "node:crypto";

export interface DiffResult {
  rows: PreviewRow[];
  counts: {
    unchanged: number; safeToApply: number; alreadyApplied: number; conflicted: number;
    sourceNotFound: number; targetReferenceMissing: number; invalid: number; dependencyBlocked: number;
  };
  affectedProducts: number;
  affectedVariants: number;
  affectedCategories: number;
  affectedBrands: number;
  priceChanges: number;
  lifecycleChanges: number;
}

const canonicalArr = (v: unknown) => JSON.stringify(v ?? null);
const toText = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return canonicalDecimal(v);
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  const s = String(v); // Prisma Decimal objects
  return canonicalDecimal(s);
};
const decEq = (a: unknown, b: unknown): boolean => {
  const ca = toText(a);
  const cb = toText(b);
  if (ca !== null && cb !== null) return ca === cb;
  return canonicalArr(a) === canonicalArr(b);
};
const STUDIO_LOCAL_PREFIXES = ["studio-cat-", "studio-brand-"];
const isStudioLocalRef = (v: unknown): v is string => typeof v === "string" && STUDIO_LOCAL_PREFIXES.some((p) => v.startsWith(p));
const asArray = (x: unknown): string[] => {
  if (x == null) return [];
  const s = Array.isArray(x) ? x : [x];
  return s.filter((v): v is string => typeof v === "string" && v.length > 0);
};

/** Three-way classification: Studio base â†’ proposed; website current. */
export function classifyOp(op: SyncManifestOperation, current: { current: unknown; exists: boolean }): RowStatus {
  if (!current.exists) {
    if (op.type === "SET_PRODUCT_FIELD" || op.type === "SET_VARIANT_FIELD") return "SOURCE_NOT_FOUND";
    if (op.type === "CREATE_PRODUCT" || op.type === "CREATE_CATEGORY" || op.type === "CREATE_BRAND") return "SAFE_TO_APPLY";
    return "SOURCE_NOT_FOUND";
  }
  const cur = current.current;
  const isProposedNow = decEq(cur, op.proposed);
  if (isProposedNow) {
    if (op.base !== undefined && op.base !== null && decEq(op.base, op.proposed) === false) return "ALREADY_APPLIED";
    return "UNCHANGED";
  }
  if (isStudioLocalRef(op.proposed as string) && (cur === null || (typeof cur === "string" && isStudioLocalRef(cur)))) return "SAFE_TO_APPLY";
  if (op.base === undefined || op.base === null) return "CONFLICTED";
  if (decEq(cur, op.base)) return "SAFE_TO_APPLY";
  return "CONFLICTED";
}

interface LiveState {
  products: Map<string, Record<string, unknown>>;
  variants: Map<string, Record<string, unknown>>;
  categories: Map<string, Record<string, unknown>>;
  brands: Map<string, Record<string, unknown>>;
}

/** One batched read of live rows referenced by the manifest. */
export async function loadLiveState(ops: SyncManifestOperation[], db: Prisma.TransactionClient = prisma): Promise<LiveState> {
  const productIds = asArray(ops.filter((o) => o.entityType === "product").map((o) => o.entityId));
  const variantIds = asArray(ops.filter((o) => o.entityType === "product_variant").map((o) => o.entityId));
  const categoryIds = asArray(ops.filter((o) => o.entityType === "category").map((o) => o.entityId));
  const brandIds = asArray(ops.filter((o) => o.entityType === "brand").map((o) => o.entityId));
  const state: LiveState = { products: new Map(), variants: new Map(), categories: new Map(), brands: new Map() };
  const prodRows = productIds.length ? await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, slug: true, categoryId: true, brandId: true, productType: true, unit: true, saleStepGrams: true, isActive: true, deletedAt: true } }) : [];
  for (const r of prodRows) state.products.set(r.id, { id: r.id, name: r.name, slug: r.slug, categoryId: r.categoryId, brandId: r.brandId, productType: r.productType, unit: r.unit, saleStepGrams: r.saleStepGrams, isActive: r.isActive, deletedAt: r.deletedAt });
  const varRows = variantIds.length ? await db.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, productId: true, name: true, price: true, sizeValue: true, sizeUnit: true, isActive: true, deletedAt: true } }) : [];
  for (const r of varRows) state.variants.set(r.id, { id: r.id, productId: r.productId, name: r.name, price: r.price, sizeValue: r.sizeValue, sizeUnit: r.sizeUnit, isActive: r.isActive, deletedAt: r.deletedAt });
  const catRows = categoryIds.length ? await db.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true, slug: true, parentId: true, isActive: true, deletedAt: true, sortOrder: true } }) : [];
  for (const r of catRows) state.categories.set(r.id, { id: r.id, name: r.name, slug: r.slug, parentId: r.parentId, isActive: r.isActive, deletedAt: r.deletedAt, sortOrder: r.sortOrder });
  const brandRows = brandIds.length ? await db.brand.findMany({ where: { id: { in: brandIds } }, select: { id: true, name: true, slug: true, isActive: true, deletedAt: true } }) : [];
  for (const r of brandRows) state.brands.set(r.id, { id: r.id, name: r.name, slug: r.slug, isActive: r.isActive, deletedAt: r.deletedAt });
  // Product codes: primary BARCODE code per product (for product_code ops).
  void productIds;
  return state;
}

/** Read the current value of an op from the batched live state. */
export function currentFromState(op: SyncManifestOperation, state: LiveState): { current: unknown; exists: boolean } {
  const row = state.products.get(op.entityId) ?? state.variants.get(op.entityId) ?? state.categories.get(op.entityId) ?? state.brands.get(op.entityId);
  if (!row) {
    if (op.type === "CREATE_PRODUCT" || op.type === "CREATE_CATEGORY" || op.type === "CREATE_BRAND") return { current: null, exists: false };
    return { current: null, exists: false };
  }
  const field = String(op.field ?? "");
  if (row.productId === undefined && "name" in row && op.entityType === "product") {
    const product = state.products.get(op.entityId);
    if (product) {
      if (field === "lifecycle") {
        const life = product.deletedAt != null ? "archived" : product.isActive ? "visible" : "hidden";
        return { current: life, exists: true };
      }
      if (field === "product_code") {
        // primary variant code â€” filled by readLiveProductCode for clarity; state has no codes (returns null => SOURCE_NOT_FOUND on mismatch)
        return { current: null, exists: true };
      }
      const mapped = { name: "name", slug: "slug", product_type: "productType", unit: "unit", sale_step_grams: "saleStepGrams", category_id: "categoryId", brand_id: "brandId", is_active: "isActive", deleted_at: "deletedAt" }[field] ?? field;
      return { current: (product as unknown as Record<string, unknown>)[mapped] ?? null, exists: true };
    }
  }
  if (op.entityType === "product_variant") {
    const mapped = { name: "name", price: "price", size_value: "sizeValue", size_unit: "sizeUnit", is_active: "isActive" }[field] ?? field;
    return { current: (row as unknown as Record<string, unknown>)[mapped] ?? null, exists: true };
  }
  const mapped = { is_active: "isActive", parent_id: "parentId", sort_order: "sortOrder" }[field] ?? field;
  return { current: (row as unknown as Record<string, unknown>)[mapped] ?? null, exists: true };
}

export async function diffManifest(ops: SyncManifestOperation[], db: Prisma.TransactionClient = prisma): Promise<DiffResult> {
  const state = await loadLiveState(ops, db);
  const rows: PreviewRow[] = [];
  const counts = { unchanged: 0, safeToApply: 0, alreadyApplied: 0, conflicted: 0, sourceNotFound: 0, targetReferenceMissing: 0, invalid: 0, dependencyBlocked: 0 };
  const affectedProducts = new Set<string>();
  const affectedVariants = new Set<string>();
  const affectedCategories = new Set<string>();
  const affectedBrands = new Set<string>();

  for (const op of ops) {
    // Slow path: product codes need a raw read.
    if (op.entityType === "product" && op.field === "product_code") {
      const code = await readLiveProductCode(op.entityId, db);
      const product = state.products.get(op.entityId);
      if (!product) { rows.push({ op, status: "SOURCE_NOT_FOUND", current: null, proposed: op.proposed, base: op.base, productId: op.productId, message: null, dependencyOrder: undefined }); continue; }
      const status = classifyOp(op, { current: code, exists: true });
      applyCounts(status, counts);
      rows.push({ op, status, current: code, proposed: op.proposed, base: op.base, productId: op.productId, message: status === "CONFLICTED" ? `target current (${JSON.stringify(code)}) != Studio base/proposed` : null, dependencyOrder: undefined });
      continue;
    }
    const current = currentFromState(op, state);
    const status = classifyOp(op, current);
    // Website CHECK: WEIGHT products require sale_step_grams > 0 (db CHECK chk_products_weight_rule).
    const productRow = state.products.get(op.entityId) as Record<string, unknown> | undefined;
    const statusFinal: RowStatus =
      status === "SAFE_TO_APPLY" &&
      op.entityType === "product" &&
      op.field === "sale_step_grams" &&
      productRow?.productType === "WEIGHT" &&
      (typeof op.proposed !== "number" || !Number.isInteger(op.proposed) || op.proposed < 1)
        ? "INVALID_OPERATION"
        : status;
    applyCounts(statusFinal, counts);
    if (op.entityId) {
      if (op.entityType === "product") affectedProducts.add(op.entityId);
      if (op.entityType === "product_variant") { affectedProducts.add(op.productId ?? ""); affectedVariants.add(op.entityId); }
      if (op.entityType === "category") affectedCategories.add(op.entityId);
      if (op.entityType === "brand") affectedBrands.add(op.entityId);
    }
    rows.push({ op, status: statusFinal, current: current.current, proposed: op.proposed, base: op.base, productId: op.productId, message: statusFinal === "CONFLICTED" ? `target current != Studio base/proposed` : statusFinal === "INVALID_OPERATION" && op.field === "sale_step_grams" ? "WEIGHT products require sale_step_grams > 0" : null, dependencyOrder: undefined });
  }

  const priceChanges = rows.filter((r) => r.op.field === "price" && r.status === "SAFE_TO_APPLY").length;
  const lifecycleChanges = rows.filter((r) => r.op.field === "lifecycle" && r.status === "SAFE_TO_APPLY").length;
  return {
    rows, counts,
    affectedProducts: affectedProducts.size,
    affectedVariants: affectedVariants.size,
    affectedCategories: affectedCategories.size,
    affectedBrands: affectedBrands.size,
    priceChanges, lifecycleChanges,
  };
}

function applyCounts(status: RowStatus, counts: DiffResult["counts"]): void {
  switch (status) {
    case "UNCHANGED": counts.unchanged++; break;
    case "SAFE_TO_APPLY": counts.safeToApply++; break;
    case "ALREADY_APPLIED": counts.alreadyApplied++; break;
    case "CONFLICTED": counts.conflicted++; break;
    case "SOURCE_NOT_FOUND": counts.sourceNotFound++; break;
    case "TARGET_REFERENCE_MISSING": counts.targetReferenceMissing++; break;
    case "INVALID_OPERATION": counts.invalid++; break;
    case "DEPENDENCY_BLOCKED": counts.dependencyBlocked++; break;
  }
}

export function summarizePreview(diff: DiffResult, manifestId: string, digest: string, studioSourceId: string, target: SyncPreview["target"]): SyncPreview {
  return {
    previewId: `preview-${randomUUID()}`,
    manifestId, digest, studioSourceId, target,
    generatedAt: new Date().toISOString(),
    rows: diff.rows,
    counts: diff.counts,
    affectedProducts: diff.affectedProducts,
    affectedVariants: diff.affectedVariants,
    affectedCategories: diff.affectedCategories,
    affectedBrands: diff.affectedBrands,
    priceChanges: diff.priceChanges,
    lifecycleChanges: diff.lifecycleChanges,
  };
}
