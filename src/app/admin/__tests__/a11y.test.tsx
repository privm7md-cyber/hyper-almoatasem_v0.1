// FE-12 admin a11y gate (axe-core on mocked admin renders).
// A clean run is a gate, NOT a conformance claim — keyboard/screen-reader flows
// that automation cannot verify stay documented in the FE-12 report.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import axe from "axe-core";
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

vi.mock("@/lib/inventory/queries", () => ({
  listInventory: vi.fn(),
  listMovements: vi.fn(),
}));

vi.mock("@/lib/api/serialize", () => ({
  dec: (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : v.toString()),
  decReq: (v: { toString(): string }) => v.toString(),
  iso: (v: Date | null | undefined) => (v === null || v === undefined ? null : v.toISOString()),
  isoReq: (v: Date) => v.toISOString(),
}));

import AdminDashboardPage from "../page";
import AdminInventoryPage from "../inventory/page";
import { requireAdmin, requirePermission } from "@/lib/auth/rbac";
import { listInventory, listMovements } from "@/lib/inventory/queries";

const ctx = {
  user: { id: "u-1", name: "مدير الاختبار", email: "admin@example.com" },
  roles: ["STORE_MANAGER"],
  permissions: ["inventory.view"],
};

afterEach(() => {
  vi.resetAllMocks();
});

describe("admin a11y (axe-core, mocked)", () => {
  it("dashboard (identity + quick links + disclaimer) has no axe violations", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(ctx);
    const { container } = render(await AdminDashboardPage());
    const results = await axe.run(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it("inventory list (table + forms + movements) has no axe violations", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx);
    vi.mocked(listInventory).mockResolvedValue([
      {
        id: "inv-0",
        productVariantId: "var-0",
        quantity: { toString: () => "10" },
        reservedQuantity: { toString: () => "2" },
        availableQuantity: { toString: () => "8" },
        lowStockThreshold: { toString: () => "3" },
        updatedAt: new Date("2026-10-01T00:00:00Z"),
      },
    ] as unknown as Awaited<ReturnType<typeof listInventory>>);
    vi.mocked(listMovements).mockResolvedValue([]);
    const { container } = render(
      <ToastProvider>{await AdminInventoryPage({ searchParams: Promise.resolve({}) })}</ToastProvider>,
    );
    const results = await axe.run(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it("admin segment error boundary exposes a retry action with an accessible name", async () => {
    const { default: AdminError } = await import("../error");
    const { container } = render(<AdminError reset={() => {}} />);
    const results = await axe.run(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
