/**
 * CS-08 أ¢â‚¬â€‌ Transactional apply engine (website).
 *
 * - Validates every manifest op against live target rows inside one tx.
 * - Apply is restricted to the pinned isolated database and exact approval.
 * - Idempotency: `sync_idempotency` PK = manifestId:operationIndex; replay
 *   returns the stored receipt without re-writing (duplicate-safe after
 *   timeout, disconnect, restart).
 * - Audit: reuse the canonical `audit_logs` writer.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isValidPriceText, canonicalDecimal } from "@/lib/catalog/price";
import { auditInTx, serializeAuditValue, auditFieldDiff } from "@/lib/api/audit";

import { computeManifestDigest, validateManifest } from "./manifest";
import { diffManifest } from "./diff";
import { isRealPrimaryTarget, readTargetIdentity, readLiveProductCode } from "./read-catalog";
import type { SyncManifestOperation, SyncApplyReceipt, ApplyStatus, SyncTargetEnvironment } from "./types";

export interface ActorContext {
  id: string;
  permission: string;
}
export interface ApplyOptions {
  allowRealPrimary: boolean;
}

export interface ApplyOutcome {
  ok: boolean;
  status: ApplyStatus;
  receipt: SyncApplyReceipt | null;
  error: string | null;
  errorCode: string | null;
}
const PRODUCT_FIELDS: Record<string, string[]> = {
  name: ["name"],
  slug: ["slug"],
  product_code: ["productCode"],
  category_id: ["categoryId"],
  brand_id: ["brandId"],
  product_type: ["productType"],
  unit: ["unit"],
  sale_step_grams: ["saleStepGrams"],
  lifecycle: ["isActive", "deletedAt"],
};
const PRODUCT_UNITS = ["PIECE", "KG", "GRAM", "LITER", "ML"];
const SIZE_UNITS = ["GRAM", "KG", "ML", "LITER", "PIECE"];
function asDecimal(v: unknown): string | null {
  if (v == null || typeof v === "string" && v.trim() === "") return null;
  if (typeof v === "string") return isValidPriceText(v) ? canonicalDecimal(v)! : null;
  if (typeof v === "number") return String(v);
  return null;
}

export async function resolveOrCreateReference(tx: Prisma.TransactionClient, kind: "category" | "brand", id: string | null): Promise<string | null> {
  if (id == null) return null;
  // Studio-local ids are not UUIDs; Prisma type validation rejects them before
  // hitting the DB, so existence is checked via a raw cast-to-text query.
  const rows = kind === "category"
    ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM categories WHERE id::text = ${id} LIMIT 1`)
    : await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM brands WHERE id::text = ${id} LIMIT 1`);
  if (rows.length > 0) return id;
  if (!id.startsWith(kind === "category" ? "studio-cat-" : "studio-brand-")) throw new Error(`TARGET_REFERENCE_MISSING ${id}`);
  const websiteId = randomUUID();
  if (kind === "category") {
    await tx.category.create({ data: { id: websiteId, name: `Studio: ${id}`, slug: `studio-${websiteId.slice(0, 8)}`, isActive: true } });
  } else {
    await tx.brand.create({ data: { id: websiteId, name: `Studio: ${id}`, slug: `studio-${websiteId.slice(0, 8)}`, isActive: true } });
  }
  await tx.syncEntityMap.create({ data: { studioId: id, websiteId, kind } });
  return websiteId;
}

export async function applyManifest(input: {
  rawManifest: unknown;
  actor: ActorContext;
  options: ApplyOptions;
}): Promise<ApplyOutcome> {
  const { rawManifest, actor, options } = input;
  const validated = validateManifest(rawManifest);
  if (!validated.ok) return { ok: false, status: "FAILED_ROLLED_BACK", receipt: null, error: validated.error, errorCode: "invalid_manifest" };
  const manifest = validated.manifest;

  // Fail-closed approval eligibility: a technically valid operation whose
  // provenance is unverified is never apply-capable without explicit owner approval.
  const ineligible = manifest.operations.find((op) =>
    op.source?.approvalEligible === false || ["TEST", "UNVERIFIED"].includes(op.source?.provenance ?? ""));
  if (ineligible) {
    return {
      ok: false, status: "BLOCKED", receipt: null,
      error: `operation has unverified provenance and is not approval-eligible: ${ineligible.type}:${ineligible.entityId}:${ineligible.field ?? ""}`,
      errorCode: "unverified_operation_blocked",
    };
  }

  if (options.allowRealPrimary || process.env.CS08_REAL_PRIMARY_ALLOWED === "true" || process.env.VERCEL_ENV === "production") {
    return { ok: false, status: "BLOCKED", receipt: null, error: "Primary apply requires separate production authorization.", errorCode: "real_primary_blocked" };
  }
  const identity = await readTargetIdentity();
  if (isRealPrimaryTarget(identity)) {
    return { ok: false, status: "BLOCKED", receipt: null, error: "Primary apply requires separate production authorization.", errorCode: "real_primary_blocked" };
  }
  const isolated = identity.host === process.env.CS08_ISOLATED_HOST &&
    String(identity.port) === process.env.CS08_ISOLATED_PORT &&
    identity.database === process.env.CS08_ISOLATED_DATABASE &&
    identity.systemIdentifier === process.env.CS08_ISOLATED_SYSTEM_IDENTIFIER &&
    identity.database !== "hyper_almoatasem";
  if (!isolated) {
    return { ok: false, status: "BLOCKED", receipt: null, error: "Apply requires a pinned isolated database identity.", errorCode: "unverified_target" };
  }
  const approvedAt = process.env.CS08_ISOLATED_APPROVED_AT ?? "";
  const approvedTime = Date.parse(approvedAt);
  const age = Date.now() - approvedTime;
  if (manifest.manifestId !== process.env.CS08_ISOLATED_APPROVED_MANIFEST_ID ||
      manifest.digest !== process.env.CS08_ISOLATED_APPROVED_DIGEST ||
      actor.id !== process.env.CS08_ISOLATED_APPROVED_ACTOR ||
      !Number.isFinite(age) || age < 0 || age > 15 * 60 * 1000) {
    return { ok: false, status: "BLOCKED", receipt: null, error: "Apply requires recent owner approval for this exact isolated manifest.", errorCode: "manifest_approval_required" };
  }
  const startAt = new Date().toISOString();
  const syncJobId = `sync-${randomUUID()}`;
  const idempotencyKey = `${manifest.manifestId}:apply`;

  const receiptBase = {
    syncJobId, manifestId: manifest.manifestId, digest: manifest.digest,
    target: { database: identity.database, systemIdentifier: identity.systemIdentifier, environment: (isRealPrimaryTarget(identity) ? "PRIMARY" : "DISPOSABLE") as SyncTargetEnvironment },
    actor: { id: actor.id, userId: actor.id, permission: actor.permission },
    approval: { manifestDigest: manifest.digest, approvedBy: actor.id, approvedAt, tool: "isolated-owner-approval" },
    startAt, completedAt: null, operationCount: manifest.operations.length,
    appliedCount: 0, alreadyAppliedCount: 0, conflictedCount: 0, failedCount: 0, auditEventCount: 0,
    resultDigest: null, status: "APPLYING" as ApplyStatus, note: null,
  };

  const apply = async (): Promise<ApplyOutcome> => {
    const applied: Array<{ id: string; field: string }> = [];
    const auditEvents: Array<{ action: string; userId: string; entityType: string; entityId: string | null; oldValues: Record<string, unknown> | null; newValues: Record<string, unknown> | null }> = [];
    const applyOp = async (op: SyncManifestOperation, tx: Prisma.TransactionClient) => {
      switch (op.type) {
        case "SET_PRODUCT_FIELD": {
          const product = await tx.product.findUnique({ where: { id: op.entityId }, select: { id: true, deletedAt: true } });
          if (!product) throw new Error(`SOURCE_NOT_FOUND ${op.entityId}`);
          if (product.deletedAt != null && op.field !== "lifecycle") throw new Error(`TARGET_REFERENCE_MISSING ${op.entityId}`);
          const prior = await tx.product.findUnique({ where: { id: op.entityId } });
          if (op.field === "product_code") {
            const code = String(op.proposed ?? "").trim();
            if (!code) throw new Error("INVALID_OPERATION product_code empty");
            const variantId = (await tx.productVariant.findFirst({ where: { productId: op.entityId }, orderBy: [{ isActive: "desc" }, { createdAt: "asc" }, { id: "asc" }], select: { id: true } }))?.id ?? null;
            if (!variantId) throw new Error("SOURCE_NOT_FOUND product_code: product has no variant");
            const previousCode = await readLiveProductCode(op.entityId, tx);
            const barcodes = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM product_codes WHERE product_variant_id IN (SELECT id FROM product_variants WHERE product_id = ${op.entityId}::uuid) AND type='BARCODE' ORDER BY created_at, id LIMIT 1`);
            if (barcodes.length > 0) {
              const [first] = barcodes;
              await tx.productCode.update({ where: { id: first.id }, data: { code } });
            } else {
              const newVariant = (await tx.productVariant.findFirst({ where: { productId: op.entityId }, orderBy: [{ isActive: "desc" }, { createdAt: "asc" }, { id: "asc" }], select: { id: true } }))?.id;
              if (!newVariant) throw new Error("SOURCE_NOT_FOUND product_code: no variant");
              await tx.productCode.create({ data: { id: randomUUID(), productVariantId: newVariant, code, type: "BARCODE", isPrimary: true } });
            }
            applied.push({ id: op.entityId, field: "product_code" });
            auditEvents.push({ action: "products.sync", userId: actor.id, entityType: "products", entityId: op.entityId, oldValues: { product_code: previousCode }, newValues: { product_code: code } });
            break;
          }
          const col = PRODUCT_FIELDS[op.field ?? ""]?.[0];
          if (!col) throw new Error(`INVALID_OPERATION ${op.entityId}:${op.field}`);
          if (op.field === "lifecycle") {
            const life = op.proposed as string;
            if (life !== "visible" && life !== "hidden" && life !== "archived") throw new Error(`INVALID_OPERATION lifecycle ${life}`);
            const before = { isActive: prior?.isActive ?? true, deletedAt: prior?.deletedAt ?? null };
            const nowDate = new Date();
            const updateData: Record<string, unknown> = { isActive: life !== "hidden" && life !== "archived" };
            updateData.deletedAt = life === "archived" ? nowDate : null;
            const updated = await tx.product.update({ where: { id: op.entityId }, data: updateData, select: { id: true, isActive: true, deletedAt: true } });
            const diff = auditFieldDiff(before, { isActive: updated.isActive, deletedAt: updated.deletedAt }, ["isActive", "deletedAt"]);
            auditEvents.push({ action: "products.sync", userId: actor.id, entityType: "products", entityId: op.entityId, oldValues: diff.oldValues, newValues: diff.newValues });
            applied.push({ id: op.entityId, field: "isActive" });
            break;
          }
          const target = op.proposed;
          if (op.field === "category_id" || op.field === "brand_id") {
            const resolved = await resolveOrCreateReference(tx, op.field === "category_id" ? "category" : "brand", op.proposed == null ? null : String(op.proposed));
            const col = PRODUCT_FIELDS[op.field][0];
            const updated = await tx.product.update({ where: { id: op.entityId }, data: { [col]: resolved ?? null } as never, select: { id: true } });
            auditEvents.push({ action: "products.sync", userId: actor.id, entityType: "products", entityId: op.entityId, oldValues: { [col]: (prior as Record<string, unknown> | null)?.[col] ?? null }, newValues: { [col]: (updated as Record<string, unknown>)[col] ?? null } });
            applied.push({ id: op.entityId, field: col });
            break;
          }
          if (op.field === "product_type" && target !== "PIECE" && target !== "WEIGHT") throw new Error("INVALID_OPERATION product_type");
          if (op.field === "unit" && target != null && !PRODUCT_UNITS.includes(String(target))) throw new Error(`INVALID_OPERATION unit ${String(target)}`);
          const before = await tx.product.findUnique({ where: { id: op.entityId }, select: { [col]: true } });
          const updated = await tx.product.update({ where: { id: op.entityId }, data: { [col]: target ?? null } as never, select: { id: true, [col]: true } });
          auditEvents.push({ action: "products.sync", userId: actor.id, entityType: "products", entityId: op.entityId, oldValues: { [col]: before?.[col] ?? null }, newValues: { [col]: updated[col] } });
          applied.push({ id: op.entityId, field: col });
          break;
        }
        case "SET_VARIANT_FIELD": {
          const variant = await tx.productVariant.findUnique({ where: { id: op.entityId }, select: { id: true, deletedAt: true } });
          if (!variant) throw new Error(`SOURCE_NOT_FOUND ${op.entityId}`);
          if (variant.deletedAt != null) throw new Error(`TARGET_REFERENCE_MISSING ${op.entityId}`);
          const col = fieldForVariant(op.field ?? "");
          if (!col) throw new Error(`INVALID_OPERATION variant ${op.field}`);
          if (col === "price") {
            const priceStr = asDecimal(op.proposed);
            if (priceStr == null) throw new Error(`INVALID_OPERATION price ${JSON.stringify(op.proposed)}`);
            if (Number(priceStr) < 0) throw new Error("INVALID_OPERATION negative price");
          }
          if (col === "sizeValue") {
            const sv = op.proposed;
            if (sv != null && (typeof sv !== "string" || !/^\d+(?:\.\d{1,3})?$/.test(sv) || Number(sv) <= 0)) throw new Error(`INVALID_OPERATION size_value ${JSON.stringify(sv)}`);
          }
          if (col === "sizeUnit") {
            if (op.proposed != null && !SIZE_UNITS.includes(String(op.proposed).toUpperCase())) throw new Error(`INVALID_OPERATION size_unit ${String(op.proposed)}`);
          }
          const prior = await tx.productVariant.findUnique({ where: { id: op.entityId }, select: { [col]: true } });
          const data: Record<string, unknown> = { [col]: op.proposed ?? null };
          const updated = await tx.productVariant.update({ where: { id: op.entityId }, data: data as never, select: { id: true, [col]: true } });
          auditEvents.push({ action: "product_variants.sync", userId: actor.id, entityType: "product_variants", entityId: op.entityId, oldValues: { [col]: serializeAuditValue(prior?.[col] ?? null) }, newValues: { [col]: serializeAuditValue(updated[col] ?? null) } });
          applied.push({ id: op.entityId, field: col });
          break;
        }
        case "CREATE_CATEGORY": {
          const p = op.payload ?? {};
          const name = String(p.name ?? "");
          const slug = String(p.slug ?? "").trim();
          if (!name || !slug) throw new Error("INVALID_OPERATION CREATE_CATEGORY missing name/slug");
          const parentId = p.parentId ?? p.parent_id ?? null;
          if (parentId && !(await tx.category.findUnique({ where: { id: String(parentId) } }))) throw new Error(`TARGET_REFERENCE_MISSING parent ${String(parentId)}`);
          const exists = await tx.category.findUnique({ where: { slug }, select: { id: true } });
          if (exists) throw new Error(`already exists: ${slug}`);
          const row = await tx.category.create({ data: { id: op.entityId, name, slug, parentId: parentId ? String(parentId) : null, isActive: p.isActive !== false, sortOrder: Number(p.sortOrder ?? 0) }, select: { id: true, name: true, slug: true } });
          auditEvents.push({ action: "categories.sync", userId: actor.id, entityType: "categories", entityId: row.id, oldValues: null, newValues: { name, slug, parentId } });
          break;
        }
        case "CREATE_BRAND": {
          const p = op.payload ?? {};
          const name = String(p.name ?? "");
          const slug = String(p.slug ?? "").trim();
          if (!name || !slug) throw new Error("INVALID_OPERATION CREATE_BRAND missing name/slug");
          const exists = await tx.brand.findUnique({ where: { slug }, select: { id: true } });
          if (exists) throw new Error(`already exists: ${slug}`);
          const row = await tx.brand.create({ data: { id: op.entityId, name, slug, isActive: p.isActive !== false }, select: { id: true, name: true, slug: true } });
          auditEvents.push({ action: "brands.sync", userId: actor.id, entityType: "brands", entityId: row.id, oldValues: null, newValues: { name, slug } });
          break;
        }
        case "CREATE_PRODUCT": {
          const p = op.payload ?? {};
          const categoryId = p.category_id ?? p.categoryId;
          const brandId = p.brand_id ?? p.brandId;
          const cat = await tx.category.findUnique({ where: { id: String(categoryId ?? "") } });
          if (!cat) throw new Error(`TARGET_REFERENCE_MISSING category`);
          const row = await tx.product.create({
            data: {
              id: op.entityId, name: String(p.name ?? ""), slug: String(p.slug ?? ""),
              categoryId: cat.id, brandId: brandId ? String(brandId) : null,
              productType: (String(p.product_type ?? p.productType ?? "PIECE")) as "PIECE" | "WEIGHT",
              unit: String(p.unit ?? "PIECE") as "PIECE" | "KG" | "GRAM" | "LITER" | "ML",
              saleStepGrams: (p.sale_step_grams ?? p.saleStepGrams ?? null) as number | null,
              isActive: Number(p.is_active ?? p.isActive ?? 1) === 1,
            },
          });
          auditEvents.push({ action: "products.sync", userId: actor.id, entityType: "products", entityId: row.id, oldValues: null, newValues: { name: row.name, slug: row.slug } });
          const variantId = (op.variantId ?? null) as string | null;
          const price = op.price ?? (p as Record<string, unknown>).price ?? null;
          if (variantId && price != null) {
            const priceStr = asDecimal(price);
            if (priceStr == null) throw new Error(`INVALID_OPERATION product price ${JSON.stringify(price)}`);
            await tx.productVariant.create({ data: { id: variantId, productId: row.id, name: row.name, price: priceStr as `${number}`, isActive: true } });
            applied.push({ id: variantId, field: "price" });
          }
          break;
        }
      }
    };

    return prisma.$transaction(async (tx): Promise<ApplyOutcome> => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
      // Isolated apply only. Serialize catalog writes from the final comparison through the receipt.
      await tx.$executeRaw`LOCK TABLE categories, brands, products, product_variants, product_codes IN SHARE ROW EXCLUSIVE MODE`;
      const existing = await tx.syncIdempotency.findUnique({ where: { idempotencyKey }, select: { receipt: true } });
      if (existing) {
        const receipt = existing.receipt as unknown as SyncApplyReceipt;
        if (receipt.digest !== manifest.digest || receipt.actor.id !== actor.id) throw new Error("IDEMPOTENCY_CONFLICT");
        return { ok: true, status: "ALREADY_APPLIED", receipt, error: null, errorCode: null };
      }
      const diff = await diffManifest(manifest.operations, tx);
      const abortStatuses = new Set(["CONFLICTED", "INVALID_OPERATION", "SOURCE_NOT_FOUND", "TARGET_REFERENCE_MISSING", "DEPENDENCY_BLOCKED"]);
      const aborted = diff.rows.find((row) => abortStatuses.has(row.status));
      if (aborted) {
        return { ok: false, status: "FAILED_ROLLED_BACK", receipt: null, error: `manifest aborted: ${aborted.op.type}:${aborted.op.entityId}:${aborted.op.field} (${aborted.status})`, errorCode: "conflict_aborted" };
      }
      for (const row of diff.rows) {
        const { op } = row;
        if (row.status === "SAFE_TO_APPLY") {
          try {
            await applyOp(op, tx);
          } catch (error) {
            throw new Error(`${op.type}:${op.entityId}:${op.field ?? ""} ${(error as Error).message}`);
          }
        }
      }
      for (const ev of auditEvents) {
        await auditInTx(tx, { ...ev, entityId: ev.entityId ?? null });
      }
      const receipt: SyncApplyReceipt = {
        ...receiptBase,
        status: "APPLIED_VERIFIED",
        completedAt: new Date().toISOString(),
        appliedCount: applied.length,
        alreadyAppliedCount: 0,
        conflictedCount: 0,
        failedCount: 0,
        auditEventCount: auditEvents.length,
        resultDigest: computeManifestDigest(manifest),
      };
      await tx.syncIdempotency.create({ data: { idempotencyKey, manifestId: receipt.manifestId, studioSourceId: manifest.studio.sourceId, status: "APPLIED", receipt: JSON.parse(JSON.stringify(receipt)) as unknown as Prisma.InputJsonValue } });
      const data: { [key: string]: unknown } = {
        syncJobId: receipt.syncJobId,
        manifestId: receipt.manifestId,
        digest: receipt.digest,
        actorId: receipt.actor.id,
        targetDatabase: receipt.target.database,
        targetSystemIdentifier: receipt.target.systemIdentifier,
        actorPermission: receipt.actor.permission,
        status: "APPLIED",
        appliedCount: receipt.appliedCount,
        alreadyAppliedCount: 0,
        conflictedCount: 0,
        failedCount: 0,
        auditEventCount: receipt.auditEventCount,
        resultDigest: receipt.resultDigest,
        note: null,
      };
      await tx.syncApplyReceipt.create({ data: data as never });
      return { ok: true, status: "APPLIED_VERIFIED", receipt, error: null, errorCode: null };
    }, { timeout: 30000 });
  };

  try {
    return await apply();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status: ApplyStatus = message.startsWith("SOURCE_NOT_FOUND") || message.startsWith("TARGET_REFERENCE_MISSING") || message.startsWith("INVALID_OPERATION") || message.includes("already exists") ? "FAILED_ROLLED_BACK" : "FAILED_ROLLED_BACK";
    return { ok: false, status, receipt: null, error: message, errorCode: message.split(" ")[0] };
  }
}

function fieldForVariant(field: string): string | null {
  const map: Record<string, string> = { name: "name", price: "price", size_value: "sizeValue", size_unit: "sizeUnit", is_active: "isActive" };
  return map[field] ?? null;
}
