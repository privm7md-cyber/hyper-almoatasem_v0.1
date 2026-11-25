import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";

vi.mock("@/lib/auth/rbac", () => ({ getCurrentAdmin: vi.fn() }));
vi.mock("@/lib/admin/notifications", () => ({ countOwnUnreadNotifications: vi.fn() }));
vi.mock("@/components/admin/admin-shell", () => ({ AdminShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("../login/LoginForm", () => ({ LoginForm: () => <form><label>البريد<input type="email" /></label></form> }));

import { getCurrentAdmin } from "@/lib/auth/rbac";
import { countOwnUnreadNotifications } from "@/lib/admin/notifications";
import AdminLayout from "../layout";
import AdminLoginPage from "../login/page";

const admin = { user: { id: "fixture-user", name: "Test Operator", email: "operator@example.invalid" }, roles: [], permissions: ["products.view"] };
beforeEach(() => vi.resetAllMocks());

describe("layout notification read projection", () => {
  it("never requests unread data before authentication", async () => {
    vi.mocked(getCurrentAdmin).mockResolvedValue(null);
    render(await AdminLayout({ children: <h1>صفحة الاختبار</h1> }));
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(countOwnUnreadNotifications).not.toHaveBeenCalled();
  });
  it("passes only unread scalar and permitted search context into shell", async () => {
    vi.mocked(getCurrentAdmin).mockResolvedValue(admin);
    vi.mocked(countOwnUnreadNotifications).mockResolvedValue(7);
    const element = await AdminLayout({ children: <h1>اختبار</h1> });
    expect(element.props.unreadCount).toBe(7);
    expect(element.props.canSearchProducts).toBe(true);
    expect(countOwnUnreadNotifications).toHaveBeenCalledWith(admin);
    expect(element.props.user).toEqual({ name: admin.user.name, email: admin.user.email, roles: [] });
    expect(element.props.user).not.toHaveProperty("id");
  });
  it("does not turn notification read errors into a zero count", async () => {
    vi.mocked(getCurrentAdmin).mockResolvedValue({ ...admin, permissions: [] });
    vi.mocked(countOwnUnreadNotifications).mockRejectedValue(new Error("offline"));
    const element = await AdminLayout({ children: <h1>اختبار</h1> });
    expect(element.props.unreadCount).toBeNull();
    expect(element.props.canSearchProducts).toBe(false);
  });
  it("renders exactly one main landmark for real login composition", async () => {
    vi.mocked(getCurrentAdmin).mockResolvedValue(null);
    const content = await AdminLoginPage();
    const { container } = render(await AdminLayout({ children: content }));
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect((await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations.map(item => item.id)).toEqual([]);
  });
});
