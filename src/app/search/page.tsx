// FE-3 search results (server): extends the FE-2 minimal page (kept, not replaced).
// Contract: q 2..120, relevance/newest sorts, category/brand/type/price/inStock filters,
// keyset load-more; no autocomplete/facets. Result pages stay noindex (SAP decision).

import type { Metadata } from "next";
import { StoreShell } from "@/components/store/store-shell";
import { ProductCard } from "@/components/store/product-card";
import { SearchBox } from "@/components/store/search-box";
import { FilterPanel } from "@/components/store/filter-panel";
import { LoadMore } from "@/components/store/load-more";
import { ResultCount } from "@/components/store/result-count";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PageTitle } from "@/components/ui/container";
import { loadMoreSearch } from "@/app/actions/catalog";
import {
  getAllBrands,
  getHomeCategorySections,
  searchCatalogPaged,
} from "@/lib/frontend/storefront-reads";
import { hasAnyInventoryRows } from "@/lib/inventory/queries";
import {
  SEARCH_SORT_OPTIONS,
  hasReversedPriceWindow,
  loadMoreKey,
  parseListingParams,
  parseSearchQuery,
  searchRetryHref,
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
  // Phase 07 D02: without stock data the "in stock only" filter cannot be
  // honoured, so it is not applied to the request at all (it would empty the
  // results) and the panel explains why it is unavailable.
  const availabilityKnown = await hasAnyInventoryRows().catch(() => false);
  const effectiveQuery = availabilityKnown ? query : { ...query, inStock: null };

  let page: Awaited<ReturnType<typeof searchCatalogPaged>> | null = null;
  let failed = false;
  // P08 (D25 completion): both bounds with max < min is contract-invalid (the
  // public routes answer 400 "Invalid price window.") — a window the frontend
  // KNOWS is invalid is never SENT; the page answers the honest state instead
  // (a silent empty result would hide the reason).
  const reversedWindow = hasReversedPriceWindow(effectiveQuery);
  if (valid !== null && !reversedWindow) {
    try {
      page = await searchCatalogPaged(valid, effectiveQuery);
    } catch {
      failed = true;
    }
  }
  const [brands, sections] = await Promise.all([
    getAllBrands().catch(() => []),
    getHomeCategorySections().catch(() => ({ mains: [], subs: [] })),
  ]);
  // Category filter options with their parent context (Phase 07: a child
  // category must be distinguishable from a top-level one).
  const categoryOptions = [
    ...sections.mains.map((m) => ({ id: m.id, name: m.name })),
    ...sections.subs.flatMap((s) =>
      s.children.map((c) => ({ id: c.id, name: c.name, hint: s.parent.name })),
    ),
  ];

  return (
    <StoreShell>
      <div className="mt-6 rounded-card border border-line bg-white p-5 shadow-xs">
        <PageTitle>البحث في المنتجات</PageTitle>
        <div className="mt-3.5 max-w-[600px]">
          <SearchBox initial={raw} label="البحث في صفحة النتائج" hint="عدّل كلمة البحث" />
        </div>
      </div>
      {valid !== null ? (
        <div className="mt-4">
          <FilterPanel
            query={effectiveQuery}
            brands={brands}
            categories={categoryOptions}
            sortOptions={SEARCH_SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            sortValue={query.sort}
            showCategory
            availabilityKnown={availabilityKnown}
          />
        </div>
      ) : null}
      {valid === null ? (
        <div className="mt-4">
          <EmptyState
            title={
              raw.trim().length === 0
                ? "ابدأ بكتابة كلمة للبحث"
                : raw.trim().length > 120
                  ? "الاستعلام أطول من 120 حرفًا — اكتب استعلامًا أقصر"
                  : "اكتب حرفين على الأقل للبحث"
            }
            hint="البحث يعمل من حرفين حتى 120 حرفًا."
          />
        </div>
      ) : reversedWindow ? (
        // P08 (D25 completion): the URL carried a contract-invalid price
        // window — the request was NOT sent (the public route would 400);
        // the same reason the panel gives is the page's answer.
        <div className="mt-4">
          <EmptyState
            title="نطاق السعر غير صالح"
            hint="الحد الأول أكبر من الثاني — عدّل النطاق ثم أعد المحاولة."
          />
        </div>
      ) : failed || page === null ? (
        <div className="mt-4">
          <ErrorState
            title="تعذّر إتمام البحث"
            text="تعذّر الوصول إلى نتائج البحث. يمكنك إعادة المحاولة."
          />
          {/* A full reload re-runs the server query (the client router would
              serve the cached payload, which is why this is a plain link). */}
          <p className="mt-3 text-center text-sm">
            <a
              href={searchRetryHref(query, valid)}
              className="font-semibold text-brand underline underline-offset-4"
            >
              إعادة المحاولة
            </a>
          </p>
        </div>
      ) : page.cards.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="لا توجد نتائج مطابقة" hint="جرّب كلمة مختلفة أو عدّل الفلاتر." />
        </div>
      ) : (
        <>
          <h2 id="search-products-heading" className="sr-only">
            نتائج المنتجات
          </h2>
          <p className="mt-4 inline-flex items-center rounded-badge border border-line bg-white px-3.5 py-1.5 text-sm text-secondary" role="status">
            <ResultCount initialCount={page.cards.length} /> لنتائج «{valid}» — اعرض المزيد للمتابعة (بدون أرقام صفحات مخترعة).
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3.5 md:grid-cols-4 md:gap-4">
            {page.cards.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
          <LoadMore
            key={`${valid}:${loadMoreKey(effectiveQuery)}`}
            initialCursor={page.nextCursor}
            loadPage={loadMoreSearch.bind(null, valid, effectiveQuery)}
          />
        </>
      )}
    </StoreShell>
  );
}
