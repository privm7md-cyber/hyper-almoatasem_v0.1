// ADM-OWNER G2 — product hard delete, UNREFERENCED ONLY.
//
// OWNER DECISION (12 Nov 2026, final): the final delete is allowed ONLY for a
// product that has no protected reference in the store's data. A product that
// is bound to a historical, financial or operational record is archived
// instead — never deleted.
//
// This module owns three things:
//   1. THE REFERENCE MAP — every protected reference the schema and the
//      application behaviour can create, with the Arabic reason the operator
//      reads. The map is the single source of truth: the read-only
//      eligibility snapshot AND the transactional delete use the SAME
//      collector, so the screen can never promise what the delete would not
//      do.
//   2. THE LOCK PROTOCOL — the delete holds the catalogue row locks and
//      re-checks the references INSIDE the same transaction, so a reference
//      created between the check and the delete cannot be lost. The
//      counterpart is the promotion writer (`lockCatalogueTarget` in
//      lib/promotions/writes.ts): an offer that attaches to a product must
//      hold the same lock. That pair is what resolves the previously
//      recorded `PROMOTION_WRITER_LOCK_PROTOCOL_MISSING`.
//   3. THE DELETE — inside one transaction: lock → re-check → delete → audit.
//      Nothing cascades into order history, invoices, movements or the audit
//      trail: the protected references are refused BEFORE the delete, and the
//      database's RESTRICT foreign keys are the second line of defence.
import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, businessRule, conflict } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";
import { assertAdminPreviewWritesAllowed } from "@/lib/auth/admin-read-only-preview";

/* ---------------------------------------------------------- reference map */

/**
 * Every reference that protects a product from the final delete.
 *
 * `protected: true` means the delete is refused while the reference exists.
 * `protected: false` means the reference is reported but does not block
 * (the record survives the delete on its own — it has no foreign key to the
 * product).
 */
export interface DeletionReferenceDefinition {
  key: string;
  /** The Arabic name the operator reads. */
  label: string;
  /** Why this reference protects the product. */
  reason: string;
  protected: boolean;
}

export const PRODUCT_REFERENCE_MAP: DeletionReferenceDefinition[] = [
  {
    key: "orderItems",
    label: "بنود طلبات سابقة",
    reason: "فيه بنود طلبات مرتبطة بالمنتج — تاريخ الطلبات المالية ما ينفعش يتشال.",
    protected: true,
  },
  {
    key: "orderItemReplacements",
    label: "بدائل طلبات",
    reason: "فيه بدائل مرتبطة ببنود الطلب — تاريخ التنفيذ ما ينفعش يتشال.",
    protected: true,
  },
  {
    key: "inventoryMovements",
    label: "حركات المخزون",
    reason: "فيه حركات مخزون — سجل الجرد والتسويات ما ينفعش يتشال.",
    protected: true,
  },
  {
    key: "inventoryBalances",
    label: "أرصدة المخزون",
    reason: "فيه رصيد مخزون مسجّل للمنتج — الرصيد والتسويات مرتبطة بيه.",
    protected: true,
  },
  {
    key: "cartItems",
    label: "عناصر السلة",
    reason: "المنتج لسه في سلة عميل — لازم يتشال من السلة الأول.",
    protected: true,
  },
  {
    key: "priceHistory",
    label: "تاريخ الأسعار",
    reason: "فيه سجل لتغييرات أسعار المنتج — الأرقام السابقة جزء من تاريخ البيع.",
    protected: true,
  },
  {
    key: "promotionTargets",
    label: "عروض ترويجية",
    reason: "العرض لسه مستهدف المنتج — لازم العرض يتشال أو يتوقّف الأول.",
    protected: true,
  },
  {
    key: "buyGetFreeVariant",
    label: "عرض اشترِ واحصل",
    reason: "شكل بيع المنتج ده هو المجاني في عرض — العرض لازم يتعدل الأول.",
    protected: true,
  },
  {
    key: "protectedAudit",
    label: "سجل تدقيق محمي",
    reason: "فيه سجل تدقيق بيحفظ معاملة تجارية أو مالية أو مخزنية أو أمنية — السجل ده بيتبقى لل auditing.",
    protected: true,
  },
  {
    key: "auditHistory",
    label: "سجل تغييرات المنتج",
    reason: "سجل التغييرات العادي بيتبقى في سجل التدقيق حتى بعد الحذف.",
    protected: false,
  },
];

/**
 * The audit events that do NOT block the final delete on their own.
 *
 * OWNER DECISION (12 Nov 2026, final): not every audit row is a permanent
 * obstacle. The ordinary lifecycle of a product — creating it, renaming it,
 * hiding it, restoring it, archiving it, managing its images and codes — is
 * metadata, not commercial history. Those rows SURVIVE the delete (the audit
 * table has no foreign key to the product) and they are readable afterwards,
 * so they must not stop a clean product from being removed.
 *
 * The rule is an ALLOW-LIST, so it fails safe: any audit row about the
 * product that is NOT one of these known metadata events counts as protected
 * evidence (a price change, a stock movement, a delivery, a security event,
 * a commercial transaction, or anything the store adds later).
 */
export const NON_BLOCKING_AUDIT_ACTIONS = [
  "products.create",
  "products.update",
  "products.archive",
  "products.restore",
  // The attempt record itself: a delete attempt must never become the reason
  // a later attempt is refused (and the delete never removes audit rows).
  "products.hard_delete",
  "variants.create",
  "variants.update",
  "images.register",
  "images.update",
  "images.primary",
  "images.delete",
  "codes.create",
  "codes.update",
  "codes.delete",
] as const;

/**
 * Classify ONE audit event: metadata (does not block) or protected evidence
 * (blocks). The allow-list is the single rule; the SQL uses the same list, so
 * the classification and the query can never disagree.
 */
export function classifyAuditAction(action: string): "METADATA" | "PROTECTED" {
  return (NON_BLOCKING_AUDIT_ACTIONS as readonly string[]).includes(action)
    ? "METADATA"
    : "PROTECTED";
}

/**
 * The audit events that DO block the final delete: they preserve a protected
 * commercial, financial, stock or security event about the product. They are
 * listed for documentation and for the tests; the enforcement itself is the
 * allow-list above (anything not metadata blocks).
 */
export const PROTECTED_AUDIT_ACTIONS = [
  "variants.price",
  "inventory.create",
  "inventory.adjust",
  "inventory.reserve",
  "inventory.release",
  "inventory.commit",
  "inventory.threshold",
] as const;

export interface DeletionReference {
  key: string;
  label: string;
  reason: string;
  count: number;
  protected: boolean;
}

export interface DeletionEligibility {
  productId: string;
  productName: string | null;
  /** A product must be archived before it can be finally deleted. */
  archived: boolean;
  /** True only when the final delete may run (no protected reference). */
  executable: boolean;
  /**
   * VERIFIED = the reference check completed. FAILED = it did NOT complete
   * (a read failed); the delete is then refused conservatively and the
   * operator is told the check could not be confirmed — the two states are
   * never confused.
   */
  verification: "VERIFIED" | "FAILED";
  /** The protected references that block the delete. */
  blockedBy: string[];
  references: DeletionReference[];
  metadata: { variants: number; images: number; codes: number };
  /** A documented limitation that still disables the feature. */
  limitation: string | null;
}

export const hardDeleteInputSchema = z
  .object({
    confirmed: z.literal(true),
    reason: z.string().trim().min(1).max(500),
    /** The concurrency token: the product's updatedAt when it was read. */
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type HardDeleteInput = z.infer<typeof hardDeleteInputSchema>;

/* ------------------------------------------------------- reference counts */

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Count every reference of the product. ONE collector for the read-only
 * snapshot and for the transactional delete — they cannot drift.
 */
export async function collectProductReferences(
  tx: Db,
  productId: string,
): Promise<{ references: DeletionReference[]; metadata: { variants: number; images: number; codes: number } }> {
  const linkedVariant = { variant: { productId } };
  const [orderItems, orderItemReplacements, inventoryMovements, inventoryBalances, cartItems, priceHistory, promotions, buyGetFreeVariant, variants, images, codes, audit] =
    await Promise.all([
      tx.orderItem.count({ where: linkedVariant }),
      tx.orderItemReplacement.count({
        where: {
          OR: [
            { replacementVariant: { productId } },
            { originalItem: linkedVariant },
            { materializedItem: linkedVariant },
          ],
        },
      }),
      tx.inventoryMovement.count({ where: linkedVariant }),
      tx.inventory.count({ where: linkedVariant }),
      tx.cartItem.count({ where: linkedVariant }),
      tx.productPriceHistory.count({ where: linkedVariant }),
      // Polymorphic targets have NO foreign key: they are counted with raw
      // SQL (a product target + every variant target of the product).
      tx.$queryRaw<Array<{ count: number }>>`
        SELECT (
          (SELECT count(*)::int FROM promotion_targets
            WHERE target_type = 'PRODUCT' AND target_id = ${productId}::uuid)
          + (SELECT count(*)::int FROM promotion_targets t
              JOIN product_variants v ON v.id = t.target_id
              WHERE t.target_type = 'VARIANT' AND v.product_id = ${productId}::uuid)
        ) AS count`,
      tx.promotionBuyGetRule.count({ where: { freeVariant: { productId } } }),
      tx.productVariant.count({ where: { productId } }),
      tx.productImage.count({ where: { productId } }),
      tx.productCode.count({ where: linkedVariant }),
      // The audit trail: the ordinary lifecycle/metadata events are reported
      // only; anything else about this product is protected evidence.
      tx.$queryRaw<Array<{ protectedCount: number; totalCount: number }>>`
        SELECT
          (SELECT count(*)::int FROM audit_logs a
            WHERE NOT (a.action = ANY(${NON_BLOCKING_AUDIT_ACTIONS}::text[]))
              AND ((a.entity_type = 'products' AND a.entity_id = ${productId}::uuid)
                OR (a.entity_type = 'product_variants' AND EXISTS
                  (SELECT 1 FROM product_variants v WHERE v.id = a.entity_id AND v.product_id = ${productId}::uuid)))
          ) AS "protectedCount",
          (SELECT count(*)::int FROM audit_logs a
            WHERE (a.entity_type = 'products' AND a.entity_id = ${productId}::uuid)
              OR (a.entity_type = 'product_variants' AND EXISTS
                (SELECT 1 FROM product_variants v WHERE v.id = a.entity_id AND v.product_id = ${productId}::uuid))
          ) AS "totalCount"`,
    ]);

  const raw: Record<string, number> = {
    orderItems,
    orderItemReplacements,
    inventoryMovements,
    inventoryBalances,
    cartItems,
    priceHistory,
    promotionTargets: promotions[0]?.count ?? 0,
    buyGetFreeVariant,
    protectedAudit: audit[0]?.protectedCount ?? 0,
    auditHistory: audit[0]?.totalCount ?? 0,
  };

  const references: DeletionReference[] = PRODUCT_REFERENCE_MAP.map((definition) => ({
    key: definition.key,
    label: definition.label,
    reason: definition.reason,
    count: raw[definition.key] ?? 0,
    protected: definition.protected,
  }));

  return {
    references,
    metadata: { variants, images, codes },
  };
}

/** The Arabic refusal message: which references block, and why. */
export function deletionRefusalMessage(references: DeletionReference[]): string {
  const blockers = references.filter((reference) => reference.protected && reference.count > 0);
  if (blockers.length === 0) return "";
  return `الحذف النهائي مش مسموح: ${blockers
    .map((blocker) => `${blocker.label} (${blocker.count}) — ${blocker.reason}`)
    .join(" ")} استخدم الأرشفة بدل الحذف.`;
}

/* --------------------------------------------------------- eligibility */

/**
 * The read-only snapshot the screen shows. It is NEVER permission and NEVER
 * proof that the delete may run: the delete re-checks everything inside its
 * own transaction.
 *
 * THREE outcomes, never mixed up (owner decision, 12 Nov 2026):
 *   • VERIFIED + no protected reference → the final delete may run.
 *   • VERIFIED + protected references   → the final delete is refused, and
 *     the references are named.
 *   • FAILED (the check could not complete) → the delete is refused
 *     CONSERVATIVELY: an unconfirmed check is never read as "clean".
 */
export async function getProductDeletionEligibility(id: string): Promise<DeletionEligibility> {
  const row = await prisma.product.findUnique({
    where: { id },
    select: { id: true, name: true, deletedAt: true },
  });
  if (!row) throw new ApiError("NOT_FOUND", "Product not found.", null);
  let collected: Awaited<ReturnType<typeof collectProductReferences>>;
  try {
    collected = await collectProductReferences(prisma, id);
  } catch {
    // The check could NOT be completed. Report it as such — never as a clean
    // result — and keep the delete out of reach.
    return {
      productId: row.id,
      productName: row.name,
      archived: row.deletedAt !== null,
      executable: false,
      verification: "FAILED",
      blockedBy: [],
      references: PRODUCT_REFERENCE_MAP.map((definition) => ({
        key: definition.key,
        label: definition.label,
        reason: definition.reason,
        count: 0,
        protected: definition.protected,
      })),
      metadata: { variants: 0, images: 0, codes: 0 },
      limitation: null,
    };
  }
  const { references, metadata } = collected;
  const blockedBy = references
    .filter((reference) => reference.protected && reference.count > 0)
    .map((reference) => reference.key);
  return {
    productId: row.id,
    productName: row.name,
    archived: row.deletedAt !== null,
    executable: row.deletedAt !== null && blockedBy.length === 0,
    verification: "VERIFIED",
    blockedBy,
    references,
    metadata,
    limitation: null,
  };
}

/* ------------------------------------------------------------- the delete */

export interface HardDeleteResult {
  deleted: true;
  productId: string;
  productName: string;
  variantsDeleted: number;
  /** The references that existed (all zero — the delete only runs when clean). */
  references: DeletionReference[];
}

/**
 * The final delete. ONE transaction: lock the catalogue rows → re-check the
 * references → delete → audit.
 *
 * The lock is the same lock the promotion writer takes, so an offer that
 * attaches to the product cannot slip in between the check and the delete:
 * either the writer wins (the delete then sees the new reference and
 * refuses) or the delete wins (the writer's own liveness check then fails
 * and the write is rejected).
 */
export async function hardDeleteProduct(
  id: string,
  input: HardDeleteInput,
  actorId: string,
): Promise<HardDeleteResult> {
  assertAdminPreviewWritesAllowed();
  const parsed = hardDeleteInputSchema.safeParse(input);
  if (!parsed.success) throw new ApiError("VALIDATION", "Invalid hard delete request.", null);

  return prisma.$transaction(async (tx) => {
    // 1) Lock the product and its variants (catalogue lock protocol).
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM products WHERE id = ${id}::uuid FOR UPDATE`;
    if (!locked.length) throw new ApiError("NOT_FOUND", "Product not found.", null);
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM product_variants WHERE product_id = ${id}::uuid FOR UPDATE`;

    const product = await tx.product.findUnique({
      where: { id },
      select: { id: true, name: true, deletedAt: true, updatedAt: true },
    });
    if (!product) throw new ApiError("NOT_FOUND", "Product not found.", null);
    if (!product.deletedAt) {
      throw businessRule("Archive the product before deleting it for good.", null);
    }
    if (Date.parse(parsed.data.expectedUpdatedAt) !== product.updatedAt.getTime()) {
      throw conflict("Product was modified concurrently; re-read and retry.", {
        currentUpdatedAt: product.updatedAt.toISOString(),
      });
    }

    // 2) Re-check EVERY reference inside this transaction.
    const { references, metadata } = await collectProductReferences(tx, id);
    const blockers = references.filter((reference) => reference.protected && reference.count > 0);
    if (blockers.length > 0) {
      throw businessRule(deletionRefusalMessage(references), {
        blockedBy: blockers.map((blocker) => blocker.key),
      });
    }

    // 3) Delete. The variants go first (the product row references them with
    //    RESTRICT). Nothing cascades into orders, invoices, movements or the
    //    audit trail: those references were refused above, and the database's
    //    RESTRICT foreign keys are the second line of defence.
    const deletedVariants = await tx.productVariant.deleteMany({ where: { productId: id } });
    await tx.product.delete({ where: { id } });

    // 4) Audit the attempt and its result (the trail survives: no FK).
    await auditInTx(tx, {
      action: "products.hard_delete",
      userId: actorId,
      entityType: "products",
      entityId: id,
      oldValues: {
        name: product.name,
        archivedAt: product.deletedAt.toISOString(),
        variants: metadata.variants,
      },
      newValues: null,
      reason: parsed.data.reason,
    });

    return {
      deleted: true,
      productId: id,
      productName: product.name,
      variantsDeleted: deletedVariants.count,
      references,
    };
  });
}
