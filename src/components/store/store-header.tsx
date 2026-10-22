// Phase-11 store header (server): wordmark, section navigation, search, actions.
//
// The header used to be a single row with a wordmark and a search box and
// nothing else: on a desktop there was no navigation at all, and the cart and
// the account were reachable only from the mobile bottom bar (which is hidden
// above 768px). The desktop row now carries the real destinations, and the
// mobile row carries the menu trigger.

import Link from "next/link";
import { ShoppingCart, UserRound } from "lucide-react";
import { SearchBox } from "./search-box";
import { StoreMenu } from "./store-menu";

const DESKTOP_LINKS = [
  { href: "/categories", label: "الأقسام" },
  { href: "/brands", label: "العلامات" },
  { href: "/search", label: "البحث" },
];

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

        <nav aria-label="أقسام المتجر" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {DESKTOP_LINKS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex min-h-[44px] items-center rounded-control px-3 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-purple-surface"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 basis-48">
          <SearchBox />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Link
            href="/cart"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-line bg-white text-ink transition-colors duration-200 hover:border-line-strong focus-visible:border-brand"
          >
            <span className="sr-only">السلة</span>
            <ShoppingCart size={20} aria-hidden="true" />
          </Link>
          <Link
            href="/account"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-line bg-white text-ink transition-colors duration-200 hover:border-line-strong focus-visible:border-brand lg:hidden"
          >
            <span className="sr-only">حسابي</span>
            <UserRound size={20} aria-hidden="true" />
          </Link>
          <StoreMenu />
        </div>
      </div>
    </header>
  );
}
