// Admin "new product" screen — a standalone page, not a drawer.
//
// The operator fills four separated panels: the product basics, its category
// and brand, the sell type with its unit, and the first sellable shape with
// its price and barcode. Saving lands on the new product's own page, where
// the remaining shapes can be added.

import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { listBrandsForAdmin, listCategoriesForAdmin } from "@/lib/catalog/queries";
import { PermissionGate } from "@/components/admin/permission-gate";
import { ProductCreateForm } from "@/components/admin/product-create-form";
import { ErrorState, Note, PageHead } from "@/components/admin/ui/surfaces";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "منتج جديد — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminNewProductPage() {
  const admin = await requirePermission("products.view");

  const [categories, brands] = await Promise.all([
    listCategoriesForAdmin({
      limit: 200,
      cursor: null,
      search: null,
      isActive: true,
      includeDeleted: false,
    }).catch(() => null),
    listBrandsForAdmin({
      limit: 200,
      cursor: null,
      search: null,
      isActive: true,
      includeDeleted: false,
    }).catch(() => null),
  ]);

  const categoryOptions = (categories?.rows ?? []).map((row) => ({ id: row.id, name: row.name }));
  const brandOptions = (brands?.rows ?? []).map((row) => ({ id: row.id, name: row.name }));

  return (
    <>
      <PageHead
        eyebrow="المنتجات"
        title="منتج جديد"
        intro="المنتج الجديد محتاج اسم واضح، وتصنيف واحد هو القسم اللي هيتحط تحته، وعلامة تجارية لو الشركة معروفة، وطريقة بيع واحدة، وأول شكل للبيع بسعره وكوده. من غير شكل وسعر، المنتج مش هيبان في المتجر."
      />

      {categories === null || brands === null ? (
        <ErrorState
          title="تعذّر تحميل التصنيفات والعلامات التجارية"
          hint="راجع صفحة التصنيفات والعلامات التجارية الأول، وبعدين جرّب تاني."
        />
      ) : (
        <PermissionGate
          permissions={admin.permissions}
          required="products.create"
          action="إضافة منتج جديد"
        >
          <ProductCreateForm categories={categoryOptions} brands={brandOptions} />
        </PermissionGate>
      )}

      <Note tone="info">
        بعد الحفظ هتنتقل لصفحة المنتج الجديدة. ساعتها هتلاقي المنتج وأول شكل للبيع وسعره، وتقدر
        تضيف باقي الأشكال والأكواد من نفس الصفحة.
      </Note>
    </>
  );
}
