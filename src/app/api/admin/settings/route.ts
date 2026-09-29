// Admin store settings: list (bootstrap-controlled key set).
// Read permission: settings.view. Keys are fixed — no create/delete.
import { NextResponse } from "next/server";
import { ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { listSettings } from "@/lib/admin/queries";
import { toSetting } from "@/lib/admin/serialize";

export async function GET() {
  const denied = await denyUnless("settings.view");
  if (denied) return denied;
  const rows = await listSettings();
  const r = ok(rows.map(toSetting));
  return NextResponse.json(r.body, { status: r.status });
}
