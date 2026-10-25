import { describe, expect, it } from "vitest";
import { ADMIN_NAV_GROUPS, permittedNavGroups } from "@/components/admin/nav-config";

describe("permittedNavGroups (D45 hide-by-default)", () => {
  it("shows only the dashboard when no permission snapshot exists", () => {
    const groups = permittedNavGroups(ADMIN_NAV_GROUPS, null);
    expect(groups).toEqual([{ title: "العمليات", items: [{ href: "/admin", label: "اللوحة" }] }]);
  });

  it("filters items by the given permission list and drops empty groups", () => {
    const groups = permittedNavGroups(ADMIN_NAV_GROUPS, ["orders.view", "products.view"]);
    expect(groups.map((g) => g.title)).toEqual(["العمليات", "الكتالوج والمخزون"]);
    expect(groups[0].items).toEqual([
      { href: "/admin", label: "اللوحة" },
      { href: "/admin/orders", label: "الطلبات" },
    ]);
    expect(groups[1].items).toEqual([
      { href: "/admin/products", label: "المنتجات" },
      { href: "/admin/taxonomy", label: "التصنيفات والعلامات" },
    ]);
  });

  it("returns every item when permissions are broadly granted", () => {
    const groups = permittedNavGroups(ADMIN_NAV_GROUPS, [
      "orders.view",
      "products.view",
      "inventory.view",
      "promotions.view",
      "coupons.view",
      "customers.view",
      "users.view",
      "roles.view",
      "settings.view",
      "audit_logs.view",
    ]);
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(ADMIN_NAV_GROUPS.reduce((n, g) => n + g.items.length, 0));
  });
});
