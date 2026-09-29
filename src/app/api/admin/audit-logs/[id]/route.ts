// Admin single audit record (read-only).
// Read permission: audit_logs.view.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { getAudit } from "@/lib/admin/queries";
import { toAudit } from "@/lib/admin/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("audit_logs.view");
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid audit id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getAudit(id);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Audit record not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(toAudit(row));
  return NextResponse.json(r.body, { status: r.status });
}
