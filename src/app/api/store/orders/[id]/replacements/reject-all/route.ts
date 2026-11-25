// Storefront: customer rejects ALL alternatives of one line (owner decision
// update, 2026-11-19). Ownership = session customer (registered) XOR valid
// guest credential for the path order (account-less BG-Guest-Order). The
// line is marked CANCELLED ("cancelled/omitted" — catalog product untouched).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { verifySameOrigin } from "@/lib/api/request-context";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { rejectAllProposedReplacements } from "@/lib/replacements/writes";
import { requireCustomer } from "@/lib/customers/session";
import { requireGuestOrder } from "@/lib/orders/guest-access";
import { prisma } from "@/lib/db";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!verifySameOrigin(request.headers, request.url)) {
    const r = fail(new ApiError("FORBIDDEN", "Cross-origin mutation is not permitted."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const { id: orderId } = await context.params;
  const url = new URL(request.url);
  const orderItemId = url.searchParams.get("orderItemId");
  if (
    !uuidSchema.safeParse(orderId).success ||
    orderItemId === null ||
    !uuidSchema.safeParse(orderItemId).success
  ) {
    const r = fail(new ApiError("VALIDATION", "Invalid order item id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const confirmed = (body as { confirmed?: unknown })?.confirmed === true;
  if (!confirmed) {
    const r = fail(new ApiError("VALIDATION", "Confirm rejecting every alternative offered for this order item."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const me = await requireCustomer(request).catch(() => null);
    if (me) {
      const owner = await prisma.order.findUnique({ where: { id: orderId }, select: { customerId: true } });
      if (!owner || owner.customerId !== me.customerId) {
        const r = fail(new ApiError("NOT_FOUND", "Order not found."));
        return NextResponse.json(r.body, { status: r.status });
      }
      const res = await rejectAllProposedReplacements({
        expectedOrderId: orderId,
        orderItemId,
        deciderType: "CUSTOMER",
        deciderId: me.customerId,
      });
      return NextResponse.json(ok(res));
    }
    // Guest separation: the order must be a guest order; the credential
    // row for a guest order is verified by requireGuestOrder.
    await requireGuestOrder(request, orderId);
    const owner = await prisma.order.findUnique({ where: { id: orderId }, select: { customerId: true } });
    if (!owner || owner.customerId !== null) {
      const r = fail(new ApiError("NOT_FOUND", "Order not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const res = await rejectAllProposedReplacements({ expectedOrderId: orderId, orderItemId, deciderType: "GUEST", deciderId: null });
    return NextResponse.json(ok(res));
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
