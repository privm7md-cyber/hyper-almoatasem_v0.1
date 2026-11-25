// Admin guest-credential rotation (staff recovery path, BG-Guest-Order).
// Permission: orders.update. Atomically revokes the live credential and
// issues a fresh one + audit row, one tx. Admin responses never expose the
// raw token. No admin UI offers rotation without an approved secure delivery
// workflow. Unknown order or no live credential → 404 (indistinguishable).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import { verifySameOrigin } from "@/lib/api/request-context";
import { fail, ok } from "@/lib/api/respond";
import { auditInTx } from "@/lib/api/audit";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { getOrderFull } from "@/lib/orders/queries";
import { rotateGuestOrderCredential } from "@/lib/orders/guest-access";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!verifySameOrigin(request.headers, request.url)) {
    const r = fail(new ApiError("FORBIDDEN", "Cross-origin mutation is not permitted."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const auth = await checkPermission("orders.update");
  if (auth.ok === false) {
    const r = fail(
      new ApiError(
        auth.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
        auth.code === "UNAUTHENTICATED" ? "Authentication required." : "Forbidden.",
      ),
    );
    return NextResponse.json(r.body, { status: r.status });
  }
  const { id: orderId } = await context.params;
  if (!uuidSchema.safeParse(orderId).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid order id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const full = await getOrderFull(orderId);
    if (!full || full.customerId !== null) {
      const r = fail(new ApiError("NOT_FOUND", "Order not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    await prisma.$transaction(async (tx) => {
      await rotateGuestOrderCredential(tx, orderId);
      await auditInTx(tx, {
        action: "orders.credential_rotate",
        userId: auth.admin.user.id,
        entityType: "orders",
        entityId: orderId,
        oldValues: null,
        newValues: { credential: "rotated" },
      });
    });
    const r = ok({ credential: "rotated" });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
