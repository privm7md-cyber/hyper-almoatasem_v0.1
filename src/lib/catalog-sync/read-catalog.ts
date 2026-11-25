/**
 * CS-08 — read-only live reads from the target database (website).
 * Every read here is SELECT-only against the operational tables.
 */
import { prisma } from "@/lib/db";
import type { SyncManifestOperation } from "./types";

export interface TargetIdentity {
  database: string;
  systemIdentifier: string;
  host: string;
  port: number;
}

/** Never logs the connection password. */
export async function readTargetIdentity(): Promise<TargetIdentity> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`SELECT current_database() AS "database", (pg_control_system()).system_identifier::text AS "systemIdentifier"`,
  );
  const row = rows[0];
  return { database: String(row.database), systemIdentifier: String(row.systemIdentifier), host: url.hostname, port: Number(url.port || 5432) };
}

export const PRIMARY_IDENTITY = { database: "hyper_almoatasem", systemIdentifier: "7687734853145036120" };

export function isRealPrimaryTarget(identity: TargetIdentity): boolean {
  return identity.database === PRIMARY_IDENTITY.database && identity.systemIdentifier === PRIMARY_IDENTITY.systemIdentifier;
}

export async function readLiveProduct(id: string): Promise<{
  id: string; name: string; slug: string;
  categoryId: string | null; brandId: string | null; productType: string; unit: string;
  saleStepGrams: number | null; isActive: boolean; deletedAt: Date | null;
} | null> {
  return prisma.product.findFirst({
    where: { id },
    select: {
      id: true, name: true, slug: true, categoryId: true, brandId: true,
      productType: true, unit: true, saleStepGrams: true, isActive: true, deletedAt: true,
    },
  }) as Promise<{ id: string; name: string; slug: string; categoryId: string | null; brandId: string | null; productType: string; unit: string; saleStepGrams: number | null; isActive: boolean; deletedAt: Date | null } | null>;
}

export async function readLiveVariant(id: string): Promise<{
  id: string; productId: string; name: string; price: string; sizeValue: string | null; sizeUnit: string | null; isActive: boolean; deletedAt: Date | null;
} | null> {
  return prisma.productVariant.findFirst({
    where: { id },
    select: { id: true, productId: true, name: true, price: true, sizeValue: true, sizeUnit: true, isActive: true, deletedAt: true },
  }) as Promise<{ id: string; productId: string; name: string; price: string; sizeValue: string | null; sizeUnit: string | null; isActive: boolean; deletedAt: Date | null } | null>;
}

export async function readLiveCategory(id: string): Promise<{ id: string; name: string; slug: string; parentId: string | null; isActive: boolean; deletedAt: Date | null; sortOrder: number } | null> {
  return prisma.category.findFirst({
    where: { id },
    select: { id: true, name: true, slug: true, parentId: true, isActive: true, deletedAt: true, sortOrder: true },
  }) as Promise<{ id: string; name: string; slug: string; parentId: string | null; isActive: boolean; deletedAt: Date | null; sortOrder: number } | null>;
}

export async function readLiveBrand(id: string): Promise<{ id: string; name: string; slug: string; isActive: boolean; deletedAt: Date | null } | null> {
  return prisma.brand.findFirst({ where: { id }, select: { id: true, name: true, slug: true, isActive: true, deletedAt: true } });
}

export interface OpCurrent {
  current: unknown;
  exists: boolean;
  row: Record<string, unknown> | null;
}

/** Website product codes live on product_codes (per-variant), not on products. */
export async function readLiveProductCode(productId: string, db: Prisma.TransactionClient = prisma): Promise<string | null> {
  const row = await db.$queryRaw<Array<{ code: string }>>(Prisma.sql`
    SELECT pc.code AS code FROM product_codes pc
    JOIN product_variants v ON v.id = pc.product_variant_id
    WHERE v.product_id = ${productId}::uuid AND pc.type = 'BARCODE'
    ORDER BY pc.created_at, pc.id LIMIT 1`);
  return row[0]?.code ?? null;
}

export async function readOpCurrent(op: SyncManifestOperation): Promise<OpCurrent> {
  switch (op.entityType) {
    case "product": {
      const row = await readLiveProduct(op.entityId);
      if (!row) return { current: null, exists: false, row: null };
      const field = String(op.field ?? "");
      if (field === "isActive" || field === "deletedAt" || field === "lifecycle") {
        const life = row.deletedAt != null ? "archived" : row.isActive ? "visible" : "hidden";
        return { current: life, exists: true, row: { deletedAt: row.deletedAt, isActive: row.isActive, lifecycle: life } };
      }
      if (field === "product_code") return { current: await readLiveProductCode(row.id), exists: true, row: row as unknown as Record<string, unknown> };
      return { current: (row as unknown as Record<string, unknown>)[fieldMapping(field, "product")], exists: true, row: row as unknown as Record<string, unknown> };
    }
    case "product_variant": {
      const row = await readLiveVariant(op.entityId);
      if (!row) return { current: null, exists: false, row: null };
      const field = String(op.field ?? "");
      const mapped = fieldMapping(field, "product_variant");
      const cur = (row as unknown as Record<string, unknown>)[mapped];
      return { current: cur === undefined ? null : cur, exists: true, row: row as unknown as Record<string, unknown> };
    }
    case "category": {
      const row = await readLiveCategory(op.entityId);
      if (!row) return { current: null, exists: false, row: null };
      const field = String(op.field ?? "");
      if (field === "isActive") return { current: row.isActive, exists: true, row: row as unknown as Record<string, unknown> };
      const cur = (row as unknown as Record<string, unknown>)[fieldMapping(field, "category")];
      return { current: cur === undefined ? null : cur, exists: true, row: row as unknown as Record<string, unknown> };
    }
    case "brand": {
      const row = await readLiveBrand(op.entityId);
      if (!row) return { current: null, exists: false, row: null };
      const field = String(op.field ?? "");
      const cur = (row as unknown as Record<string, unknown>)[fieldMapping(field, "brand")];
      return { current: cur === undefined ? null : cur, exists: true, row: row as unknown as Record<string, unknown> };
    }
    default:
      return { current: null, exists: false, row: null };
  }
}

/** Studio field name → website Prisma column name. */
export function fieldMapping(field: string, entityType: string): string {
  const map: Record<string, Record<string, string>> = {
    product: {
      name: "name", slug: "slug", product_code: "productCode", category_id: "categoryId", brand_id: "brandId",
      product_type: "productType", unit: "unit", sale_step_grams: "saleStepGrams",
      is_active: "isActive", deleted_at: "deletedAt",
    },
    product_variant: { name: "name", price: "price", size_value: "sizeValue", size_unit: "sizeUnit", is_active: "isActive" },
    category: { name: "name", parent_id: "parentId", is_active: "isActive", sort_order: "sortOrder", slug: "slug" },
    brand: { name: "name", is_active: "isActive" },
  };
  return map[entityType]?.[field] ?? field;
}

import { Prisma } from "@prisma/client";
