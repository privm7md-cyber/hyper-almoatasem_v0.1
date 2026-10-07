// PHASE 4 order fulfillment + picking (staff-operated, admin RBAC).
//
// Everything here reuses frozen architecture — no new state machine, no new
// inventory semantics, no schema change:
//
// - Transitions follow src/lib/orders/state-machine.ts EXACTLY (the DB
//   triggers/CHECKs stay authoritative; canTransition fails fast 409).
//   Allowed here: CONFIRMED→PREPARING, PREPARING→READY_FOR_DELIVERY (gated),
//   READY_FOR_DELIVERY→OUT_FOR_DELIVERY, OUT_FOR_DELIVERY→DELIVERED.
//   Cancel keeps its own path (cancelOrder, widened to PREPARING-unpicked).
// - Picking follows the frozen R7 envelope (contract §5): actual ≤
//   requested + tolerance (WEIGHT = MAX(1 sale_step, 10% requested),
//   PIECE = 0; envelopeAllows, integer thousandths). Case A (actual ≤
//   requested): commit actual, release full hold, SALE(actual), FULFILLED
//   iff equal else PARTIALLY_FULFILLED. Case B (requested < actual ≤
//   envelope): commit, no extra reservation, FULFILLED. Case C (breach):
//   422, nothing written. Stock-short at commit: 409 (operator re-cuts or
//   marks unavailable — never silent auto-cap).
// - Commit shape mirrors inventory/service.ts commitStock (quantity -=
//   actual, reserved -= requested, R3 predicate, SALE movement with prev
//   from the locked row). Implemented inline per the repo local-copy
//   convention (previous BA modules are not modified for reuse); the admin
//   inventory/commit primitive itself is untouched.
// - Money follows the frozen orders contract (§8): final_total =
//   ROUND(actual × unit_price) per picked line (DB re-verifies); 0 for
//   UNAVAILABLE/REPLACED originals at finalization; discount_total is NEVER
//   rewritten; total_final = sub_final − LEAST(discount_total, sub_final)
//   + deliveryFee, stored at READY.
// - READY gate: zero PENDING lines AND zero PROPOSED replacements (live
//   proposal rows). UNAVAILABLE lines without a substitute ship short
//   (final 0) — blocking READY on them would strand orders that can no
//   longer cancel (picked lines 409), so short-shipment is the coherent
//   rule; replacements already gave the customer the choice.
// - Every mutation: order row FOR UPDATE first, inventory ASC, history row
//   BEFORE the status flip (history-first trigger), staff audit paired in
//   the same tx. Actor always server-derived (admin id); no client actor,
//   no customerId anywhere.
import "server-only";
import { prisma } from "@/lib/db";
import { ApiError, businessRule, conflict } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";
import { orderLockIds } from "@/lib/api/concurrency";
import { canTransition } from "@/lib/orders/state-machine";
import { newUuidV7 } from "@/lib/orders/writes";
import { envelopeAllows, qtyToThousandths } from "@/lib/inventory/quantities";
import {
  formatPiastres,
  lineTotalPiastres,
  priceToPiastres,
} from "@/lib/cart/totals";

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

/** Frozen guard mapping (mirrors inventory/service.ts mapGuardError):
 * CHECK race losers → 409 (never 500); deadlocks → retryable 409. */
function mapGuardError(error: unknown): never {
  const code = pgCodeOf(error);
  if (code === "23514") {
    throw conflict("Insufficient stock for this operation.", null);
  }
  if (code === "40P01" || code === "40001") {
    throw conflict("Concurrent modification; re-read and retry.", null);
  }
  throw error;
}

/** Transitions this module performs (READY goes through the gate below). */
const ADVANCE_TARGETS = [
  "PREPARING",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
] as const;

export type AdvanceTarget = (typeof ADVANCE_TARGETS)[number];

/**
 * Guarded status advance (CONFIRMED→PREPARING, READY_FOR_DELIVERY→
 * OUT_FOR_DELIVERY, OUT_FOR_DELIVERY→DELIVERED). Illegal/repeat/backward →
 * 409. History + status + audit commit atomically.
 */
export async function advanceOrder(args: {
  orderId: string;
  to: AdvanceTarget;
  actorId: string;
}): Promise<string> {
  if (!(ADVANCE_TARGETS as readonly string[]).includes(args.to)) {
    throw new ApiError("VALIDATION", "Invalid fulfillment transition.", null);
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id::text AS id, status FROM orders WHERE id = ${args.orderId}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new ApiError("NOT_FOUND", "Order not found.", null);
      const from = rows[0].status;
      if (!canTransition(from, args.to)) {
        throw conflict(`Order cannot move from ${from} to ${args.to}.`, { from, to: args.to });
      }
      await tx.$executeRaw`
        INSERT INTO order_status_history (id, order_id, old_status, new_status, actor_type, actor_id)
        VALUES (${newUuidV7()}::uuid, ${args.orderId}::uuid, ${from}, ${args.to}, 'STAFF', ${args.actorId}::uuid)`;
      await tx.$executeRaw`UPDATE orders SET status = ${args.to} WHERE id = ${args.orderId}::uuid`;
      await auditInTx(tx, {
        action: "orders.advance",
        userId: args.actorId,
        entityType: "orders",
        entityId: args.orderId,
        oldValues: { status: from },
        newValues: { status: args.to },
      });
      return args.orderId;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    mapGuardError(error);
  }
}

interface PickLineRow {
  id: string;
  product_variant_id: string;
  requested_quantity: string;
  actual_quantity: string | null;
  unit_price: string;
  product_type_snapshot: string;
  sale_step_snapshot: number | null;
  unit_snapshot: string;
  item_status: string;
}

/**
 * Pick one PENDING line (PREPARING orders only): validate the weighed fact,
 * write actual + final_total + FULFILLED/PARTIALLY_FULFILLED, commit stock
 * (quantity -= actual, reserved -= requested, R3 predicate) + SALE(-actual)
 * movement, one tx. Envelope breach → 422 (nothing written); stock-short →
 * 409 (re-cut or mark unavailable). Repeat pick on a decided line → 409.
 */
export async function pickOrderLine(args: {
  orderId: string;
  itemId: string;
  actualQuantity: string;
  actorId: string;
}): Promise<string> {
  try {
    return await prisma.$transaction(async (tx) => {
      const orders = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id::text AS id, status FROM orders WHERE id = ${args.orderId}::uuid FOR UPDATE`;
      if (orders.length === 0) throw new ApiError("NOT_FOUND", "Order not found.", null);
      if (orders[0].status !== "PREPARING") {
        throw conflict(`Order cannot be picked in ${orders[0].status}.`, { status: orders[0].status });
      }
      const lines = await tx.$queryRaw<PickLineRow[]>`
        SELECT id::text AS id, product_variant_id::text AS product_variant_id,
          requested_quantity::text AS requested_quantity,
          actual_quantity::text AS actual_quantity,
          unit_price::text AS unit_price,
          product_type_snapshot, sale_step_snapshot, unit_snapshot, item_status
          FROM order_items WHERE id = ${args.itemId}::uuid AND order_id = ${args.orderId}::uuid FOR UPDATE`;
      if (lines.length === 0) throw new ApiError("NOT_FOUND", "Order line not found.", null);
      const line = lines[0];
      if (line.item_status !== "PENDING") {
        throw conflict("Order line is already resolved.", { itemStatus: line.item_status });
      }
      const requested = line.requested_quantity;
      const actual = args.actualQuantity;
      if (qtyToThousandths(actual) <= 0) {
        throw businessRule("Picked quantity must be positive.", null);
      }
      if (
        !envelopeAllows(requested, actual, line.product_type_snapshot, line.sale_step_snapshot, line.unit_snapshot)
      ) {
        throw businessRule("Actual quantity exceeds the fulfillment envelope.", null);
      }
      const finalCents = lineTotalPiastres(actual, line.unit_price);
      if (finalCents === null) throw new ApiError("INTERNAL", "Unexpected error.", null, false);
      const finalText = formatPiastres(finalCents);
      const status = qtyToThousandths(actual) === qtyToThousandths(requested) ? "FULFILLED" : "PARTIALLY_FULFILLED";
      // R3 commit (mirrors inventory/service.ts commitStock): quantity -=
      // actual, reserved -= requested (full hold released in both R7 cases),
      // predicate (quantity - reserved + requested) >= actual, rowcount-checked.
      const locked = await tx.$queryRaw<Array<{ id: string; quantity: string }>>`
        SELECT id::text AS id, quantity::text AS quantity FROM inventory
         WHERE product_variant_id = ${line.product_variant_id}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new ApiError("NOT_FOUND", "Inventory not found.", null);
      const updated = await tx.$queryRaw<Array<{ nq: string }>>`
        UPDATE inventory
           SET quantity = quantity - ${actual}::numeric,
               reserved_quantity = reserved_quantity - ${requested}::numeric
         WHERE product_variant_id = ${line.product_variant_id}::uuid
           AND (quantity - reserved_quantity + ${requested}::numeric) >= ${actual}::numeric
        RETURNING quantity::text AS nq`;
      if (updated.length === 0) {
        throw conflict("Insufficient stock to commit.", { productVariantId: line.product_variant_id });
      }
      const next = updated[0].nq;
      const prevThousandths = qtyToThousandths(next) + qtyToThousandths(actual);
      const prev = (prevThousandths / 1000).toFixed(3);
      const negActual = (-qtyToThousandths(actual) / 1000).toFixed(3);
      await tx.$executeRaw`
        INSERT INTO inventory_movements
          (id, product_variant_id, movement_type, quantity, previous_quantity,
           new_quantity, reference_type, reference_id, reason, created_by)
        VALUES (${newUuidV7()}::uuid, ${line.product_variant_id}::uuid, 'SALE',
          ${negActual}::numeric, ${prev}::numeric, ${next}::numeric,
          'ORDER'::varchar, ${args.orderId}::varchar,
          'fulfillment pick'::text, ${args.actorId}::uuid)`;
      await tx.$executeRaw`
        UPDATE order_items
           SET actual_quantity = ${actual}::numeric,
               final_total = ${finalText}::numeric,
               item_status = ${status}
         WHERE id = ${args.itemId}::uuid`;
      await auditInTx(tx, {
        action: "orders.pick",
        userId: args.actorId,
        entityType: "order_items",
        entityId: args.itemId,
        oldValues: { itemStatus: "PENDING", requestedQuantity: requested },
        newValues: { itemStatus: status, actualQuantity: actual, finalTotal: finalText },
      });
      return args.itemId;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    mapGuardError(error);
  }
}

/**
 * Mark one PENDING line unavailable (OOS with no stock to pick): flips to
 * UNAVAILABLE (actual stays NULL), one tx. The line's hold is NOT released
 * here — the frozen replacement flow releases the original hold at approve
 * time, and releasing here would double-release on that path (negative
 * reserved). Unsubstituted UNAVAILABLE holds are released at READY
 * (finishPreparation), substituted originals at approve. A rejected/absent
 * substitute leaves the line short-shipped (final 0 at READY).
 */
export async function markLineUnavailable(args: {
  orderId: string;
  itemId: string;
  actorId: string;
}): Promise<string> {
  try {
    return await prisma.$transaction(async (tx) => {
      const orders = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id::text AS id, status FROM orders WHERE id = ${args.orderId}::uuid FOR UPDATE`;
      if (orders.length === 0) throw new ApiError("NOT_FOUND", "Order not found.", null);
      if (orders[0].status !== "PREPARING") {
        throw conflict(`Order cannot be picked in ${orders[0].status}.`, { status: orders[0].status });
      }
      const lines = await tx.$queryRaw<
        Array<{ id: string; product_variant_id: string; requested_quantity: string; item_status: string }>
      >`
        SELECT id::text AS id, product_variant_id::text AS product_variant_id,
          requested_quantity::text AS requested_quantity, item_status
          FROM order_items WHERE id = ${args.itemId}::uuid AND order_id = ${args.orderId}::uuid FOR UPDATE`;
      if (lines.length === 0) throw new ApiError("NOT_FOUND", "Order line not found.", null);
      const line = lines[0];
      if (line.item_status !== "PENDING") {
        throw conflict("Order line is already resolved.", { itemStatus: line.item_status });
      }
      await tx.$executeRaw`
        UPDATE order_items SET item_status = 'UNAVAILABLE' WHERE id = ${args.itemId}::uuid`;
      await auditInTx(tx, {
        action: "orders.pick",
        userId: args.actorId,
        entityType: "order_items",
        entityId: args.itemId,
        oldValues: { itemStatus: "PENDING" },
        newValues: { itemStatus: "UNAVAILABLE" },
      });
      return args.itemId;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    mapGuardError(error);
  }
}

interface ReadyLine {
  id: string;
  product_variant_id: string;
  requested_quantity: string;
  item_status: string;
  actual_quantity: string | null;
  final_total: string | null;
  unit_price: string;
}

/**
 * Finish preparation: PREPARING → READY_FOR_DELIVERY behind the READY gate
 * (zero PENDING lines, zero PROPOSED replacements), finalizing money
 * (UNAVAILABLE/REPLACED/CANCELLED lines finalize at 0; picked lines
 * already carry final_total) and storing subtotalFinal/totalFinal.
 * totalFinal = subFinal − LEAST(discount_total, subFinal) + deliveryFee
 * (discount_total is READ, never rewritten — amended R19). Atomic.
 */
export async function finishPreparation(args: { orderId: string; actorId: string }): Promise<string> {
  try {
    return await prisma.$transaction(async (tx) => {
      const orders = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id::text AS id, status FROM orders WHERE id = ${args.orderId}::uuid FOR UPDATE`;
      if (orders.length === 0) throw new ApiError("NOT_FOUND", "Order not found.", null);
      if (orders[0].status !== "PREPARING") {
        throw conflict(`Order cannot be readied from ${orders[0].status}.`, { status: orders[0].status });
      }
      const lines = await tx.$queryRaw<ReadyLine[]>`
        SELECT id::text AS id, product_variant_id::text AS product_variant_id,
          requested_quantity::text AS requested_quantity, item_status,
          actual_quantity::text AS actual_quantity,
          final_total::text AS final_total,
          unit_price::text AS unit_price
          FROM order_items WHERE order_id = ${args.orderId}::uuid ORDER BY id ASC FOR UPDATE`;
      if (lines.some((l) => l.item_status === "PENDING")) {
        throw conflict("Order has unresolved lines.", null);
      }
      const openReps = await tx.$queryRaw<Array<{ one: number }>>`
        SELECT 1 AS one FROM order_item_replacements r
          JOIN order_items oi ON oi.id = r.order_item_id
         WHERE oi.order_id = ${args.orderId}::uuid AND r.status = 'PROPOSED' LIMIT 1`;
      if (openReps.length > 0) {
        throw conflict("Order has undecided replacements.", null);
      }
      // Unsubstituted UNAVAILABLE lines still hold their requested quantity
      // (markUnavailable releases nothing — approve does for substituted
      // originals, which are REPLACED by READY time). Release them here so
      // no hold survives finalization.
      const shortLines = lines.filter((l) => l.item_status === "UNAVAILABLE");
      for (const vid of orderLockIds(shortLines.map((l) => l.product_variant_id))) {
        await tx.$queryRaw`SELECT 1 FROM inventory WHERE product_variant_id = ${vid}::uuid FOR UPDATE`;
      }
      for (const line of shortLines) {
        const freed = await tx.$queryRaw<Array<{ one: number }>>`
          UPDATE inventory SET reserved_quantity = reserved_quantity - ${line.requested_quantity}::numeric
           WHERE product_variant_id = ${line.product_variant_id}::uuid
             AND reserved_quantity >= ${line.requested_quantity}::numeric
          RETURNING 1 AS one`;
        if (freed.length === 0) throw new Error("Reservation invariant broken.");
      }
      let subFinal = 0;
      for (const line of lines) {
        // Lines without a final_total (UNAVAILABLE short-ship, REPLACED
        // originals, CANCELLED) contribute zero and are LEFT NULL: the
        // frozen chk_items_final_math forbids final_total without an
        // actual_quantity (final = ROUND(actual × price)). Picked lines
        // already carry their exact final_total from pick time.
        if (line.final_total !== null) {
          subFinal += priceToPiastres(line.final_total);
        }
      }
      const order = await tx.$queryRaw<
        Array<{ discount_total: string; delivery_fee: string }>
      >`
        SELECT discount_total::text AS discount_total, delivery_fee::text AS delivery_fee
          FROM orders WHERE id = ${args.orderId}::uuid`;
      const discount = priceToPiastres(order[0].discount_total);
      const delivery = priceToPiastres(order[0].delivery_fee);
      const totalFinal = subFinal - Math.min(discount, subFinal) + delivery;
      await tx.$executeRaw`
        UPDATE orders
           SET subtotal_final = ${formatPiastres(subFinal)}::numeric,
               total_final = ${formatPiastres(totalFinal)}::numeric
         WHERE id = ${args.orderId}::uuid`;
      await tx.$executeRaw`
        INSERT INTO order_status_history (id, order_id, old_status, new_status, actor_type, actor_id)
        VALUES (${newUuidV7()}::uuid, ${args.orderId}::uuid, 'PREPARING', 'READY_FOR_DELIVERY', 'STAFF', ${args.actorId}::uuid)`;
      await tx.$executeRaw`UPDATE orders SET status = 'READY_FOR_DELIVERY' WHERE id = ${args.orderId}::uuid`;
      await auditInTx(tx, {
        action: "orders.ready",
        userId: args.actorId,
        entityType: "orders",
        entityId: args.orderId,
        oldValues: { status: "PREPARING" },
        newValues: { status: "READY_FOR_DELIVERY", subtotalFinal: formatPiastres(subFinal), totalFinal: formatPiastres(totalFinal) },
      });
      return args.orderId;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    mapGuardError(error);
  }
}
