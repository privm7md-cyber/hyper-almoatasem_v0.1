// GAP-2 Dashboard tests (approved FE-10B): `GET /admin → src/app/admin/page.tsx`.
// Scope: UI-boundary + route-guard behavior under INJECTED admin identity
// (vi.mock of `@/lib/auth/rbac`). This proves the page responds to allowed/denied
// identity correctly — it is NOT live proof that DB sessions or backend authorization
// work. No network, no DB, no real credentials.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/auth/rbac", () => ({
  requireAdmin: vi.fn(),
  requirePermission: vi.fn(),
  checkPermission: vi.fn(),
}));

import AdminDashboardPage from "../page";
import { requireAdmin } from "@/lib/auth/rbac";

const REDIRECT = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" });
const adminCtx = {
  user: { id: "u-1", name: "مدير الاختبار", email: "admin@example.com" },
  roles: ["STORE_MANAGER"],
  permissions: ["orders.view"],
};

afterEach(() => {
  vi.resetAllMocks();
});

describe("admin dashboard (FE-10B)", () => {
  it("renders session identity under authenticated admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminCtx);
    render(await AdminDashboardPage());
    expect(screen.getByText("مدير الاختبار")).toBeVisible();
    expect(screen.getByText("admin@example.com")).toBeVisible();
    expect(screen.getByText("STORE_MANAGER")).toBeVisible();
  });

  it("shows the five contracted quick-action links with correct targets", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminCtx);
    render(await AdminDashboardPage());
    const targets = ["/admin/orders", "/admin/products", "/admin/inventory", "/admin/customers", "/admin/promotions"];
    for (const href of targets) {
      const link = document.querySelector(`a[href="${href}"]`);
      expect(link, `missing dashboard link ${href}`).not.toBeNull();
    }
    expect(document.querySelectorAll('section[aria-label="الأقسام التشغيلية"] a')).toHaveLength(5);
  });

  it("does not imply metrics that do not exist", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminCtx);
    const { container } = render(await AdminDashboardPage());
    expect(container.textContent).toMatch(/لا تعرض هذه اللوحة مؤشرات رقمية/);
    expect(container.textContent).not.toMatch(/\d+%|مبيعات اليوم|إجمالي/);
  });

  it("redirects anonymous admins to login (guard ordering, no data rendered)", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(REDIRECT);
    await expect(AdminDashboardPage()).rejects.toThrow("NEXT_REDIRECT");
  });

  it("renders for admins without any .view permission (requireAdmin gate only)", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ...adminCtx, permissions: [] });
    render(await AdminDashboardPage());
    expect(screen.getByText("لوحة الإدارة")).toBeVisible();
  });
});
