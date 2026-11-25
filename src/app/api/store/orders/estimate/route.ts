// Storefront checkout estimate (read-only preview).
// Body { lines: [{ productVariantId, quantity }], couponCode? }.
// PHASE 2: per-customer coupon checks use the session customer when a
// valid session is presented, else anonymous (no client customerId claim).
// Server-side evaluation over live data (never trusts client amounts);
// checkout remains the sole committer (no locks, no bumps, no rows).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { verifySameOrigin } from "@/lib/api/request-context";
import { fail, ok } from "@/lib/api/respond";
import { estimateInputSchema } from "@/lib/promotions/validation";
import { estimateOnly } from "@/lib/promotions/checkout";
import { maybeCustomer } from "@/lib/customers/session";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  if (!verifySameOrigin(request.headers, request.url)) {
    const r = fail(new ApiError("FORBIDDEN", "Cross-origin mutation is not permitted."));
    return NextResponse.json(r.body, { status: r.status });
  }
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
    // Registered path resolves the address server-side (the client never
    // supplies locality text for an owned address). Guest path passes explicit
    // locality fields; both feed the SAME zone resolver used by order create.
    let deliveryAddress = parsed.data.deliveryAddress ?? null;
    if (parsed.data.addressId != null) {
      if (customerId === null) {
        throw new ApiError("UNAUTHENTICATED", "Authentication is required.");
      }
      const address = await prisma.customerAddress.findFirst({
        where: { id: parsed.data.addressId, customerId },
        select: { city: true, area: true, village: true },
      });
      if (!address) throw new ApiError("NOT_FOUND", "Address not found.");
      deliveryAddress = { city: address.city, area: address.area, village: address.village };
    }
    const out = await estimateOnly({
      lines: parsed.data.lines.map((l) => ({ variantId: l.productVariantId, quantity: l.quantity })),
      couponCode: parsed.data.couponCode ?? null,
      customerId,
      deliveryAddress,
    });
    const r = ok(out);
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
