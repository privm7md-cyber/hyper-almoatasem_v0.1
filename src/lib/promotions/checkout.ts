// BA-8 checkout promotion integration (runs INSIDE BA-6's creation tx).
//
// Position in the frozen order (matches the Phase 4 doubles): after line
// revalidation, before inventory locks — coupon row — promo rows —
// inventory ASC. Effective promos + category tree load INSIDE the
// creation tx (orders/writes owns the tx; single atomic unit —
// behaviorally equivalent to the doubles' outside load, but race-safe
// against concurrent promo edits); every lock/bump/count/mutation is in-tx.
// Layers: line-autos → order-autos → ONE coupon (bases read running nets).
// Coupon-gated promos (≥1 coupon row) never auto-apply: the seed intent
// ("reached via coupons") plus single-coupon economics forbid the
// double-dip, and no frozen test combines the layers (documented DERIVED).
// Auto-promo exhaustion (limited bump miss) SKIPs the promo with a full
// recompute; coupon exhaustion/limits FAIL the checkout (frozen pins).
// Cross-variant BXGY free lines materialize here (validated + reserved +
// discounted rows); dead/short free lines SKIP (auto-exhaustion pin).
// Allocation dust uses REAL order-item ids at persistence (frozen rule) —
// the pure layer returns amounts + eligible keys, and allocateShares()
// below runs on real ids with the frozen nets. Money: integer piastres;
// quantities: integer thousandths. No floating point anywhere.
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, businessRule, conflict } from "@/lib/api/errors";
import {
  allocate,
  divRoundHalfAway,
  evaluateLines,
  evaluateOrderLayer,
  matchLine,
  parseScaled,
  type EvalLine,
  type EvalPromo,
  type LineCtx,
} from "@/lib/promotions/engine";
import {
  inSubtree,
  countActiveUsages,
  findCouponForApply,
  loadCategoryTree,
  loadEffectivePromotions,
} from "@/lib/promotions/queries";
import { normalizeCouponCode } from "@/lib/promotions/writes";

export type { LineCtx };

export interface CheckoutLineInput {
  variantId: string;
  qtyT: number;
  grossC: number;
  unitPriceC: number;
  ctx: LineCtx;
}

export interface AppliedRef {
  pctH: number | null;
  amtC: number | null;
  fixC: number | null;
}

export interface AppShare {
  key: string;
  amountC: number;
}

export interface OrderAppResult {
  promoId: string;
  promoName: string;
  promoType: string;
  promoScope: string;
  applied: AppliedRef;
  capC: number | null;
  baseC: number;
  amountC: number;
  /** Eligible line keys + frozen nets (allocation runs at persistence). */
  eligKeys: string[];
  eligNets: number[];
}

export interface CouponAppResult extends OrderAppResult {
  couponId: string;
}

export interface FreeLineResult {
  tempKey: string;
  variantId: string;
  variantName: string;
  productName: string;
  brandName: string | null;
  code: string | null;
  codeType: string | null;
  unit: string;
  productType: string;
  saleStep: number | null;
  unitPriceText: string;
  qtyT: number;
  estimatedC: number;
  promoId: string;
  promoName: string;
  appliedPctH: number;
  capC: number | null;
  baseC: number;
  amountC: number;
}

export interface LineAppResult {
  promoId: string;
  promoName: string;
  promoType: string;
  promoScope: string;
  applied: AppliedRef;
  capC: number | null;
  key: string;
  baseC: number;
  amountC: number;
}

export interface PromoPhaseResult {
  /** Direct PROMOTION_LINE applications on bought lines (amount > 0). */
  lineApps: LineAppResult[];
  orderApps: OrderAppResult[];
  couponApp: CouponAppResult | null;
  freeLines: FreeLineResult[];
  discountTotalC: number;
  /** Frozen running nets per line key (allocation bases at persistence). */
  finalNets: Map<string, number>;
}

export interface EffectivePromoRow {
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
  targets: Array<{ tt: string; tid: string }>;
}

function toEvalPromo(
  r: EffectivePromoRow,
  sub: (lineCid: string, targetCid: string) => boolean,
): EvalPromo & { name: string } {
  return {
    id: r.id,
    name: r.name,
    type: r.type as EvalPromo["type"],
    scope: r.scope as EvalPromo["scope"],
    priority: r.priority,
    isStackable: r.is_stackable,
    createdAt: r.created_at.toISOString(),
    targets: r.targets.map((tg) => ({ tt: tg.tt as EvalPromo["targets"][number]["tt"], tid: tg.tid })),
    discountPercentH: r.discount_percent === null ? null : parseScaled(r.discount_percent, 2),
    discountAmountC: r.discount_amount === null ? null : parseScaled(r.discount_amount, 2),
    fixedPriceC: r.fixed_price === null ? null : parseScaled(r.fixed_price, 2),
    minimumQuantityT: r.minimum_quantity === null ? null : parseScaled(r.minimum_quantity, 3),
    minimumAmountC: r.minimum_amount === null ? null : parseScaled(r.minimum_amount, 2),
    maximumDiscountC: r.maximum_discount === null ? null : parseScaled(r.maximum_discount, 2),
    buyQtyT: r.buy_quantity === null ? null : parseScaled(r.buy_quantity, 3),
    getQtyT: r.get_quantity === null ? null : parseScaled(r.get_quantity, 3),
    buyPctH: r.buy_pct === null ? null : parseScaled(r.buy_pct, 2),
    freeVariantId: r.free_variant_id,
    usageLimit: r.usage_limit,
    inSubtree: sub,
  };
}

type NamedPromo = EvalPromo & { name: string };

function appliedOf(p: NamedPromo): AppliedRef {
  return {
    pctH: p.type === "PERCENTAGE" || p.type === "BUY_X_GET_Y" ? (p.type === "BUY_X_GET_Y" ? p.buyPctH : p.discountPercentH) : null,
    amtC: p.type === "FIXED_AMOUNT" ? p.discountAmountC : null,
    fixC: p.type === "FIXED_PRICE" ? p.fixedPriceC : null,
  };
}

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

/** Allocation with real ids over frozen nets (frozen dust rule). */
export function allocateShares(
  amountC: number,
  items: Array<{ realId: string; netC: number }>,
): Array<{ realId: string; amountC: number }> {
  return allocate(
    amountC,
    items.map((x) => ({ id: x.realId, netC: x.netC })),
  ).map((s) => ({ realId: s.id, amountC: s.amountC }));
}

export interface PromoPhaseInput {
  lines: CheckoutLineInput[];
  customerId: string;
  couponCode: string | null;
  effectivePromos: EffectivePromoRow[];
  categoryTree: Map<string, string | null>;
}

export async function applyPromotions(
  tx: Prisma.TransactionClient,
  input: PromoPhaseInput,
): Promise<PromoPhaseResult> {
  const sub = (lineCid: string, targetCid: string) => inSubtree(input.categoryTree, lineCid, targetCid);
  const gated = new Set(
    (
      await tx.$queryRaw<Array<{ pid: string }>>`
        SELECT DISTINCT promotion_id::text AS pid FROM coupons`
    ).map((r) => r.pid),
  );
  const all = input.effectivePromos
    .filter((r) => !gated.has(r.id))
    .map((r) => toEvalPromo(r, sub));
  const consumed = new Set<string>();

  // Limited-auto bump loop with drop + full recompute on exhaustion.
  let evalLines: EvalLine[] = [];
  let lineRows: ReturnType<typeof evaluateLines>["rows"] = [];
  let orderRows: ReturnType<typeof evaluateOrderLayer>["rows"] = [];
  const dropped = new Set<string>();
  const bumpedOk = new Set<string>();
  for (;;) {
    evalLines = input.lines.map((l) => ({
      key: l.variantId,
      ctx: l.ctx,
      qtyT: l.qtyT,
      grossC: l.grossC,
      netC: l.grossC,
      unitPriceC: l.unitPriceC,
    }));
    const live = all.filter((p) => !dropped.has(p.id));
    const ev = evaluateLines(evalLines, live);
    const ord = evaluateOrderLayer(evalLines, live);
    const limited = new Map<string, NamedPromo>();
    for (const r of ev.rows) {
      if (r.amountC > 0 && usageLimitOf(all, r.promo.id) !== null) limited.set(r.promo.id, r.promo as NamedPromo);
    }
    for (const r of ord.rows) {
      if (usageLimitOf(all, r.promo.id) !== null) limited.set(r.promo.id, r.promo as NamedPromo);
    }
    let missed: string | null = null;
    for (const pid of [...limited.keys()].sort()) {
      if (bumpedOk.has(pid)) continue;
      await tx.$queryRaw`SELECT 1 FROM promotions WHERE id = ${pid}::uuid FOR UPDATE`;
      const bumped = await tx.$queryRaw<Array<{ one: number }>>`
        UPDATE promotions SET used_count = used_count + 1 WHERE id = ${pid}::uuid
          AND (usage_limit IS NULL OR used_count < usage_limit)
        RETURNING 1 AS one`;
      if (bumped.length === 0) {
        missed = pid;
        break;
      }
      bumpedOk.add(pid);
    }
    if (missed === null) {
      lineRows = ev.rows;
      orderRows = ord.rows;
      break;
    }
    dropped.add(missed);
  }
  for (const pid of bumpedOk) consumed.add(pid);
  // Unlimited granting autos: usage accounting bump (A34).
  const granting = new Set<string>();
  for (const r of lineRows) if (r.amountC > 0) granting.add(r.promo.id);
  for (const r of orderRows) granting.add(r.promo.id);
  for (const pid of [...granting].sort()) {
    if (usageLimitOf(all, pid) === null && !consumed.has(pid)) {
      await tx.$queryRaw`SELECT 1 FROM promotions WHERE id = ${pid}::uuid FOR UPDATE`;
      await tx.$executeRaw`UPDATE promotions SET used_count = used_count + 1 WHERE id = ${pid}::uuid`;
      consumed.add(pid);
    }
  }

  let couponApp: CouponAppResult | null = null;
  if (input.couponCode !== null && input.couponCode.trim() !== "") {
    couponApp = await applyCoupon(tx, input.couponCode, evalLines, input.customerId, sub);
  }

  const freeLines = await materializeFreeLines(tx, lineRows, evalLines, consumed);

  const lineApps: LineAppResult[] = [];
  for (const r of lineRows) {
    if (r.amountC <= 0) continue;
    const p = r.promo as NamedPromo;
    lineApps.push({
      promoId: p.id,
      promoName: p.name,
      promoType: p.type,
      promoScope: p.scope,
      applied: appliedOf(p),
      capC: p.maximumDiscountC,
      key: evalLines[r.itemIdx].key,
      baseC: r.baseC,
      amountC: r.amountC,
    });
  }
  let discountTotalC = lineApps.reduce((s, x) => s + x.amountC, 0);
  for (const r of orderRows) discountTotalC += r.amountC;
  if (couponApp) discountTotalC += couponApp.amountC;
  for (const f of freeLines) discountTotalC += f.amountC;

  const finalNets = new Map<string, number>();
  for (const l of evalLines) finalNets.set(l.key, l.netC);
  // Per-app snapshots arrive pre-reduced-sequentially from the engine;
  // persistence re-allocates them under real item ids (frozen dust rule).
  const orderAppResults: OrderAppResult[] = orderRows.map((r) => {
    const p = r.promo as NamedPromo;
    return {
      promoId: p.id,
      promoName: p.name,
      promoType: p.type,
      promoScope: p.scope,
      applied: appliedOf(p),
      capC: p.maximumDiscountC,
      baseC: r.baseC,
      amountC: r.amountC,
      eligKeys: r.snapKeys,
      eligNets: r.snapNets,
    };
  });
  return {
    lineApps,
    finalNets,
    orderApps: orderAppResults,
    couponApp,
    freeLines,
    discountTotalC,
  };
}

function usageLimitOf(all: NamedPromo[], pid: string): number | null {
  return all.find((p) => p.id === pid)?.usageLimit ?? null;
}

function centsText(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Hundredths integer (12.50% -> 1250) to NUMERIC(5,2) text. */
function pctText(hundredths: number): string {
  return (hundredths / 100).toFixed(2);
}

export interface EstimateLineInput {
  variantId: string;
  quantity: string;
}

export interface EstimateResult {
  lines: Array<{
    variantId: string;
    quantity: string;
    unitPrice: string;
    gross: string;
    discounts: Array<{ promoId: string; promoName: string; amount: string }>;
    net: string;
  }>;
  freeLines: Array<{
    variantId: string;
    quantity: string;
    unitPrice: string;
    gross: string;
    promoId: string;
    discount: string;
  }>;
  coupon: { code: string; applicable: boolean; reason: string | null; amount: string } | null;
  subtotal: string;
  discountTotal: string;
  deliveryFee: string;
  total: string;
}

/**
 * Read-only estimate (UI re-evaluation; checkout remains the sole
 * committer). No locks, no bumps, no usage rows — informational only, so
 * races against checkout resolve by re-estimating. Per-customer coupon
 * checks need customerId; without it they report customer-required.
 */
export async function estimateOnly(input: {
  lines: EstimateLineInput[];
  couponCode: string | null;
  customerId: string | null;
}): Promise<EstimateResult> {
  const built: CheckoutLineInput[] = [];
  for (const l of input.lines) {
    const v = await prisma.productVariant.findUnique({
      where: { id: l.variantId },
      include: { product: true },
    });
    if (!v || !v.isActive || v.deletedAt !== null) {
      throw businessRule("Cart contains an unsellable variant.", { variantId: l.variantId });
    }
    const unit = v.product.productType === "WEIGHT" ? v.sizeUnit : "PIECE";
    if (v.product.productType === "PIECE") {
      const t = parseScaled(l.quantity, 3);
      if (t % 1000 !== 0) throw businessRule("Piece quantity must be whole packs.", null);
    } else {
      const step = v.product.saleStepGrams;
      if (step === null || step <= 0 || !v.sizeUnit) {
        throw businessRule("Weight product is missing its sale step.", null);
      }
      const t = parseScaled(l.quantity, 3);
      if (t % (v.sizeUnit === "GRAM" ? step * 1000 : step) !== 0) {
        throw businessRule("Weight quantity violates the sale step.", null);
      }
    }
    const qtyT = parseScaled(l.quantity, 3);
    const priceC = parseScaled(v.price.toString(), 2);
    built.push({
      variantId: l.variantId,
      qtyT,
      grossC: divRoundHalfAway(qtyT * priceC, 1000),
      unitPriceC: priceC,
      ctx: {
        vid: l.variantId,
        pid: v.product.id,
        bid: v.product.brandId,
        cid: v.product.categoryId,
        pt: v.product.productType as "PIECE" | "WEIGHT",
        pu: unit as string,
        su: v.sizeUnit,
      },
    });
  }
  const tree = await loadCategoryTree();
  const promos = await loadEffectivePromotions(null);
  const sub = (a: string, b: string) => inSubtree(tree, a, b);
  const gated = new Set(
    (await prisma.$queryRaw<Array<{ pid: string }>>`SELECT DISTINCT promotion_id::text AS pid FROM coupons`).map(
      (r) => r.pid,
    ),
  );
  const all = promos.filter((r) => !gated.has(r.id)).map((r) => toEvalPromo(r, sub));
  const evalLines: EvalLine[] = built.map((l) => ({
    key: l.variantId,
    ctx: l.ctx,
    qtyT: l.qtyT,
    grossC: l.grossC,
    netC: l.grossC,
    unitPriceC: l.unitPriceC,
  }));
  const ev = evaluateLines(evalLines, all);
  const ord = evaluateOrderLayer(evalLines, all);
  const perLine = new Map<string, Array<{ promoId: string; promoName: string; amount: string }>>();
  const pushLine = (key: string, promoId: string, promoName: string, amountC: number) => {
    const arr = perLine.get(key) ?? [];
    arr.push({ promoId, promoName, amount: centsText(amountC) });
    perLine.set(key, arr);
  };
  // Nets already carry sequential reductions from the engine (evaluate
  // mutates them in place); this loop only records display entries.
  // Order-layer allocation replays here for display shares (same inputs).
  for (const r of ev.rows) {
    if (r.amountC <= 0) continue;
    const p = r.promo as unknown as { id: string; name: string };
    pushLine(evalLines[r.itemIdx].key, p.id, p.name, r.amountC);
  }
  for (const r of ord.rows) {
    const shares = allocate(
      r.amountC,
      r.elig.map((i) => ({ id: evalLines[i].key, netC: evalLines[i].netC })),
    );
    for (const s of shares) {
      if (s.amountC <= 0) continue;
      const p = r.promo as unknown as { id: string; name: string };
      pushLine(s.id, p.id, p.name, s.amountC);
    }
  }
  let coupon: EstimateResult["coupon"] = null;
  if (input.couponCode !== null && input.couponCode.trim() !== "") {
    let code: string;
    try {
      code = normalizeCouponCode(input.couponCode);
    } catch {
      throw businessRule("Invalid coupon code.", null);
    }
    const cp = await findCouponForApply(code);
    if (!cp) throw new ApiError("NOT_FOUND", "Coupon not found.", null);
    if (!cp.own_ok || !cp.parent_ok) {
      coupon = { code, applicable: false, reason: "Coupon is not currently valid.", amount: "0.00" };
    } else {
      const grossAllC = evalLines.reduce((s, l) => s + l.grossC, 0);
      const minC = cp.minimum_order_amount === null ? null : parseScaled(cp.minimum_order_amount, 2);
      if (minC !== null && grossAllC < minC) {
        coupon = { code, applicable: false, reason: "Coupon minimum order amount not reached.", amount: "0.00" };
      } else if (cp.per_customer_limit !== null && input.customerId === null) {
        coupon = { code, applicable: false, reason: "Customer required.", amount: "0.00" };
      } else {
        let limited = false;
        if (cp.per_customer_limit !== null && input.customerId !== null) {
          const used = Number(
            (
              await prisma.$queryRaw<Array<{ n: string }>>`
                SELECT COUNT(*)::text AS n FROM coupon_usages u JOIN orders o ON o.id = u.order_id
                 WHERE u.coupon_id = ${cp.id}::uuid AND u.customer_id = ${input.customerId}::uuid
                   AND o.status <> 'CANCELLED'`
            )[0].n,
          );
          limited = used >= cp.per_customer_limit;
        }
        if (limited) {
          coupon = { code, applicable: false, reason: "Coupon per-customer limit reached.", amount: "0.00" };
        } else if (cp.promo_type !== "PERCENTAGE" && cp.promo_type !== "FIXED_AMOUNT") {
          coupon = { code, applicable: false, reason: "Coupon promotion type is not supported.", amount: "0.00" };
        } else {
          const targets = (
            await prisma.$queryRaw<Array<{ tt: string; tid: string }>>`
              SELECT target_type AS tt, target_id::text AS tid FROM promotion_targets WHERE promotion_id = ${cp.promotion_id}::uuid`
          ).map((tg) => ({
            tt: tg.tt as "VARIANT" | "PRODUCT" | "BRAND" | "CATEGORY",
            tid: tg.tid,
          }));
          const probe = { targets, inSubtree: sub } as import("@/lib/promotions/engine").EvalPromo;
          const elig = evalLines
            .map((l, i) => i)
            .filter((i) => targets.length === 0 || matchLine(evalLines[i].ctx, probe) > 0);
          const baseC = elig.reduce((s, i) => s + evalLines[i].netC, 0);
          let amountC =
            cp.promo_type === "PERCENTAGE"
              ? divRoundHalfAway(baseC * parseScaled(cp.pdp as string, 2), 10000)
              : Math.min(parseScaled(cp.pda as string, 2), baseC);
          if (cp.promo_max !== null) amountC = Math.min(amountC, parseScaled(cp.promo_max, 2));
          coupon =
            amountC <= 0 || baseC <= 0
              ? { code, applicable: false, reason: "Coupon grants no discount.", amount: "0.00" }
              : { code, applicable: true, reason: null, amount: centsText(amountC) };
        }
      }
    }
  }
  // Prospective cross-variant free lines (read-only: no reserve, no rows).
  const freeProspects: EstimateResult["freeLines"] = [];
  const freeSpent = new Map<string, number>();
  for (const r of ev.rows) {
    if (!r.freeLine) continue;
    const p = r.promo as unknown as {
      id: string;
      buyPctH: number;
      maximumDiscountC: number | null;
    };
    const sub = await prisma.productVariant.findUnique({
      where: { id: r.freeLine.variantId },
      select: { price: true },
    });
    if (!sub) continue;
    const priceC = parseScaled(sub.price.toString(), 2);
    const grossC = divRoundHalfAway(r.freeLine.qtyT * priceC, 1000);
    let amountC = Math.min(divRoundHalfAway(grossC * p.buyPctH, 10000), grossC);
    const cap = p.maximumDiscountC;
    if (cap !== null) {
      const used =
        (freeSpent.get(p.id) ?? 0) + ev.rows.filter((x) => x.promo.id === p.id).reduce((s, x) => s + x.amountC, 0);
      amountC = Math.min(amountC, Math.max(0, cap - used));
    }
    if (amountC <= 0) continue;
    freeSpent.set(p.id, (freeSpent.get(p.id) ?? 0) + amountC);
    freeProspects.push({
      variantId: r.freeLine.variantId,
      quantity: (r.freeLine.qtyT / 1000).toFixed(3),
      unitPrice: centsText(priceC),
      gross: centsText(grossC),
      promoId: p.id,
      discount: centsText(amountC),
    });
  }
  const feeRows = await prisma.$queryRaw<Array<{ v: string }>>`
    SELECT value_text AS v FROM store_settings WHERE key = 'delivery.default_fee'`;
  const feeRaw = feeRows.length === 0 ? null : feeRows[0].v;
  if (feeRaw === null || !/^\d+(\.\d{1,2})?$/.test(feeRaw)) throw new Error("Delivery fee misconfigured.");
  const feeC = parseScaled(feeRaw, 2);
  const subtotalC =
    evalLines.reduce((s, l) => s + l.grossC, 0) + freeProspects.reduce((s, f) => s + parseScaled(f.gross, 2), 0);
  const discC =
    [...perLine.values()].flat().reduce((s, x) => s + parseScaled(x.amount, 2), 0) +
    freeProspects.reduce((s, f) => s + parseScaled(f.discount, 2), 0) +
    (coupon && coupon.applicable ? parseScaled(coupon.amount, 2) : 0);
  return {
    lines: evalLines.map((l, i) => ({
      variantId: built[i].variantId,
      quantity: (l.qtyT / 1000).toFixed(3),
      unitPrice: centsText(l.unitPriceC),
      gross: centsText(l.grossC),
      discounts: perLine.get(l.key) ?? [],
      net: centsText(l.netC),
    })),
    freeLines: freeProspects,
    coupon,
    subtotal: centsText(subtotalC),
    discountTotal: centsText(discC),
    deliveryFee: centsText(feeC),
    total: centsText(subtotalC - discC + feeC),
  };
}

export interface PersistPromoInput {
  orderId: string;
  customerId: string;
  comp: PromoPhaseResult;
  /** Bought variantId → item id, plus free tempKey → item id. */
  keyToItemId: Map<string, string>;
}

/**
 * Persist application + allocation + usage rows and allocation mirror
 * bumps (same tx as the order). Zero-amount rows never stored (frozen).
 * ALLOCATION children carry no applied values (frozen pin). Item mirrors
 * for DIRECT rows are set at item INSERT by the caller; this bumps only
 * allocation shares (one UPDATE per item).
 */
export async function persistPromoRows(tx: Prisma.TransactionClient, input: PersistPromoInput): Promise<void> {
  const { orderId, customerId, comp, keyToItemId } = input;
  const mirror = new Map<string, number>();
  const bumpMirror = (realId: string, cents: number) => {
    mirror.set(realId, (mirror.get(realId) ?? 0) + cents);
  };
  const appIdOf = async (
    kind: "PROMOTION_LINE" | "PROMOTION_ORDER" | "COUPON",
    promo: { promoId: string; promoName: string; promoType: string; promoScope: string; applied: AppliedRef; capC: number | null },
    baseC: number,
    amountC: number,
    itemId: string | null,
    couponId: string | null,
  ): Promise<string> => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO order_discounts (id, order_id, order_item_id, promotion_id, coupon_id, kind,
        promotion_name_snapshot, type_snapshot, scope_snapshot, applied_percent, applied_amount,
        applied_fixed_price, cap_amount, base_estimated, discount_estimated)
      VALUES (${newUuidV7()}::uuid, ${orderId}::uuid, ${itemId}::uuid, ${promo.promoId}::uuid, ${couponId}::uuid, ${kind},
        ${promo.promoName}, ${promo.promoType}, ${promo.promoScope},
        ${promo.applied.pctH === null ? null : pctText(promo.applied.pctH)}::numeric,
        ${promo.applied.amtC === null ? null : centsText(promo.applied.amtC)}::numeric,
        ${promo.applied.fixC === null ? null : centsText(promo.applied.fixC)}::numeric,
        ${promo.capC === null ? null : centsText(promo.capC)}::numeric,
        ${centsText(baseC)}::numeric, ${centsText(amountC)}::numeric)
      RETURNING id::text AS id`;
    return rows[0].id;
  };
  for (const la of comp.lineApps) {
    const itemId = keyToItemId.get(la.key);
    if (!itemId) throw new Error("Promotion line key without item.");
    await appIdOf("PROMOTION_LINE", la, la.baseC, la.amountC, itemId, null);
  }
  for (const f of comp.freeLines) {
    const itemId = keyToItemId.get(f.tempKey);
    if (!itemId) throw new Error("Free line key without item.");
    await appIdOf(
      "PROMOTION_LINE",
      { promoId: f.promoId, promoName: f.promoName, promoType: "BUY_X_GET_Y", promoScope: "LINE", applied: { pctH: f.appliedPctH, amtC: null, fixC: null }, capC: f.capC },
      f.baseC,
      f.amountC,
      itemId,
      null,
    );
  }
  const allocChildren = async (
    parentId: string,
    promoId: string,
    couponId: string | null,
    promoName: string,
    promoType: string,
    promoScope: string,
    shares: Array<{ realId: string; amountC: number }>,
  ): Promise<void> => {
    for (const s of shares) {
      if (s.amountC <= 0) continue;
      await tx.$queryRaw`
        INSERT INTO order_discounts (id, order_id, order_item_id, promotion_id, coupon_id, kind,
          promotion_name_snapshot, type_snapshot, scope_snapshot,
          base_estimated, discount_estimated, parent_discount_id)
        VALUES (${newUuidV7()}::uuid, ${orderId}::uuid, ${s.realId}::uuid, ${promoId}::uuid, ${couponId}::uuid, 'ALLOCATION',
          ${promoName}, ${promoType}, ${promoScope},
          ${centsText(s.amountC)}::numeric, ${centsText(s.amountC)}::numeric, ${parentId}::uuid)`;
      bumpMirror(s.realId, s.amountC);
    }
  };
  for (const o of comp.orderApps) {
    const appId = await appIdOf("PROMOTION_ORDER", o, o.baseC, o.amountC, null, null);
    const shares = allocateShares(
      o.amountC,
      o.eligKeys.map((k) => {
        const realId = keyToItemId.get(k);
        if (!realId) throw new Error("Allocation key without item.");
        return { realId, netC: comp.finalNets.get(k) ?? 0 };
      }),
    );
    await allocChildren(appId, o.promoId, null, o.promoName, o.promoType, o.promoScope, shares);
  }
  if (comp.couponApp) {
    const cp = comp.couponApp;
    const appId = await appIdOf("COUPON", cp, cp.baseC, cp.amountC, null, cp.couponId);
    await tx.$executeRaw`
      INSERT INTO coupon_usages (id, coupon_id, customer_id, order_id, estimated_discount_amount)
      VALUES (${newUuidV7()}::uuid, ${cp.couponId}::uuid, ${customerId}::uuid, ${orderId}::uuid,
        ${centsText(cp.amountC)}::numeric)`;
    const shares = allocateShares(
      cp.amountC,
      cp.eligKeys.map((k) => {
        const realId = keyToItemId.get(k);
        if (!realId) throw new Error("Allocation key without item.");
        return { realId, netC: comp.finalNets.get(k) ?? 0 };
      }),
    );
    await allocChildren(appId, cp.promoId, cp.couponId, cp.promoName, cp.promoType, cp.promoScope, shares);
  }
  for (const [realId, bump] of mirror) {
    if (bump <= 0) continue;
    await tx.$executeRaw`
      UPDATE order_items SET discount_amount = discount_amount + ${centsText(bump)}::numeric
       WHERE id = ${realId}::uuid`;
  }
}

/**
 * Coupon layer: normalize → SQL-gated lookup (unknown → 404) → flag/window/
 * parent/minimum checks (422) → row lock + conditional bump (miss → 409) →
 * per-customer active-usage count (breach → 422) → parent lock +
 * conditional bump (miss → 409) → compute on running nets → temp-keyed
 * shares (allocation runs at persistence with real ids). BXGY/FIXED_PRICE
 * parents have no frozen coupon semantics → 422.
 */
async function applyCoupon(
  tx: Prisma.TransactionClient,
  rawCode: string,
  lines: EvalLine[],
  customerId: string,
  sub: (lineCid: string, targetCid: string) => boolean,
): Promise<CouponAppResult | null> {
  let code: string;
  try {
    code = normalizeCouponCode(rawCode);
  } catch {
    throw businessRule("Invalid coupon code.", null);
  }
  const cp = await findCouponForApply(code);
  if (!cp) throw new ApiError("NOT_FOUND", "Coupon not found.", null);
  if (!cp.own_ok || !cp.parent_ok) {
    throw businessRule("Coupon is not currently valid.", null);
  }
  const grossAllC = lines.reduce((s, l) => s + l.grossC, 0);
  if (cp.minimum_order_amount !== null && grossAllC < parseScaled(cp.minimum_order_amount, 2)) {
    throw businessRule("Coupon minimum order amount not reached.", null);
  }
  await tx.$queryRaw`SELECT 1 FROM coupons WHERE id = ${cp.id}::uuid FOR UPDATE`;
  const bumped = await tx.$queryRaw<Array<{ one: number }>>`
    UPDATE coupons SET used_count = used_count + 1 WHERE id = ${cp.id}::uuid
      AND (usage_limit IS NULL OR used_count < usage_limit)
    RETURNING 1 AS one`;
  if (bumped.length === 0) {
    throw conflict("Coupon usage limit reached.", { code });
  }
  if (cp.per_customer_limit !== null) {
    const used = await countActiveUsages(tx, cp.id, customerId);
    if (used >= cp.per_customer_limit) {
      throw businessRule("Coupon per-customer limit reached.", null);
    }
  }
  await tx.$queryRaw`SELECT 1 FROM promotions WHERE id = ${cp.promotion_id}::uuid FOR UPDATE`;
  const pbumped = await tx.$queryRaw<Array<{ one: number }>>`
    UPDATE promotions SET used_count = used_count + 1 WHERE id = ${cp.promotion_id}::uuid
      AND (usage_limit IS NULL OR used_count < usage_limit)
    RETURNING 1 AS one`;
  if (pbumped.length === 0) {
    throw conflict("Coupon promotion limit reached.", { code });
  }
  if (cp.promo_type !== "PERCENTAGE" && cp.promo_type !== "FIXED_AMOUNT") {
    throw businessRule("Coupon promotion type is not supported.", null);
  }
  const parentTargets =
    (
      await tx.$queryRaw<Array<{ tt: string; tid: string }>>`
        SELECT target_type AS tt, target_id::text AS tid
          FROM promotion_targets WHERE promotion_id = ${cp.promotion_id}::uuid`
    ).map((tg) => ({ tt: tg.tt as "VARIANT" | "PRODUCT" | "BRAND" | "CATEGORY", tid: tg.tid }));
  const probe = { targets: parentTargets, inSubtree: sub } as EvalPromo;
  const keys = lines.map((_, i) => i);
  const elig = keys.filter((i) => parentTargets.length === 0 || matchLine(lines[i].ctx, probe) > 0);
  const baseC = elig.reduce((s, i) => s + lines[i].netC, 0);
  if (baseC <= 0) {
    throw businessRule("Coupon has no eligible lines.", null);
  }
  let amountC =
    cp.promo_type === "PERCENTAGE"
      ? divRoundHalfAway(baseC * parseScaled(cp.pdp as string, 2), 10000)
      : Math.min(parseScaled(cp.pda as string, 2), baseC);
  if (cp.promo_max !== null) amountC = Math.min(amountC, parseScaled(cp.promo_max, 2));
  if (amountC <= 0) {
    throw businessRule("Coupon grants no discount.", null);
  }
  return {
    promoId: cp.promotion_id,
    promoName: cp.promo_name,
    promoType: cp.promo_type,
    promoScope: cp.promo_scope,
    applied: {
      pctH: cp.promo_type === "PERCENTAGE" ? parseScaled(cp.pdp as string, 2) : null,
      amtC: cp.promo_type === "FIXED_AMOUNT" ? parseScaled(cp.pda as string, 2) : null,
      fixC: null,
    },
    capC: cp.promo_max === null ? null : parseScaled(cp.promo_max, 2),
    baseC,
    amountC,
    eligKeys: elig.map((i) => lines[i].key),
    eligNets: elig.map((i) => lines[i].netC),
    couponId: cp.id,
  };
}

/**
 * Cross-variant free lines: sellable? + shared-cap room computed BEFORE
 * reserving (dead/capped-out lines SKIP per the auto-exhaustion pin);
 * reserve (miss → SKIP); discount row data returned for persistence.
 */
async function materializeFreeLines(
  tx: Prisma.TransactionClient,
  lineRows: ReturnType<typeof evaluateLines>["rows"],
  lines: EvalLine[],
  consumed: Set<string>,
): Promise<FreeLineResult[]> {
  const out: FreeLineResult[] = [];
  const spent = new Map<string, number>();
  let n = 0;
  for (const r of lineRows) {
    if (!r.freeLine) continue;
    const promo = r.promo as NamedPromo;
    const sub = await tx.productVariant.findUnique({
      where: { id: r.freeLine.variantId },
      include: { product: { include: { brand: { select: { name: true } } } } },
    });
    if (!sub || !sub.isActive || sub.deletedAt !== null || !sub.product.isActive || sub.product.deletedAt !== null) continue;
    const priceC = parseScaled(sub.price.toString(), 2);
    const freeGrossC = divRoundHalfAway(r.freeLine.qtyT * priceC, 1000);
    let amountC = Math.min(divRoundHalfAway(freeGrossC * (promo.buyPctH as number), 10000), freeGrossC);
    const cap = promo.maximumDiscountC;
    if (cap !== null) {
      const used =
        (spent.get(promo.id) ?? 0) +
        lineRows.filter((x) => x.promo.id === promo.id).reduce((s, x) => s + x.amountC, 0);
      amountC = Math.min(amountC, Math.max(0, cap - used));
    }
    if (amountC <= 0) continue;
    await tx.$queryRaw`SELECT 1 FROM inventory WHERE product_variant_id = ${sub.id}::uuid FOR UPDATE`;
    const qtyText = (r.freeLine.qtyT / 1000).toFixed(3);
    const held = await tx.$queryRaw<Array<{ one: number }>>`
      UPDATE inventory SET reserved_quantity = reserved_quantity + ${qtyText}::numeric
       WHERE product_variant_id = ${sub.id}::uuid
         AND (quantity - reserved_quantity) >= ${qtyText}::numeric
      RETURNING 1 AS one`;
    if (held.length === 0) continue;
    const code = await tx.$queryRaw<Array<{ code: string; type: string }>>`
      SELECT code, type FROM product_codes
       WHERE product_variant_id = ${sub.id}::uuid AND is_primary`;
    const unit = sub.product.productType === "WEIGHT" ? (sub.sizeUnit as string) : "PIECE";
    spent.set(promo.id, (spent.get(promo.id) ?? 0) + amountC);
    consumed.add(promo.id);
    out.push({
      tempKey: `free:${promo.id}:${n++}`,
      variantId: sub.id,
      variantName: sub.name,
      productName: sub.product.name,
      brandName: sub.product.brand?.name ?? null,
      code: code.length === 0 ? null : code[0].code,
      codeType: code.length === 0 ? null : code[0].type,
      unit,
      productType: sub.product.productType,
      saleStep: sub.product.saleStepGrams,
      unitPriceText: sub.price.toString(),
      qtyT: r.freeLine.qtyT,
      estimatedC: freeGrossC,
      promoId: promo.id,
      promoName: promo.name,
      appliedPctH: promo.buyPctH as number,
      capC: promo.maximumDiscountC,
      baseC: freeGrossC,
      amountC,
    });
  }
  return out;
}

