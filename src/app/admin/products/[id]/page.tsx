// FE-10C admin product detail (server): variants + price editor + product edit basics.
// Reads: products.view.
// Writes: products.update (product PATCH, variant PATCH), products.create (variant
//         create, barcode registration), prices.update (selling price, price fields).
//
// Phase-10 remediation (G01): the price capability is separate from the
// product capability — `prices.view` may see the selling price and the cost
// basis, `prices.update` may change them. Every control below is rendered
// only for the exact key the server route enforces.
//
// Every write control is rendered only when the session snapshot holds the
// EXACT permission key the server route enforces (see src/app/api/admin/**).
// Hiding is UX only — the server re-checks every key on every request.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { getProduct, listVariantsByProduct } from "@/lib/catalog/queries";
import { toAdminVariant } from "@/lib/catalog/serialize";
import { AdminSection } from "@/components/admin/admin-table";
import { PermissionGate } from "@/components/admin/permission-gate";
import { VariantPriceEditor } from "@/components/admin/variant-price-editor";
import { ProductEditForm } from "@/components/admin/product-edit-form";
import { VariantCreateForm, VariantEditForm } from "@/components/admin/variant-form";
import { CodeCreateForm } from "@/components/admin/code-create-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تفاصيل المنتج — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requirePermission("products.view");
  const { id } = await params;
  const row = await getProduct(id, true).catch(() => null);
  if (!row) notFound();
  const variants = await listVariantsByProduct(id, true, 50, null).catch(() => null);
  const shapes = variants ? variants.rows.map(toAdminVariant) : [];
  // Price capabilities are separate from the product capabilities (G01).
  const canSeePrice = admin.permissions.includes("prices.view");
  const canUpdatePrice = admin.permissions.includes("prices.update");

  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">{row.name}</h1>
      <p className="text-sm text-secondary">
        {row.productType} · {row.unit}
        {row.saleStepGrams ? ` · خطوة البيع ${row.saleStepGrams} جرام` : ""} ·{" "}
        {row.isActive ? "نشط" : "غير نشط"} · الفئة: {row.category.name}
        {row.brand ? ` · العلامة: ${row.brand.name}` : ""}
      </p>
      {row.description ? <p className="text-sm">{row.description}</p> : null}
      <AdminSection title="المتغيرات والأسعار">
        {shapes.length === 0 ? (
          <p className="text-sm text-secondary">لا توجد متغيرات لهذا المنتج بعد.</p>
        ) : (
          <ul className="grid gap-2">
            {shapes.map((v) => (
              <li key={v.id} className="rounded-card border border-line bg-white p-3 text-sm">
                <p className="font-bold">
                  {v.name}
                  {v.sizeValue ? ` — ${v.sizeValue}${v.sizeUnit ? ` ${v.sizeUnit}` : ""}` : ""}
                </p>
                <p>
                  {canSeePrice ? (
                    <bdi>
                      {v.price} ج.م{v.sizeUnit ? ` / ${v.sizeUnit}` : ""}
                    </bdi>
                  ) : (
                    <span className="text-secondary">السعر غير معروض — يتطلب صلاحية prices.view.</span>
                  )}
                  {canSeePrice && v.compareAtPrice !== null ? (
                    <bdi className="ms-2 text-secondary line-through">{v.compareAtPrice} ج.م</bdi>
                  ) : null}
                  {canSeePrice && v.costPrice !== null ? (
                    <bdi className="ms-2 text-secondary">تكلفة: {v.costPrice} ج.م</bdi>
                  ) : null}
                  {v.isActive ? null : <span className="ms-2 text-secondary">موقوف</span>}
                </p>
                <PermissionGate permissions={admin.permissions} required="products.update" action="تعديل المتغير">
                  <details className="mt-2">
                    <summary className="cursor-pointer font-semibold text-brand">تعديل بيانات المتغير</summary>
                    <div className="mt-2">
                      <VariantEditForm
                        canEditCost={canUpdatePrice}
                        variant={{
                          id: v.id,
                          name: v.name,
                          sizeValue: v.sizeValue,
                          sizeUnit: v.sizeUnit,
                          price: v.price,
                          compareAtPrice: v.compareAtPrice,
                          costPrice: v.costPrice,
                          isActive: v.isActive,
                        }}
                      />
                    </div>
                  </details>
                </PermissionGate>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
      <AdminSection title="تعديل السعر (prices.update)">
        <PermissionGate permissions={admin.permissions} required="prices.update" action="تعديل السعر">
          <VariantPriceEditor
            canSeePrices={canSeePrice}
            variants={shapes.map((v) => ({ id: v.id, name: v.name, price: v.price }))}
          />
        </PermissionGate>
      </AdminSection>
      <AdminSection title="تعديل المنتج (products.update)">
        <PermissionGate permissions={admin.permissions} required="products.update" action="تعديل المنتج">
          <ProductEditForm productId={row.id} name={row.name} description={row.description} isActive={row.isActive} />
        </PermissionGate>
      </AdminSection>
      <AdminSection title="إضافة متغير (products.create)">
        <PermissionGate permissions={admin.permissions} required="products.create" action="إنشاء المتغيرات">
          <VariantCreateForm productId={row.id} />
        </PermissionGate>
      </AdminSection>
      <AdminSection title="تسجيل باركود (products.create)">
        <PermissionGate permissions={admin.permissions} required="products.create" action="تسجيل الباركود">
          <CodeCreateForm variants={shapes.map((v) => ({ id: v.id, name: v.name }))} />
        </PermissionGate>
      </AdminSection>
    </main>
  );
}
