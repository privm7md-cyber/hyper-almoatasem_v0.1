// ADM-11 — own unread notification count (the topbar badge source).
import { NextResponse } from "next/server";
import { fail, ok } from "@/lib/api/respond";
import { adminSessionOrDeny } from "@/lib/api/route-auth";
import { countOwnUnreadNotifications } from "@/lib/admin/notifications";

export async function GET() {
  const gate = await adminSessionOrDeny("notifications.view");
  if ("denied" in gate) return gate.denied;
  try {
    const unreadCount = await countOwnUnreadNotifications(gate.admin);
    const r = ok({ unreadCount });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
