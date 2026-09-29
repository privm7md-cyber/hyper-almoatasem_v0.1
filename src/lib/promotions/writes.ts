// BA-8 promotion/coupon admin write domain.
//
// Frozen gates mirrored here (DB remains sole enforcer):
// - Type×scope×value shapes (chk_promos_values/scope_types) → 422.
// - Window end > start → 422. Codes normalized UPPER/trimmed, inner
//   spaces rejected (chk_coupons_code).
// - Activation validation: LINE promos need ≥1 target + BXGY needs its
//   rule row before status may become ACTIVE (frozen A2/A5).
// - Referenced immutability (A21/L2): value/target/rule columns reject
//   edits once ANY order_discounts row references the promo (422); admin
//   status/window/priority/stackable/limits stay mutable; deletion relies
//   on RESTRICT FKs (usages/discounts pin history → 409).
// Prisma owns every write (all representable); raw SQL only for the
// referenced-check EXISTS probes. IDs are app-generated UUIDv7.
import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { businessRule, conflict } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";
import type { PromotionInput, CouponInput } from "@/lib/promotions/validation";

/** RFC 9562 UUIDv7 (frozen app-ID strategy; local copy — previous BA
 * modules are not modified for reuse). */
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

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

function isNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

/** True once ANY order_discounts row references the promo (estimate or
 * final) — the A21 immutability tripwire (raw EXISTS probe). */
export async function isPromoReferenced(promotionId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS one FROM order_discounts WHERE promotion_id = ${promotionId}::uuid LIMIT 1`;
  return rows.length > 0;
}

export interface ValueShape {
  type: string;
  scope: string;
  discountPercent?: string | null;
  discountAmount?: string | null;
  fixedPrice?: string | null;
}

/** Mirror of chk_promos_values + chk_promos_scope_types (DB enforces). */
export function assertValueShape(v: ValueShape): void {
  const { type, scope } = v;
  const ok =
    (type === "PERCENTAGE" && v.discountPercent != null && v.discountAmount == null && v.fixedPrice == null) ||
    (type === "FIXED_AMOUNT" && v.discountAmount != null && v.discountPercent == null && v.fixedPrice == null) ||
    (type === "FIXED_PRICE" &&
      scope === "LINE" &&
      v.fixedPrice != null &&
      v.discountPercent == null &&
      v.discountAmount == null) ||
    (type === "BUY_X_GET_Y" &&
      scope === "LINE" &&
      v.discountPercent == null &&
      v.discountAmount == null &&
      v.fixedPrice == null);
  if (!ok) throw businessRule("Promotion value shape violates its type.", null);
}

export function assertWindow(startAt: string | null | undefined, endAt: string | null | undefined): void {
  if (startAt != null && endAt != null && !(new Date(endAt).getTime() > new Date(startAt).getTime())) {
    // Compare of two caller-supplied boundary strings (not DB time) —
    // the DB CHECK re-verifies; no CC-1 pattern involved.
    throw businessRule("Promotion window end must be after start.", null);
  }
}

export async function createPromotion(input: PromotionInput, actorId: string) {
  assertValueShape(input);
  assertWindow(input.startAt ?? null, input.endAt ?? null);
  if ((input.status ?? "DRAFT") === "ACTIVE") {
    throw businessRule("Promotions activate with targets configured.", null);
  }
  return prisma.$transaction(async (tx) => {
    const created = await tx.promotion.create({
      data: {
        id: newUuidV7(),
        name: input.name,
        description: input.description ?? null,
        type: input.type,
        scope: input.scope,
        status: input.status ?? "DRAFT",
        startAt: input.startAt ?? null,
        endAt: input.endAt ?? null,
        discountPercent: input.discountPercent ?? null,
        discountAmount: input.discountAmount ?? null,
        fixedPrice: input.fixedPrice ?? null,
        priority: input.priority ?? 0,
        isStackable: input.isStackable ?? false,
        usageLimit: input.usageLimit ?? null,
        createdBy: actorId,
      },
    });
    await auditInTx(tx, {
      action: "promotions.create",
      userId: actorId,
      entityType: "promotions",
      entityId: created.id,
      oldValues: null,
      newValues: { name: created.name, type: created.type, scope: created.scope },
    });
    return created;
  });
}

export interface PromotionPatch {
  name?: string | null;
  description?: string | null;
  status?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  discountPercent?: string | null;
  discountAmount?: string | null;
  fixedPrice?: string | null;
  priority?: number | null;
  isStackable?: boolean | null;
  usageLimit?: number | null;
}

/** Admin edit with referenced-immutability: value columns reject changes
 * once referenced; DRAFT→ACTIVE requires targets (+BXGY rule row). */
export async function patchPromotion(id: string, patch: PromotionPatch, actorId: string) {
  const current = await prisma.promotion.findUnique({
    where: { id },
    include: { targets: { select: { id: true } }, buyGetRules: { select: { id: true } } },
  });
  if (!current) return null;
  const next = {
    discountPercent: patch.discountPercent !== undefined ? patch.discountPercent : current.discountPercent?.toString() ?? null,
    discountAmount: patch.discountAmount !== undefined ? patch.discountAmount : current.discountAmount?.toString() ?? null,
    fixedPrice: patch.fixedPrice !== undefined ? patch.fixedPrice : current.fixedPrice?.toString() ?? null,
  };
  const valuesTouched =
    (patch.discountPercent !== undefined && patch.discountPercent !== (current.discountPercent?.toString() ?? null)) ||
    (patch.discountAmount !== undefined && patch.discountAmount !== (current.discountAmount?.toString() ?? null)) ||
    (patch.fixedPrice !== undefined && patch.fixedPrice !== (current.fixedPrice?.toString() ?? null));
  if (valuesTouched) {
    if (await isPromoReferenced(id)) {
      throw businessRule("Promotion values are immutable once referenced by orders.", null);
    }
    assertValueShape({ type: current.type, scope: current.scope, ...next });
  }
  const nextStatus = patch.status !== undefined && patch.status !== null ? patch.status : current.status;
  const nextStart = patch.startAt !== undefined ? patch.startAt : current.startAt?.toISOString() ?? null;
  const nextEnd = patch.endAt !== undefined ? patch.endAt : current.endAt?.toISOString() ?? null;
  assertWindow(nextStart, nextEnd);
  if (nextStatus === "ACTIVE" && current.status !== "ACTIVE") {
    if (current.scope === "LINE" && current.targets.length === 0) {
      throw businessRule("LINE promotions activate with at least one target.", null);
    }
    if (current.type === "BUY_X_GET_Y" && !current.buyGetRules) {
      throw businessRule("BUY_X_GET_Y promotions activate with their rule row.", null);
    }
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.promotion.update({
        where: { id },
        data: {
          ...(patch.name !== undefined && patch.name !== null ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.status !== undefined && patch.status !== null ? { status: patch.status } : {}),
          ...(patch.startAt !== undefined ? { startAt: patch.startAt } : {}),
          ...(patch.endAt !== undefined ? { endAt: patch.endAt } : {}),
          ...(patch.discountPercent !== undefined ? { discountPercent: patch.discountPercent } : {}),
          ...(patch.discountAmount !== undefined ? { discountAmount: patch.discountAmount } : {}),
          ...(patch.fixedPrice !== undefined ? { fixedPrice: patch.fixedPrice } : {}),
          ...(patch.priority !== undefined && patch.priority !== null ? { priority: patch.priority } : {}),
          ...(patch.isStackable !== undefined && patch.isStackable !== null ? { isStackable: patch.isStackable } : {}),
          ...(patch.usageLimit !== undefined ? { usageLimit: patch.usageLimit } : {}),
        },
      });
      await auditInTx(tx, {
        action: "promotions.update",
        userId: actorId,
        entityType: "promotions",
        entityId: id,
        oldValues: { status: current.status },
        newValues: { name: updated.name, status: updated.status },
      });
      return updated;
    });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Hard delete: CASCADE clears targets/rules/buyget/coupons only while the
 * promo is deletable; usages/discounts RESTRICT (history unreachable) → 409. */
export async function deletePromotion(id: string, actorId: string): Promise<boolean> {
  const row = await prisma.promotion.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!row) return false;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.promotion.delete({ where: { id } });
      await auditInTx(tx, {
        action: "promotions.delete",
        userId: actorId,
        entityType: "promotions",
        entityId: id,
        oldValues: { name: row.name },
        newValues: null,
      });
    });
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    if (isForeignKeyViolation(error)) {
      throw conflict("Promotion is referenced by order history.", null);
    }
    throw error;
  }
}

async function assertTargetLive(targetType: string, targetId: string): Promise<void> {
  let live = false;
  if (targetType === "VARIANT") {
    const r = await prisma.productVariant.findUnique({
      where: { id: targetId },
      select: { isActive: true, deletedAt: true },
    });
    live = !!r && r.isActive && r.deletedAt === null;
  } else if (targetType === "PRODUCT") {
    const r = await prisma.product.findUnique({
      where: { id: targetId },
      select: { isActive: true, deletedAt: true },
    });
    live = !!r && r.isActive && r.deletedAt === null;
  } else if (targetType === "BRAND") {
    const r = await prisma.brand.findUnique({
      where: { id: targetId },
      select: { isActive: true, deletedAt: true },
    });
    live = !!r && r.isActive && r.deletedAt === null;
  } else {
    const r = await prisma.category.findUnique({
      where: { id: targetId },
      select: { isActive: true, deletedAt: true },
    });
    live = !!r && r.isActive && r.deletedAt === null;
  }
  if (!live) throw businessRule("Promotion target does not exist or is not live.", null);
}

export async function addTarget(promotionId: string, targetType: string, targetId: string, actorId: string) {
  const promo = await prisma.promotion.findUnique({ where: { id: promotionId }, select: { id: true } });
  if (!promo) return null;
  if (await isPromoReferenced(promotionId)) {
    throw businessRule("Promotion targets are immutable once referenced by orders.", null);
  }
  await assertTargetLive(targetType, targetId);
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.promotionTarget.create({
        data: { id: newUuidV7(), promotionId, targetType, targetId },
      });
      await auditInTx(tx, {
        action: "targets.create",
        userId: actorId,
        entityType: "promotion_targets",
        entityId: created.id,
        oldValues: null,
        newValues: { promotionId, targetType },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("Promotion target already exists.", null);
    throw error;
  }
}

export async function deleteTarget(promotionId: string, targetRowId: string, actorId: string): Promise<boolean | null> {
  const row = await prisma.promotionTarget.findFirst({
    where: { id: targetRowId, promotionId },
    select: { id: true, targetType: true },
  });
  if (!row) return null;
  if (await isPromoReferenced(promotionId)) {
    throw businessRule("Promotion targets are immutable once referenced by orders.", null);
  }
  await prisma.$transaction(async (tx) => {
    await tx.promotionTarget.delete({ where: { id: targetRowId } });
    await auditInTx(tx, {
      action: "targets.delete",
      userId: actorId,
      entityType: "promotion_targets",
      entityId: targetRowId,
      oldValues: { promotionId, targetType: row.targetType },
      newValues: null,
    });
  });
  return true;
}

export interface RulesInput {
  minimumQuantity?: string | null;
  minimumAmount?: string | null;
  maximumDiscount?: string | null;
}

export async function putRules(promotionId: string, input: RulesInput, actorId: string) {
  const promo = await prisma.promotion.findUnique({ where: { id: promotionId }, select: { id: true } });
  if (!promo) return null;
  if (await isPromoReferenced(promotionId)) {
    throw businessRule("Promotion rules are immutable once referenced by orders.", null);
  }
  return prisma.$transaction(async (tx) => {
    const row = await tx.promotionRule.upsert({
      where: { promotionId },
      update: {
        minimumQuantity: input.minimumQuantity ?? null,
        minimumAmount: input.minimumAmount ?? null,
        maximumDiscount: input.maximumDiscount ?? null,
      },
      create: {
        id: newUuidV7(),
        promotionId,
        minimumQuantity: input.minimumQuantity ?? null,
        minimumAmount: input.minimumAmount ?? null,
        maximumDiscount: input.maximumDiscount ?? null,
      },
    });
    await auditInTx(tx, {
      action: "rules.update",
      userId: actorId,
      entityType: "promotion_rules",
      entityId: row.id,
      oldValues: null,
      newValues: { promotionId },
    });
    return row;
  });
}

export interface BuyGetInput {
  buyQuantity: string;
  getQuantity: string;
  discountPercent: string;
  freeVariantId?: string | null;
}

export async function putBuyGet(promotionId: string, input: BuyGetInput, actorId: string) {
  const promo = await prisma.promotion.findUnique({
    where: { id: promotionId },
    select: { id: true, type: true },
  });
  if (!promo) return null;
  if (promo.type !== "BUY_X_GET_Y") {
    throw businessRule("Buy-get rules belong to BUY_X_GET_Y promotions.", null);
  }
  if (await isPromoReferenced(promotionId)) {
    throw businessRule("Promotion rules are immutable once referenced by orders.", null);
  }
  if (input.freeVariantId !== undefined && input.freeVariantId !== null) {
    const v = await prisma.productVariant.findUnique({
      where: { id: input.freeVariantId },
      select: { isActive: true, deletedAt: true },
    });
    if (!v || !v.isActive || v.deletedAt !== null) {
      throw businessRule("Free variant does not exist or is not live.", null);
    }
  }
  return prisma.$transaction(async (tx) => {
    const row = await tx.promotionBuyGetRule.upsert({
      where: { promotionId },
      update: {
        buyQuantity: input.buyQuantity,
        getQuantity: input.getQuantity,
        discountPercent: input.discountPercent,
        freeVariantId: input.freeVariantId ?? null,
      },
      create: {
        id: newUuidV7(),
        promotionId,
        buyQuantity: input.buyQuantity,
        getQuantity: input.getQuantity,
        discountPercent: input.discountPercent,
        freeVariantId: input.freeVariantId ?? null,
      },
    });
    await auditInTx(tx, {
      action: "buyget.update",
      userId: actorId,
      entityType: "promotion_buy_get_rules",
      entityId: row.id,
      oldValues: null,
      newValues: { promotionId },
    });
    return row;
  });
}

/** Coupon code normalization: trim + UPPER (frozen case-insensitive-by-
 * design); inner spaces/empties fail the wire shape (400 at the route). */
export function normalizeCouponCode(raw: string): string {
  const code = raw.trim().toUpperCase();
  if (code === "" || code.includes(" ") || code.length > 64) {
    throw businessRule("Invalid coupon code.", null);
  }
  return code;
}

export async function createCoupon(input: CouponInput, actorId: string) {
  const promo = await prisma.promotion.findUnique({ where: { id: input.promotionId }, select: { id: true } });
  if (!promo) throw businessRule("Promotion does not exist.", null);
  const code = normalizeCouponCode(input.code);
  assertWindow(input.startAt ?? null, input.endAt ?? null);
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.coupon.create({
        data: {
          id: newUuidV7(),
          promotionId: input.promotionId,
          code,
          usageLimit: input.usageLimit ?? null,
          perCustomerLimit: input.perCustomerLimit ?? null,
          minimumOrderAmount: input.minimumOrderAmount ?? null,
          startAt: input.startAt ?? null,
          endAt: input.endAt ?? null,
          isActive: input.isActive ?? true,
        },
      });
      await auditInTx(tx, {
        action: "coupons.create",
        userId: actorId,
        entityType: "coupons",
        entityId: created.id,
        oldValues: null,
        newValues: { code: created.code, promotionId: input.promotionId },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("Coupon code already exists.", null);
    if (isForeignKeyViolation(error)) throw businessRule("Promotion does not exist.", null);
    throw error;
  }
}

export interface CouponPatch {
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  minimumOrderAmount?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  isActive?: boolean | null;
}

/** Code + promotion link immutable (conservative: usages audit by id, but
 * code rotation is a new-code flow, not an edit — enforced by the patch
 * schema omitting them, so unknown keys 400 at the route). */
export async function patchCoupon(id: string, patch: CouponPatch, actorId: string) {
  const current = await prisma.coupon.findUnique({ where: { id } });
  if (!current) return null;
  const nextStart = patch.startAt !== undefined ? patch.startAt : current.startAt?.toISOString() ?? null;
  const nextEnd = patch.endAt !== undefined ? patch.endAt : current.endAt?.toISOString() ?? null;
  assertWindow(nextStart, nextEnd);
  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.coupon.update({
        where: { id },
        data: {
          ...(patch.usageLimit !== undefined ? { usageLimit: patch.usageLimit } : {}),
          ...(patch.perCustomerLimit !== undefined ? { perCustomerLimit: patch.perCustomerLimit } : {}),
          ...(patch.minimumOrderAmount !== undefined ? { minimumOrderAmount: patch.minimumOrderAmount } : {}),
          ...(patch.startAt !== undefined ? { startAt: patch.startAt } : {}),
          ...(patch.endAt !== undefined ? { endAt: patch.endAt } : {}),
          ...(patch.isActive !== undefined && patch.isActive !== null ? { isActive: patch.isActive } : {}),
        },
      });
      await auditInTx(tx, {
        action: "coupons.update",
        userId: actorId,
        entityType: "coupons",
        entityId: id,
        oldValues: { code: current.code },
        newValues: { code: updated.code },
      });
      return updated;
    });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function deleteCoupon(id: string, actorId: string): Promise<boolean> {
  const row = await prisma.coupon.findUnique({ where: { id }, select: { id: true, code: true } });
  if (!row) return false;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.coupon.delete({ where: { id } });
      await auditInTx(tx, {
        action: "coupons.delete",
        userId: actorId,
        entityType: "coupons",
        entityId: id,
        oldValues: { code: row.code },
        newValues: null,
      });
    });
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    if (isForeignKeyViolation(error)) {
      throw conflict("Coupon is referenced by order history.", null);
    }
    throw error;
  }
}
