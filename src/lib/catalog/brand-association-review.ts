import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, businessRule, conflict } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";
import { assertAdminPreviewWritesAllowed } from "@/lib/auth/admin-read-only-preview";
import {
  operationDigest,
  signOperationPreview,
  verifyOperationPreview,
} from "@/lib/admin/operation-preview";
import {
  createBrandMatcher,
  isActionableClassification,
  requiresCrosswalkApproval,
  type BrandAssociationClassification,
  type BrandAssociationProposal,
} from "@/lib/catalog/brand-association";

z.config({ jitless: true });

const PREVIEW_PURPOSE = "catalog-brand-association";

export const BRAND_ASSOCIATION_CLASSIFICATIONS = [
  "ALL",
  "EXACT_VERIFIED",
  "REVIEW_REQUIRED",
  "AMBIGUOUS_CONFLICT",
  "UNMATCHED",
] as const;

export type BrandAssociationClassificationFilter = (typeof BRAND_ASSOCIATION_CLASSIFICATIONS)[number];

export interface BrandAssociationReviewRow {
  productId: string;
  productCode: string | null;
  productName: string;
  productType: string;
  unit: string;
  categoryName: string | null;
  isActive: boolean;
  currentBrandId: string | null;
  currentBrandName: string | null;
  classification: BrandAssociationClassification;
  proposedBrandId: string | null;
  proposedBrandName: string | null;
  confidence: number;
  confidenceLabel: BrandAssociationProposal["confidenceLabel"];
  reason: string;
  flags: string[];
  matchedKey: string | null;
  matchedKeyType: string | null;
  position: number | null;
  tokenLength: number | null;
  actionable: boolean;
}

export interface BrandAssociationSummary {
  totalProducts: number;
  exactVerified: number;
  reviewRequired: number;
  ambiguousConflict: number;
  unmatched: number;
  existingAssociations: number;
  actionable: number;
}

export interface BrandAssociationBrandOption {
  id: string;
  name: string;
  candidateCount: number;
}

export interface BrandAssociationReviewListResult {
  rows: BrandAssociationReviewRow[];
  nextOffset: number | null;
  totalMatching: number;
  summary: BrandAssociationSummary;
  brands: BrandAssociationBrandOption[];
  filters: {
    classification: BrandAssociationClassificationFilter;
    search: string;
    brandId: string | null;
    offset: number;
    limit: number;
  };
}

interface CatalogProductRow {
  id: string;
  name: string;
  product_type: string;
  unit: string;
  brand_id: string | null;
  brand_name: string | null;
  category_name: string | null;
  product_code: string | null;
  is_active: boolean;
}

const CLASSIFICATION_RANK: Record<BrandAssociationClassification, number> = {
  EXACT_VERIFIED: 0,
  REVIEW_REQUIRED: 1,
  AMBIGUOUS_CONFLICT: 2,
  UNMATCHED: 3,
};

function toPublicRow(
  product: CatalogProductRow,
  proposal: BrandAssociationProposal,
): BrandAssociationReviewRow {
  return {
    productId: product.id,
    productCode: product.product_code,
    productName: product.name,
    productType: product.product_type,
    unit: product.unit,
    categoryName: product.category_name,
    isActive: product.is_active,
    currentBrandId: product.brand_id,
    currentBrandName: product.brand_name,
    classification: proposal.classification,
    proposedBrandId: proposal.proposedBrandId,
    proposedBrandName: proposal.proposedBrandName,
    confidence: proposal.confidence,
    confidenceLabel: proposal.confidenceLabel,
    reason: proposal.reason,
    flags: proposal.flags,
    matchedKey: proposal.matchedKey?.key ?? null,
    matchedKeyType: proposal.matchedKey?.keyType ?? null,
    position: proposal.matchedKey?.position ?? null,
    tokenLength: proposal.matchedKey?.tokenLength ?? null,
    actionable: isActionableClassification(proposal.classification),
  };
}

function rowMatchesSearch(row: BrandAssociationReviewRow, search: string): boolean {
  if (!search) return true;
  const needle = search.toLowerCase();
  return [row.productName, row.productCode ?? "", row.currentBrandName ?? "", row.proposedBrandName ?? ""]
    .some((value) => value.toLowerCase().includes(needle));
}

/**
 * Read-only candidate listing over the whole live catalog.
 *
 * The classification is always recomputed from current product names and the
 * current brand table; no cached/stale manifest value is ever trusted for a
 * write. Filtering happens in memory so the UNMATCHED bucket is exact (SQL
 * substring pre-filters would miss normalized Arabic spelling differences).
 */
export async function listBrandAssociationReviewCandidates(input: {
  classification: BrandAssociationClassificationFilter;
  search?: string | null;
  brandId?: string | null;
  offset?: number;
  limit?: number;
}): Promise<BrandAssociationReviewListResult> {
  const classification = BRAND_ASSOCIATION_CLASSIFICATIONS.includes(input.classification)
    ? input.classification
    : "ALL";
  const search = (input.search ?? "").trim().slice(0, 120);
  const brandId = input.brandId ?? null;
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 50)));

  const [brandRows, productRows] = await Promise.all([
    prisma.brand.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.$queryRaw<CatalogProductRow[]>`
      SELECT p.id::text                    AS id,
             p.name,
             p.product_type,
             p.unit,
             p.brand_id::text              AS brand_id,
             b.name                        AS brand_name,
             c.name                        AS category_name,
             (
               SELECT pc.code
               FROM product_codes pc
               JOIN product_variants v ON v.id = pc.product_variant_id
               WHERE v.product_id = p.id AND v.deleted_at IS NULL
               ORDER BY pc.is_primary DESC, pc.created_at ASC
               LIMIT 1
             )                             AS product_code,
             p.is_active
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.deleted_at IS NULL
      ORDER BY p.name ASC, p.id ASC
    `,
  ]);

  const matcher = createBrandMatcher(brandRows);
  const allRows = productRows.map((product) => toPublicRow(product, matcher.classify(product.name)));

  const summary: BrandAssociationSummary = {
    totalProducts: allRows.length,
    exactVerified: 0,
    reviewRequired: 0,
    ambiguousConflict: 0,
    unmatched: 0,
    existingAssociations: 0,
    actionable: 0,
  };
  const countsByBrand = new Map<string, number>();
  for (const row of allRows) {
    if (row.classification === "EXACT_VERIFIED") summary.exactVerified++;
    else if (row.classification === "REVIEW_REQUIRED") summary.reviewRequired++;
    else if (row.classification === "AMBIGUOUS_CONFLICT") summary.ambiguousConflict++;
    else summary.unmatched++;
    if (row.actionable) summary.actionable++;
    if (row.currentBrandId) summary.existingAssociations++;
    if (row.proposedBrandId) countsByBrand.set(row.proposedBrandId, (countsByBrand.get(row.proposedBrandId) ?? 0) + 1);
  }

  const filtered = allRows
    .filter((row) => classification === "ALL" || row.classification === classification)
    .filter((row) => (brandId ? row.proposedBrandId === brandId : true))
    .filter((row) => rowMatchesSearch(row, search))
    .sort((a, b) =>
      CLASSIFICATION_RANK[a.classification] - CLASSIFICATION_RANK[b.classification] ||
      a.productName.localeCompare(b.productName, "ar") ||
      a.productId.localeCompare(b.productId),
    );

  return {
    rows: filtered.slice(offset, offset + limit),
    nextOffset: offset + limit < filtered.length ? offset + limit : null,
    totalMatching: filtered.length,
    summary,
    brands: brandRows
      .map((brand) => ({ id: brand.id, name: brand.name, candidateCount: countsByBrand.get(brand.id) ?? 0 }))
      .filter((brand) => brand.candidateCount > 0)
      .sort((a, b) => b.candidateCount - a.candidateCount || a.name.localeCompare(b.name, "ar")),
    filters: { classification, search, brandId, offset, limit },
  };
}

const brandAssociationItemSchema = z.object({
  productId: z.string().uuid("معرّف المنتج غير صالح."),
  brandId: z.string().uuid("معرّف الماركة غير صالح."),
});

export const brandAssociationOperationSchema = z.object({
  items: z
    .array(brandAssociationItemSchema)
    .min(1, "اختر منتجًا واحدًا على الأقل.")
    .max(200, "الحد الأقصى للدفعة الواحدة 200 منتج.")
    .refine((items) => new Set(items.map((item) => item.productId)).size === items.length, {
      message: "يوجد تكرار في معرّفات المنتجات المختارة.",
    }),
  reason: z.string().trim().min(3, "سبب الربط إلزامي (3 أحرف على الأقل).").max(500, "السبب طويل جدًا."),
  dryRun: z.boolean().default(true),
  confirmed: z.boolean().optional(),
  crosswalkApproved: z.boolean().default(false),
  previewReceipt: z.string().max(2048).optional(),
});

export type BrandAssociationOperationInput = z.infer<typeof brandAssociationOperationSchema>;

export interface BrandAssociationOperationItem {
  productId: string;
  productCode: string | null;
  productName: string;
  currentBrandId: string | null;
  currentBrandName: string | null;
  proposedBrandId: string;
  proposedBrandName: string;
  classification: BrandAssociationClassification;
  confidence: number;
  reason: string;
  flags: string[];
  requiresCrosswalkApproval: boolean;
  willChange: boolean;
}

export interface BrandAssociationBatchReceipt {
  batchId: string;
  appliedAt: string;
  appliedBy: string;
  productCount: number;
  changedCount: number;
  brandCount: number;
  crosswalkApproved: boolean;
  reason: string;
  digest: string;
}

export interface BrandAssociationOperationResult {
  previewReceipt: string | null;
  batchReceipt: BrandAssociationBatchReceipt | null;
  dryRun: boolean;
  applied: boolean;
  summary: {
    requested: number;
    willChange: number;
    unchanged: number;
    updated: number;
    exactVerified: number;
    reviewRequired: number;
    crosswalkRequired: number;
  };
  items: BrandAssociationOperationItem[];
}

/**
 * Preview or apply explicit product→brand associations.
 *
 * Contract:
 *  - every proposed brand is recomputed from the current product name; the
 *    client cannot submit an arbitrary product/brand pair,
 *  - ambiguous or unmatched rows are refused,
 *  - alias/spelling review rows require `crosswalkApproved: true`,
 *  - an existing different brand is never overwritten (conflict),
 *  - preview is signed; apply must present the matching receipt,
 *  - all updates + per-product audits + the batch audit row commit atomically.
 */
export async function previewOrApplyBrandAssociations(
  raw: unknown,
  actorId: string,
): Promise<BrandAssociationOperationResult> {
  const parsed = brandAssociationOperationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("VALIDATION", parsed.error.issues[0]?.message ?? "بيانات ربط الماركات غير صالحة.");
  }
  const input = parsed.data;

  if (!input.dryRun) {
    assertAdminPreviewWritesAllowed();
    if (input.confirmed !== true) {
      throw new ApiError("VALIDATION", "يلزم تأكيد الربط صراحة بعد مراجعة المعاينة.");
    }
  }

  const productIds = [...new Set(input.items.map((item) => item.productId))].sort();
  const brandIds = [...new Set(input.items.map((item) => item.brandId))].sort();

  return prisma.$transaction(async (tx) => {
    if (!input.dryRun) {
      await tx.$queryRaw`
        SELECT id::text
        FROM products
        WHERE id = ANY(${productIds}::uuid[])
        ORDER BY id ASC
        FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT id::text
        FROM brands
        WHERE id = ANY(${brandIds}::uuid[])
        ORDER BY id ASC
        FOR SHARE
      `;
    }

    const [products, brands] = await Promise.all([
      tx.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          name: true,
          brandId: true,
          deletedAt: true,
          brand: { select: { name: true } },
          variants: {
            where: { deletedAt: null },
            orderBy: { id: "asc" },
            take: 1,
            select: {
              id: true,
              codes: {
                orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
                take: 1,
                select: { code: true },
              },
            },
          },
        },
      }),
      // All active brands are needed for conflict detection: a product name may
      // contain a second brand that is not part of this batch.
      tx.brand.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, name: true },
      }),
    ]);

    const productById = new Map(products.map((product) => [product.id, product]));
    const brandById = new Map(brands.map((brand) => [brand.id, brand]));
    const missing = input.items.filter((item) => !productById.has(item.productId));
    if (missing.length > 0) {
      throw new ApiError("NOT_FOUND", "بعض المنتجات المختارة غير موجودة.", {
        missingProductIds: missing.map((item) => item.productId),
      });
    }
    const archived = products.filter((product) => product.deletedAt !== null);
    if (archived.length > 0) {
      throw conflict("المنتجات المؤرشفة لا يمكن ربطها بماركة؛ يجب استعادتها أولاً.", {
        productIds: archived.map((product) => product.id),
      });
    }
    const missingBrands = input.items.filter((item) => !brandById.has(item.brandId));
    if (missingBrands.length > 0) {
      throw businessRule("ماركة مقترحة غير موجودة أو غير نشطة.", {
        brandIds: [...new Set(missingBrands.map((item) => item.brandId))],
      });
    }

    const matcher = createBrandMatcher(brands);
    const items: BrandAssociationOperationItem[] = [];
    const errors: string[] = [];

    for (const requestItem of input.items) {
      const product = productById.get(requestItem.productId)!;
      const brand = brandById.get(requestItem.brandId)!;
      const proposal = matcher.classify(product.name);
      const crosswalkRequired = requiresCrosswalkApproval(proposal);

      if (!isActionableClassification(proposal.classification) || proposal.proposedBrandId !== requestItem.brandId) {
        errors.push(
          `${product.name}: الاقتراح الحالي (${proposal.classification}) لا يطابق الماركة المختارة (${brand.name}).`,
        );
        continue;
      }
      if (proposal.classification === "REVIEW_REQUIRED" && crosswalkRequired && !input.crosswalkApproved) {
        errors.push(
          `${product.name}: يتطلب موافقة صريحة على خريطة الأسماء (${proposal.matchedKey?.keyType ?? "REVIEW"}).`,
        );
        continue;
      }
      if (product.brandId !== null && product.brandId !== requestItem.brandId) {
        errors.push(
          `${product.name}: مرتبط بالفعل بماركة مختلفة (${product.brand?.name ?? product.brandId}) ولا يمكن استبدالها في هذه الدفعة.`,
        );
        continue;
      }

      items.push({
        productId: product.id,
        productCode: product.variants[0]?.codes[0]?.code ?? null,
        productName: product.name,
        currentBrandId: product.brandId,
        currentBrandName: product.brand?.name ?? null,
        proposedBrandId: brand.id,
        proposedBrandName: brand.name,
        classification: proposal.classification,
        confidence: proposal.confidence,
        reason: proposal.reason,
        flags: proposal.flags,
        requiresCrosswalkApproval: crosswalkRequired,
        willChange: product.brandId !== requestItem.brandId,
      });
    }

    if (errors.length > 0) {
      throw conflict("تعذر التحقق من بعض الصفوف؛ لم يتم تعديل أي منتج.", { rows: errors });
    }

    const snapshot = {
      reason: input.reason,
      items: [...items]
        .sort((a, b) => a.productId.localeCompare(b.productId))
        .map((item) => ({
          productId: item.productId,
          productName: item.productName,
          brandId: item.proposedBrandId,
          brandName: item.proposedBrandName,
          classification: item.classification,
          beforeBrandId: item.currentBrandId,
          afterBrandId: item.proposedBrandId,
          willChange: item.willChange,
        })),
    };
    const previewReceipt = input.dryRun ? signOperationPreview(PREVIEW_PURPOSE, actorId, snapshot) : null;
    if (!input.dryRun) verifyOperationPreview(input.previewReceipt, PREVIEW_PURPOSE, actorId, snapshot);

    const willChange = items.filter((item) => item.willChange);
    const batchId = randomUUID();
    const appliedAt = new Date();
    let updated = 0;

    if (!input.dryRun) {
      for (const item of willChange) {
        await tx.product.update({
          where: { id: item.productId },
          data: { brandId: item.proposedBrandId },
        });
        await auditInTx(tx, {
          action: "products.brand_associate",
          userId: actorId,
          entityType: "products",
          entityId: item.productId,
          oldValues: { brandId: item.currentBrandId, brandName: item.currentBrandName },
          newValues: {
            brandId: item.proposedBrandId,
            brandName: item.proposedBrandName,
            classification: item.classification,
            confidence: item.confidence,
            candidateReason: item.reason,
            flags: item.flags,
            crosswalkApproved: input.crosswalkApproved,
            batchId,
            batchSize: items.length,
            reason: input.reason,
          },
          reason: input.reason,
        });
        updated++;
      }

      const brandSummary = [...new Set(items.map((item) => item.proposedBrandId))].map((brandId) => ({
        brandId,
        brandName: brandById.get(brandId)!.name,
        count: items.filter((item) => item.proposedBrandId === brandId).length,
      }));
      await auditInTx(tx, {
        action: "products.brand_batch",
        userId: actorId,
        entityType: "brand_association_batches",
        entityId: batchId,
        oldValues: null,
        newValues: {
          batchId,
          reason: input.reason,
          productCount: items.length,
          changedCount: updated,
          brandCount: brandSummary.length,
          brands: brandSummary,
          crosswalkApproved: input.crosswalkApproved,
          digest: operationDigest(snapshot),
        },
        reason: input.reason,
      });
    }

    return {
      previewReceipt,
      batchReceipt: input.dryRun
        ? null
        : {
            batchId,
            appliedAt: appliedAt.toISOString(),
            appliedBy: actorId,
            productCount: items.length,
            changedCount: updated,
            brandCount: new Set(willChange.map((item) => item.proposedBrandId)).size,
            crosswalkApproved: input.crosswalkApproved,
            reason: input.reason,
            digest: operationDigest(snapshot),
          },
      dryRun: input.dryRun,
      applied: !input.dryRun,
      summary: {
        requested: items.length,
        willChange: willChange.length,
        unchanged: items.length - willChange.length,
        updated,
        exactVerified: items.filter((item) => item.classification === "EXACT_VERIFIED").length,
        reviewRequired: items.filter((item) => item.classification === "REVIEW_REQUIRED").length,
        crosswalkRequired: items.filter((item) => item.requiresCrosswalkApproval).length,
      },
      items,
    };
  });
}
