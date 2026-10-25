// FE-3 filter + sort panel ("use client": URL-synced controls only).
// Every visible control maps to a backend-supported param (no decorative controls).
// Discrete changes push history; filter/sort changes reset to page 1 (cursor lives outside URLs).

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { ListingQuery } from "@/lib/frontend/listing-params";

export interface SortSelectOption {
  /** Listing: "sort:dir" (e.g. "name:asc"). Search: bare sort ("relevance"). */
  value: string;
  label: string;
}

export interface BrandOption {
  id: string;
  name: string;
}

export interface CategoryOption {
  id: string;
  name: string;
  /** Optional disambiguator (e.g. the parent category) — display only. */
  hint?: string;
}

function setParam(pathname: string, current: string, key: string, value: string | null): string {
  const sp = new URLSearchParams(current);
  if (value === null || value === "") sp.delete(key);
  else sp.set(key, value);
  const s = sp.toString();
  return s === "" ? pathname : `${pathname}?${s}`;
}

export function FilterPanel({
  query,
  brands,
  categories,
  sortOptions,
  sortValue,
  showBrand = true,
  showCategory = false,
  availabilityKnown = true,
}: {
  query: ListingQuery;
  brands: BrandOption[];
  categories?: CategoryOption[];
  sortOptions: SortSelectOption[];
  sortValue: string;
  showBrand?: boolean;
  showCategory?: boolean;
  /**
   * Whether the catalog carries availability data at all (Phase 07 D02).
   * While it does not, every product's availability is UNKNOWN and the
   * "in stock only" filter cannot honour its promise — it is shown as
   * unavailable (with the reason) instead of silently emptying the results.
   */
  availabilityKnown?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.toString();
  const [minPrice, setMinPrice] = useState(query.minPrice ?? "");
  const [maxPrice, setMaxPrice] = useState(query.maxPrice ?? "");
  const [rangeError, setRangeError] = useState(false);
  // D25: after any URL-navigation the panel state follows the URL (the URL is
  // the source of truth), including edits made from outside this component
  // (search box, back/forward history, sliced links). Adjusted DURING RENDER
  // (React's documented state-from-props pattern, no effect cascades).
  const [synced, setSynced] = useState({ min: query.minPrice ?? "", max: query.maxPrice ?? "" });
  if (synced.min !== (query.minPrice ?? "") || synced.max !== (query.maxPrice ?? "")) {
    setSynced({ min: query.minPrice ?? "", max: query.maxPrice ?? "" });
    setMinPrice(query.minPrice ?? "");
    setMaxPrice(query.maxPrice ?? "");
    setRangeError(false);
  }

  function push(key: string, value: string | null) {
    router.push(setParam(pathname, current, key, value));
  }

  const activeCount =
    (query.type !== null ? 1 : 0) +
    (query.inStock !== null ? 1 : 0) +
    (query.minPrice !== null || query.maxPrice !== null ? 1 : 0) +
    (query.brandId !== null ? 1 : 0) +
    (query.categoryId !== null ? 1 : 0);

  return (
    <form
      aria-label="خيارات التصفية والترتيب"
      className="rounded-card border border-line bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        // D25: reject a reversed price range instead of silently emptying results.
        const lo = parseFloat(minPrice.trim());
        const hi = parseFloat(maxPrice.trim());
        if (
          minPrice.trim() !== "" &&
          maxPrice.trim() !== "" &&
          Number.isFinite(lo) &&
          Number.isFinite(hi) &&
          lo > hi
        ) {
          setRangeError(true);
          return;
        }
        setRangeError(false);
        const sp = new URLSearchParams(current);
        if (minPrice.trim() === "") sp.delete("minPrice");
        else sp.set("minPrice", minPrice.trim());
        if (maxPrice.trim() === "") sp.delete("maxPrice");
        else sp.set("maxPrice", maxPrice.trim());
        const s = sp.toString();
        router.push(s === "" ? pathname : `${pathname}?${s}`);
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm font-semibold">
          الترتيب
          <select
            aria-label="ترتيب النتائج"
            value={sortValue}
            onChange={(e) => {
              const [sort, dir] = e.target.value.split(":");
              const sp = new URLSearchParams(current);
              sp.set("sort", sort);
              if (dir === "asc") sp.set("dir", "asc");
              else sp.delete("dir");
              const s = sp.toString();
              router.push(s === "" ? pathname : `${pathname}?${s}`);
            }}
            className="min-h-[44px] rounded-control border border-line bg-white px-2"
          >
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          النوع
          <select
            aria-label="نوع المنتج"
            value={query.type ?? ""}
            onChange={(e) => push("type", e.target.value === "" ? null : e.target.value)}
            className="min-h-[44px] rounded-control border border-line bg-white px-2"
          >
            <option value="">الكل</option>
            <option value="PIECE">بالقطعة</option>
            <option value="WEIGHT">بالوزن</option>
          </select>
        </label>
        {showCategory && categories ? (
          <label className="grid gap-1 text-sm font-semibold">
            القسم
            <select
              aria-label="القسم"
              value={query.categoryId ?? ""}
              onChange={(e) => push("category", e.target.value === "" ? null : e.target.value)}
              className="min-h-[44px] max-w-[200px] rounded-control border border-line bg-white px-2"
            >
              <option value="">الكل</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.hint ? ` — ${c.hint}` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {showBrand && brands.length > 0 ? (
          <label className="grid gap-1 text-sm font-semibold">
            العلامة
            <select
              aria-label="العلامة التجارية"
              value={query.brandId ?? ""}
              onChange={(e) => push("brand", e.target.value === "" ? null : e.target.value)}
              className="min-h-[44px] max-w-[200px] rounded-control border border-line bg-white px-2"
            >
              <option value="">الكل</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="grid gap-1 text-sm font-semibold">
          <span>التوفر</span>
          {availabilityKnown ? (
            <label className="flex min-h-[44px] items-center gap-2">
              <input
                type="checkbox"
                checked={query.inStock === true}
                onChange={(e) => push("inStock", e.target.checked ? "true" : null)}
                className="h-5 w-5"
              />
              متوفر فقط
            </label>
          ) : (
            <>
              <p className="text-xs font-normal text-secondary">
                التوفر غير محدد حاليًا — لا تتوفر بيانات مخزون لتطبيق هذه التصفية.
              </p>
              <label className="flex min-h-[44px] items-center gap-2 opacity-60">
                <input type="checkbox" disabled className="h-5 w-5" />
                متوفر فقط (غير متاح حاليًا)
              </label>
            </>
          )}
        </div>
        <label className="grid gap-1 text-sm font-semibold">
          من سعر
          <input
            inputMode="decimal"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            placeholder="0.00"
            aria-describedby={rangeError ? "price-range-error" : undefined}
            className="min-h-[44px] w-24 rounded-control border border-line bg-white px-2"
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          إلى سعر
          <input
            inputMode="decimal"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            placeholder="0.00"
            aria-describedby={rangeError ? "price-range-error" : undefined}
            className="min-h-[44px] w-24 rounded-control border border-line bg-white px-2"
          />
        </label>
        {rangeError ? (
          <p id="price-range-error" role="alert" className="text-xs text-error">
            الحد الأول أكبر من الثاني — عدّل النطاق ثم أعد المحاولة.
          </p>
        ) : null}
        <button
          type="submit"
          className="min-h-[44px] rounded-control bg-brand px-4 font-semibold text-white"
        >
          تطبيق السعر
        </button>
        {activeCount > 0 ? (
          <button
            type="button"
            onClick={() => {
              const sp = new URLSearchParams(current);
              for (const k of ["type", "inStock", "minPrice", "maxPrice", "brand", "category", "sort", "dir"]) sp.delete(k);
              setMinPrice("");
              setMaxPrice("");
              const s = sp.toString();
              router.push(s === "" ? pathname : `${pathname}?${s}`);
            }}
            className="min-h-[44px] rounded-control border border-line-strong bg-white px-4 font-semibold text-ink"
          >
            مسح الفلاتر ({activeCount})
          </button>
        ) : null}
      </div>
    </form>
  );
}
