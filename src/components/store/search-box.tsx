// FE-2 header search island ("use client": interactive submit only).
// Submits to the real minimal /search results page (no autocomplete endpoint exists).

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SearchBox({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  return (
    <form
      role="search"
      aria-label="البحث في المتجر"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        if (q.length >= 2) router.push(`/search?q=${encodeURIComponent(q)}`);
      }}
      className="flex gap-2"
    >
      <label htmlFor="store-search" className="sr-only">
        ابحث عن منتج
      </label>
      <input
        id="store-search"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="ابحث عن منتج…"
        minLength={2}
        maxLength={120}
        className="min-h-[44px] w-full rounded-control border border-line bg-white px-3 text-base text-ink"
      />
      <button
        type="submit"
        className="min-h-[44px] shrink-0 rounded-control bg-brand px-5 font-semibold text-white"
      >
        بحث
      </button>
    </form>
  );
}
