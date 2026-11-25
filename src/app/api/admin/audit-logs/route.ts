// Admin audit trail: read-only feed (newest first, stable id cursor).
// Read permission: audit_logs.view. Filters are plain equality/range on
// indexed columns (user, action, entity, dates) — no full-text search, no
// materializations. No PATCH/DELETE exists (history is immutable).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminOrDeny } from "@/lib/api/route-auth";
import { auditListQuerySchema } from "@/lib/admin/validation";
import { listAudit } from "@/lib/admin/queries";
import { toAudit } from "@/lib/admin/serialize";
import { AUDIT_ACTION_KEYS } from "@/lib/admin/audit-vocabulary";

export async function GET(request: Request) {
  const gate = await adminOrDeny("audit_logs.view");
  if ("denied" in gate) return gate.denied;
  const parsed = auditListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const q = parsed.data;
  // The action must be a real action of the vocabulary (the filter may never
  // offer or accept a token the store does not write).
  const action = q.action && AUDIT_ACTION_KEYS.includes(q.action) ? q.action : null;
  const raw = Object.fromEntries(new URL(request.url).searchParams);
  const rows = await listAudit({
    limit: q.limit,
    cursor: q.cursor ?? null,
    userId: q.userId ?? null,
    action,
    entityType: q.entityType ?? null,
    entityId: q.entityId ?? null,
    since: q.since ?? null,
    until: q.until ?? null,
    // ADM-11: the outcome and the sensitive filter are applied in SQL.
    outcome:
      raw.outcome === "FAILURE" ? "FAILURE" : raw.outcome === "SUCCESS" ? "SUCCESS" : null,
    sensitiveOnly: raw.sensitive === "true",
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map((row) => toAudit(row, gate.admin.permissions)),
    { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
}
