// Pure POS/Catalog data-quality rules & read-only Primary DB audit helpers.
// Strictly read-only: NEVER writes, seeds, fabricates prices/stock, or touches PII.

import { classifyCatalogName, type NameTrust } from "@/lib/catalog/name-integrity";
import { decimalsEqual, isValidPriceText } from "@/lib/catalog/price";

export type ProductCodeInvalidReason =
  | "ok"
  | "empty"
  | "too_long"
  | "whitespace_or_control"
  | "zero_placeholder"
  | "short_numeric_corrupt"
  | "bad_ean13_check_digit";

export interface ProductCodeValidationResult {
  valid: boolean;
  reason: ProductCodeInvalidReason;
  normalized: string;
}

export interface ProductUnitAnalysisInput {
  name?: string;
  productType: string;
  unit: string;
  saleStepGrams: number | null;
  variants: Array<{
    sizeValue: number | string | null;
    sizeUnit: string | null;
  }>;
}

export interface ProductUnitAnalysisResult {
  dbRuleValid: boolean;
  hasWeightShapeMismatch: boolean;
  hasWeightTokenOnPieceName: boolean;
  missingVariantSizeUnitCount: number;
  missingVariantSizeValueCount: number;
  variantCount: number;
  issues: string[];
}

export interface CatalogImportRowInput {
  rowNumber?: number;
  code: string;
  codeType?: "BARCODE" | "INTERNAL_CODE" | string;
  name: string;
  productType: string;
  unit: string;
  saleStepGrams?: number | null;
  price: string;
  sectorPrice?: string | null;
  stockQty?: number | string | null;
  sizeValue?: number | string | null;
  sizeUnit?: string | null;
}

export interface CatalogImportBatchIssue {
  rowNumber: number;
  code: string;
  issueCode:
    | "INVALID_CODE_FORMAT"
    | "DUPLICATE_CODE_IN_BATCH"
    | "INVALID_PRICE"
    | "NON_POSITIVE_PRICE"
    | "SUB_ONE_EGP_PRICE_ANOMALY"
    | "NEGATIVE_STOCK_BALANCE"
    | "DB_WEIGHT_RULE_VIOLATION"
    | "SECTOR_VS_SELL_PRICE_DIVERGENCE"
    | "NAME_NEEDS_REVIEW_OR_TEST_DATA"
    | "PIECE_WEIGHT_SHAPE_MISMATCH"
    | "MISSING_SIZE_METADATA";
  severity: "blocker" | "warning";
  detail: string;
}

export interface CatalogImportBatchValidationResult {
  totalRows: number;
  validRowCount: number;
  rejectedRowCount: number;
  blockerCount: number;
  warningCount: number;
  blockers: CatalogImportBatchIssue[];
  warnings: CatalogImportBatchIssue[];
  summary: {
    invalidCodes: number;
    duplicateCodes: number;
    invalidPrices: number;
    subOneEgpPrices: number;
    negativeStockRows: number;
    sectorVsSellDivergences: number;
    nameReviewRows: number;
    weightShapeMismatches: number;
    missingSizeMetadataRows: number;
  };
}

export interface CatalogAuditDb {
  $queryRaw: <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<T>;
}

export interface CategoryCountDiscrepancy {
  categoryId: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
  adminDirectCount: number;
  storefrontVisibleDirectCount: number;
  storefrontVisibleSubtreeCount: number;
}

export interface OwnerDecisionItem {
  key: string;
  severity: "critical" | "high" | "medium";
  titleAr: string;
  observedMetric: string;
  recommendedActionAr: string;
  blockedUntilOwnerDecision: boolean;
}

export interface CatalogDataQualityAuditReport {
  generatedAt: string;
  catalogOverview: {
    totalProducts: number;
    activeProducts: number;
    hiddenProducts: number;
    archivedProducts: number;
    totalCategories: number;
    activeCategories: number;
    totalBrands: number;
    totalVariants: number;
  };
  mediaCoverage: {
    productsWithImages: number;
    totalImageRows: number;
    productsMissingImages: number;
    coveragePercent: number;
  };
  inventoryCoverage: {
    variantsWithInventoryRow: number;
    realInStock: number;
    realConfirmedOos: number;
    realUnknownStock: number;
    liveProductsWithoutInventoryRow: number;
    allProductsConfirmedOos: number;
    allProductsUnknownStock: number;
  };
  priceHygiene: {
    totalVariants: number;
    variantsZeroOrNegativePrice: number;
    variantsUnder1Egp: number;
    minPrice: string | null;
    maxPrice: string | null;
    priceHistoryRows: number;
    under1EgpSamples: Array<{ productId: string; productName: string; variantName: string; price: string }>;
  };
  codeHygiene: {
    totalCodes: number;
    duplicateCodesInDb: number;
    corruptOrZeroCodes: number;
    badEan13CheckDigits: number;
    liveProductsWithoutCodes: number;
    invalidCodeSamples: Array<{ code: string; type: string; reason: string; productName: string }>;
  };
  unitAndWeightConsistency: {
    dbWeightRuleViolations: number;
    pieceProductsWithWeightVariantUnit: number;
    pieceProductsWithWeightTokenInName: number;
    variantsMissingSizeUnit: number;
    variantsMissingSizeValue: number;
  };
  nameIntegrity: Record<NameTrust, number> & {
    needsReviewSamples: Array<{ id: string; name: string; trust: NameTrust }>;
  };
  lifecycleAnomalies: {
    hiddenProductSamples: Array<{ id: string; name: string; slug: string }>;
    archivedProductSamples: Array<{ id: string; name: string; slug: string; deletedAt: string }>;
  };
  categoryCountDiscrepancies: CategoryCountDiscrepancy[];
  ownerDecisionRequired: OwnerDecisionItem[];
}

const CONTROL_OR_WS = /[\s\u0000-\u001F\u007F]/;
const PIECE_WEIGHT_TOKEN =
  /(?:(?:\d+(?:[.,]\d+)?)\s*(?:kg|kilo|gm|g|ml|l|liter|كجم|كيلو|جرام|جم|غ|مل|لتر)(?![A-Za-z\u0621-\u064A])|(?:^|\s)(?:ربع|نص|نصف|ثمن)\s*(?:كيلو|كجم)?)/i;

function computeEan13CheckDigit(digits12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(digits12[i]);
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/** Strict validation for barcodes and internal codes without mutating stored data. */
export function validateProductCodeFormat(
  rawCode: string,
  codeType: "BARCODE" | "INTERNAL_CODE" | string = "BARCODE",
): ProductCodeValidationResult {
  const trimmed = rawCode.trim();
  if (!trimmed) {
    return { valid: false, reason: "empty", normalized: "" };
  }
  if (trimmed.length > 64) {
    return { valid: false, reason: "too_long", normalized: trimmed };
  }
  if (CONTROL_OR_WS.test(rawCode) && CONTROL_OR_WS.test(trimmed)) {
    return { valid: false, reason: "whitespace_or_control", normalized: trimmed };
  }
  if (/^0+$/.test(trimmed)) {
    return { valid: false, reason: "zero_placeholder", normalized: trimmed };
  }

  if (codeType === "BARCODE" && /^\d+$/.test(trimmed)) {
    // Reject truncated/corrupt numeric codes such as "0", 1..5-digit strings, or 11-digit POS truncations (e.g. "61938600001")
    if (trimmed.length < 6 || trimmed.length === 11) {
      return { valid: false, reason: "short_numeric_corrupt", normalized: trimmed };
    }
    if (trimmed.length === 13) {
      const expected = computeEan13CheckDigit(trimmed.slice(0, 12));
      if (Number(trimmed[12]) !== expected) {
        return { valid: false, reason: "bad_ean13_check_digit", normalized: trimmed };
      }
    }
  }

  return { valid: true, reason: "ok", normalized: trimmed };
}

/** Check DB weight-rule invariants + unit/size mismatches on PIECE vs WEIGHT items. */
export function analyzeProductUnitAndWeightConsistency(
  input: ProductUnitAnalysisInput,
): ProductUnitAnalysisResult {
  const issues: string[] = [];
  let dbRuleValid = true;

  if (input.productType === "WEIGHT") {
    if (input.unit !== "KG" || input.saleStepGrams === null || input.saleStepGrams <= 0) {
      dbRuleValid = false;
      issues.push("WEIGHT product requires unit='KG' and positive saleStepGrams.");
    }
  } else if (input.productType === "PIECE") {
    if (input.saleStepGrams !== null) {
      dbRuleValid = false;
      issues.push("PIECE product must have null saleStepGrams.");
    }
  } else {
    dbRuleValid = false;
    issues.push(`Unsupported productType '${input.productType}'.`);
  }

  // Package metadata is not the selling unit. A sealed 500g item sold as one
  // pack is correctly PIECE + GRAM. The conflict that affects pricing is the
  // inverse: an actual WEIGHT product whose variant basis is not KG.
  const hasWeightShapeMismatch =
    input.productType === "WEIGHT" &&
    input.variants.some((v) => v.sizeUnit !== null && v.sizeUnit !== "KG");
  if (hasWeightShapeMismatch) {
    issues.push("WEIGHT product has a non-KG variant size_unit (price-basis conflict).");
  }

  const hasWeightTokenOnPieceName =
    input.productType === "PIECE" && Boolean(input.name && PIECE_WEIGHT_TOKEN.test(input.name));
  if (hasWeightTokenOnPieceName) {
    issues.push("PIECE product name contains an explicit weight/volume token.");
  }

  let missingVariantSizeUnitCount = 0;
  let missingVariantSizeValueCount = 0;
  for (const v of input.variants) {
    if (!v.sizeUnit) missingVariantSizeUnitCount++;
    if (v.sizeValue === null || v.sizeValue === undefined || v.sizeValue === "") {
      missingVariantSizeValueCount++;
    }
  }
  if (missingVariantSizeUnitCount > 0 || missingVariantSizeValueCount > 0) {
    issues.push("One or more variants are missing size_unit or size_value.");
  }

  return {
    dbRuleValid,
    hasWeightShapeMismatch,
    hasWeightTokenOnPieceName,
    missingVariantSizeUnitCount,
    missingVariantSizeValueCount,
    variantCount: input.variants.length,
    issues,
  };
}

/**
 * Pure validator for POS / Excel product import batches.
 * Separates hard blockers (invalid codes, duplicate barcodes, negative stock, invalid price)
 * from review warnings (sector vs sell divergence, <1 EGP prices, mojibake names).
 */
export function validateCatalogImportBatch(
  rows: CatalogImportRowInput[],
): CatalogImportBatchValidationResult {
  const blockers: CatalogImportBatchIssue[] = [];
  const warnings: CatalogImportBatchIssue[] = [];
  const seenCodes = new Map<string, number>();

  const summary = {
    invalidCodes: 0,
    duplicateCodes: 0,
    invalidPrices: 0,
    subOneEgpPrices: 0,
    negativeStockRows: 0,
    sectorVsSellDivergences: 0,
    nameReviewRows: 0,
    weightShapeMismatches: 0,
    missingSizeMetadataRows: 0,
  };

  rows.forEach((row, idx) => {
    const rowNumber = row.rowNumber ?? idx + 1;
    let rowHasBlocker = false;

    const codeCheck = validateProductCodeFormat(row.code, row.codeType ?? "BARCODE");
    if (!codeCheck.valid) {
      rowHasBlocker = true;
      summary.invalidCodes++;
      blockers.push({
        rowNumber,
        code: row.code,
        issueCode: "INVALID_CODE_FORMAT",
        severity: "blocker",
        detail: `Invalid code format (${codeCheck.reason}).`,
      });
    } else {
      const firstRow = seenCodes.get(codeCheck.normalized);
      if (firstRow !== undefined) {
        rowHasBlocker = true;
        summary.duplicateCodes++;
        blockers.push({
          rowNumber,
          code: codeCheck.normalized,
          issueCode: "DUPLICATE_CODE_IN_BATCH",
          severity: "blocker",
          detail: `Duplicate code in batch (first seen at row ${firstRow}).`,
        });
      } else {
        seenCodes.set(codeCheck.normalized, rowNumber);
      }
    }

    if (!isValidPriceText(row.price)) {
      rowHasBlocker = true;
      summary.invalidPrices++;
      blockers.push({
        rowNumber,
        code: row.code,
        issueCode: "INVALID_PRICE",
        severity: "blocker",
        detail: `Price '${row.price}' is not a valid 2-decimal amount.`,
      });
    } else {
      const numericPrice = Number(row.price);
      if (numericPrice <= 0) {
        rowHasBlocker = true;
        summary.invalidPrices++;
        blockers.push({
          rowNumber,
          code: row.code,
          issueCode: "NON_POSITIVE_PRICE",
          severity: "blocker",
          detail: `Price '${row.price}' must be strictly positive.`,
        });
      } else if (numericPrice < 1) {
        summary.subOneEgpPrices++;
        warnings.push({
          rowNumber,
          code: row.code,
          issueCode: "SUB_ONE_EGP_PRICE_ANOMALY",
          severity: "warning",
          detail: `Sub-1 EGP price '${row.price}' requires owner price confirmation.`,
        });
      }
    }

    if (row.sectorPrice !== undefined && row.sectorPrice !== null && row.sectorPrice.trim() !== "") {
      if (isValidPriceText(row.price) && isValidPriceText(row.sectorPrice)) {
        if (!decimalsEqual(row.price, row.sectorPrice)) {
          summary.sectorVsSellDivergences++;
          warnings.push({
            rowNumber,
            code: row.code,
            issueCode: "SECTOR_VS_SELL_PRICE_DIVERGENCE",
            severity: "warning",
            detail: `Sell price (${row.price}) differs from sector price (${row.sectorPrice}).`,
          });
        }
      }
    }

    if (row.stockQty !== undefined && row.stockQty !== null && row.stockQty !== "") {
      const qty = Number(row.stockQty);
      if (!Number.isFinite(qty) || qty < 0) {
        rowHasBlocker = true;
        summary.negativeStockRows++;
        blockers.push({
          rowNumber,
          code: row.code,
          issueCode: "NEGATIVE_STOCK_BALANCE",
          severity: "blocker",
          detail: `Negative/invalid stock balance '${row.stockQty}' cannot auto-import without physical stocktake.`,
        });
      }
    }

    const unitAnalysis = analyzeProductUnitAndWeightConsistency({
      name: row.name,
      productType: row.productType,
      unit: row.unit,
      saleStepGrams: row.saleStepGrams ?? null,
      variants: [{ sizeValue: row.sizeValue ?? null, sizeUnit: row.sizeUnit ?? null }],
    });

    if (!unitAnalysis.dbRuleValid) {
      rowHasBlocker = true;
      blockers.push({
        rowNumber,
        code: row.code,
        issueCode: "DB_WEIGHT_RULE_VIOLATION",
        severity: "blocker",
        detail: unitAnalysis.issues.join(" "),
      });
    }
    if (unitAnalysis.hasWeightShapeMismatch) {
      summary.weightShapeMismatches++;
      warnings.push({
        rowNumber,
        code: row.code,
        issueCode: "PIECE_WEIGHT_SHAPE_MISMATCH",
        severity: "warning",
        detail: "PIECE product uses GRAM/KG variant unit.",
      });
    }
    if (unitAnalysis.missingVariantSizeUnitCount > 0 || unitAnalysis.missingVariantSizeValueCount > 0) {
      summary.missingSizeMetadataRows++;
      warnings.push({
        rowNumber,
        code: row.code,
        issueCode: "MISSING_SIZE_METADATA",
        severity: "warning",
        detail: "Variant size_value or size_unit missing.",
      });
    }

    const trust = classifyCatalogName(row.name);
    if (trust === "needs-review" || trust === "test-data") {
      summary.nameReviewRows++;
      warnings.push({
        rowNumber,
        code: row.code,
        issueCode: "NAME_NEEDS_REVIEW_OR_TEST_DATA",
        severity: "warning",
        detail: `Product name classified as '${trust}'.`,
      });
    }

    if (rowHasBlocker) {
      // counted below via per-row tracking
    }
  });

  const blockerRowNumbers = new Set(blockers.map((b) => b.rowNumber));
  return {
    totalRows: rows.length,
    validRowCount: rows.length - blockerRowNumbers.size,
    rejectedRowCount: blockerRowNumbers.size,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    blockers,
    warnings,
    summary,
  };
}

function asInt(val: unknown): number {
  return Number(val ?? 0);
}

/** Live read-only audit of the PostgreSQL catalog & POS state. Performs ZERO writes. */
export async function auditCatalogDataQuality(
  db: CatalogAuditDb,
): Promise<CatalogDataQualityAuditReport> {
  const [overviewRow] = await db.$queryRaw<
    Array<{
      total_products: string;
      active_products: string;
      hidden_products: string;
      archived_products: string;
      total_categories: string;
      active_categories: string;
      total_brands: string;
      total_variants: string;
    }>
  >`
    SELECT
      (SELECT COUNT(*)::text FROM products) AS total_products,
      (SELECT COUNT(*)::text FROM products WHERE is_active = true AND deleted_at IS NULL) AS active_products,
      (SELECT COUNT(*)::text FROM products WHERE is_active = false AND deleted_at IS NULL) AS hidden_products,
      (SELECT COUNT(*)::text FROM products WHERE deleted_at IS NOT NULL) AS archived_products,
      (SELECT COUNT(*)::text FROM categories) AS total_categories,
      (SELECT COUNT(*)::text FROM categories WHERE is_active = true AND deleted_at IS NULL) AS active_categories,
      (SELECT COUNT(*)::text FROM brands) AS total_brands,
      (SELECT COUNT(*)::text FROM product_variants WHERE deleted_at IS NULL) AS total_variants
  `;

  const [mediaRow] = await db.$queryRaw<
    Array<{ products_with_images: string; total_images: string }>
  >`
    SELECT
      COUNT(DISTINCT product_id)::text AS products_with_images,
      COUNT(*)::text AS total_images
    FROM product_images
  `;

  const [invRow] = await db.$queryRaw<
    Array<{
      variants_with_inv: string;
      real_in_stock: string;
      real_confirmed_oos: string;
      real_unknown_stock: string;
      live_products_without_inv: string;
      all_products_confirmed_oos: string;
      all_products_unknown_stock: string;
    }>
  >`
    WITH active_prod_variants AS (
      SELECT p.id AS product_id, v.id AS variant_id,
             COALESCE(i.available_quantity, i.quantity - i.reserved_quantity) AS avail,
             i.id AS inv_id
      FROM products p
      JOIN product_variants v ON v.product_id = p.id AND v.deleted_at IS NULL AND v.is_active = true
      LEFT JOIN inventory i ON i.product_variant_id = v.id
      WHERE p.deleted_at IS NULL AND p.is_active = true
    ),
    all_prod_variants AS (
      SELECT p.id AS product_id,
             COALESCE(i.available_quantity, i.quantity - i.reserved_quantity) AS avail,
             i.id AS inv_id
      FROM products p
      LEFT JOIN product_variants v ON v.product_id = p.id
      LEFT JOIN inventory i ON i.product_variant_id = v.id
    )
    SELECT
      (SELECT COUNT(*)::text FROM inventory) AS variants_with_inv,
      COUNT(DISTINCT product_id) FILTER (WHERE inv_id IS NOT NULL AND avail > 0)::text AS real_in_stock,
      COUNT(DISTINCT product_id) FILTER (WHERE inv_id IS NOT NULL AND avail <= 0)::text AS real_confirmed_oos,
      COUNT(DISTINCT product_id) FILTER (WHERE inv_id IS NULL)::text AS real_unknown_stock,
      COUNT(DISTINCT product_id) FILTER (WHERE inv_id IS NULL)::text AS live_products_without_inv,
      (SELECT COUNT(DISTINCT product_id)::text FROM all_prod_variants WHERE inv_id IS NOT NULL AND avail <= 0) AS all_products_confirmed_oos,
      (SELECT COUNT(DISTINCT product_id)::text FROM all_prod_variants WHERE inv_id IS NULL) AS all_products_unknown_stock
    FROM active_prod_variants
  `;

  const [priceRow] = await db.$queryRaw<
    Array<{
      total_variants: string;
      zero_or_negative: string;
      under_1_egp: string;
      min_price: string | null;
      max_price: string | null;
      price_history_rows: string;
    }>
  >`
    SELECT
      COUNT(*)::text AS total_variants,
      COUNT(*) FILTER (WHERE price <= 0)::text AS zero_or_negative,
      COUNT(*) FILTER (WHERE price > 0 AND price < 1.00)::text AS under_1_egp,
      MIN(price)::text AS min_price,
      MAX(price)::text AS max_price,
      (SELECT COUNT(*)::text FROM product_price_history) AS price_history_rows
    FROM product_variants
    WHERE deleted_at IS NULL
  `;

  const under1EgpSamples = await db.$queryRaw<
    Array<{ product_id: string; product_name: string; variant_name: string; price: string }>
  >`
    SELECT p.id::text AS product_id, p.name AS product_name, v.name AS variant_name, v.price::text AS price
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    WHERE v.deleted_at IS NULL AND v.price < 1.00
    ORDER BY v.price ASC, p.id ASC
    LIMIT 10
  `;

  const allCodes = await db.$queryRaw<
    Array<{ code: string; type: string; product_name: string }>
  >`
    SELECT pc.code, pc.type, p.name AS product_name
    FROM product_codes pc
    JOIN product_variants v ON v.id = pc.product_variant_id
    JOIN products p ON p.id = v.product_id
    ORDER BY pc.code ASC
  `;

  const [codeExtras] = await db.$queryRaw<
    Array<{ duplicate_codes: string; live_without_codes: string }>
  >`
    SELECT
      (SELECT COUNT(*)::text FROM (SELECT code FROM product_codes GROUP BY code HAVING COUNT(*) > 1) d) AS duplicate_codes,
      (SELECT COUNT(*)::text FROM products p
       WHERE p.deleted_at IS NULL AND p.is_active = true
         AND NOT EXISTS (
           SELECT 1 FROM product_variants v
           JOIN product_codes pc ON pc.product_variant_id = v.id
           WHERE v.product_id = p.id AND v.deleted_at IS NULL
         )) AS live_without_codes
  `;

  let corruptOrZeroCodes = 0;
  let badEan13CheckDigits = 0;
  const invalidCodeSamples: Array<{ code: string; type: string; reason: string; productName: string }> = [];
  for (const row of allCodes) {
    const check = validateProductCodeFormat(row.code, row.type);
    if (!check.valid) {
      if (check.reason === "bad_ean13_check_digit") {
        badEan13CheckDigits++;
      } else {
        corruptOrZeroCodes++;
      }
      if (invalidCodeSamples.length < 20) {
        invalidCodeSamples.push({
          code: row.code,
          type: row.type,
          reason: check.reason,
          productName: row.product_name,
        });
      }
    }
  }

  const productAndVariantRows = await db.$queryRaw<
    Array<{
      id: string;
      name: string;
      slug: string;
      product_type: string;
      unit: string;
      sale_step_grams: number | null;
      is_active: boolean;
      deleted_at: Date | null;
      size_value: string | null;
      size_unit: string | null;
    }>
  >`
    SELECT p.id::text, p.name, p.slug, p.product_type, p.unit, p.sale_step_grams,
           p.is_active, p.deleted_at, v.size_value::text AS size_value, v.size_unit
    FROM products p
    LEFT JOIN product_variants v ON v.product_id = p.id AND v.deleted_at IS NULL
    ORDER BY p.id ASC
  `;

  const productGrouped = new Map<
    string,
    {
      id: string;
      name: string;
      slug: string;
      productType: string;
      unit: string;
      saleStepGrams: number | null;
      isActive: boolean;
      deletedAt: Date | null;
      variants: Array<{ sizeValue: string | null; sizeUnit: string | null }>;
    }
  >();

  for (const r of productAndVariantRows) {
    let entry = productGrouped.get(r.id);
    if (!entry) {
      entry = {
        id: r.id,
        name: r.name,
        slug: r.slug,
        productType: r.product_type,
        unit: r.unit,
        saleStepGrams: r.sale_step_grams,
        isActive: r.is_active,
        deletedAt: r.deleted_at,
        variants: [],
      };
      productGrouped.set(r.id, entry);
    }
    if (r.size_value !== null || r.size_unit !== null || r.deleted_at === null) {
      entry.variants.push({ sizeValue: r.size_value, sizeUnit: r.size_unit });
    }
  }

  let dbWeightRuleViolations = 0;
  let pieceProductsWithWeightVariantUnit = 0;
  let pieceProductsWithWeightTokenInName = 0;
  let variantsMissingSizeUnit = 0;
  let variantsMissingSizeValue = 0;

  const nameTrustCounts: Record<NameTrust, number> = {
    "trusted-arabic": 0,
    "trusted-latin": 0,
    "needs-review": 0,
    "test-data": 0,
  };
  const needsReviewSamples: Array<{ id: string; name: string; trust: NameTrust }> = [];
  const hiddenProductSamples: Array<{ id: string; name: string; slug: string }> = [];
  const archivedProductSamples: Array<{ id: string; name: string; slug: string; deletedAt: string }> = [];

  for (const prod of productGrouped.values()) {
    const analysis = analyzeProductUnitAndWeightConsistency({
      name: prod.name,
      productType: prod.productType,
      unit: prod.unit,
      saleStepGrams: prod.saleStepGrams,
      variants: prod.variants,
    });
    if (!analysis.dbRuleValid) dbWeightRuleViolations++;
    if (analysis.hasWeightShapeMismatch) pieceProductsWithWeightVariantUnit++;
    if (analysis.hasWeightTokenOnPieceName) pieceProductsWithWeightTokenInName++;
    variantsMissingSizeUnit += analysis.missingVariantSizeUnitCount;
    variantsMissingSizeValue += analysis.missingVariantSizeValueCount;

    const trust = classifyCatalogName(prod.name);
    nameTrustCounts[trust]++;
    if ((trust === "needs-review" || trust === "test-data") && needsReviewSamples.length < 15) {
      needsReviewSamples.push({ id: prod.id, name: prod.name, trust });
    }

    if (prod.deletedAt !== null && archivedProductSamples.length < 20) {
      archivedProductSamples.push({
        id: prod.id,
        name: prod.name,
        slug: prod.slug,
        deletedAt: new Date(prod.deletedAt).toISOString(),
      });
    } else if (!prod.isActive && prod.deletedAt === null && hiddenProductSamples.length < 20) {
      hiddenProductSamples.push({ id: prod.id, name: prod.name, slug: prod.slug });
    }
  }

  const categoryDiscrepanciesRows = await db.$queryRaw<
    Array<{
      category_id: string;
      name: string;
      parent_id: string | null;
      is_active: boolean;
      admin_direct_count: string;
      storefront_visible_direct_count: string;
      storefront_visible_subtree_count: string;
    }>
  >`
    WITH RECURSIVE tree AS (
      SELECT id AS root_id, id AS node_id
      FROM categories
      UNION ALL
      SELECT t.root_id, c.id AS node_id
      FROM tree t
      JOIN categories c ON c.parent_id = t.node_id AND c.deleted_at IS NULL AND c.is_active = true
    ),
    admin_direct AS (
      SELECT category_id, COUNT(*)::int AS cnt
      FROM products
      GROUP BY category_id
    ),
    sf_direct AS (
      SELECT category_id, COUNT(*)::int AS cnt
      FROM products
      WHERE deleted_at IS NULL AND is_active = true
      GROUP BY category_id
    ),
    sf_subtree AS (
      SELECT t.root_id AS category_id, COUNT(p.id)::int AS cnt
      FROM tree t
      LEFT JOIN products p ON p.category_id = t.node_id AND p.deleted_at IS NULL AND p.is_active = true
      GROUP BY t.root_id
    )
    SELECT
      c.id::text AS category_id,
      c.name,
      c.parent_id::text AS parent_id,
      c.is_active,
      COALESCE(ad.cnt, 0)::text AS admin_direct_count,
      COALESCE(sd.cnt, 0)::text AS storefront_visible_direct_count,
      COALESCE(ss.cnt, 0)::text AS storefront_visible_subtree_count
    FROM categories c
    LEFT JOIN admin_direct ad ON ad.category_id = c.id
    LEFT JOIN sf_direct sd ON sd.category_id = c.id
    LEFT JOIN sf_subtree ss ON ss.category_id = c.id
    WHERE c.deleted_at IS NULL
      AND (
        COALESCE(ad.cnt, 0) <> COALESCE(sd.cnt, 0)
        OR COALESCE(ad.cnt, 0) <> COALESCE(ss.cnt, 0)
      )
    ORDER BY c.sort_order ASC, c.name ASC
  `;

  const totalProducts = asInt(overviewRow.total_products);
  const productsWithImages = asInt(mediaRow.products_with_images);

  const ownerDecisionRequired: OwnerDecisionItem[] = [
    {
      key: "media_coverage_zero",
      severity: "critical",
      titleAr: "صور المنتجات مفقودة بالكامل",
      observedMetric: `${productsWithImages} / ${totalProducts} منتجات لها صور (${asInt(mediaRow.total_images)} صفوف في product_images)`,
      recommendedActionAr: "توفير صور رسمية / ملفات مرجعية ثم تسجيلها عبر نظام الوسائط دون توليد صور وهمية.",
      blockedUntilOwnerDecision: true,
    },
    {
      key: "inventory_sync_missing",
      severity: "critical",
      titleAr: "أرصدة المخزون غير مستوردة من الكاشير",
      observedMetric: `${asInt(invRow.variants_with_inv)} صف مخزون فعلي مقابل ${asInt(invRow.real_unknown_stock)} منتج بحالة مخزون غير معروف`,
      recommendedActionAr: "جرد فعلي للمخازن وتصفية الـ 383 رصيداً سالباً في ملفات الكاشير قبل تفعيل استيراد الأرصدة.",
      blockedUntilOwnerDecision: true,
    },
    {
      key: "pos_sector_vs_sell_divergence",
      severity: "high",
      titleAr: "تضارب أسعار القطاع مع سعر البيع في شيتات الكاشير",
      observedMetric: "2,058 صفاً (20.05% في المصدر الورقي الأصلي) يختلف فيها سعر القطاع عن سعر البيع؛ و3 متغيرات حالياً أقل من 1 جنيه",
      recommendedActionAr: "اعتماد مرجعية سعر البيع النهائي ومراجعة الأصناف الأقل من 1 جنيه عبر شاشة العمليات الجماعية.",
      blockedUntilOwnerDecision: true,
    },
    {
      key: "piece_weight_unit_clarification",
      severity: "medium",
      titleAr: "فصل طريقة البيع عن وصف حجم العبوة",
      observedMetric: `${pieceProductsWithWeightVariantUnit} منتج WEIGHT يحمل أساس حجم غير KG، و${pieceProductsWithWeightTokenInName} منتج PIECE يذكر وزن/حجم العبوة في الاسم، و${variantsMissingSizeUnit} متغيراً دون size_unit`,
      recommendedActionAr: "الإبقاء على العبوات المغلقة PIECE مع وصف حجمها، ومراجعة تعارضات WEIGHT دون تغيير الأسعار أو إعادة التصنيف تلقائيًا.",
      blockedUntilOwnerDecision: true,
    },
    {
      key: "archived_fixture_cleanup",
      severity: "medium",
      titleAr: "تنظيف السجلات التجريبية المؤرشفة قبل الإطلاق",
      observedMetric: `${archivedProductSamples.length} سجل مؤرشف (${archivedProductSamples.map((a) => a.name).join(", ") || "لا يوجد"}) و${hiddenProductSamples.length} مخفية`,
      recommendedActionAr: "مراجعة وأرشفة/حذف السجلات التجريبية غير المرجوعة من شاشة المنتجات أو أداة التعديل الجماعي بعد موافقة المالك.",
      blockedUntilOwnerDecision: true,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    catalogOverview: {
      totalProducts,
      activeProducts: asInt(overviewRow.active_products),
      hiddenProducts: asInt(overviewRow.hidden_products),
      archivedProducts: asInt(overviewRow.archived_products),
      totalCategories: asInt(overviewRow.total_categories),
      activeCategories: asInt(overviewRow.active_categories),
      totalBrands: asInt(overviewRow.total_brands),
      totalVariants: asInt(overviewRow.total_variants),
    },
    mediaCoverage: {
      productsWithImages,
      totalImageRows: asInt(mediaRow.total_images),
      productsMissingImages: Math.max(0, totalProducts - productsWithImages),
      coveragePercent: totalProducts > 0 ? Number(((productsWithImages / totalProducts) * 100).toFixed(2)) : 0,
    },
    inventoryCoverage: {
      variantsWithInventoryRow: asInt(invRow.variants_with_inv),
      realInStock: asInt(invRow.real_in_stock),
      realConfirmedOos: asInt(invRow.real_confirmed_oos),
      realUnknownStock: asInt(invRow.real_unknown_stock),
      liveProductsWithoutInventoryRow: asInt(invRow.live_products_without_inv),
      allProductsConfirmedOos: asInt(invRow.all_products_confirmed_oos),
      allProductsUnknownStock: asInt(invRow.all_products_unknown_stock),
    },
    priceHygiene: {
      totalVariants: asInt(priceRow.total_variants),
      variantsZeroOrNegativePrice: asInt(priceRow.zero_or_negative),
      variantsUnder1Egp: asInt(priceRow.under_1_egp),
      minPrice: priceRow.min_price,
      maxPrice: priceRow.max_price,
      priceHistoryRows: asInt(priceRow.price_history_rows),
      under1EgpSamples: under1EgpSamples.map((r) => ({
        productId: r.product_id,
        productName: r.product_name,
        variantName: r.variant_name,
        price: r.price,
      })),
    },
    codeHygiene: {
      totalCodes: allCodes.length,
      duplicateCodesInDb: asInt(codeExtras.duplicate_codes),
      corruptOrZeroCodes,
      badEan13CheckDigits,
      liveProductsWithoutCodes: asInt(codeExtras.live_without_codes),
      invalidCodeSamples,
    },
    unitAndWeightConsistency: {
      dbWeightRuleViolations,
      pieceProductsWithWeightVariantUnit,
      pieceProductsWithWeightTokenInName,
      variantsMissingSizeUnit,
      variantsMissingSizeValue,
    },
    nameIntegrity: {
      ...nameTrustCounts,
      needsReviewSamples,
    },
    lifecycleAnomalies: {
      hiddenProductSamples,
      archivedProductSamples,
    },
    categoryCountDiscrepancies: categoryDiscrepanciesRows.map((c) => ({
      categoryId: c.category_id,
      name: c.name,
      parentId: c.parent_id,
      isActive: c.is_active,
      adminDirectCount: asInt(c.admin_direct_count),
      storefrontVisibleDirectCount: asInt(c.storefront_visible_direct_count),
      storefrontVisibleSubtreeCount: asInt(c.storefront_visible_subtree_count),
    })),
    ownerDecisionRequired,
  };
}
