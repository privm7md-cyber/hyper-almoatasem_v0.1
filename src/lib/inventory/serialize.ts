// BA-3 inventory serialization (boundary shapes).
//
// Decimals serialize as exact strings via Prisma Decimal toString (trailing
// zeros normalized away: "130.00" -> "130", "0.500" -> "0.5" — numerically
// exact; clients must parse as decimal, never string-compare). available is
// ALWAYS the database GENERATED value, never recomputed here. Stock status
// derives from the DB values: out_of_stock iff available <= 0; low_stock iff
// a threshold is set and available <= threshold (and > 0).
import type { Prisma } from "@prisma/client";
import { dec, decReq } from "@/lib/api/serialize";

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export function stockStatusFor(available: string, threshold: string | null): StockStatus {
  const a = Number(available);
  if (!(a > 0)) return "out_of_stock";
  if (threshold !== null && Number(threshold) >= 0 && a <= Number(threshold)) return "low_stock";
  return "in_stock";
}

export interface InventoryShape {
  productVariantId: string;
  quantity: string;
  reservedQuantity: string;
  /** Database GENERATED (quantity - reserved_quantity). Never written. */
  availableQuantity: string;
  lowStockThreshold: string | null;
  stockStatus: StockStatus;
  updatedAt: string;
}

export interface InventoryRow {
  productVariantId: string;
  quantity: Prisma.Decimal;
  reservedQuantity: Prisma.Decimal;
  availableQuantity: Prisma.Decimal | null;
  lowStockThreshold: Prisma.Decimal | null;
  updatedAt: Date;
}

export function toInventory(row: InventoryRow): InventoryShape {
  const available = row.availableQuantity === null ? "0" : decReq(row.availableQuantity);
  const threshold = dec(row.lowStockThreshold);
  return {
    productVariantId: row.productVariantId,
    quantity: decReq(row.quantity),
    reservedQuantity: decReq(row.reservedQuantity),
    availableQuantity: available,
    lowStockThreshold: threshold,
    stockStatus: stockStatusFor(available, threshold),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface MovementShape {
  id: string;
  productVariantId: string;
  movementType: string;
  quantity: string;
  previousQuantity: string;
  newQuantity: string;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface MovementRow {
  id: string;
  productVariantId: string;
  movementType: string;
  quantity: Prisma.Decimal;
  previousQuantity: Prisma.Decimal;
  newQuantity: Prisma.Decimal;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export function toMovement(row: MovementRow): MovementShape {
  return {
    id: row.id,
    productVariantId: row.productVariantId,
    movementType: row.movementType,
    quantity: decReq(row.quantity),
    previousQuantity: decReq(row.previousQuantity),
    newQuantity: decReq(row.newQuantity),
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    reason: row.reason,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}
