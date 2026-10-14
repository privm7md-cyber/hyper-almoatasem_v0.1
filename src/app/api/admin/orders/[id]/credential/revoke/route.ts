// Admin guest-credential revocation (staff, BG-Guest-Order).
// Permission: orders.update. Revokes the order's live guest credential
// (if any) + audit row, one tx. Unknown order or no live credential → 404
// (indistinguishable). Raw tokens never appear: revocation stores no secret.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { auditInTx } from "@/lib/api/audit";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { revokeGuestOrderCredential } from "@/lib/orders/guest-access";

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
    const done = await prisma.$transaction(async (tx) => {
      const revoked = await revokeGuestOrderCredential(tx, orderId);
      if (!revoked) return false;
      await auditInTx(tx, {
        action: "orders.credential_revoke",
        userId: auth.admin.user.id,
        entityType: "orders",
        entityId: orderId,
        oldValues: null,
        newValues: { credential: "revoked" },
      });
      return true;
    });
    if (!done) {
      const r = fail(new ApiError("NOT_FOUND", "Order not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ revoked: true });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
