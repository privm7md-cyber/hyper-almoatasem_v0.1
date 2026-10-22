// FE-10C admin product list (server): search + first keyset page + cursor-next link.
// Reads: products.view (page gate). No totals/counts (no verified source).

import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/rbac";
import { listBrands, listCategories, listProducts } from "@/lib/catalog/queries";
import { toProductListItem } from "@/lib/catalog/serialize";
import { AdminSection } from "@/components/admin/admin-table";
import { PermissionGate } from "@/components/admin/permission-gate";
import { ProductCreateForm } from "@/components/admin/product-create-form";
import { EmptyState, ErrorState } from "@/components/ui/states";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "المنتجات — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; cursor?: string }>;
}) {
  const admin = await requirePermission("products.view");
  const sp = await searchParams;
  const search = typeof sp.search === "string" && sp.search.trim() !== "" ? sp.search.trim().slice(0, 160) : null;
  const cursor = typeof sp.cursor === "string" && sp.cursor !== "" ? sp.cursor : null;
  let page: Awaited<ReturnType<typeof listProducts>> | null = null;
  try {
    page = await listProducts({
      limit: 20,
      cursor,
      sort: "created_at",
      dir: "desc",
      search,
      categoryId: null,
      brandId: null,
      productType: null,
      active: null,
      minPrice: null,
      maxPrice: null,
      inStock: null,
    });
  } catch {
    page = null;
  }
  const rows = page ? page.rows.map(toProductListItem) : null;
  // Category + brand pickers for the create form (active rows only — an
  // inactive category/brand must not be selectable for a new product).
  const categories = await listCategories({
    limit: 100,
    cursor: null,
    sort: "name",
    dir: "asc",
    search: null,
    parent: null,
    active: true,
  }).catch(() => null);
  const brands = await listBrands({
    limit: 100,
    cursor: null,
    sort: "name",
    dir: "asc",
    search: null,
    active: true,
  }).catch(() => null);
  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">المنتجات</h1>
      <form method="get" action="/admin/products" className="flex gap-2">
        <label className="sr-only" htmlFor="admin-product-search">
          بحث المنتجات
        </label>
        <input
          id="admin-product-search"
          name="search"
          defaultValue={search ?? ""}
          placeholder="بحث بالاسم…"
          maxLength={160}
          className="min-h-[44px] flex-1 rounded-control border border-line bg-white px-3"
        />
        <button type="submit" className="min-h-[44px] rounded-control bg-brand px-5 font-semibold text-white">
          بحث
        </button>
      </form>
      <AdminSection title="قائمة المنتجات">
        {rows === null ? (
          <ErrorState title="تعذّر تحميل المنتجات" text="حاول إعادة تحميل الصفحة." />
        ) : rows.length === 0 ? (
          <EmptyState title="لا توجد منتجات مطابقة" hint="جرّب بحثًا مختلفًا." />
        ) : (
          <ul className="grid gap-2">
            {rows.map((p) => (
              <li key={p.id} className="rounded-card border border-line bg-white p-3 text-sm">
                <Link href={`/admin/products/${p.id}`} className="font-bold text-brand">
                  {p.name}
                </Link>
                <p className="text-secondary">
                  {p.unit} · {p.isActive ? "نشط" : "غير نشط"}
                </p>
              </li>
            ))}
          </ul>
        )}
        {page?.nextCursor ? (
          <p className="mt-2">
            <Link
              href={`/admin/products?${new URLSearchParams({ ...(search ? { search } : {}), cursor: page.nextCursor }).toString()}`}
              className="font-semibold text-brand"
            >
              الصفحة التالية (مفتاح keyset حقيقي)
            </Link>
          </p>
        ) : null}
      </AdminSection>
      <AdminSection title="إنشاء منتج (products.create)">
        <PermissionGate permissions={admin.permissions} required="products.create" action="إنشاء المنتجات">
          {categories === null || brands === null ? (
            <p className="text-sm text-secondary">
              تعذّر تحميل التصنيفات والعلامات — أنشئ التصنيفات أولًا من صفحة{" "}
              <Link href="/admin/taxonomy" className="font-semibold text-brand">
                التصنيفات والعلامات
              </Link>
              .
            </p>
          ) : (
            <ProductCreateForm
              categories={categories.rows.map((c) => ({ id: c.id, name: c.name }))}
              brands={brands.rows.map((b) => ({ id: b.id, name: b.name }))}
            />
          )}
        </PermissionGate>
      </AdminSection>
    </main>
  );
}
