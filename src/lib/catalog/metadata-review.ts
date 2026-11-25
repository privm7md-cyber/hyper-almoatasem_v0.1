import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";
import { assertAdminPreviewWritesAllowed } from "@/lib/auth/admin-read-only-preview";
import { signOperationPreview, verifyOperationPreview } from "@/lib/admin/operation-preview";
import {
  analyzeVariantMetadata,
  normalizeVariantName,
  PACKAGE_SIZE_UNITS,
  type MetadataIssueCode,
  type PackageSizeUnit,
} from "@/lib/catalog/metadata-validation";

z.config({ jitless: true });

const correctionSchema = z.object({
  variantId: z.string().uuid("معرّف شكل البيع غير صالح."),
  sizeValue: z.string().trim().regex(/^\d{1,7}(?:\.\d{1,3})?$/, "حجم العبوة يجب أن يكون رقمًا موجبًا حتى 3 منازل عشرية."),
  sizeUnit: z.enum(PACKAGE_SIZE_UNITS),
});

export const metadataReviewOperationSchema = z.object({
  corrections: z.array(correctionSchema).min(1, "اختر تصحيحًا واحدًا على الأقل.").max(200, "الحد الأقصى 200 تصحيح في الدفعة.")
    .refine((rows) => new Set(rows.map((row) => row.variantId)).size === rows.length, "يوجد تكرار في أشكال البيع المختارة."),
  reason: z.string().trim().min(3, "سبب التصحيح إلزامي.").max(500),
  dryRun: z.boolean().default(true),
  confirmed: z.boolean().optional(),
  previewReceipt: z.string().max(2048).optional(),
});

export type MetadataReviewOperationInput = z.infer<typeof metadataReviewOperationSchema>;
export type MetadataReviewIssueFilter =
  | "all"
  | "missing_unit"
  | "missing_value"
  | "partial_pair"
  | "weight_conflict"
  | "packaged_piece"
  | "duplicate_variant";

export interface MetadataReviewRow {
  productId: string;
  productCode: string | null;
  productName: string;
  productType: string;
  sellingUnit: string;
  variantId: string;
  variantName: string;
  sizeValue: string | null;
  sizeUnit: string | null;
  issues: MetadataIssueCode[];
  proposal: null;
}

export interface MetadataReviewListResult {
  rows: MetadataReviewRow[];
  nextCursor: string | null;
}

function issueWhere(issue: MetadataReviewIssueFilter): Record<string, unknown> {
  if (issue === "missing_unit") return { sizeUnit: null };
  if (issue === "missing_value") return { sizeValue: null };
  if (issue === "partial_pair") return { OR: [{ sizeUnit: null, sizeValue: { not: null } }, { sizeUnit: { not: null }, sizeValue: null }] };
  if (issue === "weight_conflict") return { product: { productType: "WEIGHT" }, sizeUnit: { not: null, notIn: ["KG"] } };
  if (issue === "packaged_piece") return { product: { productType: "PIECE" }, sizeUnit: { in: ["KG", "GRAM", "LITER", "ML"] } };
  if (issue === "duplicate_variant") return {};
  return {
    OR: [
      { sizeUnit: null },
      { sizeValue: null },
      { product: { productType: "WEIGHT" }, sizeUnit: { not: null, notIn: ["KG"] } },
    ],
  };
}

async function duplicateVariantIds(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH duplicate_groups AS (
      SELECT product_id, lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) AS normalized_name
      FROM product_variants
      WHERE deleted_at IS NULL
      GROUP BY product_id, lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
      HAVING COUNT(*) > 1
    )
    SELECT v.id::text AS id
    FROM product_variants v
    JOIN duplicate_groups d ON d.product_id = v.product_id
      AND d.normalized_name = lower(regexp_replace(btrim(v.name), '[[:space:]]+', ' ', 'g'))
    WHERE v.deleted_at IS NULL
    ORDER BY v.id
  `;
  return rows.map((row) => row.id);
}

export async function listMetadataReviewRows(input: {
  issue: MetadataReviewIssueFilter;
  search: string | null;
  cursor: string | null;
  limit: number;
}): Promise<MetadataReviewListResult> {
  const duplicateIds = input.issue === "duplicate_variant" || input.issue === "all" ? await duplicateVariantIds() : [];
  const baseIssue = issueWhere(input.issue);
  const issueClause = input.issue === "duplicate_variant"
    ? { id: { in: duplicateIds } }
    : input.issue === "all" && duplicateIds.length > 0
      ? { OR: [baseIssue, { id: { in: duplicateIds } }] }
      : baseIssue;
  const rows = await prisma.productVariant.findMany({
    where: {
      deletedAt: null,
      product: { deletedAt: null },
      ...(input.cursor ? { id: { gt: input.cursor } } : {}),
      AND: [
        issueClause,
        ...(input.search ? [{ OR: [
          { name: { contains: input.search, mode: "insensitive" as const } },
          { product: { name: { contains: input.search, mode: "insensitive" as const } } },
          { codes: { some: { code: { contains: input.search } } } },
        ] }] : []),
      ],
    },
    orderBy: { id: "asc" },
    take: input.limit + 1,
    select: {
      id: true, name: true, sizeValue: true, sizeUnit: true, productId: true,
      codes: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1, select: { code: true } },
      product: { select: { name: true, productType: true, unit: true } },
    },
  });
  const displayed = rows.slice(0, input.limit);
  const duplicateSet = new Set(duplicateIds);
  return {
    rows: displayed.map((row) => ({
      productId: row.productId,
      productCode: row.codes[0]?.code ?? null,
      productName: row.product.name,
      productType: row.product.productType,
      sellingUnit: row.product.unit,
      variantId: row.id,
      variantName: row.name,
      sizeValue: row.sizeValue === null ? null : String(row.sizeValue),
      sizeUnit: row.sizeUnit,
      issues: analyzeVariantMetadata({
        productType: row.product.productType,
        sellingUnit: row.product.unit,
        sizeValue: row.sizeValue === null ? null : String(row.sizeValue),
        sizeUnit: row.sizeUnit,
        duplicateVariant: duplicateSet.has(row.id),
      }).issues,
      proposal: null,
    })),
    nextCursor: rows.length > input.limit ? displayed.at(-1)?.id ?? null : null,
  };
}

interface ReviewItem {
  variantId: string;
  productId: string | null;
  productName: string | null;
  variantName: string | null;
  before: { sizeValue: string | null; sizeUnit: string | null } | null;
  after: { sizeValue: string; sizeUnit: PackageSizeUnit };
  status: "READY" | "UNCHANGED" | "REJECTED";
  reasons: string[];
}

export interface MetadataReviewOperationResult {
  previewReceipt: string | null;
  dryRun: boolean;
  applied: boolean;
  summary: { requested: number; ready: number; unchanged: number; rejected: number; updated: number };
  items: ReviewItem[];
  rejectedRows: Array<{ variantId: string; reasons: string[] }>;
}

export async function previewOrApplyMetadataReview(
  raw: unknown,
  actorId: string,
): Promise<MetadataReviewOperationResult> {
  const parsed = metadataReviewOperationSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("VALIDATION", parsed.error.issues[0]?.message ?? "بيانات تصحيح العبوات غير صالحة.");
  const input = parsed.data;
  if (!input.dryRun) {
    assertAdminPreviewWritesAllowed();
    if (input.confirmed !== true) throw new ApiError("VALIDATION", "يلزم تأكيد التنفيذ صراحة بعد مراجعة المعاينة.");
  }
  const ids = input.corrections.map((row) => row.variantId).sort();

  return prisma.$transaction(async (tx) => {
    if (!input.dryRun) {
      await tx.$queryRaw`SELECT id FROM product_variants WHERE id=ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
    }
    const variants = await tx.productVariant.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, name: true, sizeValue: true, sizeUnit: true, deletedAt: true, productId: true,
        product: { select: { name: true, productType: true, unit: true, deletedAt: true,
          variants: { where: { deletedAt: null }, select: { id: true, name: true } },
        } },
      },
    });
    const byId = new Map(variants.map((row) => [row.id, row]));
    const items: ReviewItem[] = input.corrections.map((correction) => {
      const row = byId.get(correction.variantId);
      const after = { sizeValue: correction.sizeValue, sizeUnit: correction.sizeUnit };
      if (!row || row.deletedAt !== null || row.product.deletedAt !== null) {
        return { variantId: correction.variantId, productId: row?.productId ?? null, productName: row?.product.name ?? null, variantName: row?.name ?? null, before: null, after, status: "REJECTED", reasons: ["شكل البيع غير موجود أو مؤرشف."] };
      }
      const normalizedName = normalizeVariantName(row.name);
      const duplicate = row.product.variants.some((other) => other.id !== row.id && normalizeVariantName(other.name) === normalizedName);
      const analysis = analyzeVariantMetadata({ productType: row.product.productType, sellingUnit: row.product.unit, sizeValue: after.sizeValue, sizeUnit: after.sizeUnit, duplicateVariant: duplicate });
      const reasons: string[] = [];
      if (!analysis.validForWrite) reasons.push(...analysis.issues.filter((issue) => issue !== "PACKAGED_PIECE"));
      const before = { sizeValue: row.sizeValue === null ? null : String(row.sizeValue), sizeUnit: row.sizeUnit };
      const unchanged = before.sizeValue === after.sizeValue && before.sizeUnit === after.sizeUnit;
      return {
        variantId: row.id, productId: row.productId, productName: row.product.name, variantName: row.name,
        before, after, status: reasons.length > 0 ? "REJECTED" : unchanged ? "UNCHANGED" : "READY", reasons,
      };
    });
    const snapshot = { corrections: input.corrections, reason: input.reason, items };
    const previewReceipt = input.dryRun ? signOperationPreview("catalog-metadata-review", actorId, snapshot) : null;
    if (!input.dryRun) verifyOperationPreview(input.previewReceipt, "catalog-metadata-review", actorId, snapshot);

    let updated = 0;
    if (!input.dryRun) {
      for (const item of items) {
        if (item.status !== "READY" || item.before === null) continue;
        await tx.productVariant.update({ where: { id: item.variantId }, data: item.after });
        await auditInTx(tx, {
          action: "variants.update", userId: actorId, entityType: "product_variants", entityId: item.variantId,
          oldValues: item.before,
          newValues: { ...item.after, metadataReview: true, reason: input.reason },
          reason: input.reason,
        });
        updated++;
      }
    }
    return {
      previewReceipt, dryRun: input.dryRun, applied: !input.dryRun,
      summary: {
        requested: items.length,
        ready: items.filter((item) => item.status === "READY").length,
        unchanged: items.filter((item) => item.status === "UNCHANGED").length,
        rejected: items.filter((item) => item.status === "REJECTED").length,
        updated,
      },
      items,
      rejectedRows: items.filter((item) => item.status === "REJECTED").map((item) => ({ variantId: item.variantId, reasons: item.reasons })),
    };
  });
}
