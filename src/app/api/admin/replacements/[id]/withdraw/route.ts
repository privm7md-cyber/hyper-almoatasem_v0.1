// Admin proposal withdrawal (staff).
// Permission: orders.update. Records CUSTOMER_REJECTED with a STAFF decider
// (frozen R5: withdrawal rides REJECTED) and no inventory effect —
// proposals never hold stock. Decided proposals answer 409.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { decideReplacement } from "@/lib/replacements/writes";
import { getReplacement } from "@/lib/replacements/queries";
import { toReplacement } from "@/lib/replacements/serialize";

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
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid replacement id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    await decideReplacement({
      replacementId: id,
      expectedOrderId: null,
      outcome: "reject",
      deciderType: "STAFF",
      deciderId: auth.admin.user.id,
    });
    const full = await getReplacement(id);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "Replacement not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(toReplacement(full));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
