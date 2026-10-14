// FE-11 settings + audit tests: gates, read states, denial-before-read.
// Identity AND reads mocked (no DB, no network). Settings writes and audit writes
// do not exist as live paths here (mocked PATCH contract covered at island level
// where applicable); audit stays read-only per contract.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";

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

vi.mock("@/lib/admin/queries", () => ({
  listSettings: vi.fn(),
  listAudit: vi.fn(),
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
  it("gates on settings.view and renders setting keys with editors", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx(["settings.view"]));
    vi.mocked(listSettings).mockResolvedValue([
      { key: "delivery.fee", valueText: "10", valueType: "MONEY", description: "رسوم التوصيل", updatedAt: dt },
    ] as unknown as Awaited<ReturnType<typeof listSettings>>);
    render(
      <ToastProvider>{await AdminSettingsPage()}</ToastProvider>,
    );
    expect(requirePermission).toHaveBeenCalledWith("settings.view");
    expect(screen.getByText("delivery.fee")).toBeVisible();
    expect(screen.getByDisplayValue("10")).toBeInTheDocument();
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
    vi.mocked(listAudit).mockResolvedValue([
      {
        id: "a-1",
        user_id: "u-9",
        actor_type: "ADMIN",
        action: "role.assign",
        entity_type: "role",
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
    expect(screen.getByText("role.assign")).toBeVisible();
    expect(document.querySelector('a[href="/admin/audit-logs/a-1"]')).not.toBeNull();
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

  it("denied identity rejects before any read", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(FORBIDDEN);
    await expect(AdminAuditPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_FORBIDDEN");
    expect(listAudit).not.toHaveBeenCalled();
  });
});
