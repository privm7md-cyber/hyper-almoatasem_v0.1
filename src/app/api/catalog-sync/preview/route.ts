// CS-08 — /api/catalog-sync/preview: three-way diff preview of a frozen manifest. Read-only.
import { NextResponse } from "next/server";
import { adminOrDeny } from "@/lib/api/route-auth";
import { validateManifest } from "@/lib/catalog-sync/manifest";
import { previewManifest } from "@/lib/catalog-sync/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const gate = await adminOrDeny("catalog_sync.preview");
  if ("denied" in gate) return gate.denied;
  const body = (await request.json().catch(() => ({}))) as { manifest?: unknown };
  if (!body.manifest || typeof body.manifest !== "object") return NextResponse.json({ ok: false, error: "missing_manifest" }, { status: 400 });
  const validated = validateManifest(body.manifest);
  if (!validated.ok) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  try {
    const preview = await previewManifest(validated.manifest);
    return NextResponse.json({ ok: true, preview }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
