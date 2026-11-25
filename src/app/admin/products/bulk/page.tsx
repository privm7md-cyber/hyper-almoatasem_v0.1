import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { auditCatalogDataQuality } from "@/lib/catalog/data-quality";
import { classifyCatalogName } from "@/lib/catalog/name-integrity";
import { listMetadataReviewRows } from "@/lib/catalog/metadata-review";
import { PageHead } from "@/components/admin/ui/surfaces";
import {
  BulkOperationsWorkbench,
  type BulkWorkbenchProduct,
} from "@/components/admin/bulk-operations-workbench";
import { MetadataReviewWorkbench } from "@/components/admin/metadata-review-workbench";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "العمليات الجماعية وفحص الجودة — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminBulkProductsPage() {
  const admin = await requirePermission("products.update");
  await requirePermission("products.view");
  await requirePermission("prices.view");

  const [audit, categories, brands, products, metadataReview] = await Promise.all([
    auditCatalogDataQuality(prisma),
    prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, isActive: true },
    }),
    prisma.brand.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true },
    }),
    prisma.product.findMany({
      take: 40,
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
    listMetadataReviewRows({ issue: "all", search: null, cursor: null, limit: 50 }),
  ]);

  const initialProducts: BulkWorkbenchProduct[] = products.map((p) => ({
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
  }));

  return (
    <>
      <PageHead
        eyebrow="المنتجات"
        title="العمليات الجماعية وفحص جودة الكتالوج"
        intro="تعديل جماعي آمن بوضع المعاينة المسبقة والتسجيل الإلزامي في سجل التدقيق، مع تقرير قراءة فقط لجودة بيانات الكتالوج وفجوات الكاشير."
        actions={
          <>
            <Link href="/admin/products/brand-review" className="adm-btn adm-btn--secondary">مراجعة ربط الماركات</Link>
            <Link href="/admin/products/media-review" className="adm-btn adm-btn--secondary">مراجعة صور المنتجات</Link>
            {admin.permissions.includes("inventory.adjust") && admin.permissions.includes("inventory.view") && <Link href="/admin/inventory/import" className="adm-btn adm-btn--secondary">استيراد مخزون الكاشير</Link>}
            <Link href="/admin/products" prefetch={false} className="adm-btn adm-btn--secondary">
              العودة إلى المنتجات
            </Link>
          </>
        }
      />
      <BulkOperationsWorkbench
        initialAudit={audit}
        categories={categories}
        brands={brands}
        initialProducts={initialProducts}
        permissions={{
          canUpdateProducts: admin.permissions.includes("products.update"),
          canUpdatePrices: admin.permissions.includes("prices.update"),
          canDeleteProducts: admin.permissions.includes("products.delete"),
        }}
      />
      <MetadataReviewWorkbench initial={metadataReview} />
    </>
  );
}
