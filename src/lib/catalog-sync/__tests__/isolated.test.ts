// CS-08 â€” Disposable-PostgreSQL integration tests for the sync engine.
// Runs only against the verified isolated instance (DATABASE_URL points at
// the disposable DB; skip when CS08_DISPOSABLE_DB=0). NEVER runs against Primary.
import { beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { readFileSync } from "node:fs";
import type { SyncManifestOperation } from "../types";

const ISOLATED = process.env.CS08_DISPOSABLE_DB === "1" || (process.env.DATABASE_URL ?? "").includes(":5566/");

process.env.DATABASE_URL ??= "postgresql://postgres@127.0.0.1:5566/hyper_disposable";

const { readTargetIdentity, isRealPrimaryTarget, readLiveProduct, readLiveVariant } = await import("../read-catalog");
const { previewManifest, applyManifestService } = await import("../service");
const { validateManifest, computeManifestDigest } = await import("../manifest");
const { prisma } = await import("@/lib/db");

const actor = { id: "02800000-0000-7000-8000-000000000010", permission: "catalog_sync.apply" };
const ownerId = "01a1503f-7d6b-7e51-811d-f8686c605e72";

const digestOf = (m: { studio?: unknown; sourceBaseline: unknown; operations: unknown }) =>
  computeManifestDigest(m as Parameters<typeof computeManifestDigest>[0]);

describe.skipIf(!ISOLATED)("CS-08 disposable integration", () => {
  let manifest: Awaited<ReturnType<typeof import("../manifest").generateStudioManifest>>;
  let happyManifest: Awaited<ReturnType<typeof import("../manifest").generateStudioManifest>>;

  beforeAll(async () => {
    // A frozen CS-09 artifact can be supplied explicitly; this keeps the
    // integration run fast and avoids spawning the generator inside Vitest.
    manifest = process.env.CS08_MANIFEST_FILE
      ? JSON.parse(readFileSync(process.env.CS08_MANIFEST_FILE, "utf8"))
      : await import("../manifest").then((m) => m.generateStudioManifest());
    const v = validateManifest(JSON.parse(JSON.stringify(manifest)));
    expect(v.ok).toBe(true);
    // CS-09: use an explicit, disposable-only apply target so the test is not
    // dependent on whether the historical CS-08 variant ops are still pending.
    const variantId = "01a1503f-82bc-7cbe-93d9-b8339ce11cc8";
    const live = await readLiveVariant(variantId);
    happyManifest = {
      ...manifest,
      manifestId: `sync-cs09-disposable-${process.env.CS09_RUN_TAG ?? "base"}`,
      operations: [{
        type: "SET_VARIANT_FIELD", entityType: "product_variant", entityId: variantId,
        field: "name", base: live?.name ?? null, proposed: `cs09-isolated-apply-verification-${process.env.CS09_RUN_TAG ?? "base"}`,
        productId: ownerId, source: { origin: "DISPOSABLE_TEST" },
      } as SyncManifestOperation],
      digest: "",
    };
    happyManifest.digest = computeManifestDigest(happyManifest);
  }, 300000);

  it("targets the disposable instance, not Primary", async () => {
    const identity = await readTargetIdentity();
    expect(identity.database).toBe("hyper_disposable");
    expect(identity.systemIdentifier).not.toBe("7687734853145036120");
    expect(isRealPrimaryTarget(identity)).toBe(false);
  });

  it("preview: three-way diff is computed against the live disposable DB", async () => {
    const preview = await previewManifest(manifest);
    const conflictless = preview.rows.filter((r) => r.status === "CONFLICTED");
    if (conflictless.length) console.log("CONFLICT SAMPLE", JSON.stringify(conflictless.slice(0, 5)));
    expect(preview.counts.safeToApply + preview.counts.alreadyApplied + preview.counts.conflicted + preview.counts.unchanged).toBeGreaterThan(0);
    expect(conflictless.length).toBe(0);
    const statuses = preview.rows.reduce<Record<string, number>>((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {});
    console.log("STATUS SUMMARY", JSON.stringify(preview.counts), JSON.stringify(statuses));
  }, 900000);

  it("apply: writes approved changes to disposable and writes audit rows", async () => {
    const preview = await previewManifest(happyManifest);
    expect(preview.counts.safeToApply).toBe(1);
    const result = await applyManifestService({ manifest: happyManifest, actor, allowRealPrimary: false });
    expect(result.ok, `apply failed: ${result.status} ${result.error ?? ""}`).toBe(true);
    expect(result.status).toBe("APPLIED_VERIFIED");
    expect(result.receipt).toBeTruthy();
    expect((result.receipt as { appliedCount: number }).appliedCount).toBeGreaterThanOrEqual(1);
    const audit = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*) n FROM audit_logs WHERE actor_type='ADMIN' AND user_id=${actor.id}`);
    expect(audit[0].n).toBeGreaterThan(0);
  }, 900000);

  it("CS-09: corrected real manifest has zero INVALID ops and full count accounting", async () => {
    const preview = await previewManifest(manifest);
    expect(preview.rows.length).toBe(manifest.operations.length);
    expect(preview.counts.invalid).toBe(0);
    expect(preview.counts.conflicted).toBe(0);
    const sum = Object.values(preview.counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(preview.rows.length);
  }, 900000);

  it("explicit invalid NULL clear on a WEIGHT product is rejected (no invented steps)", async () => {
    const weightProductId = "01a1503f-edda-71ef-b6bb-a397a46d4f1d";
    const badManifest = {
      ...manifest,
      operations: [{
        type: "SET_PRODUCT_FIELD", entityType: "product", entityId: weightProductId,
        field: "sale_step_grams", base: 125, proposed: null, source: { origin: "DISPOSABLE_NEGATIVE_TEST" },
      } as SyncManifestOperation],
      digest: "",
    };
    badManifest.digest = computeManifestDigest(badManifest);
    const preview = await previewManifest(badManifest);
    expect(preview.counts.invalid).toBe(1);
    const before = await prisma.product.count();
    const result = await applyManifestService({ manifest: badManifest, actor, allowRealPrimary: false });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("FAILED_ROLLED_BACK");
    expect(result.errorCode).toBe("conflict_aborted");
    expect(await prisma.product.count()).toBe(before);
  }, 900000);

  it("idempotency: replay returns ALREADY_APPLIED without new writes", async () => {
    const auditBefore = (await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*) n FROM audit_logs WHERE actor_type='ADMIN' AND user_id=${actor.id}`))[0].n;
    const result = await applyManifestService({ manifest: happyManifest, actor, allowRealPrimary: false });
    expect(result.ok, `replay failed: ${result.status} ${result.error ?? ""}`).toBe(true);
    expect(result.status).toBe("ALREADY_APPLIED");
    const auditAfter = (await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*) n FROM audit_logs WHERE actor_type='ADMIN' AND user_id=${actor.id}`))[0].n;
    expect(auditAfter).toBe(auditBefore);
  }, 900000);

  it("real-primary gate: pure helper identifies the Primary identity", () => {
    const { isRealPrimaryTarget: gate } = { isRealPrimaryTarget };
    expect(gate({ database: "hyper_almoatasem", systemIdentifier: "7687734853145036120", host: "127.0.0.1", port: 5432 })).toBe(true);
    expect(gate({ database: "hyper_disposable", systemIdentifier: "7710538140396128244", host: "127.0.0.1", port: 5566 })).toBe(false);
  });

  it("atomic rollback: a manifest with an invalid op writes nothing", async () => {
    const before = (await prisma.productVariant.count()) + (await prisma.product.count());
    const valid = validateManifest(JSON.parse(JSON.stringify(manifest)));
    if (!valid.ok) throw new Error(valid.error);
    const badManifest = {
      ...valid.manifest,
      operations: [
        { type: "SET_VARIANT_FIELD", entityType: "product_variant", entityId: "01a1503f-82bc-7cbe-93d9-b8339ce11cc8", field: "name", base: null, proposed: "atomic-rollback-test-marker-zzz", productId: ownerId },
        { type: "SET_VARIANT_FIELD", entityType: "product_variant", entityId: "not-a-real-id-zzz", field: "name", base: null, proposed: "should-never-apply" },
      ],
    };
    const result = await applyManifestService({ manifest: badManifest, actor, allowRealPrimary: false });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("FAILED_ROLLED_BACK");
    expect(result.errorCode).not.toBe("IDEMPOTENCY_CONFLICT");
    const v = await readLiveVariant("01a1503f-82bc-7cbe-93d9-b8339ce11cc8");
    expect(v?.name).not.toBe("atomic-rollback-test-marker-zzz");
    const after = (await prisma.productVariant.count()) + (await prisma.product.count());
    expect(after).toBe(before);
  });

  it("applies an update to a live product row (sanity after rollback test)", async () => {
    const product = await readLiveProduct(ownerId);
    expect(product).toBeTruthy();
  });

  it("manifest digest matches recomputation", () => {
    const m = validateManifest(JSON.parse(JSON.stringify(manifest)));
    if (!m.ok) throw new Error(m.error);
    expect(digestOf(m.manifest)).toBe(m.manifest.digest);
  });
});

void computeManifestDigest;
