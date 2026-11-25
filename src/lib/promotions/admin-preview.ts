// ADM-07 admin price preview (read-only).
//
// This module is NOT a second pricing engine. The offer is converted into the
// very same evaluation shape checkout uses (`toEvalPromo`) and the very same
// pure engine decides what wins (`evaluateLines` / `evaluateOrderLayer`), so a
// number shown in the admin panel is the number the checkout engine would
// compute — not an approximation written in the browser.
//
// What this module adds is only the read-only assembly of the inputs:
//   • the variants the offer targets (or the ones the operator picked),
//   • the live competitors, so priority and stacking are decided for real,
//   • the presentation values (old price, discount, new price, savings).
//
// Nothing here writes: no promotion, no order, no usage row, no price.

import "server-only";

import { prisma } from "@/lib/db";
import { evaluateLines, evaluateOrderLayer, parseScaled, selectWinningOffer, type EvalLine, type EvalPromo } from "@/lib/promotions/engine";
import { toEvalPromo, type EffectivePromoRow } from "@/lib/promotions/checkout";
import { inSubtree, loadCategoryTree, loadEffectivePromotions } from "@/lib/promotions/queries";
import { expandCategorySubtree } from "@/lib/catalog/queries";
import { listPrimaryImagesForProducts } from "@/lib/catalog/media";
import { promotionEffectiveStatus } from "@/lib/admin/terminology";

/** How many target variants a preview shows at once. */
export const PREVIEW_LIMIT = 12;

/** One sale unit of the line — the smallest honest quantity to quote. */
const ONE_SALE_UNIT_T = 1000;

export interface PromotionPreviewOverride {
  /** Percent (10 = 10%), fixed amount, or fixed price — as typed. */
  discountPercent?: string | null;
  discountAmount?: string | null;
  fixedPrice?: string | null;
}

export interface PromotionPreviewRow {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  imageUrl: string | null;
  /** Arabic unit of the quoted price ("قطعة" / "كجم" / "جم"). */
  unitLabel: string;
  /** Live catalogue price of one sale unit, in EGP. */
  originalPrice: string;
  /** What this offer takes off this line, in EGP. */
  discountAmount: string;
  /** Price the customer pays for one sale unit, in EGP. */
  finalPrice: string;
  /** Saving as a percentage of the original price, two decimals. */
  savingsPercent: string;
  /** The offer under preview granted a discount on this line. */
  applies: boolean;
  /** The name of the offer that actually wins this product (owner policy). */
  winnerName: string | null;
  /** Another (higher priority) offer won this line — its name. */
  blockedBy: string | null;
  /** Why nothing was discounted, in plain Arabic. */
  reason: string | null;
  /** Available quantity for this variant — null when NO balance row exists
   *  (unknown), which is NOT the same as zero. */
  availableQuantity: string | null;
}

export interface PromotionPreviewResult {
  promotionId: string;
  promotionName: string;
  type: string;
  scope: string;
  /** Effective state of the offer (LIVE / SCHEDULED / EXPIRED / DRAFT / DISABLED). */
  state: string;
  rows: PromotionPreviewRow[];
  /** True when the preview could not be assembled (missing offer, no targets…). */
  empty: boolean;
}

/* ------------------------------------------------------------------ money */

/** Piastres → EGP text. No floating point: the engine works in integers. */
function money(piastres: number): string {
  const sign = piastres < 0 ? "-" : "";
  const abs = Math.abs(piastres);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function percentOf(part: number, whole: number): string {
  if (whole <= 0) return "0.00";
  const hundredths = Math.round((part * 10000) / whole);
  return (hundredths / 100).toFixed(2);
}

/* ------------------------------------------------------------------ units */

const UNIT_LABELS: Record<string, string> = {
  PIECE: "قطعة",
  KG: "كجم",
  GRAM: "جم",
  LITER: "لتر",
  ML: "مل",
};

function unitLabel(productType: string, sizeUnit: string | null): string {
  if (productType === "PIECE") return UNIT_LABELS.PIECE;
  return UNIT_LABELS[sizeUnit ?? ""] ?? "وحدة";
}

/* -------------------------------------------------------------- the offer */

type PromoGraph = {
  id: string;
  name: string;
  type: string;
  scope: string;
  status: string;
  startAt: Date | null;
  endAt: Date | null;
  priority: number;
  isStackable: boolean;
  usageLimit: number | null;
  createdAt: Date;
  discountPercent: { toString(): string } | null;
  discountAmount: { toString(): string } | null;
  fixedPrice: { toString(): string } | null;
  targets: Array<{ targetType: string; targetId: string }>;
  rules: {
    minimumQuantity: { toString(): string } | null;
    minimumAmount: { toString(): string } | null;
    maximumDiscount: { toString(): string } | null;
  } | null;
  buyGetRules: {
    buyQuantity: { toString(): string };
    getQuantity: { toString(): string };
    discountPercent: { toString(): string };
    freeVariantId: string | null;
  } | null;
};

/**
 * The stored offer as the engine's row shape. This mirrors the SQL row that
 * `loadEffectivePromotions` returns, so the SAME converter feeds both.
 */
function toEffectiveRow(promo: PromoGraph, override: PromotionPreviewOverride | null): EffectivePromoRow {
  const pick = (
    saved: { toString(): string } | null,
    typed: string | null | undefined,
  ): string | null => {
    if (typed !== null && typed !== undefined && typed !== "") return typed;
    return saved === null ? null : saved.toString();
  };
  return {
    id: promo.id,
    name: promo.name,
    type: promo.type,
    scope: promo.scope,
    priority: promo.priority,
    is_stackable: promo.isStackable,
    created_at: promo.createdAt,
    discount_percent: pick(promo.discountPercent, override?.discountPercent),
    discount_amount: pick(promo.discountAmount, override?.discountAmount),
    fixed_price: pick(promo.fixedPrice, override?.fixedPrice),
    minimum_quantity: promo.rules?.minimumQuantity ? promo.rules.minimumQuantity.toString() : null,
    minimum_amount: promo.rules?.minimumAmount ? promo.rules.minimumAmount.toString() : null,
    maximum_discount: promo.rules?.maximumDiscount ? promo.rules.maximumDiscount.toString() : null,
    buy_quantity: promo.buyGetRules ? promo.buyGetRules.buyQuantity.toString() : null,
    get_quantity: promo.buyGetRules ? promo.buyGetRules.getQuantity.toString() : null,
    buy_pct: promo.buyGetRules ? promo.buyGetRules.discountPercent.toString() : null,
    free_variant_id: promo.buyGetRules?.freeVariantId ?? null,
    usage_limit: promo.usageLimit,
    targets: promo.targets.map((t) => ({ tt: t.targetType, tid: t.targetId })),
  };
}

/* ------------------------------------------------------- target variants */

type VariantRow = {
  id: string;
  name: string;
  price: { toString(): string };
  sizeUnit: string | null;
  product: {
    id: string;
    name: string;
    brandId: string | null;
    categoryId: string;
    productType: string;
    unit: string;
    saleStepGrams: number | null;
  };
};

const VARIANT_INCLUDE = {
  product: { select: { id: true, name: true, brandId: true, categoryId: true, productType: true, unit: true, saleStepGrams: true } },
} as const;

/**
 * The variants the offer covers. Explicit ids win; otherwise the offer's own
 * targets decide (variant, product, brand, category subtree).
 */
async function targetVariants(
  promo: PromoGraph,
  explicit: string[] | null,
): Promise<VariantRow[]> {
  const variantIds: string[] = [];
  const productIds: string[] = [];
  const brandIds: string[] = [];
  const categoryIds: string[] = [];
  for (const t of promo.targets) {
    if (t.targetType === "VARIANT") variantIds.push(t.targetId);
    else if (t.targetType === "PRODUCT") productIds.push(t.targetId);
    else if (t.targetType === "BRAND") brandIds.push(t.targetId);
    else if (t.targetType === "CATEGORY") categoryIds.push(t.targetId);
  }

  if (explicit && explicit.length > 0) {
    const rows = await prisma.productVariant.findMany({
      where: { id: { in: explicit }, isActive: true, deletedAt: null },
      include: VARIANT_INCLUDE,
      orderBy: { id: "asc" },
      take: PREVIEW_LIMIT,
    });
    return rows as VariantRow[];
  }

  const where: Record<string, unknown> = { isActive: true, deletedAt: null };
  const or: Record<string, unknown>[] = [];
  if (variantIds.length > 0) or.push({ id: { in: variantIds } });
  if (productIds.length > 0) or.push({ productId: { in: productIds } });
  if (brandIds.length > 0) or.push({ product: { brandId: { in: brandIds } } });
  for (const categoryId of categoryIds) {
    const subtree = await expandCategorySubtree(categoryId);
    if (subtree.length > 0) or.push({ productId: { in: subtree } });
  }
  if (or.length === 0) return [];
  where.OR = or;

  const rows = await prisma.productVariant.findMany({
    where: where as never,
    include: VARIANT_INCLUDE,
    orderBy: { product: { name: "asc" } },
    take: PREVIEW_LIMIT,
  });
  return rows as VariantRow[];
}

/* ------------------------------------------------------------- the preview */

/**
 * Read-only price preview of one offer.
 *
 * `override` lets the operator try a value that is not saved yet; the stored
 * offer is never touched. The competing live offers are loaded so the engine
 * resolves priority and stacking exactly as checkout would.
 */
export async function previewPromotion(input: {
  promotionId: string;
  variantIds?: string[] | null;
  override?: PromotionPreviewOverride | null;
  /** Reference instant for the effective state (injected; no clock here). */
  now: Date;
}): Promise<PromotionPreviewResult> {
  const promo = await prisma.promotion.findUnique({
    where: { id: input.promotionId },
    include: { targets: true, rules: true, buyGetRules: true },
  });

  const base: PromotionPreviewResult = {
    promotionId: input.promotionId,
    promotionName: promo?.name ?? "",
    type: promo?.type ?? "",
    scope: promo?.scope ?? "",
    state: promo ? promotionEffectiveStatus(promo.status, promo.startAt, promo.endAt, input.now) : "",
    rows: [],
    empty: true,
  };
  if (!promo) return base;

  const graph = promo as unknown as PromoGraph;
  const variants = await targetVariants(graph, input.variantIds ?? null);
  if (variants.length === 0) return { ...base, promotionName: graph.name, type: graph.type, scope: graph.scope };

  // Live competitors: the engine decides the winner, so the preview has to
  // see the same competition checkout sees.
  const tree = await loadCategoryTree();
  const sub = (lineCid: string, targetCid: string) => inSubtree(tree, lineCid, targetCid);
  const live = await loadEffectivePromotions(null);
  const gated = new Set(
    (
      await prisma.$queryRaw<Array<{ pid: string }>>`
        SELECT DISTINCT promotion_id::text AS pid FROM coupons`
    ).map((r) => r.pid),
  );
  const thisRow = toEffectiveRow(graph, input.override ?? null);
  const promos: Array<EvalPromo & { name: string }> = [
    toEvalPromo(thisRow, sub),
    ...live
      .filter((r) => r.id !== graph.id && !gated.has(r.id))
      .map((r) => toEvalPromo(r, sub)),
  ];

  const lines: EvalLine[] = variants.map((v) => {
    // The engine's own exact decimal→hundredths conversion (no float math).
    const priceC = parseScaled(v.price.toString(), 2);
    const unit = v.product.productType === "WEIGHT" ? (v.sizeUnit ?? "GRAM") : "PIECE";
    return {
      key: v.id,
      ctx: {
        vid: v.id,
        pid: v.product.id,
        bid: v.product.brandId,
        cid: v.product.categoryId,
        pt: v.product.productType === "WEIGHT" ? "WEIGHT" : "PIECE",
        pu: unit,
        su: v.sizeUnit,
      },
      qtyT: ONE_SALE_UNIT_T,
      grossC: priceC,
      netC: priceC,
      unitPriceC: priceC,
    };
  });

  const images = await listPrimaryImagesForProducts([...new Set(variants.map((v) => v.product.id))]);

  // Availability is read from the inventory row itself: a missing row means
  // "unknown", a row with zero means "confirmed zero" — they never collapse.
  const inventoryRows = await prisma.inventory.findMany({
    where: { productVariantId: { in: variants.map((v) => v.id) } },
    select: { productVariantId: true, availableQuantity: true },
  });
  const availableByVariant = new Map(
    inventoryRows.map((r) => [
      r.productVariantId,
      r.availableQuantity === null ? null : r.availableQuantity.toString(),
    ]),
  );

  const rows: PromotionPreviewRow[] = variants.map((variant, index) => {
    const source = lines[index];
    const originalC = source.grossC;

    // The preview quotes ONE product alone — the same input the checkout gets
    // for a one-item cart — so the winner is selected for that single line
    // with the SAME selector checkout uses.
    const work: EvalLine = { ...source, netC: source.grossC };
    const selection = selectWinningOffer([work], promos);
    const winner = selection.winner;
    const offered: Array<EvalPromo & { name: string }> = winner
      ? [winner.promo as EvalPromo & { name: string }]
      : [];
    const lineApps = evaluateLines([work], offered).rows;
    const orderApps = evaluateOrderLayer([work], offered).rows;
    const finalC = work.netC;

    const mine = lineApps.filter((a) => a.promo.id === graph.id);
    const mineOrder = orderApps.filter((a) => a.promo.id === graph.id);
    const discountC = originalC - finalC;
    const winnerName = winner ? ((winner.promo as { name?: string }).name ?? null) : null;
    const applies = mine.length > 0 || mineOrder.length > 0;
    const blockedBy = winner && winner.promo.id !== graph.id ? winnerName : null;

    let reason: string | null = null;
    if (!applies) {
      const mineCandidate = selection.candidates.find((c) => c.promo.id === graph.id);
      if (blockedBy) {
        reason = `العرض صاحب الأولوية الأعلى هو اللي بيحسب الخصم (${blockedBy}) — العروض ماتتجمّعش مع بعض.`;
      } else if (promo.targets.length === 0) {
        reason = "العرض لسه مفيش عليه أي منتج مستهدف.";
      } else if (mineCandidate?.reason === "minimum_quantity") {
        reason = "العرض محتاج كمية أكبر من اللي اتعرضت.";
      } else if (mineCandidate?.reason === "minimum_amount") {
        reason = "العرض محتاج قيمة طلب أكبر من اللي اتعرضت.";
      } else if (mineCandidate?.reason === "no_match") {
        reason = "العرض مش بيخصم على المنتج ده.";
      } else if (mineCandidate?.reason === "zero_base") {
        reason = "مفيش قيمة يتخصم عليها في السطر ده.";
      } else {
        reason = "العرض مش بيخصم على المنتج ده.";
      }
    }
    return {
      variantId: variant.id,
      productId: variant.product.id,
      productName: variant.product.name,
      variantName: variant.name,
      imageUrl: images.get(variant.product.id)?.url ?? null,
      unitLabel: unitLabel(variant.product.productType, variant.sizeUnit),
      originalPrice: money(originalC),
      discountAmount: money(discountC),
      finalPrice: money(finalC),
      savingsPercent: percentOf(discountC, originalC),
      applies,
      winnerName,
      blockedBy,
      reason,
      availableQuantity: availableByVariant.has(variant.id) ? availableByVariant.get(variant.id) ?? null : null,
    };
  });

  return {
    promotionId: graph.id,
    promotionName: graph.name,
    type: graph.type,
    scope: graph.scope,
    state: promotionEffectiveStatus(graph.status, graph.startAt, graph.endAt, input.now),
    rows,
    empty: rows.length === 0,
  };
}
