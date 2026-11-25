// ADM-11 — mark every unread notification of the signed-in account as read.
//
// Scoped by `userId`; returns the number of rows actually changed (0 when the
// inbox was already clear), so the UI never claims a write that did not happen.
import { NextResponse } from "next/server";
import { fail, ok } from "@/lib/api/respond";
import { adminSessionOrDeny } from "@/lib/api/route-auth";
import { markAllOwnNotificationsRead } from "@/lib/admin/notifications";

export async function POST() {
  const gate = await adminSessionOrDeny(null);
  if ("denied" in gate) return gate.denied;
  try {
    const updated = await markAllOwnNotificationsRead(gate.admin);
    const r = ok({ updated });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
