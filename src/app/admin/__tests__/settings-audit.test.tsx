// FE-11 settings + audit tests: gates, read states, denial-before-read.
// Identity AND reads mocked (no DB, no network). Settings writes and audit writes
// do not exist as live paths here (mocked PATCH contract covered at island level
// where applicable); audit stays read-only per contract.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/auth/rbac", () => ({
  requireAdmin: vi.fn(),
  requirePermission: vi.fn(),
  checkPermission: vi.fn(),
}));

vi.mock("@/lib/admin/queries", () => ({
  listSettings: vi.fn(),
  listAudit: vi.fn(),
}));

// The audit list reads the name of the person who made each change from the
// database, so the operator reads a name and not an id.
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
    },
  },
}));

// `@/lib/api/serialize` carries `import "server-only"` (backend boundary marker),
// unreachable from vitest/jsdom. Stubbed byte-identical (verified against source);
// domain mapping in `@/lib/admin/serialize` stays real and under test.
vi.mock("@/lib/api/serialize", () => ({
  dec: (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : v.toString()),
  decReq: (v: { toString(): string }) => v.toString(),
  iso: (v: Date | null | undefined) => (v === null || v === undefined ? null : v.toISOString()),
  isoReq: (v: Date) => v.toISOString(),
}));

import AdminSettingsPage from "../settings/page";
import AdminAuditPage from "../audit-logs/page";
import { requirePermission } from "@/lib/auth/rbac";
import { listAudit, listSettings } from "@/lib/admin/queries";
import { prisma } from "@/lib/db";

const FORBIDDEN = Object.assign(new Error("NEXT_FORBIDDEN"), { digest: "NEXT_FORBIDDEN" });
const dt = new Date("2026-10-01T00:00:00Z");
const ctx = (permissions: string[]) => ({
  user: { id: "u", name: "n", email: "e" },
  roles: [],
  permissions,
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("admin settings (FE-11)", () => {
  it("gates on settings.view and renders the setting in Arabic with its editor", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx(["settings.view", "settings.manage"]));
    vi.mocked(listSettings).mockResolvedValue([
      {
        key: "delivery.default_fee",
        valueText: "20.00",
        valueType: "NUMERIC",
        description: "رسوم التوصيل",
        updatedAt: dt,
      },
    ] as unknown as Awaited<ReturnType<typeof listSettings>>);
    render(
      <ToastProvider>{await AdminSettingsPage()}</ToastProvider>,
    );
    expect(requirePermission).toHaveBeenCalledWith("settings.view");
    // The operator reads the Arabic name and the meaning, never the raw key.
    expect(screen.getAllByText("رسوم التوصيل الافتراضية").length).toBeGreaterThan(0);
    expect(screen.queryByText("delivery.default_fee")).toBeNull();
    expect(screen.getByText(/الرسوم اللي بتتحسب لما مفيش منطقة توصيل مطابقة للعنوان/)).toBeVisible();
    // The number is shown as a number, and the editor holds the stored value.
    expect(screen.getAllByText("20").length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("20.00")).toBeInTheDocument();
  });

  it("hides the settings editors without settings.manage and names the missing capability in Arabic", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx(["settings.view"]));
    vi.mocked(listSettings).mockResolvedValue([
      {
        key: "delivery.default_fee",
        valueText: "20.00",
        valueType: "NUMERIC",
        description: "رسوم التوصيل",
        updatedAt: dt,
      },
    ] as unknown as Awaited<ReturnType<typeof listSettings>>);
    render(
      <ToastProvider>{await AdminSettingsPage()}</ToastProvider>,
    );
    // The setting stays readable; the write control does not appear.
    expect(screen.getAllByText("رسوم التوصيل الافتراضية").length).toBeGreaterThan(0);
    expect(screen.queryByDisplayValue("20.00")).toBeNull();
    expect(screen.getByText(/محتاج صلاحية: تعديل إعدادات المتجر/)).toBeVisible();
    // The raw permission key is a machine token and never reaches the screen.
    expect(screen.queryByText(/settings\.manage/)).toBeNull();
  });

  it("denied identity rejects before any read", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(FORBIDDEN);
    await expect(AdminSettingsPage()).rejects.toThrow("NEXT_FORBIDDEN");
    expect(listSettings).not.toHaveBeenCalled();
  });
});

describe("admin audit log (FE-11, read-only)", () => {
  it("gates on audit_logs.view (exact key) and renders entries with detail links", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx(["audit_logs.view"]));
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "u-9", name: "أحمد" }] as never);
    vi.mocked(listAudit).mockResolvedValue([
      {
        id: "a-1",
        user_id: "u-9",
        actor_type: "ADMIN",
        action: "roles.grant",
        entity_type: "roles",
        entity_id: "r-1",
        old_values: null,
        new_values: null,
        ip_address: null,
        user_agent: null,
        created_at: dt,
      },
    ] as unknown as Awaited<ReturnType<typeof listAudit>>);
    render(
      <ToastProvider>
        {await AdminAuditPage({ searchParams: Promise.resolve({}) })}
      </ToastProvider>,
    );
    expect(requirePermission).toHaveBeenCalledWith("audit_logs.view");
    // The row reads in Arabic: the action, the part of the store and the name
    // of the person. The machine tokens stay off the screen.
    const table = within(screen.getByRole("table"));
    expect(table.getByText("منح صلاحية لدور")).toBeVisible();
    expect(table.getByText("الأدوار")).toBeVisible();
    expect(table.getByText("أحمد")).toBeVisible();
    expect(table.getByText("الإدارة")).toBeVisible();
    expect(screen.queryByText("roles.grant")).toBeNull();
    expect(screen.queryByText("roles")).toBeNull();
    expect(document.querySelector('a[href="/admin/audit-logs/a-1"]')).not.toBeNull();
  });

  it.each([
    ["2026-04-24", "2026-04-23T22:00:00.000Z", "2026-04-24T21:00:00.000Z"],
    ["2026-10-29", "2026-10-28T21:00:00.000Z", "2026-10-29T22:00:00.000Z"],
  ])("uses Cairo half-open boundaries for audit day %s", async (day, start, end) => {
    vi.mocked(requirePermission).mockResolvedValue(ctx(["audit_logs.view"]));
    vi.mocked(listAudit).mockResolvedValue([]);
    render(await AdminAuditPage({ searchParams: Promise.resolve({ since: day, until: day }) }));
    expect(vi.mocked(listAudit).mock.calls[0][0]).toMatchObject({ since: start, until: null, untilExclusive: end });
  });

  it("ignores impossible audit dates instead of rolling them forward", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx(["audit_logs.view"]));
    vi.mocked(listAudit).mockResolvedValue([]);
    render(await AdminAuditPage({ searchParams: Promise.resolve({ since: "2026-02-30", until: "2026-02-30" }) }));
    expect(vi.mocked(listAudit).mock.calls[0][0]).toMatchObject({ since: null, until: null, untilExclusive: null });
  });

  it("renders no mutation controls (read-only contract)", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx(["audit_logs.view"]));
    vi.mocked(listAudit).mockResolvedValue([]);
    const { container } = render(
      <ToastProvider>
        {await AdminAuditPage({ searchParams: Promise.resolve({}) })}
      </ToastProvider>,
    );
    // Only control is the GET filter submit; no POST/DELETE mutation surface exists.
    expect(container.querySelector('form[method="post"]')).toBeNull();
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["تصفية"]);
  });

  it("renders danger tone pill for failure outcome beyond auth.login_failure (e.g. auth.account_locked)", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx(["audit_logs.view"]));
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "u-9", name: "أحمد" }] as never);
    vi.mocked(listAudit).mockResolvedValue([
      {
        id: "a-locked",
        user_id: "u-9",
        actor_type: "ADMIN",
        action: "auth.account_locked",
        entity_type: "users",
        entity_id: "u-9",
        old_values: null,
        new_values: null,
        ip_address: null,
        user_agent: null,
        created_at: dt,
      },
    ] as unknown as Awaited<ReturnType<typeof listAudit>>);
    render(
      <ToastProvider>
        {await AdminAuditPage({ searchParams: Promise.resolve({}) })}
      </ToastProvider>,
    );
    const table = within(screen.getByRole("table"));
    const pill = table.getByText("محاولة مرفوضة");
    expect(pill).toHaveClass("adm-pill--danger");
  });

  it("denied identity rejects before any read", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(FORBIDDEN);
    await expect(AdminAuditPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_FORBIDDEN");
    expect(listAudit).not.toHaveBeenCalled();
  });
});
