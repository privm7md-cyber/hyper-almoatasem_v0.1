// BA-5 cart write domain.
//
// Frozen rules enforced here (mirrored, DB remains sole enforcer):
// - Ownership XOR (exactly one owner kind; enforced per request + DB CHECK).
// - Draft only: carts NEVER reserve inventory (no BA-3 reserve call exists
//   anywhere in this module — availability is BA-6 checkout's job).
// - Quote semantics: unit_snapshot per the counting-unit pin (PIECE lines
//   count packs as 'PIECE', WEIGHT lines count the live size_unit),
//   unit_price_snapshot = live variant price at write time,
//   price_checked_at = now(). Re-add aggregates; merge sums + reprices.
// - Quantity: >0 (CHECK), PIECE whole packs, WEIGHT step multiples —
//   integer-thousandths math, never float.
// - Merge = the frozen R1 reference (reassign when the customer holds no
//   ACTIVE cart, else per-line sum + live reprice with dead-variant drops,
//   guest → MERGED, carts locked ASC, one tx).
// Prisma owns inserts/updates/deletes; raw SQL owns only row locks
// (SELECT … FOR UPDATE — inexpressible in Prisma) and the guest-expiry
// default (SQL clock). IDs are app-generated UUIDv7.
import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, businessRule, conflict } from "@/lib/api/errors";
import { orderLockIds } from "@/lib/api/concurrency";
import { hashGuestToken, mintGuestToken } from "@/lib/cart/session";
import { qtyToThousandths } from "@/lib/cart/totals";
import {
  findActiveCartByOwner,
  getCartFull,
  getVariantSaleContext,
  type CartOwner,
  type VariantSaleContext,
} from "@/lib/cart/queries";

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
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return true;
  // Raw-statement failures arrive as P2010 with the PostgreSQL code nested
  // at meta.driverAdapterError.cause (BA-3 lesson — never match P2010 blindly).
  const nested = (
    error as {
      meta?: { driverAdapterError?: { cause?: { code?: unknown; originalCode?: unknown } } };
    }
  ).meta?.driverAdapterError?.cause;
  const code = nested?.code ?? nested?.originalCode;
  return code === "23505";
}

function isNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

/** Customer must exist (404) and be usable (422 when inactive/deleted —
 * checkout revalidates the same way; lookup alone never enforces). */
export async function assertCustomerUsable(customerId: string) {
  const row = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, isActive: true, deletedAt: true },
  });
  if (!row) throw new ApiError("NOT_FOUND", "Customer not found.", null);
  if (!row.isActive || row.deletedAt !== null) {
    throw businessRule("Customer is not active.", null);
  }
}

/** Counting-unit pin (frozen A11/A12): PIECE lines count packs ('PIECE'),
 * WEIGHT lines count the live size_unit. */
export function countingUnitFor(ctx: VariantSaleContext): string {
  if (ctx.product.productType === "WEIGHT") {
    if (!ctx.sizeUnit) throw businessRule("Variant has no sale unit.", null);
    return ctx.sizeUnit;
  }
  return "PIECE";
}

/** Line shape gate: sellable variant AND sellable product (reprice drops
 * lines whose variant or product is inactive/deleted — creation paths must
 * match) + PIECE whole packs + WEIGHT step multiples. */
export function assertLineShape(ctx: VariantSaleContext, quantity: string): void {
  if (!ctx.isActive || ctx.deletedAt !== null || !ctx.product.isActive || ctx.product.deletedAt !== null) {
    throw businessRule("Variant is not sellable.", null);
  }
  if (ctx.product.productType === "PIECE") {
    if (qtyToThousandths(quantity) % 1000 !== 0) {
      throw businessRule("Piece quantity must be whole packs.", null);
    }
    return;
  }
  const step = ctx.product.saleStepGrams;
  if (step === null || step <= 0 || !ctx.sizeUnit) {
    throw businessRule("Weight product is missing its sale step.", null);
  }
  const t = qtyToThousandths(quantity);
  const stepThousandths = ctx.sizeUnit === "GRAM" ? step * 1000 : step;
  if (t % stepThousandths !== 0) {
    throw businessRule("Weight quantity violates the sale step.", null);
  }
}

async function loadVariantOr404(variantId: string): Promise<VariantSaleContext> {
  const ctx = await getVariantSaleContext(variantId);
  if (!ctx) throw new ApiError("NOT_FOUND", "Variant not found.", null);
  return ctx;
}

export interface GetOrCreateResult {
  cartId: string;
  created: boolean;
  /** Raw guest token — set ONLY on guest creation (presented once). */
  guestToken: string | null;
}

/**
 * Mint a brand-new guest cart (no owner to resolve — the server issues the
 * bearer token). Used only by POST /cart with neither side supplied.
 */
export async function createGuestCart(): Promise<{ cartId: string; guestToken: string }> {
  const rawToken = mintGuestToken();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO carts (id, session_id, status, expires_at)
    VALUES (${newUuidV7()}::uuid, ${hashGuestToken(rawToken)}, 'ACTIVE', now() + INTERVAL '30 days')
    RETURNING id::text AS id`;
  return { cartId: rows[0].id, guestToken: rawToken };
}

/**
 * Create-or-resolve the ACTIVE cart for one owner (convergence, not
 * conflict: a lost create race reselected the winner's cart). Guest carts
 * get SQL-clocked expiry (+30d config default — the exact TTL number is
 * OPEN; ~+30d per contract); registered carts stay persistent (NULL).
 */
export async function getOrCreateCart(owner: CartOwner): Promise<GetOrCreateResult> {
  if (owner.kind === "customer") await assertCustomerUsable(owner.customerId);
  const existing = await findActiveCartByOwner(owner);
  if (existing) return { cartId: existing.id, created: false, guestToken: null };
  const rawToken = owner.kind === "guest" ? mintGuestToken() : null;
  try {
    const created =
      owner.kind === "guest"
        ? await prisma.$queryRaw<Array<{ id: string }>>`
            INSERT INTO carts (id, session_id, status, expires_at)
            VALUES (${newUuidV7()}::uuid, ${hashGuestToken(rawToken as string)}, 'ACTIVE', now() + INTERVAL '30 days')
            RETURNING id::text AS id`
        : await prisma.$queryRaw<Array<{ id: string }>>`
            INSERT INTO carts (id, customer_id, status, expires_at)
            VALUES (${newUuidV7()}::uuid, ${owner.customerId}::uuid, 'ACTIVE', NULL)
            RETURNING id::text AS id`;
    return { cartId: created[0].id, created: true, guestToken: rawToken };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Lost the create race (partial UQ): the winner's ACTIVE cart is ours.
    const winner = await findActiveCartByOwner(owner);
    if (!winner) throw error;
    return { cartId: winner.id, created: false, guestToken: null };
  }
}

/** Resolve the operable (ACTIVE) cart or 404 (consumed/unknown owners are
 * never silently recreated here — creation is POST /cart's job). */
export async function requireActiveCart(owner: CartOwner): Promise<string> {
  const row = await findActiveCartByOwner(owner);
  if (!row) throw new ApiError("NOT_FOUND", "Active cart not found.", null);
  return row.id;
}

async function lockCart(tx: Prisma.TransactionClient, cartId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM carts WHERE id = ${cartId}::uuid FOR UPDATE`;
}

/**
 * Add a line (re-add aggregates at live price). One explicit tx: lock the
 * cart (serializes same-cart writers) → validate → INSERT → on the frozen
 * UQ fall back to an atomic quantity bump + reprice. Never touches
 * inventory (draft only).
 */
export async function addLine(owner: CartOwner, variantId: string, quantity: string) {
  const cartId = await requireActiveCart(owner);
  const ctx = await loadVariantOr404(variantId);
  assertLineShape(ctx, quantity);
  const unit = countingUnitFor(ctx);
  const price = ctx.price.toString();
  // Single-statement UPSERT as raw SQL (frozen merge-statement shape).
  // Rationale: catching the INSERT's unique violation INSIDE an interactive
  // tx poisons the Postgres tx (later statements die with "transaction
  // aborted"), and Prisma's Decimal `increment` rejects string decimals at
  // runtime — so neither create-then-catch nor read-modify-write is safe.
  await prisma.$transaction(async (tx) => {
    await lockCart(tx, cartId);
    await tx.$executeRaw`
      INSERT INTO cart_items (id, cart_id, product_variant_id, quantity,
        unit_snapshot, unit_price_snapshot, price_checked_at)
      VALUES (${newUuidV7()}::uuid, ${cartId}::uuid, ${variantId}::uuid,
        ${quantity}::numeric, ${unit}::varchar, ${price}::numeric, now())
      ON CONFLICT (cart_id, product_variant_id) DO UPDATE SET
        quantity = cart_items.quantity + EXCLUDED.quantity,
        unit_price_snapshot = EXCLUDED.unit_price_snapshot,
        price_checked_at = now()`;
  });
  return getCartFull(cartId);
}

/** Set a line's quantity (last-writer-wins on the single row; snapshots
 * untouched — qty-only op, drift stays checkout's job). */
export async function setLineQuantity(owner: CartOwner, variantId: string, quantity: string) {
  const cartId = await requireActiveCart(owner);
  const ctx = await loadVariantOr404(variantId);
  assertLineShape(ctx, quantity);
  try {
    await prisma.$transaction(async (tx) => {
      await lockCart(tx, cartId);
      await tx.cartItem.update({
        where: { cartId_productVariantId: { cartId, productVariantId: variantId } },
        data: { quantity },
      });
    });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  return getCartFull(cartId);
}

/** Remove one line (missing line → null → 404). */
export async function removeLine(owner: CartOwner, variantId: string) {
  const cartId = await requireActiveCart(owner);
  try {
    await prisma.$transaction(async (tx) => {
      await lockCart(tx, cartId);
      await tx.cartItem.delete({
        where: { cartId_productVariantId: { cartId, productVariantId: variantId } },
      });
    });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  return getCartFull(cartId);
}

/**
 * Reprice every line against LIVE variant state (BA-C persisted reprice).
 * One tx: lock cart → per line, drop dead variants (inactive/deleted
 * variant or product, reported — merge precedent) else refresh
 * unit_price_snapshot to the live price + price_checked_at = now().
 * Quantities are untouched (steps are immutable after creation; qty was
 * valid at write time). No inventory, no promotions, no coupon state —
 * estimate/checkout own those layers. Stale snapshots never become final
 * truth: checkout revalidates live and rejects drift.
 */
export async function repriceCart(owner: CartOwner): Promise<{
  cartId: string;
  repriced: number;
  dropped: Array<{ lineId: string; variantId: string }>;
}> {
  const cartId = await requireActiveCart(owner);
  const report = await prisma.$transaction(async (tx) => {
    await lockCart(tx, cartId);
    const lines = await tx.cartItem.findMany({
      where: { cartId },
      orderBy: [{ id: "asc" as const }],
    });
    let repriced = 0;
    const dropped: Array<{ lineId: string; variantId: string }> = [];
    for (const l of lines) {
      const v = await tx.productVariant.findUnique({
        where: { id: l.productVariantId },
        select: {
          price: true,
          isActive: true,
          deletedAt: true,
          product: { select: { isActive: true, deletedAt: true } },
        },
      });
      if (!v || !v.isActive || v.deletedAt !== null || !v.product.isActive || v.product.deletedAt !== null) {
        await tx.cartItem.delete({ where: { id: l.id } });
        dropped.push({ lineId: l.id, variantId: l.productVariantId });
        continue;
      }
      const live = v.price.toString();
      if (l.unitPriceSnapshot === null || l.unitPriceSnapshot.toString() !== live) {
        await tx.$executeRaw`
          UPDATE cart_items SET unit_price_snapshot = ${live}::numeric, price_checked_at = now()
           WHERE id = ${l.id}::uuid`;
        repriced++;
      }
    }
    return { repriced, dropped };
  });
  return { cartId, ...report };
}

/** Remove all lines (draft maintenance — the cart row and its ACTIVE
 * status are untouched; no lifecycle transition invented). */
export async function clearCart(owner: CartOwner) {
  const cartId = await requireActiveCart(owner);
  await prisma.$transaction(async (tx) => {
    await lockCart(tx, cartId);
    await tx.cartItem.deleteMany({ where: { cartId } });
  });
  return getCartFull(cartId);
}

export interface MergeReport {
  mode: "reassigned" | "merged";
  inserted: number;
  summed: number;
  dropped: Array<{ lineId: string; variantId: string }>;
}

/**
 * Bind a guest cart to a customer (explicit trigger — the frozen "on login"
 * hook cannot fire while customer login stays deferred; the 9-step merge
 * itself is verbatim from the frozen R1 reference).
 * Locks: customer ACTIVE cart (if any) + guest cart, ASC order, one tx.
 * GUEST_GONE: unknown token → 404; consumed/non-guest cart → 409.
 */
export async function mergeGuestCartToCustomer(
  guestToken: string,
  customerId: string,
): Promise<{ cartId: string; report: MergeReport }> {
  await assertCustomerUsable(customerId);
  const sessionHash = hashGuestToken(guestToken);
  const guestHint = await prisma.cart.findFirst({
    where: { sessionId: sessionHash },
    select: { id: true },
  });
  if (!guestHint) throw new ApiError("NOT_FOUND", "Guest cart not found.", null);

  return prisma.$transaction(async (tx) => {
    const cust = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM carts
       WHERE customer_id = ${customerId}::uuid AND status = 'ACTIVE' FOR UPDATE`;
    const custId = cust.length === 0 ? null : cust[0].id;
    for (const id of orderLockIds(custId ? [guestHint.id, custId] : [guestHint.id])) {
      await tx.$queryRaw`SELECT 1 FROM carts WHERE id = ${id}::uuid FOR UPDATE`;
    }
    const g = await tx.$queryRaw<
      Array<{ status: string; customer_id: string | null; expired: boolean }>
    >`
      SELECT status, customer_id::text AS customer_id,
        (expires_at IS NOT NULL AND expires_at <= now()) AS expired
        FROM carts WHERE id = ${guestHint.id}::uuid`;
    if (g.length === 0 || g[0].status !== "ACTIVE" || g[0].customer_id !== null || g[0].expired) {
      throw conflict("Guest cart is no longer available for merge.", { cartId: guestHint.id });
    }
    if (!custId) {
      await tx.$executeRaw`
        UPDATE carts SET customer_id = ${customerId}::uuid, session_id = NULL, expires_at = NULL
         WHERE id = ${guestHint.id}::uuid`;
      return {
        cartId: guestHint.id,
        report: { mode: "reassigned" as const, inserted: 0, summed: 0, dropped: [] },
      };
    }
    const lines = await tx.cartItem.findMany({ where: { cartId: guestHint.id } });
    const report: MergeReport = { mode: "merged", inserted: 0, summed: 0, dropped: [] };
    for (const l of lines) {
      const ctx = await tx.productVariant.findUnique({
        where: { id: l.productVariantId },
        select: {
          price: true,
          sizeUnit: true,
          isActive: true,
          deletedAt: true,
          product: { select: { productType: true, isActive: true, deletedAt: true } },
        },
      });
      if (!ctx || !ctx.isActive || ctx.deletedAt !== null || !ctx.product.isActive || ctx.product.deletedAt !== null) {
        report.dropped.push({ lineId: l.id, variantId: l.productVariantId });
        continue;
      }
      if (ctx.product.productType === "WEIGHT" && !ctx.sizeUnit) {
        throw businessRule("Variant has no sale unit.", null);
      }
      const unit = ctx.product.productType === "WEIGHT" ? (ctx.sizeUnit as string) : "PIECE";
      // Frozen upsert shape as one statement (sum + live reprice). Raw SQL:
      // Prisma's Decimal `increment` rejects string decimals at runtime,
      // and only the statement itself can report insert-vs-sum atomically
      // (`xmax = 0` ⟺ inserted) under the held cart locks.
      const moved = await tx.$queryRaw<Array<{ inserted: boolean }>>`
        INSERT INTO cart_items (id, cart_id, product_variant_id, quantity,
          unit_snapshot, unit_price_snapshot, price_checked_at)
        VALUES (${newUuidV7()}::uuid, ${custId}::uuid, ${l.productVariantId}::uuid,
          ${l.quantity.toString()}::numeric, ${unit}::varchar, ${ctx.price.toString()}::numeric, now())
        ON CONFLICT (cart_id, product_variant_id) DO UPDATE SET
          quantity = cart_items.quantity + EXCLUDED.quantity,
          unit_price_snapshot = EXCLUDED.unit_price_snapshot,
          price_checked_at = now()
        RETURNING (xmax = 0) AS inserted`;
      if (moved[0].inserted) report.inserted += 1;
      else report.summed += 1;
    }
    await tx.$executeRaw`UPDATE carts SET status = 'MERGED' WHERE id = ${guestHint.id}::uuid`;
    return { cartId: custId, report };
  });
}
