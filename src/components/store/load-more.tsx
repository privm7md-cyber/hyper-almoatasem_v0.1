// FE-3 load-more island ("use client"): appends the next keyset page via server action.
// Filters/sort stay those of the current URL (same params the server used); refresh returns
// to page 1 by design (documented keyset limitation — never invented page numbers).

"use client";

import { useState } from "react";
import { ProductCard } from "./product-card";
import type { HomeProductCard } from "@/lib/frontend/storefront-reads";

export function LoadMore({
  initialCursor,
  loadPage,
}: {
  initialCursor: string | null;
  /** Bound server action (category/brand/query already applied by the caller). */
  loadPage: (cursor: string) => Promise<{ cards: HomeProductCard[]; nextCursor: string | null }>;
}) {
  const [cards, setCards] = useState<HomeProductCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  if (cursor === null && cards.length === 0) return null;

  async function more() {
    if (cursor === null || pending) return;
    setPending(true);
    setFailed(false);
    try {
      const page = await loadPage(cursor);
      setCards((prev) => [...prev, ...page.cards]);
      setCursor(page.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {cards.length > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {cards.map((c) => (
            <ProductCard key={c.id} product={c} />
          ))}
        </div>
      ) : null}
      {cursor !== null ? (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={more}
            disabled={pending}
            className="min-h-[44px] rounded-control border border-line-strong bg-white px-6 font-semibold text-ink disabled:opacity-55"
          >
            {pending ? "جارٍ التحميل…" : failed ? "إعادة محاولة التحميل" : "تحميل المزيد"}
          </button>
        </div>
      ) : null}
    </>
  );
}
