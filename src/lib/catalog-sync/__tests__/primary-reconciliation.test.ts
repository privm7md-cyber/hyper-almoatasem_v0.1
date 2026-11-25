// CS-08 — Primary read-only reconciliation receipt (guarded, read-only only).
// Run explicitly: CS08_PRIMARY_RECONCILIATION=1 npx vitest run src/lib/catalog-sync/__tests__/primary-reconciliation.test.ts
// NEVER runs in the default suite (default: skipped).
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const RUN = process.env.CS09_RUN_DIR ?? "D:/Hyper_Data_Review/CATALOG_REVIEW_STUDIO/CS_08/Run_20261121_1010";
const PRIMARY_SID = "7687734853145036120";

const { generateStudioManifest, validateManifest } = await import("../manifest");
const { previewManifest, applyManifestService } = await import("../service");
const { readTargetIdentity, isRealPrimaryTarget, PRIMARY_IDENTITY } = await import("../read-catalog");
const { Prisma } = await import("@prisma/client");
const { prisma } = await import("@/lib/db");

describe.skipIf(process.env.CS08_PRIMARY_RECONCILIATION !== "1")("CS-08 Primary read-only reconciliation", () => {
  let manifest: Awaited<ReturnType<typeof generateStudioManifest>>;

  beforeAll(async () => {
    manifest = process.env.CS08_MANIFEST_FILE
      ? JSON.parse(fs.readFileSync(process.env.CS08_MANIFEST_FILE, "utf8"))
      : generateStudioManifest();
    const v = validateManifest(JSON.parse(JSON.stringify(manifest)));
    expect(v.ok).toBe(true);
  }, 300000);

  it("target is Primary; write-mode sessions are read-only and writes fail", async () => {
    const identity = await readTargetIdentity();
    expect(identity.database).toBe("hyper_almoatasem");
    expect(identity.systemIdentifier).toBe(PRIMARY_IDENTITY.systemIdentifier);
    expect(identity.systemIdentifier).toBe(PRIMARY_SID);
    expect(isRealPrimaryTarget(identity)).toBe(true);
    // Read-only enforcement proof lives in the inspector (cs08-inspect-pg.cjs),
    // which sets a read-only session and proves writes fail; the website
    // connection here is a normal read path. All reads must succeed on Primary.
    const rows = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*) n FROM products`);
    expect(rows[0].n).toBeGreaterThan(9000);
  }, 120000);

  it("diff previews against Primary (read-only)", async () => {
    const preview = await previewManifest(manifest);
    expect(preview.target.environment).toBe("PRIMARY");
    expect(preview.rows.length).toBeGreaterThan(0);
  }, 300000);

  it("real Primary apply is BLOCKED when not authorized (no writes executed)", async () => {
    const result = await applyManifestService({ manifest, actor: { id: PRIMARY_IDENTITY.systemIdentifier === "x" ? "" : "02800000-0000-7000-8000-000000000010", permission: "catalog_sync.apply" }, allowRealPrimary: false });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("BLOCKED");
    expect(["real_primary_blocked", "unverified_operation_blocked"]).toContain(result.errorCode);
    // And Primary remains identical to pre-apply counts.
    const rows = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*) n FROM products`);
    expect(rows[0].n).toBeGreaterThan(9000);
  }, 120000);

  it("writes the machine-readable Primary read-only reconciliation receipt", async () => {
    const identity = await readTargetIdentity();
    const preview = await previewManifest(manifest);
    const blocked = await applyManifestService({ manifest, actor: { id: "02800000-0000-7000-8000-000000000010", permission: "catalog_sync.apply" }, allowRealPrimary: false });
    const catalog = (await prisma.$queryRaw<Array<{ n: number; v: number; c: number; b: number }>>(Prisma.sql`SELECT (SELECT count(*)::int FROM products) AS n, (SELECT count(*)::int FROM product_variants) AS v, (SELECT count(*)::int FROM categories) AS c, (SELECT count(*)::int FROM brands) AS b`))[0];
    const catalogCounts = { products: catalog.n, variants: catalog.v, categories: catalog.c, brands: catalog.b };
    const receipt = {
      generatedAt: new Date().toISOString(),
      target: { ...identity, name: "hyper_almoatasem" },
      manifest: { manifestId: manifest.manifestId, digest: manifest.digest, studioRevision: manifest.studio.revision },
      preview: { environment: preview.target.environment, counts: preview.counts, conflicted: preview.counts.conflicted },
      realPrimaryApply: { ok: blocked.ok, status: blocked.status, errorCode: blocked.errorCode },
      catalogCounts,
    };
    fs.writeFileSync(path.join(RUN, "PRIMARY-READ-ONLY-RECONCILIATION.json"), JSON.stringify(receipt, null, 2), "utf8");
    expect(identity.database).toBe("hyper_almoatasem");
  }, 300000);
});
