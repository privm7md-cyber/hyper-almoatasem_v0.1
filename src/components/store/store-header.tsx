// FE-2 store header (server): wordmark text (D16 behavior), search island, honest nav.

import Link from "next/link";
import { SearchBox } from "./search-box";

export function StoreHeader() {
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 md:px-6 md:py-4">
        <Link
          href="/"
          className="flex shrink-0 items-baseline gap-2"
          aria-label="هايبر المعتصم — الرئيسية"
        >
          <span className="text-xl font-extrabold tracking-tight text-brand md:text-[22px]">
            هايبر <span className="text-accent">المعتصم</span>
          </span>
          <span className="hidden rounded-badge bg-purple-surface px-2 py-0.5 text-[11px] font-semibold text-secondary md:inline">
            عصري، نظيف وعملي
          </span>
        </Link>
        <div className="min-w-0 flex-1 basis-48">
          <SearchBox />
        </div>
      </div>
    </header>
  );
}
