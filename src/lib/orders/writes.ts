// BA-6 order write domain (creation + cancel).
//
// Creation is ONE authoritative transaction, transactionally equivalent to
// the frozen checkout (§F): lock cart (ACTIVE else replay) → idempotency
// pre-check → validate customer/address → revalidate lines (liveness,
// counting unit, live price, step) → lock inventory ASC → atomic reserve
// (rowcount) → INSERT order + snapshot items + history (NULL→NEW,
// NEW→CONFIRMED) → cart CHECKED_OUT → COMMIT. Price drift always rejects
// (new terms = new key + confirmation — BA-6 offers no confirm flag).
// Cancel (NEW|CONFIRMED, unpicked only) releases reservations with zero
// movements (frozen §J) + history + status flip, one tx.
// Prisma owns representable writes; raw SQL owns locks, the sequence,
// atomic reserve bumps, and guarded updates. Errors caught OUTSIDE any tx
// (never continue a poisoned transaction — BA-5 lesson).
import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, businessRule, conflict } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";
import { orderLockIds } from "@/lib/api/concurrency";
import { formatOrderNumber } from "@/lib/orders/state-machine";
import { findOrderByCart, findOrderByIdempotencyKey } from "@/lib/orders/queries";
import {
  formatPiastres,
  lineTotalPiastres,
  priceToPiastres,
  qtyToThousandths,
} from "@/lib/cart/totals";
import type { CartOwner } from "@/lib/cart/queries";
import { applyPromotions, persistPromoRows } from "@/lib/promotions/checkout";

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

/** PostgreSQL code out of Prisma (raw failures nest it at
 * meta.driverAdapterError.cause — proven in BA-3; local copy). */
function pgCodeOf(error: unknown): string | null {
  const e = error as {
    code?: unknown;
    meta?: { driverAdapterError?: { cause?: { code?: unknown; originalCode?: unknown } } };
  };
  const nested = e.meta?.driverAdapterError?.cause;
  const code = nested?.code ?? nested?.originalCode ?? e.code;
  if (typeof code === "string" && code !== "P2010") return code;
  if (e.code === "P2002") return "23505";
  return typeof code === "string" ? code : null;
}

/** Cart no longer orderable (consumed/retired). Outer handler replays the
 * winner's order by cart (frozen cart-checkout-once guard companion). */
export class CartConsumedError extends ApiError {
  constructor(cartId: string) {
    super("CONFLICT", "Cart is no longer available for ordering.", { cartId }, true);
  }
}

export interface CreateOrderArgs {
  owner: CartOwner;
  customerId: string;
  addressId: string;
  idempotencyKey: string;
  /** Optional coupon code (normalized + validated server-side; absent = autos only). */
  couponCode?: string | null;
}

export interface CreateOrderResult {
  orderId: string;
  replay: boolean;
}

interface PricedLine {
  variantId: string;
  productId: string;
  variantName: string;
  productName: string;
  brandName: string | null;
  brandId: string | null;
  categoryId: string;
  code: string | null;
  codeType: string | null;
  unit: string;
  productType: string;
  saleStep: number | null;
  sizeUnit: string | null;
  unitPriceCents: number;
  unitPriceText: string;
  quantity: string;
  estimatedCents: number;
  estimatedText: string;
}

/** Step/pack gate shared with cart semantics (integer thousandths). */
function assertOrderLineShape(
  productType: string,
  sizeUnit: string | null,
  saleStep: number | null,
  quantity: string,
): { unit: string } {
  if (productType === "PIECE") {
    if (qtyToThousandths(quantity) % 1000 !== 0) {
      throw businessRule("Piece quantity must be whole packs.", null);
    }
    return { unit: "PIECE" };
  }
  if (saleStep === null || saleStep <= 0 || !sizeUnit) {
    throw businessRule("Weight product is missing its sale step.", null);
  }
  const t = qtyToThousandths(quantity);
  const stepThousandths = sizeUnit === "GRAM" ? saleStep * 1000 : saleStep;
  if (t % stepThousandths !== 0) {
    throw businessRule("Weight quantity violates the sale step.", null);
  }
  return { unit: sizeUnit };
}

async function readDeliveryFeeCents(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ v: string }>>`
    SELECT value_text AS v FROM store_settings WHERE key = 'delivery.default_fee'`;
  const raw = rows.length === 0 ? null : rows[0].v;
  // Fail-closed server misconfiguration (never client-supplied, never silent 0).
  if (raw === null || !/^\d+(\.\d{1,2})?$/.test(raw)) throw new Error("Delivery fee misconfigured.");
  return priceToPiastres(raw);
}

/**
 * Create an order from the owner's ACTIVE cart. Convergence rules (all
 * outside any failed tx): consumed cart → replay winner by cart;
 * idempotency-key hit → same cart ? replay : 409; lost INSERT race
 * (23505) → reselect by key → same rule. Rollback on any other failure
 * writes nothing (no partial order, no leaked reservation, cart untouched).
 */
export async function createOrder(args: CreateOrderArgs): Promise<CreateOrderResult> {
  // Subject cart id for the key-hit comparison (outside tx, read-only).
  // Latest cart regardless of status for BOTH owner kinds: a consumed cart
  // still identifies "same cart" for idempotency replay (the tx re-checks
  // ACTIVE and the CartConsumedError path replays the winner by cart).
  // Restricting customers to ACTIVE here made post-checkout same-key replay
  // answer 404 instead of 200-replay, unlike the guest path.
  const subjectHint =
    args.owner.kind === "guest"
      ? await prisma.cart.findFirst({
          where: { sessionId: args.owner.sessionHash },
          select: { id: true },
          orderBy: [{ createdAt: "desc" as const }],
        })
      : await prisma.cart.findFirst({
          where: { customerId: args.owner.customerId },
          select: { id: true },
          orderBy: [{ createdAt: "desc" as const }],
        });
  if (!subjectHint) throw new ApiError("NOT_FOUND", "Active cart not found.", null);

  const keyHit = await findOrderByIdempotencyKey(args.idempotencyKey);
  if (keyHit) {
    if (keyHit.cartId === subjectHint.id) return { orderId: keyHit.id, replay: true };
    throw conflict("Idempotency key was already used with different terms.", { key: args.idempotencyKey });
  }

  try {
    const orderId = await prisma.$transaction(async (tx) => {
      const carts = await tx.$queryRaw<Array<{ id: string; status: string; expired: boolean }>>`
        SELECT id::text AS id, status,
          (expires_at IS NOT NULL AND expires_at <= now()) AS expired
          FROM carts WHERE id = ${subjectHint.id}::uuid FOR UPDATE`;
      if (carts.length === 0 || carts[0].status !== "ACTIVE" || carts[0].expired) {
        throw new CartConsumedError(subjectHint.id);
      }

      const customer = await tx.customer.findUnique({ where: { id: args.customerId } });
      if (!customer) throw new ApiError("NOT_FOUND", "Customer not found.", null);
      if (!customer.isActive || customer.deletedAt !== null) {
        throw businessRule("Customer is not active.", null);
      }
      const address = await tx.customerAddress.findFirst({
        where: { id: args.addressId, customerId: args.customerId },
      });
      if (!address) throw new ApiError("NOT_FOUND", "Address not found.", null);

      const lines = await tx.cartItem.findMany({
        where: { cartId: subjectHint.id },
        orderBy: [{ id: "asc" as const }],
      });
      if (lines.length === 0) throw businessRule("Cart is empty.", null);

      // Revalidate every line against LIVE variant state (authoritative).
      const priced: PricedLine[] = [];
      const drifted: string[] = [];
      for (const l of lines) {
        const v = await tx.productVariant.findUnique({
          where: { id: l.productVariantId },
          include: {
            product: {
              include: { brand: { select: { id: true, name: true } } },
            },
          },
        });
        if (!v || !v.isActive || v.deletedAt !== null) {
          throw businessRule("Cart contains an unsellable variant.", { variantId: l.productVariantId });
        }
        const expectedUnit = v.product.productType === "WEIGHT" ? v.sizeUnit : "PIECE";
        if (l.unitSnapshot !== expectedUnit) {
          throw businessRule("Cart line unit no longer matches the variant.", { variantId: l.productVariantId });
        }
        const qtyText = l.quantity.toString();
        const { unit } = assertOrderLineShape(v.product.productType, v.sizeUnit, v.product.saleStepGrams, qtyText);
        const liveCents = priceToPiastres(v.price.toString());
        const snapCents =
          l.unitPriceSnapshot === null ? null : priceToPiastres(l.unitPriceSnapshot.toString());
        if (snapCents === null || snapCents !== liveCents) {
          drifted.push(l.productVariantId);
          continue;
        }
        const code =
          await tx.$queryRaw<Array<{ code: string; type: string }>>`
            SELECT code, type FROM product_codes
             WHERE product_variant_id = ${l.productVariantId}::uuid AND is_primary`;
        const lineCents = lineTotalPiastres(qtyText, v.price.toString()) as number;
        priced.push({
          variantId: l.productVariantId,
          productId: v.product.id,
          variantName: v.name,
          productName: v.product.name,
          brandName: v.product.brand?.name ?? null,
          brandId: v.product.brand?.id ?? null,
          categoryId: v.product.categoryId,
          code: code.length === 0 ? null : code[0].code,
          codeType: code.length === 0 ? null : code[0].type,
          unit,
          productType: v.product.productType,
          saleStep: v.product.saleStepGrams,
          sizeUnit: v.sizeUnit,
          unitPriceCents: liveCents,
          unitPriceText: v.price.toString(),
          quantity: qtyText,
          estimatedCents: lineCents,
          estimatedText: formatPiastres(lineCents),
        });
      }
      // Price drift = new terms = new key + confirmation (no confirm flag in
      // BA-6, so drift always rejects; cart stays ACTIVE for the next attempt).
      if (drifted.length > 0) {
        throw conflict("Prices changed since items were added to the cart.", { variants: drifted });
      }

      // Promotion phase (BA-8): autos + optional coupon evaluated on the
      // validated lines; counters/usages consumed in-tx; free-line specs
      // materialized below. No promos and no coupon = empty computation
      // (zero behavior change for plain orders).
      const promoTree = await tx.$queryRaw<Array<{ id: string; parent: string | null }>>`
        SELECT id::text AS id, parent_id::text AS parent FROM categories`;
      const promoTreeMap = new Map(promoTree.map((r) => [r.id, r.parent]));
      const promoRows = await tx.$queryRaw<
        Array<{
          id: string;
          name: string;
          type: string;
          scope: string;
          priority: number;
          is_stackable: boolean;
          created_at: Date;
          discount_percent: string | null;
          discount_amount: string | null;
          fixed_price: string | null;
          minimum_quantity: string | null;
          minimum_amount: string | null;
          maximum_discount: string | null;
          buy_quantity: string | null;
          get_quantity: string | null;
          buy_pct: string | null;
          free_variant_id: string | null;
          usage_limit: number | null;
        }>
      >`
        SELECT p.id::text AS id, p.name, p.type, p.scope, p.priority, p.is_stackable, p.created_at,
          p.discount_percent::text, p.discount_amount::text, p.fixed_price::text,
          pr.minimum_quantity::text, pr.minimum_amount::text, pr.maximum_discount::text,
          b.buy_quantity::text, b.get_quantity::text, b.discount_percent::text AS buy_pct,
          b.free_variant_id::text AS free_variant_id, p.usage_limit
          FROM promotions p
          LEFT JOIN promotion_rules pr ON pr.promotion_id = p.id
          LEFT JOIN promotion_buy_get_rules b ON b.promotion_id = p.id
         WHERE p.status = 'ACTIVE' AND p.deleted_at IS NULL
           AND (p.start_at IS NULL OR p.start_at <= now())
           AND (p.end_at IS NULL OR p.end_at > now())`;
      const promoTargets = await tx.$queryRaw<Array<{ pid: string; tt: string; tid: string }>>`
        SELECT promotion_id::text AS pid, target_type AS tt, target_id::text AS tid
          FROM promotion_targets`;
      const targetsByPromo = new Map<string, Array<{ tt: string; tid: string }>>();
      for (const tg of promoTargets) {
        const arr = targetsByPromo.get(tg.pid) ?? [];
        arr.push({ tt: tg.tt, tid: tg.tid });
        targetsByPromo.set(tg.pid, arr);
      }
      const promo = await applyPromotions(tx, {
        lines: priced.map((p) => ({
          variantId: p.variantId,
          qtyT: qtyToThousandths(p.quantity),
          grossC: p.estimatedCents,
          unitPriceC: p.unitPriceCents,
          ctx: {
            vid: p.variantId,
            pid: p.productId,
            bid: p.brandId,
            cid: p.categoryId,
            pt: p.productType as "PIECE" | "WEIGHT",
            pu: p.unit,
            su: p.sizeUnit,
          },
        })),
        customerId: args.customerId,
        couponCode: args.couponCode ?? null,
        effectivePromos: promoRows.map((r) => ({ ...r, targets: targetsByPromo.get(r.id) ?? [] })),
        categoryTree: promoTreeMap,
      });

      // Deterministic ASC inventory locks (bought + free lines), then
      // atomic conditional reserves — all-or-nothing with the order.
      const reserveLines: Array<{ variantId: string; qtyText: string }> = priced.map((p) => ({
        variantId: p.variantId,
        qtyText: p.quantity,
      }));
      for (const f of promo.freeLines) {
        reserveLines.push({ variantId: f.variantId, qtyText: (f.qtyT / 1000).toFixed(3) });
      }
      const variantIds = orderLockIds(reserveLines.map((l) => l.variantId));
      for (const vid of variantIds) {
        await tx.$queryRaw`SELECT 1 FROM inventory WHERE product_variant_id = ${vid}::uuid FOR UPDATE`;
      }
      for (const vid of variantIds) {
        const qty = reserveLines.find((l) => l.variantId === vid)?.qtyText as string;
        const bumped = await tx.$queryRaw<Array<{ one: number }>>`
          UPDATE inventory SET reserved_quantity = reserved_quantity + ${qty}::numeric
           WHERE product_variant_id = ${vid}::uuid
             AND (quantity - reserved_quantity) >= ${qty}::numeric
          RETURNING 1 AS one`;
        if (bumped.length === 0) {
          throw conflict("Insufficient availability.", { productVariantId: vid });
        }
      }

      const feeCents = await readDeliveryFeeCents(tx);
      // Free-line gross joins the merchandise subtotal (its discount row
      // offsets it inside discount_total — net merchandise unaffected; the
      // frozen discount≤subtotal CHECK requires the gross to be counted).
      const subtotalCents =
        priced.reduce((s, p) => s + p.estimatedCents, 0) +
        promo.freeLines.reduce((s, f) => s + f.estimatedC, 0);
      const discountCents = promo.discountTotalC;
      const totalCents = subtotalCents - discountCents + feeCents;
      const seq = await tx.$queryRaw<Array<{ n: number; d: string }>>`
        SELECT nextval('order_number_seq')::int AS n, to_char(now(), 'YYYYMMDD') AS d`;
      const orderNumber = formatOrderNumber(seq[0].d, seq[0].n);
      const orderId = newUuidV7();
      const customerName = `${customer.firstName}${customer.lastName ? ` ${customer.lastName}` : ""}`.trim();
      await tx.$executeRaw`
        INSERT INTO orders (id, order_number, customer_id, cart_id, idempotency_key,
          status, subtotal_estimated, discount_total, delivery_fee, total_estimated,
          customer_name_snapshot, customer_phone_snapshot,
          delivery_city, delivery_area, delivery_village, delivery_street,
          delivery_building, delivery_landmark, delivery_phone)
        VALUES (${orderId}::uuid, ${orderNumber}, ${args.customerId}::uuid, ${subjectHint.id}::uuid,
          ${args.idempotencyKey}, 'NEW', ${formatPiastres(subtotalCents)}::numeric,
          ${formatPiastres(discountCents)}::numeric,
          ${formatPiastres(feeCents)}::numeric, ${formatPiastres(totalCents)}::numeric,
          ${customerName}, ${customer.phone},
          ${address.city}, ${address.area}, ${address.village}, ${address.street},
          ${address.buildingNumber}, ${address.landmark}, ${address.phone})`;
      // Item rows with direct-discount mirrors (bought lines + free lines);
      // allocation shares bump mirrors afterwards in persistPromoRows.
      const keyToItemId = new Map<string, string>();
      const directDisc = (key: string): number =>
        promo.lineApps.filter((r) => r.key === key).reduce((s, r) => s + r.amountC, 0);
      for (const p of priced) {
        const itemId = newUuidV7();
        keyToItemId.set(p.variantId, itemId);
        await tx.$executeRaw`
          INSERT INTO order_items (id, order_id, product_variant_id,
            product_name_snapshot, variant_name_snapshot, brand_name_snapshot,
            product_code_snapshot, code_type_snapshot, unit_snapshot,
            product_type_snapshot, sale_step_snapshot, unit_price,
            requested_quantity, estimated_total, discount_amount)
          VALUES (${itemId}::uuid, ${orderId}::uuid, ${p.variantId}::uuid,
            ${p.productName}, ${p.variantName}, ${p.brandName},
            ${p.code}, ${p.codeType}, ${p.unit},
            ${p.productType}, ${p.saleStep}, ${p.unitPriceText}::numeric,
            ${p.quantity}::numeric, ${p.estimatedText}::numeric,
            ${formatPiastres(directDisc(p.variantId))}::numeric)`;
      }
      for (const f of promo.freeLines) {
        const itemId = newUuidV7();
        keyToItemId.set(f.tempKey, itemId);
        await tx.$executeRaw`
          INSERT INTO order_items (id, order_id, product_variant_id,
            product_name_snapshot, variant_name_snapshot, brand_name_snapshot,
            product_code_snapshot, code_type_snapshot, unit_snapshot,
            product_type_snapshot, sale_step_snapshot, unit_price,
            requested_quantity, estimated_total, discount_amount)
          VALUES (${itemId}::uuid, ${orderId}::uuid, ${f.variantId}::uuid,
            ${f.productName}, ${f.variantName}, ${f.brandName},
            ${f.code}, ${f.codeType}, ${f.unit},
            ${f.productType}, ${f.saleStep}, ${f.unitPriceText}::numeric,
            ${(f.qtyT / 1000).toFixed(3)}::numeric, ${formatPiastres(f.estimatedC)}::numeric,
            ${formatPiastres(f.amountC)}::numeric)`;
      }
      await persistPromoRows(tx, {
        orderId,
        customerId: args.customerId,
        comp: promo,
        keyToItemId,
      });
      await tx.$executeRaw`
        INSERT INTO order_status_history (id, order_id, old_status, new_status, actor_type, actor_id)
        VALUES (${newUuidV7()}::uuid, ${orderId}::uuid, NULL, 'NEW', 'CUSTOMER', ${args.customerId}::uuid)`;
      await tx.$executeRaw`
        INSERT INTO order_status_history (id, order_id, old_status, new_status, actor_type, actor_id)
        VALUES (${newUuidV7()}::uuid, ${orderId}::uuid, 'NEW', 'CONFIRMED', 'CUSTOMER', ${args.customerId}::uuid)`;
      await tx.$executeRaw`UPDATE orders SET status = 'CONFIRMED' WHERE id = ${orderId}::uuid`;
      await tx.$executeRaw`UPDATE carts SET status = 'CHECKED_OUT' WHERE id = ${subjectHint.id}::uuid`;
      return orderId;
    });
    return { orderId, replay: false };
  } catch (error) {
    if (error instanceof CartConsumedError) {
      // Same-cart race loser: the winner's committed order replays.
      const winner = await findOrderByCart(subjectHint.id);
      if (winner) return { orderId: winner.id, replay: true };
      throw conflict("Cart is no longer available for ordering.", { cartId: subjectHint.id });
    }
    if (error instanceof ApiError) throw error;
    if (pgCodeOf(error) === "23505") {
      // Lost the idempotency INSERT race: reselect + same cart rule.
      const winner = await findOrderByIdempotencyKey(args.idempotencyKey);
      if (winner && winner.cartId === subjectHint.id) return { orderId: winner.id, replay: true };
      throw conflict("Idempotency key was already used with different terms.", { key: args.idempotencyKey });
    }
    throw error;
  }
}

export interface CancelOrderArgs {
  orderId: string;
  actorType: "CUSTOMER" | "STAFF";
  actorId: string;
}

/**
 * Cancel an unpicked order (NEW|CONFIRMED): release every line's reserved
 * quantity (zero movements — frozen §J), append the CANCELLED history row,
 * flip status, one tx (history-first trigger satisfied in-tx). Picked
 * lines (actuals set) belong to fulfillment-gated cancel — 409 here.
 */
export async function cancelOrder(args: CancelOrderArgs): Promise<string> {
  try {
    return await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id::text AS id, status FROM orders WHERE id = ${args.orderId}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new ApiError("NOT_FOUND", "Order not found.", null);
      const status = rows[0].status;
      if (status === "CANCELLED" || status === "DELIVERED") {
        throw conflict(`Order cannot be cancelled from ${status}.`, { status });
      }
      if (status !== "NEW" && status !== "CONFIRMED") {
        throw conflict("Order cannot be cancelled in its current state.", { status });
      }
      const items = await tx.orderItem.findMany({
        where: { orderId: args.orderId },
        orderBy: [{ id: "asc" as const }],
      });
      if (items.some((i) => i.actualQuantity !== null)) {
        throw conflict("Order has picked lines and cannot be cancelled here.", { status });
      }
      // REPLACED originals hold nothing: replacement approval (the only
      // producer of REPLACED, frozen R10) always releases the original hold
      // at approval time. Releasing them again here would double-release and
      // corrupt other lines' holds — so cancel skips them (BA-7 invariant).
      const releasable = items.filter((i) => i.itemStatus !== "REPLACED");
      const variantIds = orderLockIds(releasable.map((i) => i.productVariantId));
      for (const vid of variantIds) {
        await tx.$queryRaw`SELECT 1 FROM inventory WHERE product_variant_id = ${vid}::uuid FOR UPDATE`;
      }
      for (const item of releasable) {
        const qty = item.requestedQuantity.toString();
        const freed = await tx.$queryRaw<Array<{ one: number }>>`
          UPDATE inventory SET reserved_quantity = reserved_quantity - ${qty}::numeric
           WHERE product_variant_id = ${item.productVariantId}::uuid
             AND reserved_quantity >= ${qty}::numeric
          RETURNING 1 AS one`;
        if (freed.length === 0) throw new Error("Reservation invariant broken.");
      }
      // BA-8 counter hygiene (frozen A34): decrement the promo + coupon
      // counters this order consumed. Application rows identify the promos;
      // usage/audit rows stay (liveness derives from order status). No-op
      // for promo-free orders (empty sets, zero behavior change).
      const consumedPromos = await tx.$queryRaw<Array<{ pid: string }>>`
        SELECT DISTINCT promotion_id::text AS pid FROM order_discounts
         WHERE order_id = ${args.orderId}::uuid
           AND kind IN ('PROMOTION_LINE', 'PROMOTION_ORDER', 'COUPON')`;
      for (const pid of orderLockIds(consumedPromos.map((r) => r.pid))) {
        await tx.$executeRaw`UPDATE promotions SET used_count = used_count - 1 WHERE id = ${pid}::uuid`;
      }
      const consumedCoupons = await tx.$queryRaw<Array<{ cid: string }>>`
        SELECT DISTINCT coupon_id::text AS cid FROM coupon_usages WHERE order_id = ${args.orderId}::uuid`;
      for (const cid of orderLockIds(consumedCoupons.map((r) => r.cid))) {
        await tx.$executeRaw`UPDATE coupons SET used_count = used_count - 1 WHERE id = ${cid}::uuid`;
      }
      await tx.$executeRaw`
        INSERT INTO order_status_history (id, order_id, old_status, new_status, actor_type, actor_id, note)
        VALUES (${newUuidV7()}::uuid, ${args.orderId}::uuid, ${status}, 'CANCELLED',
          ${args.actorType}, ${args.actorId}::uuid, 'cancelled before picking')`;
      await tx.$executeRaw`UPDATE orders SET status = 'CANCELLED' WHERE id = ${args.orderId}::uuid`;
      // PRE-BA-11 decision #2: staff cancels pair an audit row in this same
      // tx (customer self-service cancels stay unaudited — not admin
      // mutations — so store behavior is byte-identical).
      if (args.actorType === "STAFF") {
        await auditInTx(tx, {
          action: "orders.cancel",
          userId: args.actorId,
          entityType: "orders",
          entityId: args.orderId,
          oldValues: { status },
          newValues: { status: "CANCELLED" },
        });
      }
      return args.orderId;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw error;
  }
}


