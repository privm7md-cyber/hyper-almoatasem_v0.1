import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { z } from "zod";

import type { SyncManifest } from "./types";

const sha = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

/** Canonical JSON (sorted keys) — the digest input is never source-file dependent. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export const manifestOperationSchema = z
  .object({
    type: z.enum(["SET_PRODUCT_FIELD", "SET_VARIANT_FIELD", "CREATE_PRODUCT", "CREATE_CATEGORY", "CREATE_BRAND"]),
    entityType: z.enum(["product", "product_variant", "category", "brand"]),
    entityId: z.string().min(1),
    field: z.string().min(1).optional(),
    base: z.unknown(),
    proposed: z.unknown(),
    productId: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
    variantId: z.string().nullable().optional(),
    price: z.string().nullable().optional(),
  })
  .passthrough();

const manifestSchema = z
  .object({
    manifestId: z.string().min(1),
    digest: z.string().min(1),
    studio: z.object({ source: z.string(), sourceId: z.string(), revision: z.number(), generatedAt: z.string() }),
    sourceBaseline: z.object({ id: z.string(), type: z.string() }),
    operations: z.array(manifestOperationSchema),
    counts: z.object({ products: z.number(), variants: z.number(), categories: z.number(), brands: z.number() }),
    validation: z.record(z.string(), z.unknown()).optional(),
    mode: z.string().optional(),
  })
  .passthrough();

export function validateManifest(raw: unknown): { ok: true; manifest: SyncManifest } | { ok: false; error: string } {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `invalid manifest: ${first?.message ?? "schema"} @ ${first?.path.join(".") ?? ""}` };
  }
  const m = parsed.data;
  const recomputed = computeManifestDigest(m);
  if (recomputed !== m.digest) {
    return { ok: false, error: `manifest digest mismatch: ${recomputed.slice(0, 16)}... != ${m.digest.slice(0, 16)}...` };
  }
  return { ok: true, manifest: m as SyncManifest };
}

export function computeManifestDigest(manifest: Pick<SyncManifest, "studio" | "sourceBaseline" | "operations">): string {
  return sha(canonicalJson({ sourceBaseline: manifest.sourceBaseline, operations: manifest.operations }));
}

export function generateStudioManifest(args: { source?: string; releaseId?: string; mode?: string; outDir?: string; file?: string; printJson?: boolean } = {}): SyncManifest {
  const script = path.join(process.env.STUDIO_ROOT ?? "D:/Hyper_Catalog_Studio", "scripts", "cs08-manifest-gen.mts");
  const outDir = args.outDir ?? process.env.CS08_MANIFEST_DIR ?? "D:/Hyper_Data_Review/CATALOG_REVIEW_STUDIO/CS_08/Manifests";
  const cmdArgs = ["--source", args.source ?? "DRAFT", "--releaseId", args.releaseId ?? "", "--mode", args.mode ?? "full", "--outDir", outDir];
  execFileSync(process.execPath, [script, ...cmdArgs], { cwd: process.env.STUDIO_ROOT ?? "D:/Hyper_Catalog_Studio", encoding: "utf8", timeout: 300000 });
  const files = fs.readdirSync(outDir).filter((f) => f.startsWith("cs08-manifest-") && f.endsWith(".json") && !f.includes(".receipt.")).sort((a, b) => fs.statSync(path.join(outDir, b)).mtimeMs - fs.statSync(path.join(outDir, a)).mtimeMs);
  if (!files.length) throw new Error(`Studio manifest artifact not produced in ${outDir}`);
  const targetFile = args.file ? path.resolve(args.file) : path.join(outDir, files[0]);
  const parsed = JSON.parse(fs.readFileSync(targetFile, "utf8"));
  const result = validateManifest(parsed);
  if (!result.ok) throw new Error(result.error);
  return result.manifest;
}
