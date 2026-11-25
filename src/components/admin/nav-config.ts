// Server-safe navigation data. Permissions control visibility only; each page
// still enforces access on the server. Icon names cross the RSC boundary as data.

export type AdminIconName =
  | "gauge"
  | "clipboard-list"
  | "package"
  | "eye"
  | "eye-off"
  | "archive"
  | "tags"
  | "boxes"
  | "badge-percent"
  | "ticket"
  | "users"
  | "user-cog"
  | "shield-check"
  | "scroll-text"
  | "settings"
  | "map-pinned"
  | "rotate-ccw-clock"
  | "bell";

export interface NavItem {
  href: string;
  label: string;
  hint: string;
  perm: string | null;
  /**
   * Additional ACCEPTED keys (E-3 closure): the item is visible when the
   * operator holds `perm` OR any key in this list. Never a widening of
   * authority — visibility only; every page and API re-checks server-side.
   */
  altPerms?: readonly string[];
  icon: AdminIconName;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    title: "الرئيسية",
    items: [
      { href: "/admin", label: "الرئيسية", hint: "نقطة البداية لكل أقسام الإدارة.", perm: null, icon: "gauge" },
    ],
  },
  {
    title: "التشغيل",
    items: [
      { href: "/admin/orders", label: "الطلبات", hint: "متابعة الطلبات وتجهيزها حسب حالتها.", perm: "orders.view", icon: "clipboard-list" },
      { href: "/admin/customers", label: "العملاء", hint: "مراجعة بيانات العملاء وطلباتهم.", perm: "customers.view", icon: "users" },
    ],
  },
  {
    title: "المنتجات والمخزون",
    items: [
      { href: "/admin/products", label: "كل المنتجات", hint: "البحث في المنتجات وإدارة بياناتها.", perm: "products.view", icon: "package" },
      { href: "/admin/products?state=displayed", label: "المنتجات المعروضة", hint: "المنتجات المعروضة للعملاء في المتجر.", perm: "products.view", icon: "eye" },
      { href: "/admin/products?state=hidden", label: "المنتجات المخفية", hint: "المنتجات غير المعروضة للعملاء.", perm: "products.view", icon: "eye-off" },
      { href: "/admin/products?state=archived", label: "أرشيف المنتجات", hint: "مراجعة المنتجات المؤرشفة.", perm: "products.view", icon: "archive" },
      { href: "/admin/taxonomy", label: "التصنيفات والعلامات", hint: "أقسام المنتجات وعلاماتها التجارية.", perm: "products.view", icon: "tags" },
      { href: "/admin/inventory", label: "المخزون", hint: "متابعة الكميات وإضافتها وتسويتها.", perm: "inventory.view", icon: "boxes" },
    ],
  },
  {
    title: "التسويق",
    items: [
      { href: "/admin/promotions", label: "العروض والخصومات", hint: "مراجعة العروض وإدارة الخصومات.", perm: "promotions.view", icon: "badge-percent" },
      { href: "/admin/coupons", label: "أكواد الخصم", hint: "الأكواد التي يستخدمها العميل للحصول على خصم.", perm: "coupons.view", icon: "ticket" },
    ],
  },
  {
    title: "إدارة النظام",
    items: [
      { href: "/admin/users", label: "المستخدمون", hint: "حسابات الفريق الذي يدخل لوحة الإدارة.", perm: "users.view", icon: "user-cog" },
      { href: "/admin/roles", label: "أدوار الموظفين", hint: "مجموعات الصلاحيات الممنوحة للفريق.", perm: "roles.view", icon: "shield-check" },
      { href: "/admin/permissions", label: "صلاحيات المستخدمين", hint: "كتالوج الصلاحيات المتاحة في اللوحة.", perm: "roles.view", icon: "scroll-text" },
      { href: "/admin/delivery-zones", label: "مناطق التوصيل", hint: "مناطق التوصيل وتكلفة كل منطقة.", perm: "delivery.view", altPerms: ["settings.view"], icon: "map-pinned" },
      { href: "/admin/audit-logs", label: "سجل التغييرات", hint: "مراجعة من غيّر البيانات ومتى.", perm: "audit_logs.view", icon: "rotate-ccw-clock" },
      // Own-account notifications: no reports/notifications permission implied.
      { href: "/admin/notifications", label: "إشعاراتي", hint: "إشعارات الحساب الحالي فقط.", perm: null, icon: "bell" },
      { href: "/admin/settings", label: "إعدادات المتجر", hint: "الإعدادات التي تتحكم في المتجر.", perm: "settings.view", icon: "settings" },
    ],
  },
];

export type PermittedNavGroup = {
  title: string;
  items: { href: string; label: string; hint: string; icon: AdminIconName }[];
};

export function permittedNavGroups(
  groups: NavGroup[],
  permissions: string[] | null | undefined,
): PermittedNavGroup[] {
  const can = (item: NavItem) =>
    item.perm === null ||
    (permissions?.includes(item.perm) ?? false) ||
    (item.altPerms ?? []).some((key) => permissions?.includes(key) ?? false);
  return groups
    .map((group) => ({
      title: group.title,
      items: group.items
        .filter((item) => can(item))
        .map((item) => ({ href: item.href, label: item.label, hint: item.hint, icon: item.icon })),
    }))
    .filter((group) => group.items.length > 0);
}

export const NAV_TITLES: Record<string, string> = Object.fromEntries(
  ADMIN_NAV_GROUPS.flatMap((group) => group.items.map((item) => [item.href, item.label])),
);

function productNavState(search: URLSearchParams): string | null {
  const state = search.get("state");
  if (state === "displayed" || state === "hidden" || state === "archived") return state;
  const active = search.get("active");
  return active === "true" ? "displayed" : active === "false" ? "hidden" : null;
}

/** Ignore unrelated filters, but never mark all four product links current. */
export function isAdminNavActive(href: string, pathname: string, search = ""): boolean {
  const [itemPath, itemQuery = ""] = href.split("?");
  if (itemPath === "/admin") return pathname === itemPath;
  if (pathname !== itemPath && !pathname.startsWith(`${itemPath}/`)) return false;
  if (itemPath !== "/admin/products") return true;
  const target = new URLSearchParams(itemQuery);
  if (pathname !== itemPath) return !target.has("state");
  const state = productNavState(new URLSearchParams(search));
  return target.has("state") ? state === target.get("state") : state === null;
}

export interface AdminBreadcrumb {
  label: string;
  href?: string;
}

const DETAIL_TITLES: Record<string, string> = {
  "/admin/products": "تفاصيل المنتج",
  "/admin/orders": "تفاصيل الطلب",
  "/admin/customers": "تفاصيل العميل",
  "/admin/promotions": "تفاصيل العرض",
  "/admin/coupons": "تفاصيل كود الخصم",
  "/admin/users": "تفاصيل المستخدم",
  "/admin/roles": "تفاصيل الدور",
  "/admin/audit-logs": "تفاصيل التغيير",
};

/** Route hierarchy without exposing UUIDs or guessing stored record names. */
export function adminBreadcrumbs(pathname: string, search = ""): AdminBreadcrumb[] {
  const home = { label: NAV_TITLES["/admin"], href: "/admin" };
  if (pathname === "/admin") return [{ label: home.label }];
  const base = Object.keys(NAV_TITLES)
    .filter((href) => href !== "/admin" && !href.includes("?"))
    .sort((a, b) => b.length - a.length)
    .find((href) => pathname === href || pathname.startsWith(`${href}/`));
  if (!base) return [home, { label: "لوحة الإدارة" }];
  if (pathname === base) {
    const state = base === "/admin/products" ? productNavState(new URLSearchParams(search)) : null;
    const filteredTitle = state ? NAV_TITLES[`${base}?state=${state}`] : null;
    return filteredTitle
      ? [home, { label: NAV_TITLES[base], href: base }, { label: filteredTitle }]
      : [home, { label: NAV_TITLES[base] }];
  }
  const rest = pathname.slice(base.length + 1).split("/");
  const detail = base === "/admin/products" && rest[0] === "new"
    ? "إضافة منتج"
    : DETAIL_TITLES[base] ?? "التفاصيل";
  const crumbs: AdminBreadcrumb[] = [home, { label: NAV_TITLES[base], href: base }, { label: detail }];
  if (rest.length > 1) {
    crumbs[2].href = `${base}/${rest[0]}`;
    crumbs.push({ label: rest.at(-1) === "edit" ? "تعديل البيانات" : "تفاصيل إضافية" });
  }
  return crumbs;
}
