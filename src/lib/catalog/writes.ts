// BA-2 catalog write domain (Prisma writes only, explicit transactions).
//
// Frozen rules enforced here (mirrored, DB remains sole enforcer):
// - product weight rule (WEIGHT↔KG/GRAM+step / PIECE↔PIECE+no step)
// - variant compare_at >= price, size_value > 0
// - price change ⇒ history row in the SAME tx (frozen convention)
// - single-primary switch is one atomic UPDATE (partial UQ guards)
// - IDs are app-generated UUIDv7 (DB gen_random_uuid() is backstop only)
// Prisma errors map to stable API errors: P2002 → 409, P2003 → 422,
// P2025 → NOT_FOUND-equivalent (callers translate to 404).
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, businessRule, conflict } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";
import type {
  BrandInput,
  CategoryInput,
  ProductInput,
  VariantInput,
} from "@/lib/catalog/validation";
import { normalizeSlug } from "@/lib/catalog/validation";

/** RFC 9562 UUIDv7 (unix-ms timestamp + rand_b): frozen app-ID strategy. */
export function newUuidV7(nowMs: number = Date.now()): string {
  const rand = randomBytes(10);
  const timeHex = nowMs.toString(16).padStart(12, "0");
  const b: number[] = [
    ...[0, 1, 2, 3, 4, 5].map((i) => parseInt(timeHex.slice(i * 2, i * 2 + 2), 16)),
    0x70 | (rand[0] & 0x0f),
    rand[1],
    0x80 | (rand[2] & 0x3f),
    rand[3],
    rand[4],
    rand[5],
    rand[6],
    rand[7],
    rand[8],
    rand[9],
  ];
  const hex = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

function isNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

/** Wrap a write: unique → 409, FK → 422, missing row → null (caller 404s). */
export async function catalogWrite<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict(`${label} already exists.`, null);
    }
    if (isForeignKeyViolation(error)) {
      throw businessRule(`Referenced ${label} parent does not exist.`, null);
    }
    if (isNotFound(error)) return null;
    if (error instanceof ApiError) throw error;
    throw error;
  }
}

/** Mirror of the frozen product weight CHECK (DB enforces; this fails fast). */
export function assertProductWeightShape(input: {
  productType: "PIECE" | "WEIGHT";
  unit: string;
  saleStepGrams?: number | null;
}): void {
  const ok =
    input.productType === "WEIGHT"
      ? (input.unit === "KG" || input.unit === "GRAM") &&
        input.saleStepGrams !== null &&
        input.saleStepGrams !== undefined &&
        input.saleStepGrams > 0
      : input.unit === "PIECE" && (input.saleStepGrams === null || input.saleStepGrams === undefined);
  if (!ok) {
    throw businessRule("Product weight shape violates the catalog weight rule.", null);
  }
}

/** Mirror of frozen variant CHECKs (DB enforces; this fails fast). */
export function assertVariantShape(input: {
  sizeValue?: string | null;
  price: string;
  compareAtPrice?: string | null;
}): void {
  if (input.sizeValue !== null && input.sizeValue !== undefined && Number(input.sizeValue) <= 0) {
    throw businessRule("Variant size must be positive.", null);
  }
  if (input.compareAtPrice !== null && input.compareAtPrice !== undefined && Number(input.compareAtPrice) < Number(input.price)) {
    throw businessRule("Compare-at price must be at least the selling price.", null);
  }
}

export function resolveSlug(explicit: string | null | undefined, name: string): string {
  const base = explicit && explicit.trim() !== "" ? explicit : name;
  const slug = normalizeSlug(base);
  if (!slug) throw businessRule("Slug is empty after normalization.", null);
  return slug;
}

export async function createCategory(input: CategoryInput, actorId: string) {
  return catalogWrite("Category", () =>
    prisma.$transaction(async (tx) => {
      const created = await tx.category.create({
        data: {
          id: newUuidV7(),
          name: input.name,
          slug: resolveSlug(input.slug, input.name),
          description: input.description ?? null,
          image: input.image ?? null,
          parentId: input.parentId ?? null,
          sortOrder: input.sortOrder ?? 0,
          isActive: input.isActive ?? true,
        },
      });
      await auditInTx(tx, {
        action: "categories.create",
        userId: actorId,
        entityType: "categories",
        entityId: created.id,
        oldValues: null,
        newValues: { name: created.name, slug: created.slug },
      });
      return created;
    }),
  );
}

export async function patchCategory(id: string, input: Partial<CategoryInput>, actorId: string) {
  return catalogWrite("Category", () =>
    prisma.$transaction(async (tx) => {
      // Explicit assignments (not conditional spreads): the spread-union form
      // defeats Prisma's Without<> conditional input type under strict mode.
      // Null passes through only to nullable columns; non-nullable columns
      // treat stray null as absent (the API boundary already rejects null
      // there with 400 — see categoryPatchSchema).
      const data: {
        name?: string;
        slug?: string;
        description?: string | null;
        image?: string | null;
        parentId?: string | null;
        sortOrder?: number;
        isActive?: boolean;
      } = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.slug !== undefined) {
        const resolved = input.slug === null ? undefined : resolveSlug(input.slug, input.name ?? "");
        if (resolved !== undefined) data.slug = resolved;
      }
      if (input.description !== undefined) data.description = input.description;
      if (input.image !== undefined) data.image = input.image;
      if (input.parentId !== undefined) data.parentId = input.parentId;
      if (input.sortOrder != null) data.sortOrder = input.sortOrder;
      if (input.isActive != null) data.isActive = input.isActive;
      const updated = await tx.category.update({ where: { id }, data });
      await auditInTx(tx, {
        action: "categories.update",
        userId: actorId,
        entityType: "categories",
        entityId: id,
        oldValues: null,
        newValues: { name: updated.name, slug: updated.slug },
      });
      return updated;
    }),
  );
}

export async function createBrand(input: BrandInput, actorId: string) {
  return catalogWrite("Brand", () =>
    prisma.$transaction(async (tx) => {
      const created = await tx.brand.create({
        data: {
          id: newUuidV7(),
          name: input.name,
          slug: resolveSlug(input.slug, input.name),
          logo: input.logo ?? null,
          isActive: input.isActive ?? true,
        },
      });
      await auditInTx(tx, {
        action: "brands.create",
        userId: actorId,
        entityType: "brands",
        entityId: created.id,
        oldValues: null,
        newValues: { name: created.name, slug: created.slug },
      });
      return created;
    }),
  );
}

export async function patchBrand(id: string, input: Partial<BrandInput>, actorId: string) {
  return catalogWrite("Brand", () =>
    prisma.$transaction(async (tx) => {
      // Explicit assignments (not conditional spreads): the spread-union form
      // defeats Prisma's Without<> conditional input type under strict mode.
      // Null passes through only to nullable columns; non-nullable columns
      // treat stray null as absent (the API boundary already rejects null
      // there with 400 — see brandPatchSchema).
      const data: {
        name?: string;
        slug?: string;
        logo?: string | null;
        isActive?: boolean;
      } = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.slug !== undefined) {
        const resolved = input.slug === null ? undefined : resolveSlug(input.slug, input.name ?? "");
        if (resolved !== undefined) data.slug = resolved;
      }
      if (input.logo !== undefined) data.logo = input.logo;
      if (input.isActive != null) data.isActive = input.isActive;
      const updated = await tx.brand.update({ where: { id }, data });
      await auditInTx(tx, {
        action: "brands.update",
        userId: actorId,
        entityType: "brands",
        entityId: id,
        oldValues: null,
        newValues: { name: updated.name, slug: updated.slug },
      });
      return updated;
    }),
  );
}

async function assertCategoryExists(id: string): Promise<void> {
  const row = await prisma.category.findUnique({ where: { id }, select: { id: true } });
  if (!row) throw businessRule("Category does not exist.", null);
}

async function assertBrandExists(id: string | null | undefined): Promise<void> {
  if (id === null || id === undefined) return;
  const row = await prisma.brand.findUnique({ where: { id }, select: { id: true } });
  if (!row) throw businessRule("Brand does not exist.", null);
}

export async function createProduct(input: ProductInput, actorId: string) {
  assertProductWeightShape(input);
  await assertCategoryExists(input.categoryId);
  await assertBrandExists(input.brandId);
  return catalogWrite("Product", () =>
    prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          id: newUuidV7(),
          name: input.name,
          slug: resolveSlug(input.slug, input.name),
          description: input.description ?? null,
          categoryId: input.categoryId,
          brandId: input.brandId ?? null,
          productType: input.productType,
          unit: input.unit,
          saleStepGrams: input.saleStepGrams ?? null,
          isActive: input.isActive ?? true,
        },
      });
      await auditInTx(tx, {
        action: "products.create",
        userId: actorId,
        entityType: "products",
        entityId: created.id,
        oldValues: null,
        newValues: { name: created.name, slug: created.slug },
      });
      return created;
    }),
  );
}

export async function patchProduct(
  id: string,
  input: { name?: string; slug?: string | null; description?: string | null; categoryId?: string; brandId?: string | null; isActive?: boolean },
  actorId: string,
) {
  if (input.categoryId !== undefined) await assertCategoryExists(input.categoryId);
  if (input.brandId !== undefined) await assertBrandExists(input.brandId);
  return catalogWrite("Product", () =>
    prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.slug !== undefined
            ? { slug: input.slug === null ? undefined : resolveSlug(input.slug, input.name ?? "") }
            : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          ...(input.brandId !== undefined ? { brandId: input.brandId } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      await auditInTx(tx, {
        action: "products.update",
        userId: actorId,
        entityType: "products",
        entityId: id,
        oldValues: null,
        newValues: { name: updated.name, slug: updated.slug },
      });
      return updated;
    }),
  );
}

async function assertProductExists(id: string): Promise<void> {
  const row = await prisma.product.findUnique({ where: { id }, select: { id: true } });
  if (!row) throw businessRule("Product does not exist.", null);
}

export async function createVariant(input: VariantInput, actorId: string) {
  assertVariantShape(input);
  await assertProductExists(input.productId);
  return catalogWrite("Variant", () =>
    prisma.$transaction(async (tx) => {
      const created = await tx.productVariant.create({
        data: {
          id: newUuidV7(),
          productId: input.productId,
          name: input.name,
          sizeValue: input.sizeValue ?? null,
          sizeUnit: input.sizeUnit ?? null,
          price: input.price,
          compareAtPrice: input.compareAtPrice ?? null,
          costPrice: input.costPrice ?? null,
          isActive: input.isActive ?? true,
        },
      });
      await auditInTx(tx, {
        action: "variants.create",
        userId: actorId,
        entityType: "product_variants",
        entityId: created.id,
        oldValues: null,
        newValues: { name: created.name, price: created.price.toString() },
      });
      return created;
    }),
  );
}

export async function patchVariant(
  id: string,
  input: { name?: string; sizeValue?: string | null; sizeUnit?: string | null; compareAtPrice?: string | null; costPrice?: string | null; isActive?: boolean },
  actorId: string,
) {
  if (
    input.sizeValue !== undefined ||
    (input.compareAtPrice !== undefined && input.compareAtPrice !== null)
  ) {
    const current = await prisma.productVariant.findUnique({
      where: { id },
      select: { price: true, compareAtPrice: true, sizeValue: true },
    });
    if (!current) return null;
    assertVariantShape({
      sizeValue: input.sizeValue !== undefined ? input.sizeValue : current.sizeValue?.toString() ?? null,
      price: current.price.toString(),
      compareAtPrice:
        input.compareAtPrice !== undefined ? input.compareAtPrice : current.compareAtPrice?.toString() ?? null,
    });
  }
  return catalogWrite("Variant", () =>
    prisma.$transaction(async (tx) => {
      const updated = await tx.productVariant.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.sizeValue !== undefined ? { sizeValue: input.sizeValue } : {}),
          ...(input.sizeUnit !== undefined ? { sizeUnit: input.sizeUnit } : {}),
          ...(input.compareAtPrice !== undefined ? { compareAtPrice: input.compareAtPrice } : {}),
          ...(input.costPrice !== undefined ? { costPrice: input.costPrice } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      await auditInTx(tx, {
        action: "variants.update",
        userId: actorId,
        entityType: "product_variants",
        entityId: id,
        oldValues: null,
        newValues: { name: updated.name },
      });
      return updated;
    }),
  );
}

/** Price change + history row + audit row in ONE tx (frozen convention —
 * never one without the other; audit joins the same tx). */
export async function updateVariantPrice(id: string, price: string, reason: string | null, changedBy: string | null, actorId: string) {
  const current = await prisma.productVariant.findUnique({
    where: { id },
    select: { price: true, compareAtPrice: true },
  });
  if (!current) return null;
  if (current.compareAtPrice !== null && Number(price) > Number(current.compareAtPrice)) {
    throw businessRule("New price exceeds the compare-at price.", null);
  }
  if (current.price.toString() === price) return current as unknown as Awaited<ReturnType<typeof prisma.productVariant.update>>;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.productVariant.update({ where: { id }, data: { price } });
    await tx.productPriceHistory.create({
      data: {
        id: newUuidV7(),
        productVariantId: id,
        oldPrice: current.price.toString(),
        newPrice: price,
        changedBy,
        reason,
      },
    });
    await auditInTx(tx, {
      action: "variants.price",
      userId: actorId,
      entityType: "product_variants",
      entityId: id,
      oldValues: { price: current.price.toString() },
      newValues: { price },
    });
    return updated;
  });
}

export async function createCode(input: { productVariantId: string; code: string; type: "BARCODE" | "INTERNAL_CODE"; isPrimary?: boolean | null }, actorId: string) {
  await assertVariantExists(input.productVariantId);
  return catalogWrite("ProductCode", () =>
    prisma.$transaction(async (tx) => {
      const created = await tx.productCode.create({
        data: {
          id: newUuidV7(),
          productVariantId: input.productVariantId,
          code: input.code,
          type: input.type,
          isPrimary: input.isPrimary ?? false,
        },
      });
      await auditInTx(tx, {
        action: "codes.create",
        userId: actorId,
        entityType: "product_codes",
        entityId: created.id,
        oldValues: null,
        newValues: { code: created.code, type: created.type },
      });
      return created;
    }),
  );
}

async function assertVariantExists(id: string): Promise<void> {
  const row = await prisma.productVariant.findUnique({ where: { id }, select: { id: true } });
  if (!row) throw businessRule("Variant does not exist.", null);
}

/** Single-statement primary switch scoped to one variant (partial UQ guards).
 * Returns the number of variant code rows reconciled (0 when the code does
 * not belong to the variant — never touches other variants' codes). */
export async function setCodePrimary(variantId: string, codeId: string): Promise<number> {
  const row = await prisma.productCode.findUnique({
    where: { id: codeId },
    select: { productVariantId: true },
  });
  if (!row || row.productVariantId !== variantId) return 0;
  const n = await prisma.$executeRaw`
    UPDATE product_codes SET is_primary = (id = ${codeId}::uuid), updated_at = now()
     WHERE product_variant_id = ${variantId}::uuid
  `;
  return Number(n);
}

export async function patchCode(
  id: string,
  // isPrimary accepts null: only `true` triggers the primary switch, every
  // other value (false/null/absent) means "don't switch" — same runtime rule.
  input: { type?: "BARCODE" | "INTERNAL_CODE"; isPrimary?: boolean | null },
  actorId: string,
) {
  const row = await prisma.productCode.findUnique({ where: { id }, select: { id: true, productVariantId: true } });
  if (!row) return null;
  return catalogWrite("ProductCode", () =>
    prisma.$transaction(async (tx) => {
      // Single-statement primary switch scoped to one variant (partial UQ
      // guards) — inside this tx so the audit row pairs atomically.
      if (input.isPrimary === true) {
        await tx.$executeRaw`
          UPDATE product_codes SET is_primary = (id = ${id}::uuid), updated_at = now()
           WHERE product_variant_id = ${row.productVariantId}::uuid`;
      }
      const updated =
        input.type === undefined
          ? await tx.productCode.findUnique({ where: { id } })
          : await tx.productCode.update({
              where: { id },
              data: { type: input.type },
            });
      await auditInTx(tx, {
        action: "codes.update",
        userId: actorId,
        entityType: "product_codes",
        entityId: id,
        oldValues: null,
        newValues: {
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.isPrimary === true ? { isPrimary: true } : {}),
        },
      });
      return updated;
    }),
  );
}

export async function deleteCode(id: string, actorId: string): Promise<boolean> {
  const row = await prisma.productCode.findUnique({
    where: { id },
    select: { id: true, code: true, type: true },
  });
  if (!row) return false;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.productCode.delete({ where: { id } });
      await auditInTx(tx, {
        action: "codes.delete",
        userId: actorId,
        entityType: "product_codes",
        entityId: id,
        oldValues: { code: row.code, type: row.type },
        newValues: null,
      });
    });
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}
