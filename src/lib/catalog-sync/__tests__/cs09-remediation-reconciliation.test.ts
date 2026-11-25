// CS-09 follow-up — guarded reconciliation of the post-remediation manifest
// against the disposable PostgreSQL only. Never runs in the default suite.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ENABLED = process.env.CS09_REMEDIATION_RECONCILIATION === "1";
const MANIFEST = process.env.CS09_REMEDIATION_MANIFEST ?? "";
const RUN = process.env.CS09_REVIEW_RUN ?? "";
const { readTargetIdentity, isRealPrimaryTarget } = await import("../read-catalog");
const { validateManifest } = await import("../manifest");
const { previewManifest, applyManifestService } = await import("../service");

describe.skipIf(!ENABLED)("CS-09 post-remediation disposable reconciliation", () => {
  it("reconciles the frozen post-remediation manifest against disposable PostgreSQL", async () => {
    expect(MANIFEST, "CS09_REMEDIATION_MANIFEST is required").toBeTruthy();
    const identity = await readTargetIdentity();
    expect(identity.database).toBe("hyper_disposable");
    expect(isRealPrimaryTarget(identity)).toBe(false);
    const raw = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    const parsed = validateManifest(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const preview = await previewManifest(parsed.manifest);
    const sum = Object.values(preview.counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(preview.rows.length);
    expect(preview.counts.invalid).toBe(0);
    expect(preview.counts.conflicted).toBe(0);
    if (RUN) {
      fs.writeFileSync(path.join(RUN, "DISPOSABLE-POST-REMEDIATION-RECONCILIATION.json"), JSON.stringify({
        generatedAt: new Date().toISOString(),
        target: { database: identity.database, systemIdentifier: identity.systemIdentifier, environment: preview.target.environment },
        manifest: { manifestId: parsed.manifest.manifestId, digest: parsed.manifest.digest, operationCount: parsed.manifest.operations.length },
        counts: preview.counts,
        rows: preview.rows.map((r) => ({ status: r.status, field: r.op.field, entityId: r.op.entityId, current: r.current, proposed: r.proposed })),
      }, null, 2));
    }
  }, 300000);

  it("fail-closed: unverified operation is never apply-capable", async () => {
    const raw = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    const parsed = validateManifest(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await applyManifestService({
      manifest: parsed.manifest,
      actor: { id: "02800000-0000-7000-8000-000000000010", permission: "catalog_sync.apply" },
      allowRealPrimary: false,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("BLOCKED");
    expect(result.errorCode).toBe("unverified_operation_blocked");
  }, 300000);
});
