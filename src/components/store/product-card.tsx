// FE-2/FE-4 product card (server, presentational): authoritative fields only.
// Links to the real PDP route (/p/[id]/[slug]); no add-to-cart here (PDP owns purchase).
// VXP: bordered card w/ gentle hover lift, availability chip w/ distinct states,
// image frame stays stable with or without artwork.

import Link from "next/link";
import { ImageOff } from "lucide-react";
import type { HomeProductCard } from "@/lib/frontend/storefront-reads";

const STOCK_CHIP: Record<HomeProductCard["stock"], { className: string; dotClass: string; label: string }> = {
  in: { className: "bg-[color:var(--success-bg)] text-success", dotClass: "bg-success", label: "متوفر" },
  oos: { className: "bg-[color:var(--error-bg)] text-error", dotClass: "bg-error", label: "غير متوفر" },
  unknown: {
    className: "bg-purple-surface text-secondary",
    dotClass: "bg-[color:var(--border-strong)]",
    label: "التوفر غير مؤكد",
  },
};

export function ProductCard({ product }: { product: HomeProductCard }) {
  const href = `/p/${product.id}/${encodeURIComponent(product.slug)}`;
  const chip = STOCK_CHIP[product.stock];
  return (
    <article
      aria-label={product.name}
      className="vxp-card flex h-full flex-col gap-2 rounded-card border border-line bg-white p-3 shadow-subtle hover:border-brand/40"
    >
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-control bg-purple-surface">
        {product.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-contain transition-transform duration-300 hover:scale-[1.03]"
          />
        ) : (
          <span className="flex flex-col items-center gap-1.5 text-secondary" aria-hidden="true">
            <ImageOff size={26} strokeWidth={1.5} className="text-[color:var(--border-strong)]" />
            <span className="text-xs">بلا صورة</span>
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
            <bdi className="ms-2 text-sm text-secondary line-through">{product.compareAt} ج.م</bdi>
          ) : null}
        </p>
      ) : (
        <p className="text-sm text-secondary">السعر عند الاختيار</p>
      )}
      <p className="text-sm" aria-live="off">
        <span className={`inline-flex items-center gap-1.5 rounded-badge px-2 py-0.5 text-xs font-semibold ${chip.className}`}>
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${chip.dotClass}`} />
          {chip.label}
        </span>
      </p>
      <p className="mt-auto text-xs text-secondary">{product.unit === "PIECE" ? "بالقطعة" : "بالوزن (تقديري)"}</p>
    </article>
  );
}
