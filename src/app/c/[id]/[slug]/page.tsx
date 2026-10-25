// FE-3 category listing (server): UUID fetch + display-only slug (canonical redirect on
// mismatch, stale slugs keep working — FP-09 D01). Filters/sort in URL; keyset load-more;
// unknown/inactive id → not-found. Indexable with canonical slug.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { StoreShell } from "@/components/store/store-shell";
import { ProductCard } from "@/components/store/product-card";
import { FilterPanel } from "@/components/store/filter-panel";
import { LoadMore } from "@/components/store/load-more";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PageTitle } from "@/components/ui/container";
import { loadMoreCategory } from "@/app/actions/catalog";
import {
  getAllBrands,
  getCategoryById,
  listCategoryProducts,
} from "@/lib/frontend/storefront-reads";
import { hasAnyInventoryRows } from "@/lib/inventory/queries";
import { LISTING_SORT_OPTIONS, loadMoreKey, parseListingParams, sortKeyFor } from "@/lib/frontend/listing-params";
import { slugMatches, wireSlugOf } from "@/lib/frontend/slug";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; slug: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const category = await getCategoryById(id).catch(() => null);
  if (!category) return { title: "قسم غير موجود" };
  return { title: category.name, description: `منتجات قسم ${category.name} في هايبر المعتصم.` };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, slug } = await params;
  const sp = await searchParams;
  const category = await getCategoryById(id).catch(() => null);
  if (!category) notFound();
  if (!slugMatches(slug, category.slug)) permanentRedirect(`/c/${category.id}/${wireSlugOf(category.slug)}`);

  const query = parseListingParams(sp, "listing");
  // Phase 07 D02: the availability filter is only honoured when the catalog
  // carries stock data. Without it the request is NOT narrowed by an
  // impossible condition (which would empty the whole store's listing) and the
  // panel states the reason instead.
  const availabilityKnown = await hasAnyInventoryRows().catch(() => false);
  const effectiveQuery = availabilityKnown ? query : { ...query, inStock: null };
  let page: Awaited<ReturnType<typeof listCategoryProducts>> | null = null;
  try {
    page = await listCategoryProducts(category.id, effectiveQuery);
  } catch {
    page = null;
  }
  const brands = await getAllBrands().catch(() => []);

  return (
    <StoreShell>
      <nav aria-label="مسار التنقل" className="mt-4 text-sm text-secondary">
        <Link href="/categories" className="hover:text-brand">
          الأقسام
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{category.name}</span>
      </nav>
      <div className="mt-2">
        <PageTitle>{category.name}</PageTitle>
      </div>
      <div className="mt-3">
        <FilterPanel
          query={effectiveQuery}
          brands={brands}
          sortOptions={LISTING_SORT_OPTIONS.map((o) => ({ value: `${o.sort}:${o.dir}`, label: o.label }))}
          sortValue={sortKeyFor(query.sort, query.dir)}
          showBrand
          availabilityKnown={availabilityKnown}
        />
      </div>
      {page === null ? (
        <div className="mt-4">
          <ErrorState title="تعذّر تحميل المنتجات" text="حاول إعادة تحميل الصفحة." />
        </div>
      ) : page.cards.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="لا توجد منتجات مطابقة" hint="جرّب تعديل الفلاتر أو مسحها." />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {page.cards.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
      {page !== null ? (
        <LoadMore
          key={loadMoreKey(effectiveQuery)}
          initialCursor={page.nextCursor}
          loadPage={loadMoreCategory.bind(null, category.id, effectiveQuery)}
        />
      ) : null}
    </StoreShell>
  );
}
