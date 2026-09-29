// Admin audit trail: read-only feed (newest first, stable id cursor).
// Read permission: audit_logs.view. Filters are plain equality/range on
// indexed columns (user, action, entity, dates) — no full-text search, no
// materializations. No PATCH/DELETE exists (history is immutable).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { auditListQuerySchema } from "@/lib/admin/validation";
import { listAudit } from "@/lib/admin/queries";
import { toAudit } from "@/lib/admin/serialize";

export async function GET(request: Request) {
  const denied = await denyUnless("audit_logs.view");
  if (denied) return denied;
  const parsed = auditListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const q = parsed.data;
  const rows = await listAudit({
    limit: q.limit,
    cursor: q.cursor ?? null,
    userId: q.userId ?? null,
    action: q.action ?? null,
    entityType: q.entityType ?? null,
    entityId: q.entityId ?? null,
    since: q.since ?? null,
    until: q.until ?? null,
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map(toAudit),
    { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
}
