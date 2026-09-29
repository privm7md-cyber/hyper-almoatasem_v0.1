// BA-3 inventory write domain (raw SQL only for stock mutations).
//
// Frozen rule: writers touch ONLY quantity / reserved_quantity atomically;
// available_quantity is GENERATED (never written). Every mutation runs in
// an explicit transaction with SELECT ... FOR UPDATE + a rowcount-checked
// conditional UPDATE (never read-check-write, never SERIALIZABLE).
// Movements are paired in the SAME transaction with previous_quantity taken
// from the locked row (never from app memory).
//
// Prisma NEVER owns these paths (gaps doc §5 + contract §17): Prisma cannot
// express FOR UPDATE, atomic predicates, or GENERATED-safe writes. Prisma
// is used only for threshold edits (no stock guard involved) and reads.
//
// Transaction boundaries are explicit per operation below (no generic
// wrapper — BA-1 rule). All time/quantity decisions are in SQL / integer
// thousandths math; no JS floating point touches stock arithmetic.
import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { ApiError, businessRule, conflict } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";
import { orderLockIds } from "@/lib/api/concurrency";
import { getVariantStockContext } from "@/lib/inventory/queries";
import { qtyToThousandths, isWholePacks, isStepMultiple, envelopeAllows } from "@/lib/inventory/quantities";

/** RFC 9562 UUIDv7 (frozen app-ID strategy, mirrors catalog writes). */
export function newUuidV7(nowMs: number = Date.now()): string {
  const rand = randomBytes(10);
  const timeHex = nowMs.toString(16).padStart(12, "0");
  const b: number[] = [
    ...[0, 1, 2, 3, 4, 5].map((i) => parseInt(timeHex.slice(i * 2, i * 2 + 2), 16)),
    0x70 | (rand[0] & 0x0f),
    rand[1],
    0x80 | (rand[2] & 0x3f),
    rand[3],
    rand[4],
    rand[5],
    rand[6],
    rand[7],
    rand[8],
    rand[9],
  ];
  const hex = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Extract the PostgreSQL code from a Prisma raw-query failure. Prisma 7
 * surfaces raw failures as P2010 with the driver code nested at
 * meta.driverAdapterError.cause.{code,originalCode} (proven live). */
function pgCodeOf(error: unknown): string | null {
  const e = error as {
    code?: unknown;
    meta?: { driverAdapterError?: { cause?: { code?: unknown; originalCode?: unknown } } };
  };
  const nested = e.meta?.driverAdapterError?.cause;
  const code = nested?.code ?? nested?.originalCode ?? e.code;
  return typeof code === "string" ? code : null;
}

/** Map PG guard-rail errors to API conflicts (loser re-reads, never 500s
 * for contended stock): 23514 check_violation (CHECK backstop on a lost
 * race, e.g. double-commit breaching reserved<=quantity), 40P01 deadlock +
 * 40001 serialization (re-read per BA-1 classifier). Anything else rethrows. */
function mapGuardError(error: unknown, variantId: string): never {
  const code = pgCodeOf(error);
  if (code === "23514") {
    throw conflict("Insufficient stock for this operation.", { productVariantId: variantId });
  }
  if (code === "40P01" || code === "40001") {
    throw conflict("Concurrent modification; re-read and retry.", { productVariantId: variantId });
  }
  throw error;
}

export interface StockContext {
  productType: string;
  sizeUnit: string | null;
  saleStepGrams: number | null;
}

/** Domain gate shared by reserve/commit requesteds: variant must exist and
 * be sellable; PIECE qtys whole packs; WEIGHT qtys step multiples.
 * Throws 404 (unknown variant) or 422 (business rule). */
export async function assertRequestedShape(
  variantId: string,
  qty: string,
): Promise<StockContext> {
  const ctx = await getVariantStockContext(variantId);
  if (!ctx) {
    throw new ApiError("NOT_FOUND", "Variant not found.", null);
  }
  if (!ctx.isActive || ctx.deletedAt !== null || !ctx.product.isActive || ctx.product.deletedAt !== null) {
    throw businessRule("Variant is not sellable.", null);
  }
  const productType = ctx.product.productType;
  if (productType === "PIECE") {
    if (!isWholePacks(qty)) throw businessRule("Piece quantity must be whole packs.", null);
  } else {
    const step = ctx.product.saleStepGrams;
    if (step === null || step === undefined || step <= 0) {
      throw businessRule("Weight product is missing its sale step.", null);
    }
    if (!isStepMultiple(qty, step, ctx.sizeUnit)) {
      throw businessRule("Weight quantity violates the sale step.", null);
    }
  }
  return { productType, sizeUnit: ctx.sizeUnit, saleStepGrams: ctx.product.saleStepGrams };
}

/** Liveness gate for release/commit actuals: variant must exist (404) and
 * be sellable (422). No step check on actuals (R7 W1: 0.475 on a 125g step
 * commits as PARTIAL — actuals are weighed facts, not offers). */
export async function assertVariantSellable(variantId: string): Promise<StockContext> {
  const ctx = await getVariantStockContext(variantId);
  if (!ctx) throw new ApiError("NOT_FOUND", "Variant not found.", null);
  if (!ctx.isActive || ctx.deletedAt !== null || !ctx.product.isActive || ctx.product.deletedAt !== null) {
    throw businessRule("Variant is not sellable.", null);
  }
  return { productType: ctx.product.productType, sizeUnit: ctx.sizeUnit, saleStepGrams: ctx.product.saleStepGrams };
}

export interface AdjustArgs {
  variantId: string;
  delta: string;
  movementType: "STOCK_IN" | "ADJUSTMENT" | "WASTE" | "RETURN";
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  actorId: string;
}

/**
 * Stock adjustment (admin). Transaction:
 * BEGIN → SELECT inventory FOR UPDATE → conditional UPDATE
 * (quantity+delta ≥ 0 AND reserved ≤ quantity+delta, rowcount-checked) →
 * INSERT movement (prev from locked row) → COMMIT.
 * 409 when the predicate fails (insufficient stock / reserved breach).
 */
export async function adjustStock(args: AdjustArgs) {
  try {
    return await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; quantity: string; reserved_quantity: string }>>`
      SELECT id::text AS id, quantity::text AS quantity, reserved_quantity::text AS reserved_quantity
        FROM inventory WHERE product_variant_id = ${args.variantId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new ApiError("NOT_FOUND", "Inventory not found.", null);
    const prev = locked[0].quantity;
    const updated = await tx.$queryRaw<Array<{ nq: string }>>`
      UPDATE inventory SET quantity = quantity + ${args.delta}::numeric
       WHERE product_variant_id = ${args.variantId}::uuid
         AND quantity + ${args.delta}::numeric >= 0
         AND reserved_quantity <= quantity + ${args.delta}::numeric
      RETURNING quantity::text AS nq`;
    if (updated.length === 0) {
      throw conflict("Insufficient stock for this adjustment.", { productVariantId: args.variantId });
    }
    const next = updated[0].nq;
    const movementId = newUuidV7();
    await tx.$executeRaw`
      INSERT INTO inventory_movements
        (id, product_variant_id, movement_type, quantity, previous_quantity,
         new_quantity, reference_type, reference_id, reason, created_by)
      VALUES (${movementId}::uuid, ${args.variantId}::uuid, ${args.movementType}::varchar,
        ${args.delta}::numeric, ${prev}::numeric, ${next}::numeric,
        ${args.referenceType}::varchar, ${args.referenceId}::varchar,
        ${args.reason}::text, ${args.actorId}::uuid)`;
    await auditInTx(tx, {
      action: "inventory.adjust",
      userId: args.actorId,
      entityType: "inventory",
      entityId: locked[0].id,
      oldValues: { quantity: prev },
      newValues: { delta: args.delta, quantity: next, movementType: args.movementType },
    });
    return { movementId, previousQuantity: prev, newQuantity: next };
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    mapGuardError(error, args.variantId);
  }
}

/**
 * Reserve (checkout foundation, BA-6 consumer). Transaction:
 * BEGIN → SELECT inventory FOR UPDATE → conditional reserved bump
 * (available ≥ qty, rowcount-checked) → COMMIT. NO movement (frozen §J).
 * 409 when available < qty (single-winner race loser).
 */
export async function reserveStock(variantId: string, quantity: string, actorId: string) {
  await assertRequestedShape(variantId, quantity);
  try {
    return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM inventory WHERE product_variant_id = ${variantId}::uuid FOR UPDATE`;
    const updated = await tx.$queryRaw<Array<{ r: string; a: string; id: string }>>`
      UPDATE inventory SET reserved_quantity = reserved_quantity + ${quantity}::numeric
       WHERE product_variant_id = ${variantId}::uuid
         AND (quantity - reserved_quantity) >= ${quantity}::numeric
      RETURNING reserved_quantity::text AS r, available_quantity::text AS a, id::text AS id`;
    if (updated.length === 0) {
      throw conflict("Insufficient availability.", { productVariantId: variantId });
    }
    await auditInTx(tx, {
      action: "inventory.reserve",
      userId: actorId,
      entityType: "inventory",
      entityId: updated[0].id,
      oldValues: null,
      newValues: { quantity },
    });
    return { reservedQuantity: updated[0].r, availableQuantity: updated[0].a };
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    mapGuardError(error, variantId);
  }
}

/**
 * Release a prior reservation. Transaction:
 * BEGIN → SELECT FOR UPDATE → conditional reserved decrement
 * (reserved ≥ qty, rowcount-checked) → COMMIT. NO movement (frozen §J).
 * 409 when reserved < qty (nothing to release / race loser).
 */
export async function releaseStock(variantId: string, quantity: string, actorId: string) {
  await assertVariantSellable(variantId);
  if (qtyToThousandths(quantity) <= 0) throw businessRule("Invalid quantity.", null);
  try {
    return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM inventory WHERE product_variant_id = ${variantId}::uuid FOR UPDATE`;
    const updated = await tx.$queryRaw<Array<{ r: string; a: string; id: string }>>`
      UPDATE inventory SET reserved_quantity = reserved_quantity - ${quantity}::numeric
       WHERE product_variant_id = ${variantId}::uuid
         AND reserved_quantity >= ${quantity}::numeric
      RETURNING reserved_quantity::text AS r, available_quantity::text AS a, id::text AS id`;
    if (updated.length === 0) {
      const exists = await tx.$queryRaw<Array<{ one: number }>>`
        SELECT 1 AS one FROM inventory WHERE product_variant_id = ${variantId}::uuid`;
      if (exists.length === 0) throw new ApiError("NOT_FOUND", "Inventory not found.", null);
      throw conflict("Insufficient reserved quantity to release.", { productVariantId: variantId });
    }
    await auditInTx(tx, {
      action: "inventory.release",
      userId: actorId,
      entityType: "inventory",
      entityId: updated[0].id,
      oldValues: null,
      newValues: { quantity },
    });
    return { reservedQuantity: updated[0].r, availableQuantity: updated[0].a };
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    mapGuardError(error, variantId);
  }
}

export interface CommitArgs {
  variantId: string;
  requested: string;
  actual: string;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  actorId: string;
}

/**
 * Commit (picking foundation, BA-6 consumer). Strict R3 primitive:
 * BEGIN → SELECT FOR UPDATE → R7 envelope check already done in domain →
 * conditional UPDATE (quantity -= actual, reserved -= requested,
 * predicate (quantity - reserved + requested) ≥ actual, rowcount-checked) →
 * INSERT SALE movement (signed -actual, prev from locked row + actual) →
 * COMMIT. 422 on envelope breach; 409 on stock-predicate failure (no
 * auto-cap here — BA-6 implements R7 max-fulfillable capping policy).
 */
export async function commitStock(args: CommitArgs) {
  const ctx = await assertVariantSellable(args.variantId);
  // Requested keeps the offer discipline (step/whole-pack); actual is a
  // weighed fact gated only by the envelope (R7 W1 precedent).
  await assertRequestedShape(args.variantId, args.requested);
  if (!envelopeAllows(args.requested, args.actual, ctx.productType, ctx.saleStepGrams, ctx.sizeUnit)) {
    throw businessRule("Actual quantity exceeds the fulfillment envelope.", null);
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; quantity: string }>>`
        SELECT id::text AS id, quantity::text AS quantity FROM inventory
         WHERE product_variant_id = ${args.variantId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new ApiError("NOT_FOUND", "Inventory not found.", null);
      const updated = await tx.$queryRaw<Array<{ nq: string }>>`
        UPDATE inventory
           SET quantity = quantity - ${args.actual}::numeric,
               reserved_quantity = reserved_quantity - ${args.requested}::numeric
         WHERE product_variant_id = ${args.variantId}::uuid
           AND (quantity - reserved_quantity + ${args.requested}::numeric) >= ${args.actual}::numeric
        RETURNING quantity::text AS nq`;
      if (updated.length === 0) {
        throw conflict("Insufficient stock to commit.", { productVariantId: args.variantId });
      }
      const next = updated[0].nq;
      // prev = next + actual (exact in thousandths; DB re-verifies via CHECK).
      const prevThousandths = qtyToThousandths(next) + qtyToThousandths(args.actual);
      const prev = (prevThousandths / 1000).toFixed(3);
      const negActual = (-qtyToThousandths(args.actual) / 1000).toFixed(3);
      const movementId = newUuidV7();
      const refType = args.referenceType ?? "MANUAL";
      await tx.$executeRaw`
        INSERT INTO inventory_movements
          (id, product_variant_id, movement_type, quantity, previous_quantity,
           new_quantity, reference_type, reference_id, reason, created_by)
        VALUES (${movementId}::uuid, ${args.variantId}::uuid, 'SALE',
          ${negActual}::numeric, ${prev}::numeric, ${next}::numeric,
          ${refType}::varchar, ${args.referenceId}::varchar,
          ${args.reason}::text, ${args.actorId}::uuid)`;
      await auditInTx(tx, {
        action: "inventory.commit",
        userId: args.actorId,
        entityType: "inventory",
        entityId: locked[0].id,
        oldValues: { quantity: prev },
        newValues: { requested: args.requested, actual: args.actual, quantity: next },
      });
      return { movementId, previousQuantity: prev, newQuantity: next };
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    mapGuardError(error, args.variantId);
  }
}

/**
 * Multi-row atomic reserve (BA-6 checkout foundation — service-only in BA-3,
 * no HTTP surface to avoid inventing endpoints). Locks inventory rows in
 * deterministic ASC order (frozen H1 rule), then conditionally reserves each
 * line; ANY insufficient line rolls back the whole batch (no partial hold).
 */
export async function reserveBatch(lines: Array<{ variantId: string; quantity: string }>) {
  const ordered = orderLockIds(lines.map((l) => l.variantId));
  const byVariant = new Map(lines.map((l) => [l.variantId, l.quantity] as const));
  for (const v of ordered) {
    const q = byVariant.get(v);
    if (q !== undefined) await assertRequestedShape(v, q);
  }
  try {
    return await prisma.$transaction(async (tx) => {
      for (const v of ordered) {
        await tx.$queryRaw`SELECT 1 FROM inventory WHERE product_variant_id = ${v}::uuid FOR UPDATE`;
      }
      for (const v of ordered) {
        const qty = byVariant.get(v);
        if (qty === undefined) continue;
        const updated = await tx.$queryRaw<Array<{ one: number }>>`
          UPDATE inventory SET reserved_quantity = reserved_quantity + ${qty}::numeric
           WHERE product_variant_id = ${v}::uuid
             AND (quantity - reserved_quantity) >= ${qty}::numeric
          RETURNING 1 AS one`;
        if (updated.length === 0) {
          throw conflict("Insufficient availability.", { productVariantId: v });
        }
      }
      return { locked: ordered };
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    mapGuardError(error, ordered[0] ?? "batch");
  }
}

/** Admin threshold edit (no stock guard, no movement — display-level).
 * Audit-paired in the same tx (PRE-BA-11 decision #2). */
export async function setLowStockThreshold(variantId: string, threshold: string | null, actorId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.inventory.update({
        where: { productVariantId: variantId },
        data: { lowStockThreshold: threshold },
      });
      await auditInTx(tx, {
        action: "inventory.threshold",
        userId: actorId,
        entityType: "inventory",
        entityId: updated.id,
        oldValues: null,
        newValues: { threshold },
      });
      return updated;
    });
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code === "P2025") return null;
    throw error;
  }
}
