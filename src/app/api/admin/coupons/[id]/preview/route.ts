// ADMIN COUPON PREVIEW — what the customer will actually see for this code.
//
// The preview runs the SAME rules the checkout runs (`evaluateCouponEligibility`
// in `src/lib/promotions/coupon-eligibility.ts`), against a REAL basket read
// from the database (real variant prices). It never writes: no usage row, no
// counter bump, no lock.
//
// Read permission: coupons.view (a preview reveals no more than the code
// itself, which the same reader may already see).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { prisma } from "@/lib/db";
import { divRoundHalfAway, matchLine, parseScaled, type EvalLine, type EvalPromo } from "@/lib/promotions/engine";
import { evaluateCouponEligibility } from "@/lib/promotions/coupon-eligibility";
import { getCouponAdmin, listCouponOfferTargets } from "@/lib/promotions/admin-coupon-queries";

export const runtime = "nodejs";

const MAX_ITEMS = 20;

interface PreviewItem {
  variantId: string;
  quantity: string;
}

function parseItems(body: unknown): PreviewItem[] {
  if (body === null || typeof body !== "object") return [];
  const raw = (body as { items?: unknown }).items;
  if (!Array.isArray(raw)) return [];
  const items: PreviewItem[] = [];
  for (const entry of raw.slice(0, MAX_ITEMS)) {
    if (entry === null || typeof entry !== "object") continue;
    const variantId = (entry as { variantId?: unknown }).variantId;
    const quantity = (entry as { quantity?: unknown }).quantity;
    if (typeof variantId !== "string" || variantId.trim() === "") continue;
    if (typeof quantity !== "string" || quantity.trim() === "") continue;
    items.push({ variantId: variantId.trim(), quantity: quantity.trim() });
  }
  return items;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("coupons.view");
  if (denied) return denied;
  const { id } = await context.params;
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const coupon = await getCouponAdmin(id).catch(() => null);
  if (!coupon) {
    const r = fail(new ApiError("NOT_FOUND", "Coupon not found."));
    return NextResponse.json(r.body, { status: r.status });
  }

  const items = parseItems(body);
  const basketProvided = items.length > 0;

  // The basket: real variant prices read from the database.
  const lines: EvalLine[] = [];
  for (const item of items) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: item.variantId },
      include: { product: true },
    });
    if (!variant || !variant.isActive || variant.deletedAt !== null) continue;
    const unit = variant.product.productType === "WEIGHT" ? variant.sizeUnit : "PIECE";
    const qtyT = parseScaled(item.quantity, 3);
    if (qtyT <= 0) continue;
    const priceC = parseScaled(variant.price.toString(), 2);
    lines.push({
      key: variant.id,
      ctx: {
        vid: variant.id,
        pid: variant.product.id,
        bid: variant.product.brandId,
        cid: variant.product.categoryId,
        pt: variant.product.productType as "PIECE" | "WEIGHT",
        pu: unit as string,
        su: variant.sizeUnit,
      },
      qtyT,
      grossC: divRoundHalfAway(qtyT * priceC, 1000),
      netC: divRoundHalfAway(qtyT * priceC, 1000),
      unitPriceC: priceC,
    });
  }

  // The offer's target lines — the same targets the checkout matches against.
  const targets = await listCouponOfferTargets(coupon.promotion_id);
  const probe = { targets, inSubtree: () => false } as unknown as EvalPromo;
  const eligibleIndexes = lines
    .map((_, index) => index)
    .filter((index) => targets.length === 0 || matchLine(lines[index].ctx, probe) > 0);
  const eligibleGrossC = eligibleIndexes.reduce((sum, index) => sum + lines[index].grossC, 0);
  const grossTotalC = lines.reduce((sum, line) => sum + line.grossC, 0);

  const evaluation = evaluateCouponEligibility({
    coupon: {
      id: coupon.id,
      promotion_id: coupon.promotion_id,
      promo_type: coupon.promo_type,
      promo_scope: coupon.promo_scope,
      pdp: coupon.pdp,
      pda: coupon.pda,
      promo_max: coupon.promo_max,
      usage_limit: coupon.usage_limit,
      used_count: coupon.used_count,
      per_customer_limit: coupon.per_customer_limit,
      minimum_order_amount: coupon.minimum_order_amount,
      own_ok: coupon.own_ok,
      parent_ok: coupon.parent_ok,
    },
    grossTotalC,
    eligibleGrossC,
    eligibleLineIndexes: eligibleIndexes,
    customerId: null,
    customerActiveUsages: null,
    autoDiscountedLines: [],
    autoOrderDiscount: false,
    mode: "preview",
    basketProvided,
  });

  const r = ok({
    code: coupon.code,
    status: coupon.status,
    discount: {
      type: coupon.promo_type,
      percent: coupon.promo_type === "PERCENTAGE" ? coupon.pdp : null,
      amount: coupon.promo_type === "FIXED_AMOUNT" ? coupon.pda : null,
      maximumDiscount: coupon.promo_max,
      offerName: coupon.promo_name,
    },
    limits: {
      minimumOrderAmount: coupon.minimum_order_amount,
      usageLimit: coupon.usage_limit,
      usedCount: coupon.used_count,
      perCustomerLimit: coupon.per_customer_limit,
      startAt: coupon.start_at ? coupon.start_at.toISOString() : null,
      endAt: coupon.end_at ? coupon.end_at.toISOString() : null,
    },
    basket: {
      provided: basketProvided,
      lineCount: lines.length,
      eligibleLineCount: eligibleIndexes.length,
      grossTotal: (grossTotalC / 100).toFixed(2),
      eligibleGross: (eligibleGrossC / 100).toFixed(2),
    },
    applicable: evaluation.applicable,
    blockedBy: evaluation.blockedBy,
    amount: evaluation.amountC === null ? null : (evaluation.amountC / 100).toFixed(2),
    base: evaluation.baseC === null ? null : (evaluation.baseC / 100).toFixed(2),
    conditions: evaluation.conditions,
    targets: targets.map((target) => `${target.tt}:${target.tid}`),
  });
  return NextResponse.json(r.body, { status: r.status });
}
