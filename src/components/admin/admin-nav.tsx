// Phase-11 admin navigation ("use client": drawer + active state only).
//
// The admin sidebar was a plain server-rendered list: on a phone it was a
// narrow column squeezed next to the content (the shell is `md:flex-row`, so
// below 768px the nav sat ON TOP of the page and pushed the content down),
// and nothing ever marked the current section.
//
// The permitted items are computed SERVER-side (the layout filters them by the
// session permission snapshot) and handed over as data — this component never
// decides what a role may see, and it never hides a control the backend
// would refuse. Hiding is UX only; every page re-verifies its own permission.

"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

export interface AdminNavItem {
  href: string;
  label: string;
}

export interface AdminNavGroup {
  title: string;
  items: AdminNavItem[];
}

export function AdminNav({ groups }: { groups: AdminNavGroup[] }) {
  // The open state is DERIVED from the route it was opened on: navigating
  // (including the browser back/forward buttons) changes the pathname and the
  // drawer closes by itself — no effect, no stale dialog.
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

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);

  const linkClass = (item: AdminNavItem) =>
    `flex min-h-[44px] items-center rounded-control px-3 text-sm font-semibold transition-colors duration-200 ${
      isActive(item.href) ? "bg-purple-surface text-brand" : "text-ink hover:bg-purple-surface"
    }`;

  const list = (
    <ul className="grid gap-4">
      {groups.map((group) => (
        <li key={group.title}>
          <p className="mb-1 px-3 text-xs font-bold text-secondary">{group.title}</p>
          <ul className="grid gap-1">
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => close()}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={linkClass(item)}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpenedAt(pathname)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        className="mb-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-control border border-line bg-white px-4 text-sm font-semibold text-ink transition-colors duration-200 hover:border-line-strong md:hidden"
      >
        <Menu size={18} aria-hidden="true" />
        أقسام الإدارة
      </button>

      <nav aria-label="أقسام الإدارة" className="hidden md:block md:w-56 md:shrink-0">
        {list}
      </nav>

      {open ? (
        <div className="fixed inset-0 z-[70] md:hidden">
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
            aria-label="أقسام الإدارة"
            ref={panelRef}
            tabIndex={-1}
            className="absolute inset-y-0 right-0 w-[86%] max-w-[320px] overflow-y-auto border-l border-line bg-white p-4 shadow-xl outline-none"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold">أقسام الإدارة</h2>
              <button
                type="button"
                onClick={() => close()}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-line text-secondary transition-colors duration-200 hover:border-line-strong"
              >
                <span className="sr-only">إغلاق القائمة</span>
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            {list}
          </div>
        </div>
      ) : null}
    </>
  );
}
