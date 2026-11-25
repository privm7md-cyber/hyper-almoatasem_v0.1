// ADM-11 — own notification inbox (read-only listing).
//
// The inbox is scoped to the signed-in account in SQL (`user_id` is bound from
// the session, never from the request). Pagination is the same keyset cursor
// the page uses; the type filter is validated against the types this build
// actually writes, so the API can never be used to probe arbitrary values.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminSessionOrDeny } from "@/lib/api/route-auth";
import {
  countOwnUnreadNotifications,
  isKnownNotificationType,
  listOwnNotifications,
} from "@/lib/admin/notifications";

export async function GET(request: Request) {
  const gate = await adminSessionOrDeny("notifications.view");
  if ("denied" in gate) return gate.denied;
  const { admin } = gate;

  const params = new URL(request.url).searchParams;
  const cursor = params.get("cursor");
  const unread = params.get("unread") === "true";
  const type = params.get("type");

  if (type !== null && !isKnownNotificationType(type)) {
    const r = fail(new ApiError("VALIDATION", "Unknown notification type."));
    return NextResponse.json(r.body, { status: r.status });
  }

  try {
    const [page, unreadCount] = await Promise.all([
      listOwnNotifications(admin, cursor, unread, type),
      countOwnUnreadNotifications(admin),
    ]);
    const r = ok({ ...page, unreadCount });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
