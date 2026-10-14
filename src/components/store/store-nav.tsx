// FE-2 mobile bottom navigation ("use client": active-state only).
// FP03-C1 five items. Interim honesty rule (FE-2): destinations without routes render
// disabled with "قريبًا" — never as working links, never to 404.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, LayoutGrid, ShoppingCart, Package, UserRound } from "lucide-react";

interface Item {
  id: string;
  label: string;
  href: string | null;
  Icon: typeof House;
}

const ITEMS: Item[] = [
  { id: "home", label: "الرئيسية", href: "/", Icon: House },
  { id: "categories", label: "الأقسام", href: "/#categories", Icon: LayoutGrid },
  { id: "cart", label: "السلة", href: "/cart", Icon: ShoppingCart },
  { id: "orders", label: "الطلبات", href: null, Icon: Package },
  { id: "account", label: "الحساب", href: "/account", Icon: UserRound },
];

export function StoreNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="التنقل الرئيسي" className="fixed inset-x-0 bottom-0 z-sticky border-t border-line bg-white md:hidden">
      <ul className="grid grid-cols-5">
        {ITEMS.map((item) => {
          const active = item.href !== null && (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href));
          const inner = (
            <>
              <item.Icon size={22} aria-hidden="true" />
              <span className="text-xs font-semibold">
                {item.label}
                {item.href === null ? " (قريبًا)" : ""}
              </span>
            </>
          );
          return (
            <li key={item.id} className="min-w-0">
              {item.href === null ? (
                <span
                  aria-disabled="true"
                  title={`${item.label} — ستتوفر في مرحلة لاحقة`}
                  className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-secondary opacity-70"
                >
                  {inner}
                </span>
              ) : (
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 ${
                    active ? "text-brand" : "text-ink"
                  }`}
                >
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
