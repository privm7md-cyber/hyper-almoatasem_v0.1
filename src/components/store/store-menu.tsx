// Phase-11 store mobile menu ("use client": open/close state only).
//
// The drawer is a real dialog: it opens and closes, takes focus, returns the
// focus to the trigger, closes on Escape and on navigation, and locks the
// background scroll while it is open. Every destination is a REAL route.

"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";

const SECTIONS = [
  { href: "/", label: "الرئيسية" },
  { href: "/categories", label: "الأقسام" },
  { href: "/brands", label: "العلامات" },
  { href: "/search", label: "البحث في المنتجات" },
  { href: "/cart", label: "السلة" },
  { href: "/account", label: "حسابي" },
  { href: "/orders", label: "طلباتي" },
];

const INFO = [
  { href: "/about", label: "من نحن" },
  { href: "/faq", label: "الأسئلة الشائعة" },
  { href: "/delivery", label: "سياسة التوصيل" },
  { href: "/cancellation", label: "سياسة الإلغاء" },
  { href: "/replacement", label: "سياسة الاستبدال" },
  { href: "/order-help", label: "مساعدة الطلب" },
];

export function StoreMenu() {
  // The open state is DERIVED from the route it was opened on: navigating
  // (including the browser back/forward buttons) changes the pathname and the
  // menu closes by itself — no effect, no stale dialog.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const pathname = usePathname();
  const open = openedAt !== null && openedAt === pathname;
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = (restoreFocus = true) => {
    setOpenedAt(null);
    if (restoreFocus) triggerRef.current?.focus();
  };

  // Escape closes and the focus returns to the trigger.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // The background must not scroll behind an open dialog.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Move the focus into the panel when it opens.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpenedAt(pathname)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-line bg-white text-ink transition-colors duration-200 hover:border-line-strong focus-visible:border-brand lg:hidden"
      >
        <span className="sr-only">فتح قائمة المتجر</span>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => close()}
            className="absolute inset-0 h-full w-full cursor-default bg-[color:var(--text-ink)]/45"
          />
          <div
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label="قائمة المتجر"
            ref={panelRef}
            tabIndex={-1}
            className="absolute inset-x-0 top-0 max-h-[85dvh] overflow-y-auto rounded-b-card border-b border-line bg-white p-4 shadow-xl outline-none"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold">قائمة المتجر</h2>
              <button
                type="button"
                onClick={() => close()}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-line text-secondary transition-colors duration-200 hover:border-line-strong"
              >
                <span className="sr-only">إغلاق القائمة</span>
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="أقسام المتجر">
              <ul className="grid gap-1">
                {SECTIONS.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpenedAt(null)}
                      className="flex min-h-[44px] items-center rounded-control px-3 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-purple-surface"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <nav aria-label="معلومات المتجر" className="mt-4 border-t border-line pt-3">
              <h3 className="mb-1 px-3 text-xs font-bold text-secondary">معلومات</h3>
              <ul className="grid gap-1">
                {INFO.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpenedAt(null)}
                      className="flex min-h-[44px] items-center rounded-control px-3 text-sm text-secondary transition-colors duration-200 hover:bg-purple-surface"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}
