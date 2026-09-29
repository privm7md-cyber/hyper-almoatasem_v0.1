// Admin promotion target removal (structure edit).
// Permission: promotions.update. Referenced promos reject (422).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { deleteTarget } from "@/lib/promotions/writes";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; targetId: string }> }) {
  const auth = await checkPermission("promotions.update");
  if (auth.ok === false) {
    const r = fail(
      new ApiError(
        auth.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
        auth.code === "UNAUTHENTICATED" ? "Authentication required." : "Forbidden.",
      ),
    );
    return NextResponse.json(r.body, { status: r.status });
  }
  const { id, targetId } = await context.params;
  if (!uuidSchema.safeParse(id).success || !uuidSchema.safeParse(targetId).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid target id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const done = await deleteTarget(id, targetId, auth.admin.user.id);
    if (done === null) {
      const r = fail(new ApiError("NOT_FOUND", "Target not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ deleted: true });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
