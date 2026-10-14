// FE-4 product gallery (single selected-image state; server-provided rows only).
// One image ⇒ no thumbnails (never a fake gallery). Keyboard-operable thumbs.

"use client";

import { useState } from "react";

export function ProductGallery({ images, name }: { images: { url: string; alt: string | null }[]; name: string }) {
  const [selected, setSelected] = useState(0);
  if (images.length === 0) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-card bg-purple-surface">
        <span className="text-sm text-secondary">بلا صورة</span>
      </div>
    );
  }
  const current = images[Math.min(selected, images.length - 1)];
  return (
    <div className="grid gap-2">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-card bg-purple-surface">
        {/* Plain img: external URL metadata, no next/image remote config exists. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={current.alt ?? name}
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
