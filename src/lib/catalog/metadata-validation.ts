/** Pure package-metadata rules. Selling unit and package size are distinct. */

export const PACKAGE_SIZE_UNITS = ["PIECE", "KG", "GRAM", "LITER", "ML"] as const;
export type PackageSizeUnit = (typeof PACKAGE_SIZE_UNITS)[number];

export type MetadataIssueCode =
  | "MISSING_SIZE_UNIT"
  | "MISSING_SIZE_VALUE"
  | "PARTIAL_SIZE_PAIR"
  | "INVALID_SIZE_VALUE"
  | "UNSUPPORTED_SIZE_UNIT"
  | "WEIGHT_PRICE_BASIS_CONFLICT"
  | "DUPLICATE_VARIANT"
  | "PACKAGED_PIECE";

export interface VariantMetadataInput {
  productType: string;
  sellingUnit: string;
  sizeValue: string | number | null;
  sizeUnit: string | null;
  duplicateVariant?: boolean;
}

export interface VariantMetadataAnalysis {
  validForWrite: boolean;
  issues: MetadataIssueCode[];
  sellingModel: "PIECE" | "WEIGHT" | "INVALID";
  packageDescription: string | null;
}

const UNIT_ALIASES: Readonly<Record<string, PackageSizeUnit>> = {
  piece: "PIECE", pieces: "PIECE", pc: "PIECE", pcs: "PIECE", each: "PIECE", ea: "PIECE",
  "قطعة": "PIECE", "عبوة": "PIECE",
  kg: "KG", kgs: "KG", kilogram: "KG", kilograms: "KG", "كجم": "KG", "كيلو": "KG", "كيلوجرام": "KG",
  g: "GRAM", gm: "GRAM", gram: "GRAM", grams: "GRAM", "جم": "GRAM", "جرام": "GRAM", "غرام": "GRAM",
  l: "LITER", lt: "LITER", liter: "LITER", litre: "LITER", liters: "LITER", litres: "LITER", "لتر": "LITER",
  ml: "ML", milliliter: "ML", millilitre: "ML", milliliters: "ML", millilitres: "ML", "مل": "ML",
};

export function normalizePackageUnit(raw: string): PackageSizeUnit | null {
  const key = raw.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/[._-]+/g, "");
  const canonical = key.toUpperCase();
  if ((PACKAGE_SIZE_UNITS as readonly string[]).includes(canonical)) return canonical as PackageSizeUnit;
  return UNIT_ALIASES[key] ?? null;
}

export function normalizeVariantName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

export function isValidPackageSizeValue(value: string | number | null): boolean {
  if (value === null || value === "") return false;
  const text = String(value).trim();
  if (!/^\d{1,7}(?:\.\d{1,3})?$/.test(text)) return false;
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric > 0 && numeric <= 9_999_999.999;
}

export function analyzeVariantMetadata(input: VariantMetadataInput): VariantMetadataAnalysis {
  const issues: MetadataIssueCode[] = [];
  const missingValue = input.sizeValue === null || input.sizeValue === "";
  const missingUnit = input.sizeUnit === null || input.sizeUnit.trim() === "";
  const canonicalUnit = missingUnit ? null : normalizePackageUnit(input.sizeUnit!);

  if (missingValue) issues.push("MISSING_SIZE_VALUE");
  if (missingUnit) issues.push("MISSING_SIZE_UNIT");
  if (missingValue !== missingUnit) issues.push("PARTIAL_SIZE_PAIR");
  if (!missingValue && !isValidPackageSizeValue(input.sizeValue)) issues.push("INVALID_SIZE_VALUE");
  if (!missingUnit && canonicalUnit === null) issues.push("UNSUPPORTED_SIZE_UNIT");

  const sellingModel = input.productType === "PIECE"
    ? "PIECE"
    : input.productType === "WEIGHT"
      ? "WEIGHT"
      : "INVALID";

  // A sealed 500g/1L package is still sold by PIECE. GRAM/KG/LITER/ML here
  // describes its package and must never reclassify the selling model.
  if (sellingModel === "PIECE" && canonicalUnit !== null && canonicalUnit !== "PIECE") {
    issues.push("PACKAGED_PIECE");
  }
  // Existing checkout prices WEIGHT rows per KG. A non-KG variant basis is a
  // financial/display conflict, not permission to rewrite product_type.
  if (sellingModel === "WEIGHT" && canonicalUnit !== null && canonicalUnit !== "KG") {
    issues.push("WEIGHT_PRICE_BASIS_CONFLICT");
  }
  if (input.duplicateVariant) issues.push("DUPLICATE_VARIANT");

  const blockers: MetadataIssueCode[] = [
    "MISSING_SIZE_UNIT", "MISSING_SIZE_VALUE", "PARTIAL_SIZE_PAIR", "INVALID_SIZE_VALUE",
    "UNSUPPORTED_SIZE_UNIT", "WEIGHT_PRICE_BASIS_CONFLICT", "DUPLICATE_VARIANT",
  ];
  return {
    validForWrite: sellingModel !== "INVALID" && !issues.some((issue) => blockers.includes(issue)),
    issues,
    sellingModel,
    packageDescription: canonicalUnit !== null && !missingValue ? `${String(input.sizeValue)} ${canonicalUnit}` : null,
  };
}
