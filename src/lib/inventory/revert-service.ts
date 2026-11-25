// Inventory import revert (rollback) — the guarded inverse of previewOrApplyInventoryImport.
//
// Contract (rollback/reconciliation plan, deliverable #15):
//   • Dry-run by default: returns the full diff (deltas per variant) without writing.
//   • Apply requires confirmation; restored balances come from the import's own audit
//     rows — never invented numbers.
//   • Guarded like the import: advisory lock + guarded UPDATE per row (rowcount 0 → conflict).
//   • Balances the import created (old_values.quantity = NULL) revert to neutral zero —
//     rows are never deleted.
//   • Same-transaction audit trail: one inventory.revert_row per applied row + one
//     inventory.revert summary — always auditable, never silent.
//   • Returns the full diff (deltas) so the rollback plan can be reviewed first.
import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiError, conflict } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";
import { assertAdminPreviewWritesAllowed } from "@/lib/auth/admin-read-only-preview";
import { boundedThousandths, thousandthsText } from "@/lib/inventory/quantities";
import { prisma } from "@/lib/db";

export const revertStockImportInputSchema = z.object({
  importId: z.string().uuid(),
  dryRun: z.boolean(),
  confirmed: z.boolean().optional(),
}).strict();

export type RevertStockImportInput = z.infer<typeof revertStockImportInputSchema>;

interface RevertRow {
  variantId: string;
  target: string;   // previous balance text from the import audit ("0.000" if the variant was created by the import)
  current: string;  // live balance (expected to equal what the import set)
  created: boolean;
}

interface RevertDiff {
  variantId: string;
  target: string;
  current: string;
  delta: string | null; // target - current; null when nothing to do
  created: boolean;
}

async function loadRows(tx: Prisma.TransactionClient, importId: string): Promise<RevertRow[]> {
  // import_row audits are keyed by the variant id (the same shape the import wrote);
  // the import id lives in new_values.importId.
  return tx.$queryRaw<RevertRow[]>`
    SELECT al.entity_id::text AS "variantId",
           COALESCE(al.old_values->>'quantity','0.000') AS target,
           COALESCE(i.quantity::text,'0.000') AS current,
           (al.old_values->>'quantity') IS NULL AS created
    FROM audit_logs al
    LEFT JOIN inventory i ON i.product_variant_id = al.entity_id::uuid
    WHERE al.action = 'inventory.import_row'
      AND al.new_values->>'importId' = ${importId}
    ORDER BY al.entity_id`;
}

function diffs(rows: RevertRow[]): RevertDiff[] {
  return rows.map((row) => {
    const target = boundedThousandths(row.target), current = boundedThousandths(row.current);
    return { variantId: row.variantId, target: row.target, current: row.current,
      delta: target !== current ? thousandthsText(target - current) : null, created: row.created };
  });
}

async function exists(importId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int n FROM audit_logs
    WHERE action='inventory.import' AND entity_type='inventory_import' AND entity_id::text=${importId}`;
  return rows[0]?.n > 0;
}

export async function revertStockImport(input: RevertStockImportInput, actorId: string) {
  const parsed = revertStockImportInputSchema.parse(input);
  assertAdminPreviewWritesAllowed();
  if (!parsed.dryRun && parsed.confirmed !== true) throw new ApiError("VALIDATION", "Explicit confirmation is required.");
  if (!await exists(parsed.importId)) throw new ApiError("NOT_FOUND", `No stock import ${parsed.importId}.`);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(912021, 1)::text`;
    const rows = await loadRows(tx, parsed.importId);
    if (rows.length === 0) throw new ApiError("VALIDATION", "No rows recorded for this import.");
    const ids = rows.map((r) => r.variantId);
    const locked = await tx.$queryRaw<Array<{ variantId: string; current: string }>>`
      SELECT v.id::text AS "variantId", COALESCE(i.quantity::text,'0.000') AS current
      FROM product_variants v LEFT JOIN inventory i ON i.product_variant_id = v.id
      WHERE v.id = ANY(${ids}::uuid[]) ORDER BY v.id FOR UPDATE OF v`;
    const liveBy = new Map(locked.map((r) => [r.variantId, boundedThousandths(r.current)]));
    const planned: RevertRow[] = [];
    for (const row of rows) {
      const live = liveBy.get(row.variantId);
      if (live === undefined || live !== boundedThousandths(row.current)) {
        throw conflict("Balance changed; retry the revert.", { variantId: row.variantId });
      }
      const target = row.created ? 0 : boundedThousandths(row.target);
      if (target !== live) planned.push({ ...row, target: thousandthsText(target) });
    }
    const summary = { total: rows.length, planned: planned.length, reverted: 0 };
    if (!planned.length) return { applied: false, revertId: null, summary, diffs: diffs(rows) };
    if (!parsed.dryRun) {
      for (const row of planned) {
        const target = row.created ? 0 : boundedThousandths(row.target);
        const current = boundedThousandths(row.current);
        const count = await tx.$executeRaw`
          UPDATE inventory SET quantity=${row.target}::numeric
          WHERE product_variant_id=${row.variantId}::uuid AND quantity=${row.current}::numeric`;
        if (count !== 1) throw conflict("Balance changed; retry the revert.", { variantId: row.variantId });
        // chk_movements_math: new_quantity = previous_quantity + quantity (delta).
        await tx.$executeRaw`
          INSERT INTO inventory_movements
            (product_variant_id,movement_type,quantity,previous_quantity,new_quantity,reference_type,reference_id,reason,created_by)
          VALUES (${row.variantId}::uuid,'ADJUSTMENT',${target - current}::numeric,${current}::numeric,${target}::numeric,'ADJUSTMENT',${parsed.importId},'Reverted by operator',${actorId}::uuid)`;
        await auditInTx(tx, { action: "inventory.revert_row", userId: actorId, entityType: "product_variants", entityId: row.variantId,
          oldValues: { quantity: row.current }, newValues: { quantity: row.target, importId: parsed.importId }, reason: "Reverted by operator" });
      }
      const revertId = randomUUID();
      await auditInTx(tx, { action: "inventory.revert", userId: actorId, entityType: "inventory_import", entityId: revertId,
        oldValues: null, newValues: { importId: parsed.importId, summary: { total: rows.length, planned: planned.length, reverted: planned.length } }, reason: "Reverted by operator" });
      summary.reverted = planned.length;
    }
    return { applied: !parsed.dryRun, revertId: null, summary, diffs: diffs(rows) };
  }, { timeout: 60_000, maxWait: 5_000, isolationLevel: "ReadCommitted" });
  return result;
}
