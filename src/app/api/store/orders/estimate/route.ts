// Storefront checkout estimate (read-only preview).
// Body { lines: [{ productVariantId, quantity }], couponCode? }.
// PHASE 2: per-customer coupon checks use the session customer when a
// valid session is presented, else anonymous (no client customerId claim).
// Server-side evaluation over live data (never trusts client amounts);
// checkout remains the sole committer (no locks, no bumps, no rows).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { estimateInputSchema } from "@/lib/promotions/validation";
import { estimateOnly } from "@/lib/promotions/checkout";
import { maybeCustomer } from "@/lib/customers/session";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = estimateInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid estimate request."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const customerId = await maybeCustomer(request);
    const out = await estimateOnly({
      lines: parsed.data.lines.map((l) => ({ variantId: l.productVariantId, quantity: l.quantity })),
      couponCode: parsed.data.couponCode ?? null,
      customerId,
    });
    const r = ok(out);
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
