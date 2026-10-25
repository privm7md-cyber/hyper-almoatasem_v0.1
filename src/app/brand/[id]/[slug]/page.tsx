// FE-3 brand listing (server): same id/slug contract as categories (FP-09 D01).

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { StoreShell } from "@/components/store/store-shell";
import { ProductCard } from "@/components/store/product-card";
import { FilterPanel } from "@/components/store/filter-panel";
import { LoadMore } from "@/components/store/load-more";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PageTitle } from "@/components/ui/container";
import { loadMoreBrand } from "@/app/actions/catalog";
import {
  getAllCategories,
  getBrandById,
  listBrandProducts,
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
  const brand = await getBrandById(id).catch(() => null);
  if (!brand) return { title: "علامة غير موجودة" };
  return { title: brand.name, description: `منتجات ${brand.name} في هايبر المعتصم.` };
}

export default async function BrandPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, slug } = await params;
  const sp = await searchParams;
  const brand = await getBrandById(id).catch(() => null);
  if (!brand) notFound();
  if (!slugMatches(slug, brand.slug)) permanentRedirect(`/brand/${brand.id}/${wireSlugOf(brand.slug)}`);

  const query = parseListingParams(sp, "listing");
  const hasActiveFilters =
    query.type !== null ||
    query.inStock !== null ||
    query.minPrice !== null ||
    query.maxPrice !== null ||
    query.categoryId !== null;
  // Phase 07 D02: the availability filter is only applied when the catalog
  // carries stock data (otherwise the listing would be emptied by a condition
  // that cannot be honoured).
  const availabilityKnown = await hasAnyInventoryRows().catch(() => false);
  const effectiveQuery = availabilityKnown ? query : { ...query, inStock: null };
  let page: Awaited<ReturnType<typeof listBrandProducts>> | null = null;
  try {
    page = await listBrandProducts(brand.id, effectiveQuery);
  } catch {
    page = null;
  }
  const categories = await getAllCategories().catch(() => []);

  return (
    <StoreShell>
      <nav aria-label="مسار التنقل" className="mt-4 text-sm text-secondary">
        <Link href="/brands" className="hover:text-brand">
          العلامات التجارية
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{brand.name}</span>
      </nav>
      <div className="mt-2">
        <PageTitle>{brand.name}</PageTitle>
      </div>
      <div className="mt-3">
        <FilterPanel
          query={effectiveQuery}
          brands={[]}
          categories={categories}
          sortOptions={LISTING_SORT_OPTIONS.map((o) => ({ value: `${o.sort}:${o.dir}`, label: o.label }))}
          sortValue={sortKeyFor(query.sort, query.dir)}
          showBrand={false}
          showCategory
          availabilityKnown={availabilityKnown}
        />
      </div>
      {page === null ? (
        <div className="mt-4">
          <ErrorState title="تعذّر تحميل المنتجات" text="حاول إعادة تحميل الصفحة." />
        </div>
      ) : page.cards.length === 0 ? (
        <div className="mt-4">
          {hasActiveFilters ? (
            <EmptyState title="لا توجد منتجات مطابقة" hint="جرّب تعديل الفلاتر أو مسحها." />
          ) : (
            <EmptyState
              title="لا توجد منتجات مرتبطة بهذه العلامة حاليًا"
              hint="قد تتوفّر منتجات لها لاحقًا."
            />
          )}
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
          loadPage={loadMoreBrand.bind(null, brand.id, effectiveQuery)}
        />
      ) : null}
    </StoreShell>
  );
}
