// Admin bulk catalog operations + read-only data-quality diagnostics.
// GET returns audit metrics + category/brand choices + safe product list (no costPrice).
// POST validates action permissions (products.update, products.delete, prices.update),
// enforces mandatory dryRun preview / explicit confirmation, and writes atomically.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import {
  adminOrDeny,
  adminOrDenyAll,
  adminSessionOrDeny,
  denyUnless,
} from "@/lib/api/route-auth";
import {
  bulkProductOperationInputSchema,
  previewOrApplyBulkProductOperation,
} from "@/lib/catalog/bulk-operations";
import { auditCatalogDataQuality } from "@/lib/catalog/data-quality";
import { classifyCatalogName } from "@/lib/catalog/name-integrity";

export async function GET(request: Request) {
  const denied = await denyUnless("products.view");
  if (denied) return denied;
  const deniedPrice=await denyUnless("prices.view");
  if(deniedPrice)return deniedPrice;

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "all";
  const categoryId = url.searchParams.get("categoryId")?.trim() || null;
  const issueFilter = url.searchParams.get("issue")?.trim() || null;
  const limitRaw = Number(url.searchParams.get("limit") ?? "40");
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 && limitRaw <= 100 ? Math.trunc(limitRaw) : 40;

  try {
    const where: Record<string, unknown> = {};
    if (state === "active") {
      where.deletedAt = null;
      where.isActive = true;
    } else if (state === "hidden") {
      where.deletedAt = null;
      where.isActive = false;
    } else if (state === "archived") {
      where.deletedAt = { not: null };
    }
    if (categoryId) {
      where.categoryId = categoryId;
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { slug: { contains: search, mode: "insensitive" } },
      ];
    }
    if (issueFilter === "under_1_egp") {
      where.variants = { some: { deletedAt: null, price: { lt: 1 } } };
    } else if (issueFilter === "piece_weight_unit") {
      where.productType = "WEIGHT";
      where.variants = { some: { deletedAt: null, sizeUnit: { not: null, notIn: ["KG"] } } };
    } else if (issueFilter === "missing_size_unit") {
      where.variants = { some: { deletedAt: null, sizeUnit: null } };
    }

    const [audit, categories, brands, products] = await Promise.all([
      auditCatalogDataQuality(prisma),
      prisma.category.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, isActive: true, parentId: true },
      }),
      prisma.brand.findMany({
        where: { deletedAt: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true, isActive: true },
      }),
      prisma.product.findMany({
        where,
        take: limit,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          slug: true,
          productType: true,
          unit: true,
          isActive: true,
          deletedAt: true,
          categoryId: true,
          brandId: true,
          category: { select: { name: true } },
          brand: { select: { name: true } },
          variants: {
            where: { deletedAt: null },
            orderBy: { name: "asc" },
            select: {
              id: true,
              name: true,
              price: true,
              sizeValue: true,
              sizeUnit: true,
            },
          },
        },
      }),
    ]);

    const r = ok({
      audit,
      categories,
      brands,
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        nameTrust: classifyCatalogName(p.name),
        slug: p.slug,
        productType: p.productType,
        unit: p.unit,
        isActive: p.isActive,
        archived: p.deletedAt !== null,
        categoryId: p.categoryId,
        categoryName: p.category.name,
        brandId: p.brandId,
        brandName: p.brand?.name ?? null,
        variants: p.variants.map((v) => ({
          id: v.id,
          name: v.name,
          price: String(v.price),
          sizeValue: v.sizeValue !== null ? String(v.sizeValue) : null,
          sizeUnit: v.sizeUnit,
        })),
      })),
    });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function POST(request: Request) {
  const sessionGate = await adminSessionOrDeny(null);
  if ("denied" in sessionGate) return sessionGate.denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }

  const parsed = bulkProductOperationInputSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "بيانات العملية الجماعية غير صالحة.";
    const r = fail(new ApiError("VALIDATION", msg));
    return NextResponse.json(r.body, { status: r.status });
  }

  const action = parsed.data.action;
  if (action === "ARCHIVE" || action === "RESTORE") {
    const gate = await adminOrDeny("products.delete");
    if ("denied" in gate) return gate.denied;
  } else if (action === "ADJUST_PRICE") {
    const gate = await adminOrDenyAll(["products.update", "prices.update", "prices.view"]);
    if ("denied" in gate) return gate.denied;
  } else {
    const gate = await adminOrDeny("products.update");
    if ("denied" in gate) return gate.denied;
  }

  try {
    const result = await previewOrApplyBulkProductOperation(parsed.data, sessionGate.admin.user.id);
    const r = ok(result);
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
