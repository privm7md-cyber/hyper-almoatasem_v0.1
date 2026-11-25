// FE-4 product gallery (single selected-image state; server-provided rows only).
// One image ⇒ no thumbnails (never a fake gallery). Keyboard-operable thumbs.

"use client";

import { useState } from "react";
import { Package, Scale } from "lucide-react";

export function ProductGallery({
  images,
  name,
  productType = "PIECE",
}: {
  images: { url: string; alt: string | null }[];
  name: string;
  productType?: "PIECE" | "WEIGHT";
}) {
  const [selected, setSelected] = useState(0);
  if (images.length === 0) {
    const Icon = productType === "WEIGHT" ? Scale : Package;
    return (
      <div className="relative flex aspect-[4/3] flex-col items-center justify-center gap-3 overflow-hidden rounded-card border border-line bg-gradient-to-br from-purple-surface via-white to-orange-surface/65 p-6 shadow-xs">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-10 -top-10 h-36 w-36 rounded-full border border-brand/10 bg-brand/[0.04]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-12 -right-8 h-40 w-40 rounded-full bg-[color:var(--brand-orange)]/10"
        />
        <span
          aria-hidden="true"
          className="relative inline-flex h-16 w-16 items-center justify-center rounded-full border border-line bg-white text-brand shadow-xs"
        >
          <Icon size={28} strokeWidth={1.6} />
        </span>
        <span className="relative rounded-badge border border-line/70 bg-white/90 px-3 py-1 text-sm font-medium text-secondary">
          بلا صورة
        </span>
      </div>
    );
  }
  const current = images[Math.min(selected, images.length - 1)];
  return (
    <div className="grid gap-3">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-card border border-line bg-white p-3 shadow-xs">
        {/* Plain img: external URL metadata, no next/image remote config exists. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={current.alt ?? name}
          fetchPriority="high"
          decoding="async"
          className="h-full w-full object-contain"
        />
      </div>
      {images.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto" role="group" aria-label="صور المنتج">
          {images.map((im, i) => (
            <button
              key={im.url + i}
              type="button"
              onClick={() => setSelected(i)}
              aria-pressed={selected === i}
              aria-label={`الصورة ${i + 1} من ${images.length}`}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-control border ${selected === i ? "border-brand" : "border-line"} bg-white`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.url} alt="" className="h-full w-full object-contain" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
