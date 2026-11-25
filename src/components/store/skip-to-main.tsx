"use client";

import { usePathname } from "next/navigation";

/**
 * Renders the primary skip-to-main link outside authenticated Admin routes
 * (where AdminShell provides its own top-level `.adm-skip-link`). Keeps
 * `/admin/login` and all Storefront routes covered without duplicating `#main`.
 */
export function SkipToMain() {
  const pathname = usePathname() ?? "";
  const isAuthenticatedAdminRoute =
    pathname.startsWith("/admin") && !pathname.startsWith("/admin/login");

  if (isAuthenticatedAdminRoute) {
    return null;
  }

  return (
    <a
      href="#main"
      className="sr-only absolute start-0 top-0 focus:not-sr-only focus:absolute focus:end-4 focus:top-4 focus:z-[80] focus:rounded-control focus:bg-brand focus:px-4 focus:py-2 focus:font-semibold focus:text-white"
    >
      تخطَّ إلى المحتوى
    </a>
  );
}
