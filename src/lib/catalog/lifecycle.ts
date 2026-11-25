import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, conflict } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";
import { assertAdminPreviewWritesAllowed } from "@/lib/auth/admin-read-only-preview";

export const lifecycleInputSchema = z.object({
  confirmed: z.literal(true),
  reason: z.string().trim().min(1).max(500),
  // Unlike the generic PATCH, lifecycle never permits match-any or no version.
  expectedUpdatedAt: z.string().datetime({ offset: true }),
}).strict();

export type LifecycleInput = z.infer<typeof lifecycleInputSchema>;
export type LifecycleOperation = "archive" | "restore";
export interface LifecycleResult {
  id: string;
  deletedAt: string | null;
  isActive: boolean;
  updatedAt: string;
  alreadyApplied: boolean;
}

const lifecycleSelect = { id: true, deletedAt: true, isActive: true, updatedAt: true } as const;

/** Only lifecycle fields change. Product PATCH uses the same product row lock. */
export async function transitionProduct(id: string, operation: LifecycleOperation, input: LifecycleInput, actorId: string): Promise<LifecycleResult> {
  assertAdminPreviewWritesAllowed();
  const parsed = lifecycleInputSchema.safeParse(input);
  if (!parsed.success || !["archive", "restore"].includes(operation)) {
    throw new ApiError("VALIDATION", "Invalid product lifecycle request.");
  }
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM products WHERE id = ${id}::uuid FOR UPDATE`;
    if (!locked.length) throw new ApiError("NOT_FOUND", "Product not found.");
    const prior = await tx.product.findUnique({ where: { id }, select: lifecycleSelect });
    if (!prior) throw new ApiError("NOT_FOUND", "Product not found.");
    // Even a final-state retry with a stale token is rejected: it might span
    // an intervening restore/archive or edit. A current-token no-op is safe.
    if (Date.parse(parsed.data.expectedUpdatedAt) !== prior.updatedAt.getTime()) {
      throw conflict("Product was modified concurrently; re-read and retry.", { currentUpdatedAt: prior.updatedAt.toISOString() });
    }
    const sameState = operation === "archive" ? prior.deletedAt !== null : prior.deletedAt === null;
    if (sameState) {
      // Restore must NEVER silently hide a product that has since been published.
      if (prior.isActive) throw conflict("Product is not in the requested hidden lifecycle state.");
      return { ...prior, deletedAt: prior.deletedAt?.toISOString() ?? null, updatedAt: prior.updatedAt.toISOString(), alreadyApplied: true };
    }
    const updated = await tx.product.update({
      where: { id },
      data: { deletedAt: operation === "archive" ? new Date() : null, isActive: false },
      select: lifecycleSelect,
    });
    await auditInTx(tx, {
      action: `products.${operation}`,
      userId: actorId,
      entityType: "products",
      entityId: id,
      oldValues: { deletedAt: prior.deletedAt?.toISOString() ?? null, isActive: prior.isActive },
      newValues: { deletedAt: updated.deletedAt?.toISOString() ?? null, isActive: updated.isActive },
      reason: parsed.data.reason,
    });
    return { ...updated, deletedAt: updated.deletedAt?.toISOString() ?? null, updatedAt: updated.updatedAt.toISOString(), alreadyApplied: false };
  });
}

/**
 * The final delete lives in `@/lib/catalog/hard-delete` (owner decision,
 * 12 Nov 2026: UNREFERENCED ONLY). It owns the reference map, the catalogue
 * lock protocol and the transactional delete. This module keeps the archive /
 * restore transition, which is the safe path for every product that carries
 * any history.
 */
export {
  PRODUCT_REFERENCE_MAP,
  PROTECTED_AUDIT_ACTIONS,
  collectProductReferences,
  deletionRefusalMessage,
  getProductDeletionEligibility,
  hardDeleteProduct,
  hardDeleteInputSchema,
  type DeletionEligibility,
  type DeletionReference,
  type HardDeleteInput,
} from "@/lib/catalog/hard-delete";
