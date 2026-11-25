// CS-08 — /api/catalog-sync/history: apply receipts from the disposable/engine environment.
import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/rbac";
import { historyEntries } from "@/lib/catalog-sync/service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const auth = await checkPermission("catalog_sync.preview");
  if (!auth.ok) return NextResponse.json({ ok: false, code: auth.code }, { status: auth.ok ? 200 : 401 });
  try {
    const rows = await historyEntries();
    return NextResponse.json({ ok: true, history: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
