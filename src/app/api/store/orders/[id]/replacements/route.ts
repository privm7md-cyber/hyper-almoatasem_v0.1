// Storefront replacement list for one owned order.
// ?customerId= must own the order (guest ids via BA-4 identify — never
// phone lookup); foreign/unknown orders read as an empty-missing 404.
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { listReplacementsForCustomerOrder } from "@/lib/replacements/queries";
import { toReplacement } from "@/lib/replacements/serialize";

const querySchema = z.object({ customerId: uuidSchema });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: orderId } = await context.params;
  if (!uuidSchema.safeParse(orderId).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid order id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const rows = await listReplacementsForCustomerOrder(orderId, parsed.data.customerId);
  if (!rows) {
    const r = fail(new ApiError("NOT_FOUND", "Order not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(rows.map(toReplacement));
  return NextResponse.json(r.body, { status: r.status });
}
