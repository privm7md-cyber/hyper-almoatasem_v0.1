// Admin guest-credential rotation (staff recovery path, BG-Guest-Order).
// Permission: orders.update. Atomically revokes the live credential and
// issues a fresh one + audit row, one tx. The new RAW token is returned
// exactly once in this response (for handoff through a verified channel);
// it is never persisted raw and never logged. Unknown order or no live
// credential → 404 (indistinguishable).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { auditInTx } from "@/lib/api/audit";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { getOrderFull } from "@/lib/orders/queries";
import { rotateGuestOrderCredential } from "@/lib/orders/guest-access";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
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
    const token = await prisma.$transaction(async (tx) => {
      const out = await rotateGuestOrderCredential(tx, orderId);
      await auditInTx(tx, {
        action: "orders.credential_rotate",
        userId: auth.admin.user.id,
        entityType: "orders",
        entityId: orderId,
        oldValues: null,
        newValues: { credential: "rotated" },
      });
      return out.token;
    });
    const r = ok({ guestOrderToken: token });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
