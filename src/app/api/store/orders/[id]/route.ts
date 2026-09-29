// Storefront single order (snapshot read, ownership-scoped).
// ?customerId= must equal the order's customer (guests use the customer id
// returned by BA-4 identify — never phone lookup). Foreign/unknown → 404.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { z } from "zod";
import { getCustomerOrder } from "@/lib/orders/queries";
import { toOrder } from "@/lib/orders/serialize";

const querySchema = z.object({ customerId: uuidSchema });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid order id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getCustomerOrder(id, parsed.data.customerId);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Order not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok({ order: toOrder(row) });
  return NextResponse.json(r.body, { status: r.status });
}
