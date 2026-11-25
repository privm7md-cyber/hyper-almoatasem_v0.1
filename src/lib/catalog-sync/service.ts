/**
 * CS-08 — Shared service layer used by /sync page and API routes.
 */
import { generateStudioManifest } from "./manifest";
import { diffManifest } from "./diff";
import { applyManifest } from "./apply";
import { isRealPrimaryTarget, readTargetIdentity } from "./read-catalog";
import { canonicalJson } from "./manifest";
import type { SyncManifest, SyncPreview } from "./types";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

export async function buildStudioManifest(args?: { source?: string; releaseId?: string; mode?: string; outDir?: string }): Promise<SyncManifest> {
  return generateStudioManifest(args ?? {});
}

export async function previewManifest(manifest: SyncManifest): Promise<SyncPreview> {
  const identity = await readTargetIdentity();
  const diff = await diffManifest(manifest.operations);
  return {
    previewId: `preview-${randomUUID()}`,
    manifestId: manifest.manifestId,
    digest: manifest.digest,
    studioSourceId: manifest.studio.sourceId,
    target: { database: identity.database, systemIdentifier: identity.systemIdentifier, environment: isRealPrimaryTarget(identity) ? "PRIMARY" : "DISPOSABLE", host: identity.host, port: identity.port },
    generatedAt: new Date().toISOString(),
    rows: diff.rows,
    counts: diff.counts,
    affectedProducts: diff.affectedProducts,
    affectedVariants: diff.affectedVariants,
    affectedCategories: diff.affectedCategories,
    affectedBrands: diff.affectedBrands,
    priceChanges: diff.priceChanges,
    lifecycleChanges: diff.lifecycleChanges,
  };
}

export interface ApplyServiceInput {
  manifest: unknown;
  actor: { id: string; permission: string };
  allowRealPrimary: boolean;
}

export async function applyManifestService(input: ApplyServiceInput): Promise<{ ok: boolean; status: string; receipt: unknown; error: string | null; errorCode: string | null }> {
  return applyManifest({ rawManifest: input.manifest, actor: input.actor, options: { allowRealPrimary: input.allowRealPrimary } });
}

export async function historyEntries(): Promise<Array<Record<string, unknown>>> {
  const { prisma } = await import("@/lib/db");
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT sync_job_id, manifest_id, actor_id, target_database, actor_permission, status, applied_count, already_applied_count, conflicted_count, failed_count, audit_event_count, result_digest, created_at, completed_at
    FROM sync_apply_receipts ORDER BY created_at DESC LIMIT 200`);
  return rows;
}

export function canonicalOf(manifest: SyncManifest): string {
  return canonicalJson({ studio: manifest.studio, sourceBaseline: manifest.sourceBaseline, operations: manifest.operations });
}
