// FE-3 category listing (server): UUID fetch + display-only slug (canonical redirect on
// mismatch, stale slugs keep working — FP-09 D01). Filters/sort in URL; keyset load-more;
// unknown/inactive id → not-found. Indexable with canonical slug.

import type { Metadata } from "next";
import { canonicalMetadata } from "@/lib/seo/canonical";
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
  getAllCategories,
  getCategoryById,
  listCategoryProducts,
} from "@/lib/frontend/storefront-reads";
import { emptyCategoryCopy, selectCategoryChildren, selectCategoryParent } from "@/lib/frontend/category-context";
import { hasAnyInventoryRows } from "@/lib/inventory/queries";
import {
  LISTING_SORT_OPTIONS,
  hasReversedPriceWindow,
  loadMoreKey,
  parseListingParams,
  sortKeyFor,
} from "@/lib/frontend/listing-params";
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
  return {
    title: category.name,
    description: `منتجات قسم ${category.name} في هايبر المعتصم.`,
    ...canonicalMetadata(`/c/${category.id}/${wireSlugOf(category.slug)}`),
  };
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

  // Batch 6 perf: Parallelize category lookup and catalog metadata reads via Promise.all
  // instead of 5 serial round-trips, delivering the initial HTML chunk significantly faster.
  const [category, allActiveCategories, brands, availabilityKnown] = await Promise.all([
    getCategoryById(id).catch(() => null),
    getAllCategories().catch(() => []),
    getAllBrands().catch(() => []),
    hasAnyInventoryRows().catch(() => false),
  ]);

  if (!category) notFound();
  if (!slugMatches(slug, category.slug)) permanentRedirect(`/c/${category.id}/${wireSlugOf(category.slug)}`);

  const query = parseListingParams(sp, "listing");
  const effectiveQuery = availabilityKnown ? query : { ...query, inStock: null };
  let page: Awaited<ReturnType<typeof listCategoryProducts>> | null = null;
  const reversedWindow = hasReversedPriceWindow(effectiveQuery);
  if (!reversedWindow) {
    try {
      page = await listCategoryProducts(category.id, effectiveQuery);
    } catch {
      page = null;
    }
  }
  const parent = selectCategoryParent(category, allActiveCategories);
  const subcategories = selectCategoryChildren(category, allActiveCategories);
  // Empty-state honesty: merge nothing — a category with zero real products and
  // a category whose filters matched nothing are different states (P05 wording).
  const hasActiveFilters =
    effectiveQuery.brandId !== null ||
    effectiveQuery.type !== null ||
    effectiveQuery.inStock !== null ||
    effectiveQuery.minPrice !== null ||
    effectiveQuery.maxPrice !== null;
  const emptyCopy = emptyCategoryCopy(hasActiveFilters);

  return (
    <StoreShell>
      <nav aria-label="مسار التنقل" className="mt-4 text-sm text-secondary">
        <Link href="/" prefetch={false} className="hover:text-brand">
          الرئيسية
        </Link>
        <span aria-hidden="true"> / </span>
        <Link href="/categories" prefetch={false} className="hover:text-brand">
          الأقسام
        </Link>
        {parent ? (
          <>
            <span aria-hidden="true"> / </span>
            <Link
              href={`/c/${parent.id}/${wireSlugOf(parent.slug)}`}
              prefetch={false}
              className="hover:text-brand"
            >
              {parent.name}
            </Link>
          </>
        ) : null}
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{category.name}</span>
      </nav>
      <div className="mt-3 rounded-card border border-line bg-white p-5 shadow-xs">
        <PageTitle>{category.name}</PageTitle>
        {subcategories.length > 0 ? (
          <p className="mt-1.5 text-sm text-secondary">
            المُعروض ضمن هذا القسم يشمل منتجات أقسامه الفرعية أيضًا.
          </p>
        ) : null}
        {subcategories.length > 0 ? (
          <div className="mt-3.5">
            <ul className="flex flex-wrap gap-2">
              {subcategories.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/c/${c.id}/${wireSlugOf(c.slug)}`}
                    prefetch={false}
                    className="inline-flex min-h-[40px] items-center rounded-badge border border-line bg-purple-surface/65 px-3.5 text-sm font-medium text-ink transition-colors duration-150 hover:border-brand hover:bg-purple-surface hover:text-brand"
                    aria-label={`قسم فرعي ${c.name} ضمن ${category.name}`}
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="mt-4">
        <FilterPanel
          query={effectiveQuery}
          brands={brands}
          sortOptions={LISTING_SORT_OPTIONS.map((o) => ({ value: `${o.sort}:${o.dir}`, label: o.label }))}
          sortValue={sortKeyFor(query.sort, query.dir)}
          showBrand
          availabilityKnown={availabilityKnown}
        />
      </div>
      {reversedWindow ? (
        <div className="mt-4">
          <EmptyState
            title="نطاق السعر غير صالح"
            hint="الحد الأول أكبر من الثاني — عدّل النطاق ثم أعد المحاولة."
          />
        </div>
      ) : page === null ? (
        <div className="mt-4">
          <ErrorState title="تعذّر تحميل المنتجات" text="حاول إعادة تحميل الصفحة." />
        </div>
      ) : page.cards.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={emptyCopy.title} hint={emptyCopy.hint} />
        </div>
      ) : (
        <section aria-labelledby="category-products-heading">
          <h2 id="category-products-heading" className="sr-only">
            المنتجات
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3.5 md:grid-cols-4 md:gap-4">
            {page.cards.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
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
