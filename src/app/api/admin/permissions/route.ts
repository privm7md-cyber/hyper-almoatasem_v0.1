// Admin permission registry: read-only list (frozen action registry).
// Permission: roles.view (documented closest-capability mapping — no
// permission-read key exists in the frozen 31-key matrix, and none is
// invented; grant management needs the registry visible).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { permissionListQuerySchema } from "@/lib/admin/validation";
import { listPermissions } from "@/lib/admin/queries";
import { toPermission } from "@/lib/admin/serialize";

export async function GET(request: Request) {
  const denied = await denyUnless("roles.view");
  if (denied) return denied;
  const parsed = permissionListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const q = parsed.data;
  const rows = await listPermissions({
    limit: q.limit,
    cursor: q.cursor ?? null,
    search: q.search ?? null,
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map(toPermission),
    { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
}
