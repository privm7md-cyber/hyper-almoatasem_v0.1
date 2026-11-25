import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, businessRule, conflict } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";
import { assertAdminPreviewWritesAllowed } from "@/lib/auth/admin-read-only-preview";
import { canonicalDecimal, decimalsEqual, isValidPriceText } from "@/lib/catalog/price";
import { signOperationPreview, verifyOperationPreview } from "@/lib/admin/operation-preview";

z.config({ jitless: true });

export const BULK_ACTIONS = [
  "SET_CATEGORY",
  "SET_BRAND",
  "ACTIVATE",
  "DEACTIVATE",
  "ARCHIVE",
  "RESTORE",
  "ADJUST_PRICE",
] as const;

export type BulkProductAction = (typeof BULK_ACTIONS)[number];
export type BulkPriceMode = "PERCENT" | "FIXED_DELTA" | "EXACT_SET";

export const bulkProductOperationInputSchema = z.object({
  action: z.enum(BULK_ACTIONS),
  productIds: z
    .array(z.string().uuid("معرّف المنتج غير صالح."))
    .min(1, "اختر منتجًا واحدًا على الأقل.")
    .max(200, "الحد الأقصى للدفعة الواحدة 200 منتج.")
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "يوجد تكرار في معرّفات المنتجات المختارة.",
    }),
  reason: z
    .string()
    .trim()
    .min(3, "السبب إلزامي (3 أحرف على الأقل).")
    .max(500, "السبب طويل جدًا."),
  dryRun: z.boolean().default(true),
  confirmed: z.boolean().optional(),
  previewReceipt:z.string().max(2048).optional(),
  categoryId: z.string().uuid().optional(),
  brandId: z.string().uuid().nullable().optional(),
  priceMode: z.enum(["PERCENT", "FIXED_DELTA", "EXACT_SET"]).optional(),
  amount: z.string().trim().optional(),
});

export type BulkProductOperationInput = z.infer<typeof bulkProductOperationInputSchema>;

export interface BulkVariantChange {
  variantId: string;
  variantName: string;
  oldPrice: string;
  newPrice: string;
  changed: boolean;
}

export interface BulkProductPreviewItem {
  productId: string;
  productName: string;
  willChange: boolean;
  before: Record<string, string | boolean | null>;
  after: Record<string, string | boolean | null>;
  variantChanges: BulkVariantChange[];
}

export interface BulkProductOperationResult {
  previewReceipt:string|null;
  applied: boolean;
  dryRun: boolean;
  action: BulkProductAction;
  reason: string;
  summary: {
    requestedCount: number;
    willChangeCount: number;
    unchangedCount: number;
    updatedProductCount: number;
    updatedVariantCount: number;
    skippedUnchangedVariants: number;
  };
  items: BulkProductPreviewItem[];
}

const SIGNED_DECIMAL_RE = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;
const MAX_PRICE_PIASTERS = 99_999_999;

/** Parse a signed decimal string into exact safe integer scaled units (zero floating point). */
export function parseDecimalToScaledInt(text: string, scale = 2): number | null {
  const m = SIGNED_DECIMAL_RE.exec(text.trim());
  if (!m) return null;
  const neg = m[1] === "-";
  const whole = Number(m[2]);
  const fracRaw = m[3] ?? "";
  if (fracRaw.length > scale) return null;
  const frac = Number(fracRaw.padEnd(scale, "0"));
  const factor = Math.pow(10, scale);
  const abs = whole * factor + frac;
  if (!Number.isSafeInteger(abs)) return null;
  return neg ? -abs : abs;
}

export function formatPiasters(piasters: number): string {
  const sign = piasters < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(piasters));
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${sign}${whole.toString()}.${frac}`;
}

export function computeAdjustedPrice(
  oldPriceText: string,
  priceMode: BulkPriceMode,
  amountText: string,
): { newPrice: string; changed: boolean } {
  const canonOld = canonicalDecimal(oldPriceText);
  if (canonOld === null) {
    throw businessRule(`سعر حالي غير صالح للتحويل (${oldPriceText}).`, null);
  }
  const oldPiasters = parseDecimalToScaledInt(canonOld, 2);
  if (oldPiasters === null) {
    throw businessRule("تعذر تحليل السعر الحالي.", null);
  }

  let nextPiasters: number;
  if (priceMode === "EXACT_SET") {
    if (!isValidPriceText(amountText)) {
      throw new ApiError("VALIDATION", "السعر الثابت الجديد يجب أن يكون رقمًا موجبًا بصيغة عشرية صحيحة.");
    }
    const target = parseDecimalToScaledInt(amountText, 2);
    if (target === null || target <= 0) {
      throw new ApiError("VALIDATION", "السعر الجديد يجب أن يكون أكبر من الصفر.");
    }
    nextPiasters = target;
  } else if (priceMode === "FIXED_DELTA") {
    const delta = parseDecimalToScaledInt(amountText, 2);
    if (delta === null || delta === 0) {
      throw new ApiError("VALIDATION", "قيمة التعديل الثابت غير صالحة أو تساوي صفرًا.");
    }
    nextPiasters = oldPiasters + delta;
  } else {
    // PERCENT: amountText is signed percent e.g. "10" (+10%), "-5.5" (-5.5%) -> scaled by 100
    const pctBps = parseDecimalToScaledInt(amountText, 2);
    if (pctBps === null || pctBps === 0) {
      throw new ApiError("VALIDATION", "النسبة المئوية غير صالحة أو تساوي صفرًا.");
    }
    const rawNumerator = oldPiasters * pctBps;
    if (!Number.isSafeInteger(rawNumerator)) {
      throw businessRule("قيمة التعديل خارج النطاق العددي الآمن.", null);
    }
    const absNum = Math.abs(rawNumerator);
    const roundedAbs = Math.floor((absNum + 5000) / 10_000);
    const signedDelta = rawNumerator < 0 ? -roundedAbs : roundedAbs;
    nextPiasters = oldPiasters + signedDelta;
  }

  if (nextPiasters <= 0 || nextPiasters > MAX_PRICE_PIASTERS) {
    throw businessRule("السعر الناتج خارج النطاق المسموح (0.01 .. 999999.99).", {
      oldPrice: formatPiasters(oldPiasters),
      nextPrice: formatPiasters(nextPiasters),
    });
  }

  const newPrice = formatPiasters(nextPiasters);
  return {
    newPrice,
    changed: !decimalsEqual(canonOld, newPrice),
  };
}

function validateActionSpecificPayload(data: BulkProductOperationInput): void {
  if (data.action === "SET_CATEGORY" && !data.categoryId) {
    throw new ApiError("VALIDATION", "يجب تحديد القسم الجديد (categoryId).");
  }
  if (data.action === "SET_BRAND" && data.brandId === undefined) {
    throw new ApiError("VALIDATION", "يجب تحديد الماركة (brandId) أو إرسال null لإزالتها.");
  }
  if (data.action === "ADJUST_PRICE") {
    if (!data.priceMode || data.amount === undefined || data.amount === "") {
      throw new ApiError("VALIDATION", "تعديل الأسعار يتطلب تحديد الوضع والقيمة.");
    }
    computeAdjustedPrice("100.00", data.priceMode, data.amount);
  }
}

export async function previewOrApplyBulkProductOperation(
  rawInput: unknown,
  actorId: string,
): Promise<BulkProductOperationResult> {
  const parsed = bulkProductOperationInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? "بيانات العملية الجماعية غير صالحة.";
    throw new ApiError("VALIDATION", firstIssue);
  }

  const input = parsed.data;
  validateActionSpecificPayload(input);

  if (!input.dryRun) {
    assertAdminPreviewWritesAllowed();
    if (input.confirmed !== true) {
      throw new ApiError("VALIDATION", "يلزم تأكيد العملية الجماعية صراحة (confirmed: true) قبل التنفيذ.");
    }
  }

  const sortedIds = [...input.productIds].sort();

  return prisma.$transaction(async (tx) => {
    if (!input.dryRun && typeof tx.$queryRaw === "function") {
      await tx.$queryRaw`
        SELECT id::text
        FROM products
        WHERE id = ANY(${sortedIds}::uuid[])
        ORDER BY id ASC
        FOR UPDATE
      `;
      await tx.$queryRaw`SELECT id FROM product_variants WHERE product_id=ANY(${sortedIds}::uuid[]) ORDER BY id FOR UPDATE`;
      if(input.categoryId)await tx.$queryRaw`SELECT id FROM categories WHERE id=${input.categoryId}::uuid FOR SHARE`;
      if(input.brandId)await tx.$queryRaw`SELECT id FROM brands WHERE id=${input.brandId}::uuid FOR SHARE`;
    }

    const products = await tx.product.findMany({
      where: { id: { in: sortedIds } },
      select: {
        id: true,
        name: true,
        categoryId: true,
        brandId: true,
        isActive: true,
        deletedAt: true,
        category: { select: { name: true } },
        brand: { select: { name: true } },
        variants: {
          where: { deletedAt: null },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            price: true,
          },
        },
      },
      orderBy: { id: "asc" },
    });

    const foundSet = new Set(products.map((p) => p.id));
    const missingIds = sortedIds.filter((id) => !foundSet.has(id));
    if (missingIds.length > 0) {
      throw new ApiError("NOT_FOUND", "بعض المنتجات المختارة غير موجودة.", {
        missingIds,
      });
    }

    let targetCategoryName: string | null = null;
    if (input.action === "SET_CATEGORY" && input.categoryId) {
      const cat = await tx.category.findFirst({
        where: { id: input.categoryId, deletedAt: null, isActive: true },
        select: { id: true, name: true },
      });
      if (!cat) {
        throw businessRule("القسم المحدد غير موجود أو غير نشط.", null);
      }
      targetCategoryName = cat.name;
    }

    let targetBrandName: string | null = null;
    if (input.action === "SET_BRAND" && input.brandId) {
      const brand = await tx.brand.findFirst({
        where: { id: input.brandId, deletedAt: null, isActive: true },
        select: { id: true, name: true },
      });
      if (!brand) {
        throw businessRule("الماركة المحددة غير موجودة أو غير نشطة.", null);
      }
      targetBrandName = brand.name;
    }

    // Preserve requested order in response items while DB locks stay sorted
    const byId = new Map(products.map((p) => [p.id, p]));
    const items: BulkProductPreviewItem[] = [];
    const now = new Date();

    for (const id of input.productIds) {
      const p = byId.get(id)!;

      if (input.action === "RESTORE") {
        if (p.deletedAt === null) {
          throw conflict("المنتجات غير المؤرشفة لا يمكن استعادتها.", { productId: p.id });
        }
      } else {
        if (p.deletedAt !== null) {
          throw conflict("المنتجات المؤرشفة لا يمكن تعديلها مباشرة؛ يجب استعادتها أولاً.", {
            productId: p.id,
          });
        }
        if (input.action === "ARCHIVE" && p.isActive) {
          throw conflict("يجب إخفاء المنتجات النشطة أولاً قبل أرشفتها جماعيًا.", {
            productId: p.id,
          });
        }
      }

      const variantChanges: BulkVariantChange[] = [];
      let before: Record<string, string | boolean | null> = {};
      let after: Record<string, string | boolean | null> = {};
      let willChange = false;

      if (input.action === "SET_CATEGORY") {
        willChange = p.categoryId !== input.categoryId;
        before = { categoryId: p.categoryId, categoryName: p.category.name };
        after = { categoryId: input.categoryId ?? null, categoryName: targetCategoryName };
      } else if (input.action === "SET_BRAND") {
        const nextBrandId = input.brandId ?? null;
        willChange = p.brandId !== nextBrandId;
        before = { brandId: p.brandId, brandName: p.brand?.name ?? null };
        after = { brandId: nextBrandId, brandName: nextBrandId ? targetBrandName : null };
      } else if (input.action === "ACTIVATE") {
        willChange = !p.isActive;
        before = { isActive: p.isActive };
        after = { isActive: true };
      } else if (input.action === "DEACTIVATE") {
        willChange = p.isActive;
        before = { isActive: p.isActive };
        after = { isActive: false };
      } else if (input.action === "ARCHIVE") {
        willChange = p.deletedAt === null;
        before = { isActive: p.isActive, archived: false };
        after = { isActive: false, archived: true };
      } else if (input.action === "RESTORE") {
        willChange = p.deletedAt !== null;
        before = { isActive: p.isActive, archived: true };
        after = { isActive: false, archived: false };
      } else if (input.action === "ADJUST_PRICE") {
        if (p.variants.length === 0) {
          throw businessRule("يوجد منتج بدون متغيرات نشطة لتعديل سعره.", { productId: p.id });
        }
        for (const v of p.variants) {
          const oldPriceStr = String(v.price);
          const calc = computeAdjustedPrice(oldPriceStr, input.priceMode!, input.amount!);
          const formattedOld = formatPiasters(parseDecimalToScaledInt(canonicalDecimal(oldPriceStr)!, 2)!);
          variantChanges.push({
            variantId: v.id,
            variantName: v.name,
            oldPrice: formattedOld,
            newPrice: calc.newPrice,
            changed: calc.changed,
          });
          if (calc.changed) willChange = true;
        }
        before = { variantCount: String(p.variants.length), samplePrice: variantChanges[0]?.oldPrice ?? null };
        after = { variantCount: String(p.variants.length), samplePrice: variantChanges[0]?.newPrice ?? null };
      }

      items.push({
        productId: p.id,
        productName: p.name,
        willChange,
        before,
        after,
        variantChanges,
      });
    }

    const snapshot={action:input.action,productIds:input.productIds,reason:input.reason,
      categoryId:input.categoryId,brandId:input.brandId,priceMode:input.priceMode,amount:input.amount,items};
    const previewReceipt=input.dryRun ? signOperationPreview("catalog-bulk",actorId,snapshot) : null;
    if(!input.dryRun)verifyOperationPreview(input.previewReceipt,"catalog-bulk",actorId,snapshot);
    let updatedProductCount = 0;
    let updatedVariantCount = 0;
    let skippedUnchangedVariants = 0;

    for (const item of items) {
      if (item.variantChanges.length > 0) {
        skippedUnchangedVariants += item.variantChanges.filter((vc) => !vc.changed).length;
      }
      if (!item.willChange) continue;

      if (!input.dryRun) {
        if (input.action === "SET_CATEGORY") {
          await tx.product.update({
            where: { id: item.productId },
            data: { categoryId: input.categoryId! },
          });
          await auditInTx(tx, {
            action: "products.update",
            userId: actorId,
            entityType: "products",
            entityId: item.productId,
            oldValues: item.before,
            newValues: { ...item.after, bulkBatchSize: items.length, reason: input.reason },
          });
          updatedProductCount++;
        } else if (input.action === "SET_BRAND") {
          await tx.product.update({
            where: { id: item.productId },
            data: { brandId: input.brandId ?? null },
          });
          await auditInTx(tx, {
            action: "products.update",
            userId: actorId,
            entityType: "products",
            entityId: item.productId,
            oldValues: item.before,
            newValues: { ...item.after, bulkBatchSize: items.length, reason: input.reason },
          });
          updatedProductCount++;
        } else if (input.action === "ACTIVATE" || input.action === "DEACTIVATE") {
          const nextActive = input.action === "ACTIVATE";
          await tx.product.update({
            where: { id: item.productId },
            data: { isActive: nextActive },
          });
          await auditInTx(tx, {
            action: "products.update",
            userId: actorId,
            entityType: "products",
            entityId: item.productId,
            oldValues: item.before,
            newValues: { ...item.after, bulkBatchSize: items.length, reason: input.reason },
          });
          updatedProductCount++;
        } else if (input.action === "ARCHIVE") {
          await tx.product.update({
            where: { id: item.productId },
            data: { isActive: false, deletedAt: now },
          });
          await auditInTx(tx, {
            action: "products.archive",
            userId: actorId,
            entityType: "products",
            entityId: item.productId,
            oldValues: item.before,
            newValues: { ...item.after, bulkBatchSize: items.length, reason: input.reason },
          });
          updatedProductCount++;
        } else if (input.action === "RESTORE") {
          await tx.product.update({
            where: { id: item.productId },
            data: { isActive: false, deletedAt: null },
          });
          await auditInTx(tx, {
            action: "products.restore",
            userId: actorId,
            entityType: "products",
            entityId: item.productId,
            oldValues: item.before,
            newValues: { ...item.after, bulkBatchSize: items.length, reason: input.reason },
          });
          updatedProductCount++;
        } else if (input.action === "ADJUST_PRICE") {
          let productHadVariantUpdate = false;
          for (const vc of item.variantChanges) {
            if (!vc.changed) continue;
            await tx.productVariant.update({
              where: { id: vc.variantId },
              data: { price: vc.newPrice },
            });
            await tx.productPriceHistory.create({
              data: {
                productVariantId: vc.variantId,
                oldPrice: vc.oldPrice,
                newPrice: vc.newPrice,
                changedBy: actorId,
                reason: input.reason,
              },
            });
            await auditInTx(tx, {
              action: "variants.price",
              userId: actorId,
              entityType: "product_variants",
              entityId: vc.variantId,
              oldValues: { price: vc.oldPrice },
              newValues: { price: vc.newPrice, bulkBatchSize: items.length, reason: input.reason },
            });
            updatedVariantCount++;
            productHadVariantUpdate = true;
          }
          if (productHadVariantUpdate) updatedProductCount++;
        }
      }
    }

    const willChangeCount = items.filter((i) => i.willChange).length;

    return {
      previewReceipt,
      applied: !input.dryRun,
      dryRun: input.dryRun,
      action: input.action,
      reason: input.reason,
      summary: {
        requestedCount: items.length,
        willChangeCount,
        unchangedCount: items.length - willChangeCount,
        updatedProductCount: input.dryRun ? 0 : updatedProductCount,
        updatedVariantCount: input.dryRun ? 0 : updatedVariantCount,
        skippedUnchangedVariants,
      },
      items,
    };
  });
}
