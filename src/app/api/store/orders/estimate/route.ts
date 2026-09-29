// Storefront checkout estimate (read-only preview).
// Body { lines: [{ productVariantId, quantity }], couponCode?, customerId? }.
// Server-side evaluation over live data (never trusts client amounts);
// checkout remains the sole committer (no locks, no bumps, no rows).
// Per-customer coupon checks need customerId, else report customer-required.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { estimateInputSchema } from "@/lib/promotions/validation";
import { estimateOnly } from "@/lib/promotions/checkout";
import { uuidSchema } from "@/lib/api/validation";

const bodySchema = estimateInputSchema.extend({ customerId: uuidSchema.nullish() });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid estimate request."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const out = await estimateOnly({
      lines: parsed.data.lines.map((l) => ({ variantId: l.productVariantId, quantity: l.quantity })),
      couponCode: parsed.data.couponCode ?? null,
      customerId: parsed.data.customerId ?? null,
    });
    const r = ok(out);
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
