// ADM-07 admin price preview (READ-ONLY).
//
// The preview is a computation, not a mutation: it is a GET, it changes
// nothing, and it is refused for the same reasons every other admin read is
// refused. Permission: promotions.view + prices.view (a price is a separate
// capability from the offer itself). The response numbers come from the
// checkout pricing engine (`previewPromotion` → `evaluateLines` /
// `evaluateOrderLayer`), never from arithmetic in the browser.
//
// Query (all optional):
//   variantIds      — repeated variant ids to quote instead of the targets
//   discountPercent — a value to try before saving it (percentage)
//   discountAmount  — a value to try before saving it (fixed amount)
//   fixedPrice      — a value to try before saving it (fixed price)
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnlessAll } from "@/lib/api/route-auth";
import { strictObject, uuidSchema } from "@/lib/api/validation";
import { previewPromotion } from "@/lib/promotions/admin-preview";

/** A typed value the operator wants to try before saving it. */
const moneyText = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, { message: "Invalid amount." })
  .refine((s) => Number(s) > 0, { message: "Invalid amount." });

const querySchema = strictObject({
  variantIds: z.array(uuidSchema).max(12).optional(),
  discountPercent: moneyText.optional(),
  discountAmount: moneyText.optional(),
  fixedPrice: moneyText.optional(),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessAll(["promotions.view", "prices.view"]);
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid promotion id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    variantIds: url.searchParams.getAll("variantId"),
    discountPercent: url.searchParams.get("discountPercent") ?? undefined,
    discountAmount: url.searchParams.get("discountAmount") ?? undefined,
    fixedPrice: url.searchParams.get("fixedPrice") ?? undefined,
  });
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid preview request."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const result = await previewPromotion({
      promotionId: id,
      variantIds: parsed.data.variantIds && parsed.data.variantIds.length > 0 ? parsed.data.variantIds : null,
      override: {
        discountPercent: parsed.data.discountPercent ?? null,
        discountAmount: parsed.data.discountAmount ?? null,
        fixedPrice: parsed.data.fixedPrice ?? null,
      },
      now: new Date(),
    });
    const r = ok(result);
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
