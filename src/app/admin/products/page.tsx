// Admin products list — the operator's catalogue screen.
//
// Server-rendered on purpose: the search, the filters and the pagination all
// run on the server, so the URL alone reproduces the exact list and nothing
// depends on a hydrated page.
//
// The pagination is a keyset over a deterministic order, and the cursor is the
// id of the LAST DISPLAYED row — the row after it is only the probe that tells
// the page "there is a next one". Reading the cursor from the extra row
// instead would skip one product on every page.
//
// Suspect stored names are labeled by the display-only classifier; nothing
// here rewrites catalogue data.

import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/rbac";
import {
  listBrandsForAdmin,
  listCategoriesForAdmin,
  listProductsForAdmin,
  type AdminProductFilter,
  type AdminTaxonomyFilter,
} from "@/lib/catalog/queries";
import { listPrimaryImagesForProducts } from "@/lib/catalog/media";
import { AdminProductCard } from "@/components/admin/admin-product-card";
import { ProductFilters, type ProductFilterValues } from "@/components/admin/product-filters";
import { AdminRetryButton } from "@/components/admin/ui/controls";
import {
  EmptyState,
  ErrorState,
  Note,
  PageHead,
  Pager,
  Panel,
} from "@/components/admin/ui/surfaces";
import styles from "@/components/admin/admin-product-card.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "المنتجات — الإدارة",
  robots: { index: false, follow: false },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SALE_TYPES = ["PIECE", "WEIGHT"] as const;
const UNITS = ["PIECE", "KG", "GRAM", "LITER", "ML"] as const;
const STATES = ["displayed", "hidden", "archived"] as const;

function parseFilters(sp: Record<string, string | undefined>): ProductFilterValues {
  const type = SALE_TYPES.find((value) => value === sp.type) ?? "";
  const unit = UNITS.find((value) => value === sp.unit) ?? "";
  const active = sp.active === "true" || sp.active === "false" ? sp.active : "";
  const state = STATES.find((value) => value === sp.state) ?? "";
  return {
    search: typeof sp.search === "string" ? sp.search.trim().slice(0, 160) : "",
    type,
    unit,
    active,
    state,
    category: sp.category && UUID_RE.test(sp.category) ? sp.category : "",
    brand: sp.brand && UUID_RE.test(sp.brand) ? sp.brand : "",
  };
}

// Use the taxonomy queries' actual keysets, not an arbitrary first-page cap.
// Only id/name leave this loader; a failure discards incomplete options.
async function loadPickerOptions(
  query: (filter: AdminTaxonomyFilter) => Promise<{ rows: { id: string; name: string }[]; nextCursor: string | null }>,
): Promise<{ id: string; name: string }[]> {
  const options: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await query({ limit: 200, cursor, search: null, isActive: null, includeDeleted: false });
    options.push(...page.rows.map(({ id, name }) => ({ id, name })));
    cursor = page.nextCursor;
    if (cursor) {
      if (seen.has(cursor)) throw new Error("Taxonomy pagination did not advance");
      seen.add(cursor);
    }
  } while (cursor);
  return options;
}

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requirePermission("products.view");
  const raw = await searchParams;
  const sp: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) sp[key] = Array.isArray(value) ? value[0] : value;
  const filters = parseFilters(sp);
  let invalidCursor = raw.cursor !== undefined && (typeof raw.cursor !== "string" || !UUID_RE.test(raw.cursor));
  const cursor = !invalidCursor && typeof raw.cursor === "string" ? raw.cursor : null;
  const canSeePrices = admin.permissions.includes("prices.view");
  const canSeeInventory = admin.permissions.includes("inventory.view");

  const listFilter: AdminProductFilter = {
    limit: 20,
    cursor,
    search: filters.search === "" ? null : filters.search,
    categoryId: filters.category === "" ? null : filters.category,
    brandId: filters.brand === "" ? null : filters.brand,
    productType: filters.type === "" ? null : filters.type,
    unit: filters.unit === "" ? null : filters.unit,
    isActive: filters.active === "" ? null : filters.active === "true",
    state: filters.state || null,
    withPrices: canSeePrices,
    ...(canSeeInventory ? { withInventory: true } : {}),
  };
  let page: Awaited<ReturnType<typeof listProductsForAdmin>> | null = null;
  try {
    page = await listProductsForAdmin(listFilter);
    if (page.invalidCursor) {
      invalidCursor = true;
      page = await listProductsForAdmin({ ...listFilter, cursor: null });
    }
  } catch {
    page = null;
  }

  // A failed media read cannot establish that a product has no photograph.
  let images: Awaited<ReturnType<typeof listPrimaryImagesForProducts>> | null = new Map();
  if (page?.rows.length) {
    try {
      images = await listPrimaryImagesForProducts(page.rows.map((row) => row.id));
    } catch {
      images = null;
    }
  }

  // Hidden taxonomy stays selectable; archived taxonomy does not. Failures
  // remain distinct from empty lists, and never change the active filters.
  const [categoryOptions, brandOptions] = await Promise.all([
    loadPickerOptions(listCategoriesForAdmin).catch(() => null),
    loadPickerOptions(listBrandsForAdmin).catch(() => null),
  ]);

  const pagerParams: Record<string, string | undefined> = {
    search: filters.search || undefined,
    type: filters.type || undefined,
    unit: filters.unit || undefined,
    category: filters.category || undefined,
    brand: filters.brand || undefined,
    state: filters.state || undefined,
    active: filters.state ? undefined : filters.active || undefined,
  };
  const startParams = new URLSearchParams();
  for (const [key, value] of Object.entries(pagerParams)) if (value !== undefined) startParams.set(key, value);
  const startHref = `/admin/products${startParams.size ? `?${startParams}` : ""}`;

  return (
    <>
      <PageHead
        eyebrow="المنتجات"
        title="المنتجات"
        intro="من هنا بتدوّر على أي منتج، تشوف تصنيفه وعلامته التجارية وطريقة بيعه وسعره، تفتحه علشان تعدّل بياناته، أو تضيف منتج جديد."
        actions={
          <>
            <Link href="/admin/products/storefront" prefetch={false} className="adm-btn adm-btn--secondary">
              كتالوج المتجر
            </Link>
            <Link href="/admin/products?state=archived" prefetch={false} className="adm-btn adm-btn--secondary">
              المنتجات المؤرشفة
            </Link>
            {admin.permissions.includes("products.update") ? (
              <Link href="/admin/products/bulk" prefetch={false} className="adm-btn adm-btn--secondary">
                العمليات الجماعية وفحص الجودة
              </Link>
            ) : null}
            {admin.permissions.includes("products.create") ? (
              <Link href="/admin/products/new" className="adm-btn adm-btn--primary">
                منتج جديد
              </Link>
            ) : null}
          </>
        }
      />

      <ProductFilters values={filters} categories={categoryOptions} brands={brandOptions} />

      {categoryOptions === null || brandOptions === null ? (
        <Note tone="warn">
          {categoryOptions === null ? <p>تعذّر تحميل قائمة التصنيفات كاملة.</p> : null}
          {brandOptions === null ? <p>تعذّر تحميل قائمة العلامات التجارية كاملة.</p> : null}
          <p>الفلترة الحالية لم تتغيّر. أعد المحاولة لتحميل كل الخيارات.</p>
          <div className="adm-btn-row"><AdminRetryButton /></div>
        </Note>
      ) : null}

      {invalidCursor ? (
        <Note tone="warn">
          رابط الصفحة غير صالح أو لم يعد متاحًا لهذه الفلترة.
          {page !== null ? " عرضنا بداية النتائج بنفس الفلترة." : " تعذّر تحميل بداية النتائج."}
          <div className="adm-btn-row">
            <Link href={startHref} className="adm-btn adm-btn--secondary">بداية النتائج بنفس الفلترة</Link>
          </div>
        </Note>
      ) : null}

      {page === null ? (
        <Panel title="قائمة المنتجات">
          <ErrorState
            title="تعذّر تحميل المنتجات"
            hint="حصلت مشكلة في جلب القائمة — جرّب تعمل تحديث للصفحة."
          />
          <div className="adm-btn-row"><AdminRetryButton /></div>
        </Panel>
      ) : page.rows.length === 0 ? (
        <Panel title="قائمة المنتجات">
          <EmptyState
            title="لا توجد منتجات مطابقة"
            hint="ملقيناش نتائج بالفلترة دي — غيّر كلمة البحث أو ألغِ الفلترة وجرب تاني."
            action={
              <Link href="/admin/products" className="adm-btn adm-btn--secondary">
                ألغِ الفلترة واعرض الكل
              </Link>
            }
          />
        </Panel>
      ) : (
        <Panel title="قائمة المنتجات" sub="أحدث المنتجات المطابقة للفلترة">
          {images === null ? (
            <Note tone="warn">
              تعذّر تحميل صور المنتجات. بيانات المنتجات متاحة، لكن الصور غير متاحة حاليًا.
              <div className="adm-btn-row"><AdminRetryButton /></div>
            </Note>
          ) : null}
          <div className={styles.grid} aria-label="المنتجات المطابقة للفلترة الحالية">
            {page.rows.map((product) => (
              <AdminProductCard
                key={product.id}
                product={{
                  id: product.id,
                  name: product.name,
                  slug: product.slug,
                  productType: product.productType,
                  unit: product.unit,
                  isActive: product.isActive,
                  deletedAt: product.deletedAt,
                  category: { id: product.category.id, name: product.category.name },
                  brand: product.brand ? { id: product.brand.id, name: product.brand.name } : null,
                  minPrice: canSeePrices ? product.minPrice : null,
                  stock: canSeeInventory ? product.stock : "unknown",
                }}
                image={images?.get(product.id) ?? null}
                imagesUnavailable={images === null}
                canSeePrices={canSeePrices}
                canManage={admin.permissions.includes("products.update")}
              />
            ))}
          </div>
          <Pager basePath="/admin/products" params={pagerParams} nextCursor={page.nextCursor} label="منتج" />
        </Panel>
      )}

      <Note tone="info">
        فلتر طريقة البيع والوحدة بيفرق بين المنتجات بالوزن وبالقطعة. «يبدأ من» هو أرخص سعر
        لأشكال البيع النشطة، والأشكال ممكن تختلف في حجم العبوة؛ افتح التفاصيل لمعرفة سعر كل شكل
        ووحدته، مش باعتباره سعر الكيلو.
      </Note>

      {!canSeePrices ? (
        <Note tone="info">
          الأسعار مش معروضة لحسابك. لو محتاج تشوفها، كلّم مالك المتجر عشان يضيف صلاحية عرض الأسعار
          لحسابك.
        </Note>
      ) : null}

      {admin.permissions.includes("products.create") ? (
        <Note tone="info">
          عايز تضيف منتج جديد؟ افتح{" "}
          <Link href="/admin/products/new" className="adm-cell-title">
            صفحة المنتج الجديد
          </Link>{" "}
          — فيها الاسم والتصنيف والعلامة التجارية وطريقة البيع وأول شكل للبيع بسعره.
        </Note>
      ) : (
        <Note tone="info">
          إضافة منتج جديد محتاج صلاحية إضافية من مالك المتجر. لو محتاج تضيف منتجات، كلّمه يضيفها
          لحسابك.
        </Note>
      )}
    </>
  );
}
