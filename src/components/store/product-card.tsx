// FE-2/FE-4 home product card (server, presentational): authoritative fields only.
// Links to the real PDP route (/p/[id]/[slug]); no add-to-cart here (PDP owns purchase).

import Link from "next/link";
import type { HomeProductCard } from "@/lib/frontend/storefront-reads";

export function ProductCard({ product }: { product: HomeProductCard }) {
  const href = `/p/${product.id}/${encodeURIComponent(product.slug)}`;
  return (
    <article aria-label={product.name} className="flex flex-col gap-2 rounded-card bg-white p-3 shadow-subtle">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-control bg-purple-surface">
        {product.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="text-sm text-secondary" aria-hidden="true">
            بلا صورة
          </span>
        )}
      </div>
      <h3 className="line-clamp-2 min-h-[2.6em] text-sm font-bold">
        <Link href={href} className="text-ink" aria-label={`تفاصيل ${product.name}`}>
          {product.name}
        </Link>
      </h3>
      {product.brandName ? <p className="text-xs text-secondary">{product.brandName}</p> : null}
      {product.price !== null ? (
        <p>
          <bdi className="text-lg font-extrabold">
            {product.price} ج.م
          </bdi>
          {product.compareAt !== null ? (
            <bdi className="text-sm text-secondary line-through ms-2">{product.compareAt} ج.م</bdi>
          ) : null}
        </p>
      ) : (
        <p className="text-sm text-secondary">السعر عند الاختيار</p>
      )}
      <p className="text-sm font-semibold" aria-live="off">
        {product.stock === "in" ? (
          <span className="text-success">متوفر</span>
        ) : product.stock === "oos" ? (
          <span className="text-error">غير متوفر</span>
        ) : (
          <span className="text-secondary">التوفر غير مؤكد</span>
        )}
      </p>
      <p className="text-xs text-secondary">{product.unit === "PIECE" ? "بالقطعة" : "بالوزن (تقديري)"}</p>
    </article>
  );
}
