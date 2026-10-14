// FE-10C admin product detail (server): variants + price editor + product edit basics.
// Reads: products.view. Writes: products.update (product PATCH + variant price PATCH).

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { getProduct, listVariantsByProduct } from "@/lib/catalog/queries";
import { toVariant } from "@/lib/catalog/serialize";
import { AdminSection } from "@/components/admin/admin-table";
import { VariantPriceEditor } from "@/components/admin/variant-price-editor";
import { ProductEditForm } from "@/components/admin/product-edit-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تفاصيل المنتج — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("products.view");
  const { id } = await params;
  const row = await getProduct(id, true).catch(() => null);
  if (!row) notFound();
  const variants = await listVariantsByProduct(id, true, 50, null).catch(() => null);
  const shapes = variants ? variants.rows.map(toVariant) : [];

  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">{row.name}</h1>
      <p className="text-sm text-secondary">
        {row.productType} · {row.unit} · {row.isActive ? "نشط" : "غير نشط"} · الفئة: {row.category.name}
        {row.brand ? ` · العلامة: ${row.brand.name}` : ""}
      </p>
      {row.description ? <p className="text-sm">{row.description}</p> : null}
      <AdminSection title="الـVariants والأسعار">
        {shapes.length === 0 ? (
          <p className="text-sm text-secondary">لا توجد Variants.</p>
        ) : (
          <ul className="grid gap-2">
            {shapes.map((v) => (
              <li key={v.id} className="rounded-card border border-line bg-white p-3 text-sm">
                <p className="font-bold">{v.name}</p>
                <p>
                  <bdi>
                    {v.price} ج.م{v.sizeUnit ? ` / ${v.sizeUnit}` : ""}
                  </bdi>
                  {v.compareAtPrice !== null ? (
                    <bdi className="ms-2 text-secondary line-through">{v.compareAtPrice} ج.م</bdi>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
      <AdminSection title="تعديل السعر (products.update)">
        <VariantPriceEditor variants={shapes.map((v) => ({ id: v.id, name: v.name, price: v.price }))} />
      </AdminSection>
      <AdminSection title="تعديل المنتج (products.update)">
        <ProductEditForm productId={row.id} name={row.name} description={row.description} isActive={row.isActive} />
      </AdminSection>
    </main>
  );
}
