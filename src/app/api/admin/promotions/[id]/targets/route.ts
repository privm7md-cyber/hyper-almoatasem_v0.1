// Admin promotion targets: add + remove (structure edits).
// Permission: promotions.update. Targets validate existence+liveness at
// write time (frozen activation rule); duplicates → 409; referenced
// promos reject edits (422, A21 immutability).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail } from "@/lib/api/respond";
import { adminOrDeny } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { targetInputSchema } from "@/lib/promotions/validation";
import { addTarget } from "@/lib/promotions/writes";
import { toTarget } from "@/lib/promotions/serialize";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await adminOrDeny("promotions.update");
  if ("denied" in gate) return gate.denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid promotion id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = targetInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid target."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const row = await addTarget(id, parsed.data.targetType, parsed.data.targetId, gate.admin.user.id);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Promotion not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = created(toTarget(row));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
