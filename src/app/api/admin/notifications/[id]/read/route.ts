// ADM-11 — mark ONE notification as read.
//
// The update is scoped by `userId`, so an id belonging to another account is
// reported exactly like a missing id (404) and is never touched. The operation
// is idempotent: an already-read row keeps its original read time.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminSessionOrDeny } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { markOwnNotificationRead } from "@/lib/admin/notifications";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await adminSessionOrDeny(null);
  if ("denied" in gate) return gate.denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid notification id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const outcome = await markOwnNotificationRead(gate.admin, id);
    if (outcome === "missing") {
      const r = fail(new ApiError("NOT_FOUND", "Notification not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ updated: outcome === "updated", read: true });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
