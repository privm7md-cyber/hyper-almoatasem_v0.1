// Phase-11 mobile bottom navigation ("use client": active-state only).
//
// Fixed in this phase:
//   * the active state could never match the categories item (the href carried
//     an anchor, and a pathname never contains "#") — the item is now matched
//     on the real destinations;
//   * `z-sticky` is not a Tailwind class (there is no z-index theme
//     namespace), so the bar had `z-index: auto` and the toast painted over
//     it — the bar now carries an explicit z-index;
//   * the bar had no safe-area inset, so on a phone with a home indicator the
//     last row sat flush against the indicator;
//   * the "orders" item was disabled even though /orders exists and works —
//     it is now a real link (the page itself handles the signed-out case).

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, LayoutGrid, ShoppingCart, Package, UserRound } from "lucide-react";

interface Item {
  id: string;
  label: string;
  href: string;
  Icon: typeof House;
  /** Path prefixes that mark this item as the current destination. */
  match: string[];
}

const ITEMS: Item[] = [
  { id: "home", label: "الرئيسية", href: "/", Icon: House, match: ["/"] },
  {
    id: "categories",
    label: "الأقسام",
    href: "/categories",
    Icon: LayoutGrid,
    match: ["/categories", "/c/"],
  },
  { id: "cart", label: "السلة", href: "/cart", Icon: ShoppingCart, match: ["/cart"] },
  { id: "orders", label: "الطلبات", href: "/orders", Icon: Package, match: ["/orders", "/order-confirmation/"] },
  { id: "account", label: "الحساب", href: "/account", Icon: UserRound, match: ["/account"] },
];

export function StoreNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="التنقل الرئيسي"
      className="fixed inset-x-0 bottom-0 z-[30] border-t border-line bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_rgba(27,21,48,0.06)] md:hidden"
    >
      <ul className="grid grid-cols-5">
        {ITEMS.map((item) => {
          const active =
            item.match.length === 1 && item.match[0] === "/"
              ? pathname === "/"
              : item.match.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
          const inner = (
            <>
              <item.Icon size={22} aria-hidden="true" />
              <span className="text-xs font-semibold">{item.label}</span>
            </>
          );
          return (
            <li key={item.id} className="min-w-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 transition-colors duration-200 ${
                  active ? "text-brand" : "text-ink"
                }`}
              >
                {inner}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
