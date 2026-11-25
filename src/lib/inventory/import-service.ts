import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, conflict } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";
import { assertAdminPreviewWritesAllowed } from "@/lib/auth/admin-read-only-preview";
import { operationDigest, signOperationPreview, verifyOperationPreview } from "@/lib/admin/operation-preview";
import { inventoryDifferences, stockImportSchema, type ImportTarget } from "@/lib/inventory/import-validation";

async function loadTargets(tx: Prisma.TransactionClient, codes: string[]): Promise<ImportTarget[]> {
  const rows = await tx.$queryRaw<Array<ImportTarget>>`
    SELECT v.id::text, p.id::text AS "productId", p.name || ' / ' || v.name AS name,
      ARRAY(SELECT code FROM product_codes WHERE product_variant_id=v.id ORDER BY code) AS codes,
      (p.is_active AND p.deleted_at IS NULL AND v.is_active AND v.deleted_at IS NULL) AS active,
      p.product_type AS "productType", v.size_unit AS "sizeUnit", v.price::text,
      i.quantity::text, coalesce(i.reserved_quantity,0)::text AS reserved,
      i.updated_at::text AS revision
    FROM product_variants v JOIN products p ON p.id=v.product_id
    LEFT JOIN inventory i ON i.product_variant_id=v.id
    WHERE EXISTS (SELECT 1 FROM product_codes c WHERE c.product_variant_id=v.id AND c.code=ANY(${codes}::text[]))
    ORDER BY v.id`;
  return rows;
}

export async function previewOrApplyInventoryImport(raw: unknown, actorId: string) {
  const parsed = stockImportSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("VALIDATION", "Invalid stock import.", parsed.error.flatten());
  const input = parsed.data;
  if (Date.parse(input.asOf) > Date.now() + 60_000) throw new ApiError("VALIDATION", "Stock timestamp cannot be in the future.");
  if (!input.dryRun) {
    assertAdminPreviewWritesAllowed();
    if (input.confirmed !== true) throw new ApiError("VALIDATION", "Explicit confirmation is required.");
  }
  const terms = { source:input.source, asOf:input.asOf, location:input.location, rows:input.rows };
  const fingerprint = operationDigest(terms);
  const sourceKey = operationDigest({ source:input.source, asOf:input.asOf, location:input.location });
  return prisma.$transaction(async tx => {
    if (!input.dryRun) {
      // One transaction lock for imports; ordinary checkout uses row locks below.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(712019, 1)::text`;
    }
    const prior = await tx.$queryRaw<Array<{ id:string; fingerprint:string }>>`
      SELECT entity_id::text AS id, new_values->>'fingerprint' AS fingerprint FROM audit_logs
      WHERE action='inventory.import' AND
        (new_values->>'fingerprint'=${fingerprint} OR new_values->>'sourceKey'=${sourceKey}) LIMIT 1`;
    if (prior.length) throw conflict("This source snapshot was already imported. Reconcile instead of replaying it.", { importId:prior[0].id });
    const codes = [...new Set(input.rows.flatMap(r => [r.code,r.productCode]).filter(Boolean))].sort();
    let targets = await loadTargets(tx, codes);
    if (!input.dryRun) {
      const products = [...new Set(targets.map(t => t.productId))].sort();
      const variants = targets.map(t => t.id).sort();
      await tx.$queryRaw`SELECT id FROM products WHERE id=ANY(${products}::uuid[]) ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM product_variants WHERE id=ANY(${variants}::uuid[]) ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM product_codes WHERE product_variant_id=ANY(${variants}::uuid[]) ORDER BY id FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM inventory WHERE product_variant_id=ANY(${variants}::uuid[]) ORDER BY product_variant_id FOR UPDATE`;
      targets = await loadTargets(tx, codes);
    }
    const differences = inventoryDifferences(input.rows, targets);
    const accepted = differences.filter(r => r.status === "accepted");
    const summary = { total: differences.length, accepted: accepted.length, rejected: differences.length - accepted.length,
      created: accepted.filter(r => r.before === null).length,
      changed: accepted.filter(r => r.before !== null && r.delta !== "0.000").length,
      unchanged: accepted.filter(r => r.delta === "0.000").length };
    const snapshot = { terms, reason:input.reason, targets, differences, summary };
    if (input.dryRun) return { applied:false, importId:null, summary, differences, previewReceipt: signOperationPreview("stock-import",actorId,snapshot) };
    verifyOperationPreview(input.previewReceipt,"stock-import",actorId,snapshot);
    if (!accepted.length) throw new ApiError("VALIDATION", "No accepted rows to import.");
    const importId = randomUUID();
    for (const row of accepted) {
      if (row.before === null) {
        // Null -> a declared opening balance, never a fabricated movement from zero.
        await tx.$executeRaw`INSERT INTO inventory (product_variant_id,quantity,reserved_quantity)
          VALUES (${row.variantId}::uuid,${row.after}::numeric,0)`;
      } else if (row.delta !== "0.000") {
        const count = await tx.$executeRaw`UPDATE inventory SET quantity=${row.after}::numeric
          WHERE product_variant_id=${row.variantId}::uuid AND quantity=${row.before}::numeric
            AND reserved_quantity<=${row.after}::numeric`;
        if (count !== 1) throw conflict("Stock changed; preview again.");
        await tx.$executeRaw`INSERT INTO inventory_movements
          (product_variant_id,movement_type,quantity,previous_quantity,new_quantity,reference_type,reference_id,reason,created_by)
          VALUES (${row.variantId}::uuid,'ADJUSTMENT',${row.delta}::numeric,${row.before}::numeric,${row.after}::numeric,
          'ADJUSTMENT',${importId},${input.reason},${actorId}::uuid)`;
      }
      await auditInTx(tx,{ action:"inventory.import_row", userId:actorId, entityType:"product_variants", entityId:row.variantId,
        oldValues:{quantity:row.before},newValues:{quantity:row.after,importId,sourceRow:row.row,reservedQuantity:row.reserved},reason:input.reason });
    }
    await auditInTx(tx,{ action:"inventory.import",userId:actorId,entityType:"inventory_import",entityId:importId,
      oldValues:null,newValues:{fingerprint,sourceKey,source:input.source,asOf:input.asOf,location:input.location,...summary},reason:input.reason });
    return { applied:true,importId,summary,differences,previewReceipt:null };
  }, { timeout:120_000, maxWait:10_000, isolationLevel:input.dryRun ? "RepeatableRead" : "ReadCommitted" });
}
