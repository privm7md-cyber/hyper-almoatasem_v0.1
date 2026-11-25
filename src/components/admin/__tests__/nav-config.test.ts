import { describe, expect, it } from "vitest";
import { ADMIN_NAV_GROUPS, adminBreadcrumbs, isAdminNavActive, permittedNavGroups } from "@/components/admin/nav-config";
import { navIcon } from "@/components/admin/nav-icons";

const productLinks = [
  "/admin/products",
  "/admin/products?state=displayed",
  "/admin/products?state=hidden",
  "/admin/products?state=archived",
];

describe("permittedNavGroups (hide-by-default, own-account notifications)", () => {
  it.each([null, undefined, []])("shows home and own notifications without a permission snapshot: %s", (permissions) => {
    const groups = permittedNavGroups(ADMIN_NAV_GROUPS, permissions);
    expect(groups.map((group) => group.title)).toEqual(["الرئيسية", "إدارة النظام"]);
    expect(groups.flatMap((group) => group.items.map((item) => item.href))).toEqual(["/admin", "/admin/notifications"]);
  });

  it("uses the operational architecture and drops empty permission groups", () => {
    expect(ADMIN_NAV_GROUPS.map((group) => group.title)).toEqual([
      "الرئيسية", "التشغيل", "المنتجات والمخزون", "التسويق", "إدارة النظام",
    ]);
    const groups = permittedNavGroups(ADMIN_NAV_GROUPS, ["orders.view", "products.view"]);
    expect(groups.map((group) => group.title)).toEqual(["الرئيسية", "التشغيل", "المنتجات والمخزون", "إدارة النظام"]);
    expect(groups[1].items.map((item) => item.href)).toEqual(["/admin/orders"]);
    expect(groups[2].items.map((item) => item.href)).toEqual([...productLinks, "/admin/taxonomy"]);
    expect(groups.flatMap((group) => group.items).every((item) => !("perm" in item))).toBe(true);
  });

  it("grants all entries only with the appropriate permissions and has no reports route", () => {
    const permissions = [...new Set(ADMIN_NAV_GROUPS.flatMap((group) => group.items.flatMap((item) => item.perm ? [item.perm] : [])))];
    const groups = permittedNavGroups(ADMIN_NAV_GROUPS, permissions);
    expect(groups.flatMap((group) => group.items)).toHaveLength(ADMIN_NAV_GROUPS.flatMap((group) => group.items).length);
    expect(groups.every((group) => group.items.length > 0)).toBe(true);
    expect(groups.flatMap((group) => group.items).some((item) => item.href.includes("reports"))).toBe(false);
    expect(ADMIN_NAV_GROUPS.flatMap((group) => group.items).find((item) => item.href === "/admin/notifications")?.perm).toBeNull();
  });

  it("keeps server-to-client data serializable, with supported icons and helpful copy", () => {
    const groups = permittedNavGroups(ADMIN_NAV_GROUPS, ["products.view", "orders.view", "settings.view"]);
    expect(JSON.parse(JSON.stringify(groups))).toEqual(groups);
    for (const group of ADMIN_NAV_GROUPS) {
      for (const item of group.items) {
        expect(item.label).not.toBe("");
        expect(item.hint).not.toBe("");
        expect(navIcon(item.icon)).toBeDefined();
      }
    }
  });
});

describe("query-aware active navigation", () => {
  it.each(["displayed", "hidden", "archived"])("marks only %s products current", (state) => {
    expect(productLinks.filter((href) => isAdminNavActive(href, "/admin/products", `search=milk&state=${state}&cursor=next`)))
      .toEqual([`/admin/products?state=${state}`]);
  });

  it.each(["search=milk", "state=", "state=invalid", "active=invalid"])("marks all products for the unfiltered query %s", (query) => {
    expect(productLinks.filter((href) => isAdminNavActive(href, "/admin/products", query))).toEqual([productLinks[0]]);
  });

  it.each([
    ["active=true", "displayed"],
    ["active=false", "hidden"],
    ["state=&active=false", "hidden"],
    ["state=invalid&active=true", "displayed"],
    ["state=archived&active=true", "archived"],
  ])("matches the page's normalized state for %s", (query, state) => {
    expect(productLinks.filter((href) => isAdminNavActive(href, "/admin/products", query)))
      .toEqual([`/admin/products?state=${state}`]);
    expect(adminBreadcrumbs("/admin/products", query).at(-1)?.label)
      .toBe(ADMIN_NAV_GROUPS.flatMap((group) => group.items).find((item) => item.href === `/admin/products?state=${state}`)?.label);
  });

  it("keeps product details under all products regardless of list query parameters", () => {
    expect(productLinks.filter((href) => isAdminNavActive(href, "/admin/products/id", "state=hidden"))).toEqual([productLinks[0]]);
  });

  it("matches path boundaries and details without marking home current", () => {
    expect(isAdminNavActive("/admin", "/admin/orders/id")).toBe(false);
    expect(isAdminNavActive("/admin/orders", "/admin/orders/id")).toBe(true);
    expect(isAdminNavActive("/admin/orders", "/admin/orders-other")).toBe(false);
    expect(isAdminNavActive("/admin/products?state=hidden", "/admin/products/id", "state=hidden")).toBe(false);
  });
});

describe("route-aware breadcrumbs", () => {
  it("has home, section and a human-readable detail title, never a UUID", () => {
    expect(adminBreadcrumbs("/admin/orders/secret-record-id")).toEqual([
      { label: "الرئيسية", href: "/admin" },
      { label: "الطلبات", href: "/admin/orders" },
      { label: "تفاصيل الطلب" },
    ]);
    expect(adminBreadcrumbs("/admin/products/new").at(-1)?.label).toBe("إضافة منتج");
    expect(adminBreadcrumbs("/admin/users/id/edit").at(-1)?.label).toBe("تعديل البيانات");
  });

  it("includes product filter context and safe unknown-route fallback", () => {
    expect(adminBreadcrumbs("/admin/products", "state=hidden&search=milk")).toEqual([
      { label: "الرئيسية", href: "/admin" },
      { label: "كل المنتجات", href: "/admin/products" },
      { label: "المنتجات المخفية" },
    ]);
    expect(adminBreadcrumbs("/admin")).toEqual([{ label: "الرئيسية" }]);
    expect(adminBreadcrumbs("/admin/unknown/internal").at(-1)?.label).toBe("لوحة الإدارة");
    expect(adminBreadcrumbs("/admin/products", "state=invalid").at(-1)?.label).toBe("كل المنتجات");
  });
});
