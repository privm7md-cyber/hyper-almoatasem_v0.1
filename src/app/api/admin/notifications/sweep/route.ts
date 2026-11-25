// ADM-11 (final round) — publish the store's REAL alerts to the owners.
//
// The sweep reads the inventory, promotions and coupons tables (the same rows
// the admin screens read) and writes one notification per new alert. It is a
// mutation, so the read-only preview vetoes it before any effect, and it
// needs the permissions of the domains it reads. The response carries counts
// only — the alert details go to the owner accounts, not to the caller.
import { NextResponse } from "next/server";
import { denyUnlessAll } from "@/lib/api/route-auth";
import { assertAdminPreviewWritesAllowed } from "@/lib/auth/admin-read-only-preview";
import { fail, ok } from "@/lib/api/respond";
import { sweepStoreAlerts } from "@/lib/admin/store-alerts";

export async function POST() {
  try {
    assertAdminPreviewWritesAllowed();
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
  const denied = await denyUnlessAll(["inventory.view", "promotions.view"]);
  if (denied) return denied;
  try {
    const result = await sweepStoreAlerts();
    const r = ok({ alerts: result.alerts, created: result.created });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
