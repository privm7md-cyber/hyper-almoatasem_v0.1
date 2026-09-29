// Admin R5 pre-consent evaluation (staff-triggered SYSTEM approval).
// Permission: orders.update. Covered ⟺ the customer consented AND the
// signed delta spends within caps (≤0, or ≤10% of the original estimate
// AND ≤50 EGP, exact integers). Uncovered → 422 (explicit approval stays
// required). Approval materializes exactly like an explicit approve, with
// decided_by SYSTEM + the executing admin's id (the frozen CHECK demands a
// non-null decider id on terminal rows).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { autoAcceptReplacement } from "@/lib/replacements/writes";
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
    await autoAcceptReplacement({ replacementId: id, executorAdminId: auth.admin.user.id });
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
