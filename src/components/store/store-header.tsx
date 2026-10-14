// FE-2 store header (server): wordmark text (D16 behavior), search island, honest nav.
import Link from "next/link";
import { SearchBox } from "./search-box";

export function StoreHeader() {
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 md:px-6">
        <Link
          href="/"
          className="text-xl font-extrabold text-brand"
          aria-label="هايبر المعتصم — الرئيسية"
        >
          هايبر <span className="text-accent">المعتصم</span>
        </Link>
        <div className="min-w-0 flex-1 basis-48">
          <SearchBox />
        </div>
      </div>
    </header>
  );
}
