// FE-10A admin shell layout (server): sidebar + topbar around section pages.
// Nav visibility follows the session permission snapshot (D45 hide-by-default);
// every gated page re-verifies server-side (visibility is UX only, never a boundary).

import Link from "next/link";
import { getCurrentAdmin } from "@/lib/auth/rbac";
import { logoutAction } from "@/app/actions/auth";

interface NavItem {
  href: string;
  label: string;
  perm: string | null;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    title: "العمليات",
    items: [
      { href: "/admin", label: "اللوحة", perm: null },
      { href: "/admin/orders", label: "الطلبات", perm: "orders.view" },
    ],
  },
  {
    title: "الكتالوج والمخزون",
    items: [
      { href: "/admin/products", label: "المنتجات", perm: "products.view" },
      { href: "/admin/taxonomy", label: "التصنيفات والعلامات", perm: "products.view" },
      { href: "/admin/inventory", label: "المخزون", perm: "inventory.view" },
    ],
  },
  {
    title: "التسويق",
    items: [
      { href: "/admin/promotions", label: "العروض", perm: "promotions.view" },
      { href: "/admin/coupons", label: "الكوبونات", perm: "coupons.view" },
    ],
  },
  {
    title: "العملاء",
    items: [{ href: "/admin/customers", label: "العملاء", perm: "customers.view" }],
  },
  {
    title: "النظام",
    items: [
      { href: "/admin/users", label: "المستخدمون", perm: "users.view" },
      { href: "/admin/roles", label: "الأدوار", perm: "roles.view" },
      { href: "/admin/permissions", label: "سجل الصلاحيات", perm: "roles.view" },
      { href: "/admin/settings", label: "الإعدادات", perm: "settings.view" },
      { href: "/admin/audit-logs", label: "سجل التدقيق", perm: "audit_logs.view" },
    ],
  },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();
  const can = (perm: string | null) => perm === null || (admin?.permissions.includes(perm) ?? false);
  return (
    <div dir="rtl" className="min-h-screen bg-zinc-50">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-3 px-4 py-3">
          <Link href="/admin" className="text-lg font-extrabold text-brand">
            هايبر المعتصم <span className="text-sm font-semibold text-secondary">— الإدارة</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-secondary">{admin ? admin.user.name : "غير مسجّل"}</span>
            {admin ? (
              <form action={logoutAction}>
                <button type="submit" className="min-h-[44px] rounded-control border border-line bg-white px-4 text-sm font-semibold">
                  خروج
                </button>
              </form>
            ) : null}
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 py-4 md:flex-row">
        <nav aria-label="أقسام الإدارة" className="md:w-56 md:shrink-0">
          <ul className="grid gap-4 md:gap-4">
            {GROUPS.map((group) => {
              const visible = group.items.filter((item) => can(item.perm));
              if (visible.length === 0) return null;
              return (
                <li key={group.title}>
                  <p className="mb-1 text-xs font-bold text-secondary">{group.title}</p>
                  <ul className="grid gap-1">
                    {visible.map((item) => (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className="block min-h-[44px] rounded-control px-3 py-2 text-sm font-semibold text-ink hover:bg-purple-surface"
                        >
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
