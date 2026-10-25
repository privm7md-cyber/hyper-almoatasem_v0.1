// FE-10A admin navigation data + permission filter (pure + testable).
// D45 hide-by-default: the permitted navigation is computed from the session
// permission snapshot handed in as plain data — this module never decides WHAT
// a role may do, only what the sidebar shows.

export interface NavItem {
  href: string;
  label: string;
  perm: string | null;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const ADMIN_NAV_GROUPS: NavGroup[] = [
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

export type PermittedNavGroup = { title: string; items: { href: string; label: string }[] };

export function permittedNavGroups(groups: NavGroup[], permissions: string[] | null | undefined): PermittedNavGroup[] {
  const can = (perm: string | null) => perm === null || (permissions?.includes(perm) ?? false);
  return groups
    .map((group) => ({
      title: group.title,
      items: group.items.filter((item) => can(item.perm)).map((item) => ({ href: item.href, label: item.label })),
    }))
    .filter((group) => group.items.length > 0);
}
