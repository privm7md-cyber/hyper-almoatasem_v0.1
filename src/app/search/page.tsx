// FE-3 search results (server): extends the FE-2 minimal page (kept, not replaced).
// Contract: q 2..120, relevance/newest sorts, category/brand/type/price/inStock filters,
// keyset load-more; no autocomplete/facets. Result pages stay noindex (SAP decision).

import type { Metadata } from "next";
import { StoreShell } from "@/components/store/store-shell";
import { ProductCard } from "@/components/store/product-card";
import { SearchBox } from "@/components/store/search-box";
import { FilterPanel } from "@/components/store/filter-panel";
import { LoadMore } from "@/components/store/load-more";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PageTitle } from "@/components/ui/container";
import { loadMoreSearch } from "@/app/actions/catalog";
import {
  getAllBrands,
  getAllCategories,
  searchCatalogPaged,
} from "@/lib/frontend/storefront-reads";
import {
  SEARCH_SORT_OPTIONS,
  parseListingParams,
  parseSearchQuery,
} from "@/lib/frontend/listing-params";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "البحث",
  description: "ابحث في منتجات هايبر المعتصم.",
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = typeof sp.q === "string" ? sp.q : "";
  const query = parseListingParams(sp, "search");
  const valid = parseSearchQuery(sp);

  let page: Awaited<ReturnType<typeof searchCatalogPaged>> | null = null;
  let failed = false;
  if (valid !== null) {
    try {
      page = await searchCatalogPaged(valid, query);
    } catch {
      failed = true;
    }
  }
  const [brands, categories] = await Promise.all([
    getAllBrands().catch(() => []),
    getAllCategories().catch(() => []),
  ]);

  return (
    <StoreShell>
      <div className="mt-6">
        <PageTitle>البحث في المنتجات</PageTitle>
        <div className="mt-3 max-w-[560px]">
          <SearchBox initial={raw} />
        </div>
      </div>
      {valid !== null ? (
        <div className="mt-3">
          <FilterPanel
            query={query}
            brands={brands}
            categories={categories}
            sortOptions={SEARCH_SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            sortValue={query.sort}
            showCategory
          />
        </div>
      ) : null}
      {valid === null ? (
        <div className="mt-4">
          <EmptyState
            title={raw.trim().length === 0 ? "ابدأ بكتابة كلمة للبحث" : "اكتب كلمتين على الأقل للبحث"}
            hint="البحث يعمل من حرفين حتى 120 حرفًا."
          />
        </div>
      ) : failed || page === null ? (
        <div className="mt-4">
          <ErrorState title="تعذّر إتمام البحث" text="حاول إعادة المحاولة." />
        </div>
      ) : page.cards.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="لا توجد نتائج مطابقة" hint="جرّب كلمة مختلفة أو عدّل الفلاتر." />
        </div>
      ) : (
        <>
          <p className="mt-4 text-sm text-secondary" role="status">
            نتائج «{valid}» — اعرض المزيد للمتابعة (بدون أرقام صفحات مخترعة).
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
            {page.cards.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
          <LoadMore initialCursor={page.nextCursor} loadPage={loadMoreSearch.bind(null, valid, query)} />
        </>
      )}
    </StoreShell>
  );
}
