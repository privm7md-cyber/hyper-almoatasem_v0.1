// CS-08 — /api/catalog-sync/apply: transactional apply of an approved manifest.
// Production apply is disabled. The isolated execution gate lives in the service.
import { NextResponse } from "next/server";
import { adminOrDeny } from "@/lib/api/route-auth";
import { boundedJson } from "@/lib/api/bounded-body";
import { validateManifest } from "@/lib/catalog-sync/manifest";
import { applyManifestService } from "@/lib/catalog-sync/service";
import type { SyncApplyReceipt } from "@/lib/catalog-sync/types";

export const dynamic = "force-dynamic";

const allowRealPrimary = process.env.CS08_REAL_PRIMARY_ALLOWED === "true";

export async function POST(request: Request): Promise<Response> {
  const gate = await adminOrDeny("catalog_sync.apply");
  if ("denied" in gate) return gate.denied;
  const body = await boundedJson(request, 2 * 1024 * 1024).catch(() => null);
  if (!body || typeof body !== "object" || !("manifest" in body)) {
    return NextResponse.json({ ok: false, error: "missing_or_invalid_manifest" }, { status: 400 });
  }
  const validated = validateManifest(body.manifest);
  if (!validated.ok) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  try {
    const result = await applyManifestService({ manifest: validated.manifest, actor: { id: gate.admin.user.id, permission: "catalog_sync.apply" }, allowRealPrimary });
    return NextResponse.json(
      { ok: result.ok, status: result.status, receipt: result.receipt as SyncApplyReceipt | null, error: result.error, errorCode: result.errorCode },
      { status: result.ok ? 200 : 409, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ ok: false, errorCode: "engine_error" }, { status: 500 });
  }
}
