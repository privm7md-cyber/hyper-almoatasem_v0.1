// FE-2/FE-4 product card (server, presentational): authoritative fields only.
// Links to the real PDP route (/p/[id]/[slug]); no add-to-cart here (PDP owns purchase).
// VXP: bordered card w/ gentle hover lift, availability chip w/ distinct states,
// image frame stays stable with or without artwork.
// Phase 07 (D01): the price is shown with ITS OWN basis — a WEIGHT product priced
// per kilogram reads "X ج.م / كجم"; a pack-priced product reads "X ج.م" with its pack
// detail. A price is never divided by a weight, and a reference price is never
// dressed up as a discount (D01/AC-10).
// DS-02: chip text uses the AA-safe success INK over the tinted success fill; the
// identity green (dot/icon) is unchanged.

import Link from "next/link";
import { ImageOff } from "lucide-react";
import type { HomeProductCard } from "@/lib/frontend/storefront-reads";
import { saleBasisFor } from "@/lib/frontend/cart-qty";
import { CardBuy } from "@/components/store/card-buy";

const STOCK_CHIP: Record<HomeProductCard["stock"], { className: string; dotClass: string; label: string }> = {
  in: { className: "bg-[color:var(--success-bg)] text-success-ink", dotClass: "bg-success", label: "متوفر" },
  oos: { className: "bg-[color:var(--error-bg)] text-error", dotClass: "bg-error", label: "غير متوفر" },
  unknown: {
    className: "bg-purple-surface text-secondary",
    dotClass: "bg-[color:var(--border-strong)]",
    label: "التوفر غير محدد حاليًا",
  },
};

const SIZE_UNIT_LABEL: Record<string, string> = {
  GRAM: "جم",
  KG: "كجم",
  ML: "مل",
  LITER: "لتر",
  PIECE: "قطعة",
};

/** Pack detail (e.g. "عبوة 125 جم") — a size detail, never a price basis. */
function packDetail(product: HomeProductCard): string | null {
  if (!product.sizeValue || !product.sizeUnit) return null;
  const unit = SIZE_UNIT_LABEL[product.sizeUnit] ?? product.sizeUnit;
  const value = Number(product.sizeValue);
  const shown = Number.isFinite(value) ? String(value) : product.sizeValue;
  return `عبوة ${shown} ${unit}`;
}

export function ProductCard({ product }: { product: HomeProductCard }) {
  const href = `/p/${product.id}/${encodeURIComponent(product.slug)}`;
  const chip = STOCK_CHIP[product.stock];
  const basis = saleBasisFor(product.productType, product.sizeUnit);
  const pack = packDetail(product);
  const saleLine =
    basis === "PER_KG"
      ? "سعر الكيلوجرام"
      : pack ?? (product.productType === "PIECE" ? "بالقطعة" : "سعر الوحدة");
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
            {product.price} ج.م{basis === "PER_KG" ? " / كجم" : ""}
          </bdi>
          {product.compareAt !== null ? (
            <span className="ms-2 text-xs text-secondary">
              السعر المرجعي: <bdi>{product.compareAt} ج.م</bdi> (ليس عرضًا)
            </span>
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
      <p className="mt-auto text-xs text-secondary">{saleLine}</p>
      {/*
        FE-11.2 (AC-P3 owner-approved): PIECE cards carry an add island —
        productType === "PIECE", price known, and availability is not provably
        out (OOS keeps the honest chip + lets the PDP own its disabled add;
        stock "unknown" stays clickable — the server is the authority).
      */}
      {product.productType === "PIECE" && product.stock !== "oos" && product.price !== null ? (
        <CardBuy productId={product.id} />
      ) : null}
    </article>
  );
}
