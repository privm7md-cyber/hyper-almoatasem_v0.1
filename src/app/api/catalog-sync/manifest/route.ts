// CS-08 — /api/catalog-sync/manifest: generate a frozen Studio manifest.
import { NextResponse } from "next/server";
import { adminOrDeny } from "@/lib/api/route-auth";
import { generateStudioManifest } from "@/lib/catalog-sync/manifest";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const gate = await adminOrDeny("catalog_sync.preview");
  if ("denied" in gate) return gate.denied;
  const body = (await request.json().catch(() => ({}))) as { source?: string; releaseId?: string; mode?: string };
  if (!["DRAFT", "V0", "RELEASE"].includes(body.source ?? "DRAFT")) {
    return NextResponse.json({ ok: false, error: "invalid_source" }, { status: 400 });
  }
  try {
    const manifest = generateStudioManifest({
      source: body.source ?? "DRAFT",
      releaseId: body.releaseId ?? "",
      mode: body.mode ?? "full",
    });
    return NextResponse.json({ ok: true, manifest }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 400 });
  }
}
