// BA-7 replacement write domain (propose / decide / withdraw / auto-accept).
//
// Frozen R10, transactionally exact: lock order → validate state → lock
// affected rows in deterministic ASC order → mutate → commit; any failure
// rolls back everything (no partial proposal/approval/order mutation).
// Link-never-overwrite: the original line is NEVER edited except its
// trigger-whitelisted status flip (PENDING|UNAVAILABLE → REPLACED); the
// substitute arrives as a NEW order_items row linked by
// replacement_order_item_id strictly after it exists.
// Inventory reuses the BA-3 predicate text verbatim (reserve substitute,
// release original hold, zero movements — frozen §J), executed on the
// ambient tx because R10 demands ONE atomic transaction (BA-3's own
// functions open their own tx and cannot be nested — documented, not
// redesigned). Raw SQL owns locks, atomic bumps, and guarded updates;
// Prisma owns representable reads/writes. Errors are caught OUTSIDE any
// tx (never continue a poisoned transaction — BA-5 lesson).
import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, businessRule, conflict } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";
import { orderLockIds } from "@/lib/api/concurrency";
import { preConsentCovers } from "@/lib/replacements/state-machine";
import {
  formatPiastres,
  lineTotalPiastres,
  priceToPiastres,
  qtyToThousandths,
} from "@/lib/cart/totals";

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

/** Order must be in a replacement-workable state (proposing/deciding
 * happens on CONFIRMED|PREPARING; picking owns the rest). */
function assertWorkableOrderStatus(status: string): void {
  if (status !== "CONFIRMED" && status !== "PREPARING") {
    throw conflict(`Order cannot take replacement actions in ${status}.`, { status });
  }
}

/** Substitute shape gate: BA-6 line discipline (sellable + whole packs /
 * step multiples + counting-unit pin). Propose-time failures are semantic
 * (422); approval-time liveness loss is a state race (409) — callers map. */
function substituteUnit(
  productType: string,
  sizeUnit: string | null,
  saleStep: number | null,
  quantity: string,
): string {
  if (productType === "PIECE") {
    if (qtyToThousandths(quantity) % 1000 !== 0) {
      throw businessRule("Piece quantity must be whole packs.", null);
    }
    return "PIECE";
  }
  if (saleStep === null || saleStep <= 0 || !sizeUnit) {
    throw businessRule("Weight product is missing its sale step.", null);
  }
  const t = qtyToThousandths(quantity);
  const stepThousandths = sizeUnit === "GRAM" ? saleStep * 1000 : saleStep;
  if (t % stepThousandths !== 0) {
    throw businessRule("Weight quantity violates the sale step.", null);
  }
  return sizeUnit;
}

interface SubstituteCtx {
  variantId: string;
  quantity: string;
  variantName: string;
  productName: string;
  brandName: string | null;
  code: string | null;
  codeType: string | null;
  unit: string;
  productType: string;
  saleStep: number | null;
  priceText: string;
  priceCents: number;
}

async function loadSubstitute(
  tx: Prisma.TransactionClient,
  variantId: string,
  quantity: string,
  onStale: () => never,
): Promise<SubstituteCtx> {
  const v = await tx.productVariant.findUnique({
    where: { id: variantId },
    include: { product: { include: { brand: { select: { name: true } } } } },
  });
  if (!v) throw new ApiError("NOT_FOUND", "Substitute variant not found.", null);
  if (!v.isActive || v.deletedAt !== null) onStale();
  const unit = substituteUnit(v.product.productType, v.sizeUnit, v.product.saleStepGrams, quantity);
  const code = await tx.$queryRaw<Array<{ code: string; type: string }>>`
    SELECT code, type FROM product_codes
     WHERE product_variant_id = ${variantId}::uuid AND is_primary`;
  return {
    variantId,
    quantity,
    variantName: v.name,
    productName: v.product.name,
    brandName: v.product.brand?.name ?? null,
    code: code.length === 0 ? null : code[0].code,
    codeType: code.length === 0 ? null : code[0].type,
    unit,
    productType: v.product.productType,
    saleStep: v.product.saleStepGrams,
    priceText: v.price.toString(),
    priceCents: priceToPiastres(v.price.toString()),
  };
}

export interface ProposeArgs {
  orderId: string;
  orderItemId: string;
  replacementVariantId: string;
  replacementQuantity: string;
  reason: string | null;
  markUnavailable: boolean;
  proposerType: "STAFF" | "SYSTEM";
  proposerId: string | null;
}

/**
 * Propose a substitute for one line (STAFF in BA-7; no SYSTEM proposer
 * engine exists). OOS-driven by default (PENDING→UNAVAILABLE same-tx);
 * swap mode keeps PENDING. Sequential re-proposals allowed on UNAVAILABLE
 * originals. Lost open-proposal races (partial UQ) → 409.
 */
export async function proposeReplacement(args: ProposeArgs): Promise<string> {
  try {
    return await prisma.$transaction(async (tx) => {
      const orders = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM orders WHERE id = ${args.orderId}::uuid FOR UPDATE`;
      if (orders.length === 0) throw new ApiError("NOT_FOUND", "Order not found.", null);
      assertWorkableOrderStatus(orders[0].status);

      const items = await tx.$queryRaw<
        Array<{ id: string; item_status: string; actual: string | null; est: string; req: string }>
      >`
        SELECT id::text AS id, item_status, actual_quantity::text AS actual,
          estimated_total::text AS est, requested_quantity::text AS req
          FROM order_items WHERE id = ${args.orderItemId}::uuid AND order_id = ${args.orderId}::uuid FOR UPDATE`;
      if (items.length === 0) throw new ApiError("NOT_FOUND", "Order item not found.", null);
      const item = items[0];
      if (item.actual !== null) {
        throw conflict("Picked lines belong to fulfillment.", { itemStatus: item.item_status });
      }
      const flip = item.item_status === "PENDING" && args.markUnavailable;
      if (item.item_status !== "PENDING" && item.item_status !== "UNAVAILABLE") {
        throw conflict("Line cannot take a replacement proposal.", { itemStatus: item.item_status });
      }

      const sub = await loadSubstitute(tx, args.replacementVariantId, args.replacementQuantity, () => {
        throw businessRule("Substitute variant is not sellable.", null);
      });
      const diffCents =
        (lineTotalPiastres(args.replacementQuantity, sub.priceText) as number) -
        priceToPiastres(item.est);

      if (flip) {
        await tx.$executeRaw`
          UPDATE order_items SET item_status = 'UNAVAILABLE' WHERE id = ${args.orderItemId}::uuid`;
      }
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO order_item_replacements (id, order_item_id, replacement_variant_id,
          replacement_quantity, replacement_unit_price, price_difference, reason,
          status, proposed_by_type, proposed_by_id)
        VALUES (${newUuidV7()}::uuid, ${args.orderItemId}::uuid, ${args.replacementVariantId}::uuid,
          ${args.replacementQuantity}::numeric, ${sub.priceText}::numeric,
          ${formatPiastres(diffCents)}::numeric, ${args.reason}::text,
          'PROPOSED', ${args.proposerType}, ${args.proposerId}::uuid)
        RETURNING id::text AS id`;
      // PRE-BA-11 decision #2: staff proposals pair an audit row in this
      // same tx (no SYSTEM proposer engine exists frozen; only the STAFF
      // admin surface audits).
      if (args.proposerType === "STAFF" && args.proposerId !== null) {
        await auditInTx(tx, {
          action: "replacements.propose",
          userId: args.proposerId,
          entityType: "order_item_replacements",
          entityId: rows[0].id,
          oldValues: null,
          newValues: { orderItemId: args.orderItemId, status: "PROPOSED" },
        });
      }
      return rows[0].id;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (pgCodeOf(error) === "23505") {
      throw conflict("A proposal is already open for this line.", { orderItemId: args.orderItemId });
    }
    throw error;
  }
}

interface ApprovalContext {
  replacementId: string;
  orderId: string;
  orderItemId: string;
  origVariantId: string;
  origRequested: string;
  sub: SubstituteCtx;
}

/** Shared R10 materialization on an open tx (locks already held by the
 * caller path): reserve substitute (BA-3 predicate) → release original
 * hold → insert linked line → link + decide → original REPLACED. */
async function approveSteps(
  tx: Prisma.TransactionClient,
  ctx: ApprovalContext,
  status: "CUSTOMER_APPROVED" | "AUTO_ACCEPTED",
  deciderType: "CUSTOMER" | "SYSTEM",
  deciderId: string,
): Promise<void> {
  for (const vid of orderLockIds([ctx.origVariantId, ctx.sub.variantId])) {
    await tx.$queryRaw`SELECT 1 FROM inventory WHERE product_variant_id = ${vid}::uuid FOR UPDATE`;
  }
  const bumped = await tx.$queryRaw<Array<{ one: number }>>`
    UPDATE inventory SET reserved_quantity = reserved_quantity + ${ctx.sub.quantity}::numeric
     WHERE product_variant_id = ${ctx.sub.variantId}::uuid
       AND (quantity - reserved_quantity) >= ${ctx.sub.quantity}::numeric
    RETURNING 1 AS one`;
  if (bumped.length === 0) {
    throw conflict("Insufficient availability for the substitute.", { variantId: ctx.sub.variantId });
  }
  await tx.$executeRaw`
    UPDATE inventory SET reserved_quantity = reserved_quantity - ${ctx.origRequested}::numeric
     WHERE product_variant_id = ${ctx.origVariantId}::uuid`;
  const lineId = newUuidV7();
  const estimatedText = formatPiastres(
    lineTotalPiastres(ctx.sub.quantity, ctx.sub.priceText) as number,
  );
  await tx.$executeRaw`
    INSERT INTO order_items (id, order_id, product_variant_id,
      product_name_snapshot, variant_name_snapshot, brand_name_snapshot,
      product_code_snapshot, code_type_snapshot, unit_snapshot,
      product_type_snapshot, sale_step_snapshot, unit_price,
      requested_quantity, estimated_total)
    VALUES (${lineId}::uuid, ${ctx.orderId}::uuid, ${ctx.sub.variantId}::uuid,
      ${ctx.sub.productName}, ${ctx.sub.variantName}, ${ctx.sub.brandName},
      ${ctx.sub.code}, ${ctx.sub.codeType}, ${ctx.sub.unit},
      ${ctx.sub.productType}, ${ctx.sub.saleStep}, ${ctx.sub.priceText}::numeric,
      ${ctx.sub.quantity}::numeric, ${estimatedText}::numeric)`;
  await tx.$executeRaw`
    UPDATE order_item_replacements
       SET status = ${status}, decided_by_type = ${deciderType},
           decided_by_id = ${deciderId}::uuid, replacement_order_item_id = ${lineId}::uuid
     WHERE id = ${ctx.replacementId}::uuid`;
  await tx.$executeRaw`
    UPDATE order_items SET item_status = 'REPLACED' WHERE id = ${ctx.orderItemId}::uuid`;
}

async function loadApprovalContext(
  tx: Prisma.TransactionClient,
  replacementId: string,
  expectedOrderId: string | null,
): Promise<ApprovalContext> {
  const reps = await tx.$queryRaw<
    Array<{
      id: string;
      order_id: string;
      order_item_id: string;
      status: string;
      rep_variant: string;
      rep_qty: string;
      orig_variant: string;
      orig_req: string;
      orig_actual: string | null;
      orig_status: string;
    }>
  >`
    SELECT r.id::text AS id, oi.order_id::text AS order_id, r.order_item_id::text AS order_item_id,
      r.status, r.replacement_variant_id::text AS rep_variant, r.replacement_quantity::text AS rep_qty,
      oi.product_variant_id::text AS orig_variant, oi.requested_quantity::text AS orig_req,
      oi.actual_quantity::text AS orig_actual, oi.item_status AS orig_status
      FROM order_item_replacements r JOIN order_items oi ON oi.id = r.order_item_id
     WHERE r.id = ${replacementId}::uuid FOR UPDATE OF r`;
  if (reps.length === 0) throw new ApiError("NOT_FOUND", "Replacement not found.", null);
  const rep = reps[0];
  if (expectedOrderId !== null && rep.order_id !== expectedOrderId) {
    throw new ApiError("NOT_FOUND", "Replacement not found.", null);
  }
  const orders = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM orders WHERE id = ${rep.order_id}::uuid FOR UPDATE`;
  if (orders.length === 0) throw new ApiError("NOT_FOUND", "Order not found.", null);
  assertWorkableOrderStatus(orders[0].status);
  if (rep.status !== "PROPOSED") {
    throw conflict("Replacement is no longer open.", { status: rep.status });
  }
  if (rep.orig_actual !== null || (rep.orig_status !== "PENDING" && rep.orig_status !== "UNAVAILABLE")) {
    throw conflict("Original line cannot be replaced now.", { itemStatus: rep.orig_status });
  }
  await tx.$queryRaw`
    SELECT 1 FROM order_items WHERE id = ${rep.order_item_id}::uuid FOR UPDATE`;
  const sub = await loadSubstitute(tx, rep.rep_variant, rep.rep_qty, () => {
    throw conflict("Substitute is no longer sellable.", null);
  });
  return {
    replacementId: rep.id,
    orderId: rep.order_id,
    orderItemId: rep.order_item_id,
    origVariantId: rep.orig_variant,
    origRequested: rep.orig_req,
    sub,
  };
}

export interface DecideArgs {
  replacementId: string;
  expectedOrderId: string | null;
  outcome: "approve" | "reject";
  deciderType: "CUSTOMER" | "STAFF";
  deciderId: string;
}

/**
 * Customer/staff decision on an open proposal. Approve runs full R10
 * materialization (CUSTOMER_APPROVED); reject flips to CUSTOMER_REJECTED
 * with no inventory effect (proposal held none). Double decisions,
 * approve-vs-reject races, and decided-then-replayed calls all land 409
 * via the PROPOSED gate (never silent, never partial).
 */
export async function decideReplacement(args: DecideArgs): Promise<string> {
  // Frozen actor semantics: approval is an explicit CUSTOMER decision;
  // staff may only withdraw (reject). Enforced in-domain, not just routes.
  if (args.outcome === "approve" && args.deciderType !== "CUSTOMER") {
    throw businessRule("Only the customer can approve a replacement.", null);
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const ctx = await loadApprovalContext(tx, args.replacementId, args.expectedOrderId);
      if (args.outcome === "reject") {
        const status = "CUSTOMER_REJECTED";
        await tx.$executeRaw`
          UPDATE order_item_replacements
             SET status = ${status}, decided_by_type = ${args.deciderType},
                 decided_by_id = ${args.deciderId}::uuid
           WHERE id = ${args.replacementId}::uuid`;
        // PRE-BA-11 decision #2: staff withdrawals (the admin surface)
        // pair an audit row in this same tx; customer self-service
        // decisions stay unaudited (store behavior byte-identical).
        if (args.deciderType === "STAFF") {
          await auditInTx(tx, {
            action: "replacements.withdraw",
            userId: args.deciderId,
            entityType: "order_item_replacements",
            entityId: args.replacementId,
            oldValues: { status: "PROPOSED" },
            newValues: { status },
          });
        }
        return args.replacementId;
      }
      // Narrowed by the entry guard: approve implies CUSTOMER decider.
      await approveSteps(tx, ctx, "CUSTOMER_APPROVED", "CUSTOMER", args.deciderId);
      return args.replacementId;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw error;
  }
}

export interface AutoAcceptArgs {
  replacementId: string;
  executorAdminId: string;
}

/**
 * R5 pre-consent evaluation + SYSTEM approval. Covered ⟺ the owning
 * customer has auto_accept_replacements AND the signed delta spends
 * within caps (≤0, or ≤10% of the original estimate AND ≤50 EGP — exact
 * integers). Uncovered → 422 (explicit approval required instead).
 * Records decided_by SYSTEM with the executing admin's id: the frozen
 * CHECK demands a non-null decider id on terminal rows, and no system
 * user row exists (the reference double's SYSTEM+NULL pair would violate
 * chk_repl_decided — never executed frozen; resolved here, documented).
 */
export async function autoAcceptReplacement(args: AutoAcceptArgs): Promise<string> {
  try {
    return await prisma.$transaction(async (tx) => {
      const ctx = await loadApprovalContext(tx, args.replacementId, null);
      const cust = await tx.$queryRaw<Array<{ consent: boolean; diff: string; est: string }>>`
        SELECT c.auto_accept_replacements AS consent,
          r.price_difference::text AS diff, oi.estimated_total::text AS est
          FROM order_item_replacements r
          JOIN order_items oi ON oi.id = r.order_item_id
          JOIN orders o ON o.id = oi.order_id
          JOIN customers c ON c.id = o.customer_id
         WHERE r.id = ${args.replacementId}::uuid`;
      const row = cust[0];
      const covered = preConsentCovers(
        row.consent === true,
        priceToPiastres(row.diff),
        priceToPiastres(row.est),
      );
      if (!covered) {
        throw businessRule("Pre-consent does not cover this replacement.", null);
      }
      await approveSteps(tx, ctx, "AUTO_ACCEPTED", "SYSTEM", args.executorAdminId);
      // PRE-BA-11 decision #2: auto-accept runs on the admin surface, so
      // its R10 materialization pairs an audit row in this same tx (no
      // double release/reservation — one INSERT after approveSteps).
      await auditInTx(tx, {
        action: "replacements.auto_accept",
        userId: args.executorAdminId,
        entityType: "order_item_replacements",
        entityId: args.replacementId,
        oldValues: { status: "PROPOSED" },
        newValues: { status: "AUTO_ACCEPTED" },
      });
      return args.replacementId;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw error;
  }
}
