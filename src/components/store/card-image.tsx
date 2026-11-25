"use client";

import { useState } from "react";
import { ImageOff, Package, Scale } from "lucide-react";

/** Only browser image failure handling lives on the client; no catalog/cart reads. */
export function CardImage({
  src,
  name,
  unavailable = false,
  productType = "PIECE",
}: {
  src: string | null;
  name: string;
  unavailable?: boolean;
  productType?: "PIECE" | "WEIGHT";
}) {
  const [broken, setBroken] = useState(false);
  if (unavailable || broken || !src) {
    const failed = unavailable || broken;
    const FallbackIcon = failed ? ImageOff : productType === "WEIGHT" ? Scale : Package;
    return (
      <span
        className="relative flex h-full w-full flex-col items-center justify-center gap-2 overflow-hidden bg-gradient-to-br from-purple-surface via-white/70 to-orange-surface/65 p-3 text-secondary"
        role={failed ? "status" : undefined}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -end-6 -top-6 h-20 w-20 rounded-full border border-brand/10 bg-brand/[0.04]"
        />
        <span
          aria-hidden="true"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line/80 bg-white/90 text-brand/75 shadow-xs"
        >
          <FallbackIcon size={20} strokeWidth={1.6} />
        </span>
        <span className="rounded-badge bg-white/80 px-2 py-0.5 text-[11px] font-medium text-secondary">
          {failed ? "الصورة غير متاحة حاليًا" : "بلا صورة"}
        </span>
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={name} loading="lazy" onError={() => setBroken(true)}
      className="h-full w-full object-contain transition-transform duration-300 hover:scale-[1.03]" />
  );
}
