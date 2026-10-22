// Phase-10 admin taxonomy (server): categories + brands (catalog structure).
// Reads: products.view. Writes: products.create (create) / products.update (edit).
//
// The backend contract already exposes the full taxonomy surface
// (`/api/admin/catalog/categories`, `/api/admin/catalog/brands`). This page is
// the missing operator face for it — and it is a prerequisite for creating a
// product, because `productInputSchema` requires a `categoryId`.

import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { listBrands, listCategories } from "@/lib/catalog/queries";
import { toBrand, toCategory } from "@/lib/catalog/serialize";
import { AdminSection, AdminTable } from "@/components/admin/admin-table";
import { PermissionGate } from "@/components/admin/permission-gate";
import {
  BrandCreateForm,
  BrandEditForm,
  CategoryCreateForm,
  CategoryEditForm,
} from "@/components/admin/taxonomy-forms";
import { EmptyState, ErrorState } from "@/components/ui/states";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "التصنيفات والعلامات — الإدارة",
  robots: { index: false, follow: false },
};

const PAGE = { limit: 100, cursor: null, sort: "name" as const, dir: "asc" as const };

export default async function AdminTaxonomyPage() {
  const admin = await requirePermission("products.view");
  const can = (perm: string) => admin.permissions.includes(perm);

  // The admin list filter is tri-state (null = active-only), so the full
  // operator view needs both halves. Failures degrade to an empty list with an
  // explicit error state — never a fabricated row.
  const [activeCategories, inactiveCategories, activeBrands, inactiveBrands] = await Promise.all([
    listCategories({ ...PAGE, search: null, parent: null, active: true }).catch(() => null),
    listCategories({ ...PAGE, search: null, parent: null, active: false }).catch(() => null),
    listBrands({ ...PAGE, search: null, active: true }).catch(() => null),
    listBrands({ ...PAGE, search: null, active: false }).catch(() => null),
  ]);

  const categories =
    activeCategories && inactiveCategories
      ? [...activeCategories.rows, ...inactiveCategories.rows].map(toCategory)
      : null;
  const brands =
    activeBrands && inactiveBrands ? [...activeBrands.rows, ...inactiveBrands.rows].map(toBrand) : null;

  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">التصنيفات والعلامات</h1>
      <p className="text-sm text-secondary">
        بنية الكتالوج: التصنيف مطلوب لكل منتج، والعلامة اختيارية. التعطيل يخرج العنصر من المتجر دون حذفه.
      </p>

      <AdminSection title="التصنيفات">
        {categories === null ? (
          <ErrorState title="تعذّر تحميل التصنيفات" text="حاول إعادة تحميل الصفحة." />
        ) : categories.length === 0 ? (
          <EmptyState title="لا توجد تصنيفات" hint="أنشئ أول تصنيف من النموذج بالأسفل." />
        ) : (
          <AdminTable
            caption="التصنيفات"
            headers={["الاسم", "المعرّف", "الحالة"]}
            rows={categories.map((c) => [
              <span key={`n-${c.id}`} className="font-bold">{c.name}</span>,
              <span key={`s-${c.id}`} className="font-mono text-xs" dir="ltr">{c.slug}</span>,
              <span key={`a-${c.id}`}>{c.isActive ? "نشط" : "موقوف"}</span>,
            ])}
          />
        )}
        <PermissionGate permissions={admin.permissions} required="products.update" action="تعديل التصنيفات">
          <CategoryEditForm
            categories={(categories ?? []).map((c) => ({ id: c.id, name: c.name, isActive: c.isActive }))}
          />
        </PermissionGate>
        <PermissionGate permissions={admin.permissions} required="products.create" action="إنشاء التصنيفات">
          <CategoryCreateForm />
        </PermissionGate>
      </AdminSection>

      <AdminSection title="العلامات التجارية">
        {brands === null ? (
          <ErrorState title="تعذّر تحميل العلامات" text="حاول إعادة تحميل الصفحة." />
        ) : brands.length === 0 ? (
          <EmptyState title="لا توجد علامات" hint="أنشئ أول علامة من النموذج بالأسفل." />
        ) : (
          <AdminTable
            caption="العلامات التجارية"
            headers={["الاسم", "المعرّف", "الحالة"]}
            rows={brands.map((b) => [
              <span key={`n-${b.id}`} className="font-bold">{b.name}</span>,
              <span key={`s-${b.id}`} className="font-mono text-xs" dir="ltr">{b.slug}</span>,
              <span key={`a-${b.id}`}>{b.isActive ? "نشط" : "موقوف"}</span>,
            ])}
          />
        )}
        <PermissionGate permissions={admin.permissions} required="products.update" action="تعديل العلامات">
          <BrandEditForm brands={(brands ?? []).map((b) => ({ id: b.id, name: b.name, isActive: b.isActive }))} />
        </PermissionGate>
        <PermissionGate permissions={admin.permissions} required="products.create" action="إنشاء العلامات">
          <BrandCreateForm />
        </PermissionGate>
      </AdminSection>

      {!can("products.create") && !can("products.update") ? (
        <p className="text-sm text-secondary">
          لديك صلاحية <span dir="ltr" className="font-mono">products.view</span> للقراءة فقط في هذا القسم.
        </p>
      ) : null}
    </main>
  );
}
