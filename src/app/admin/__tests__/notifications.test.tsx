import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const dbMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(), $queryRawUnsafe: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn(),
  notification: { count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: dbMock }));
vi.mock("@/lib/auth/rbac", () => ({ requireAdmin: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { requireAdmin } from "@/lib/auth/rbac";
import NotificationsPage from "../notifications/page";

const admin = { user: { id: "00000000-0000-4000-8000-000000000001", name: "PRIVATE_ADMIN_NAME", email: "PRIVATE_EMAIL@example.invalid" }, roles: [], permissions: [] };
const cursor = "00000000-0000-4000-8000-000000000002";
const row = { id: cursor, title: "تنبيه اختبار", message: "<script>alert(1)</script>", readAt: null, createdAt: "2026-11-10T12:00:00.123456Z" };
const pageView = (params: Record<string, string | string[] | undefined> = {}) => NotificationsPage({ searchParams: Promise.resolve(params) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(admin);
  dbMock.$queryRaw.mockResolvedValue([{ anchorValid: true, rows: [] }]);
});

describe("notification page with isolated SQL envelope fixtures (no database)", () => {
  it("requires authentication before any inbox read", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("redirect"));
    await expect(pageView()).rejects.toThrow("redirect");
    expect(dbMock.$queryRaw).not.toHaveBeenCalled();
  });

  it.each(["missing", "foreign", "deleted", "read"])("renders identical private recovery for a %s scoped anchor", async () => {
    // These states share the same SQL envelope; their scope rules are tested in the lib reference model.
    dbMock.$queryRaw.mockResolvedValue([{ anchorValid: false, rows: [] }]);
    const { container } = render(await pageView({ cursor, unread: "true" }));
    expect(screen.getByRole("alert")).toHaveTextContent("رابط الصفحة لم يعد متاحًا");
    expect(screen.getByRole("link", { name: "بداية الصندوق" })).toHaveAttribute("href", "/admin/notifications?unread=true");
    expect(screen.queryByText(/لا توجد إشعارات|وصلت لنهاية الإشعارات/)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/PRIVATE_|example\.invalid/);
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it.each(["", "not-a-uuid", "00000000-0000-4000-8000000000000001", `${cursor}\n`, [cursor], [cursor, cursor]])("rejects malformed or repeated cursor %j without SQL", async (value) => {
    render(await pageView({ cursor: value }));
    expect(screen.getByRole("alert")).toHaveTextContent("رابط الصفحة لم يعد متاحًا");
    expect(screen.getByRole("link", { name: "بداية الصندوق" })).toHaveAttribute("href", "/admin/notifications");
    expect(screen.queryByText(/لا توجد إشعارات|وصلت لنهاية الإشعارات/)).not.toBeInTheDocument();
    expect(dbMock.$queryRaw).not.toHaveBeenCalled();
  });

  it.each([false, true])("distinguishes valid end-of-list from genuine first-page emptiness with unread=%s", async (unread) => {
    const params = { unread: unread ? "true" : undefined };
    const { unmount } = render(await pageView(params));
    expect(screen.getByText(unread ? "لا توجد إشعارات غير مقروءة" : "لا توجد إشعارات لحسابك")).toBeInTheDocument();
    expect(screen.queryByText("وصلت لنهاية الإشعارات")).not.toBeInTheDocument();
    unmount();
    render(await pageView({ ...params, cursor }));
    expect(screen.getByText("وصلت لنهاية الإشعارات")).toBeInTheDocument();
    expect(screen.queryByText(/لا توجد إشعارات لحسابك|لا توجد إشعارات غير مقروءة/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "بداية الصندوق" })).toHaveAttribute("href", unread ? "/admin/notifications?unread=true" : "/admin/notifications");
    expect(screen.queryByRole("link", { name: "الصفحة اللي بعد كده" })).not.toBeInTheDocument();
  });

  it.each([undefined, cursor])("keeps a failed SQL statement distinct from empty/invalid for cursor=%s", async (value) => {
    dbMock.$queryRaw.mockRejectedValue(new Error("PRIVATE_QUERY_DETAILS"));
    const { container } = render(await pageView({ cursor: value }));
    expect(screen.getByRole("alert")).toHaveTextContent("البيانات غير متاحة حاليًا");
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeEnabled();
    expect(screen.queryByText(/لا توجد إشعارات|رابط الصفحة لم يعد متاحًا|وصلت لنهاية الإشعارات/)).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("PRIVATE_QUERY_DETAILS");
  });

  it("does not disguise a missing SQL envelope as an empty inbox", async () => {
    dbMock.$queryRaw.mockResolvedValue([]);
    render(await pageView());
    expect(screen.getByRole("alert")).toHaveTextContent("البيانات غير متاحة حاليًا");
    expect(screen.queryByText("لا توجد إشعارات لحسابك")).not.toBeInTheDocument();
  });

  it.each([false, true])("uses the last displayed cursor and retains unread filter=%s", async (unread) => {
    const rows = Array.from({ length: 21 }, (_, i) => ({ ...row, id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, title: `إشعار ${i + 1}` }));
    dbMock.$queryRaw.mockResolvedValue([{ anchorValid: true, rows }]);
    render(await pageView({ unread: unread ? "true" : undefined }));
    expect(screen.getAllByRole("listitem")).toHaveLength(20);
    expect(screen.queryByText("إشعار 21")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "الصفحة اللي بعد كده" })).toHaveAttribute("href", `/admin/notifications?${unread ? "unread=true&" : ""}cursor=${rows[19].id}`);
  });

  it("escapes stored titles/messages, omits private fields, and performs no read writes", async () => {
    const title = "<img src=x onerror=alert(1)>";
    dbMock.$queryRaw.mockResolvedValue([{ anchorValid: true, rows: [{ ...row, title, data: { secret: "PRIVATE_DATA" }, userId: "PRIVATE_OWNER", type: "PRIVATE_TYPE" }] }]);
    const { container } = render(await pageView());
    expect(screen.getByText(row.message)).toBeInTheDocument();
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(container.querySelector("script, img")).toBeNull();
    expect(screen.getByText("غير مقروء")).toBeInTheDocument();
    expect(container.querySelector("time")).toHaveAttribute("datetime", "2026-11-10T12:00:00.123Z");
    expect(container.textContent).not.toMatch(/PRIVATE_|example\.invalid/);
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(1);
    for (const method of Object.values(dbMock.notification)) expect(method).not.toHaveBeenCalled();
    expect(dbMock.$executeRaw).not.toHaveBeenCalled();
    expect(dbMock.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("renders read status without changing it and hides sweep action without inventory+promotions permissions", async () => {
    dbMock.$queryRaw.mockResolvedValue([{ anchorValid: true, rows: [{ ...row, readAt: "2026-11-11T04:05:06.987654Z" }] }]);
    render(await pageView());
    expect(screen.getByText("مقروء")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تحديث تنبيهات المتجر" })).toBeNull();
    expect(dbMock.notification.update).not.toHaveBeenCalled();
    expect(dbMock.notification.updateMany).not.toHaveBeenCalled();
    expect(dbMock.$executeRaw).not.toHaveBeenCalled();
  });

  it("shows the store-alert sweep button when the operator has inventory.view and promotions.view", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ...admin, permissions: ["inventory.view", "promotions.view"] });
    dbMock.$queryRaw.mockResolvedValue([{ anchorValid: true, rows: [row] }]);
    render(await pageView());
    expect(screen.getByRole("button", { name: "تحديث تنبيهات المتجر" })).toBeEnabled();
  });
});
