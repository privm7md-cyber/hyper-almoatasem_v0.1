// FE-12 admin a11y gate (axe-core on mocked admin renders).
// A clean run is a gate, NOT a conformance claim — keyboard/screen-reader flows
// that automation cannot verify stay documented in the FE-12 report.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import axe from "axe-core";
import { ToastProvider } from "@/components/ui/toast";

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, ...rest }: { href: string; children: ReactNode; prefetch?: boolean } & AnchorHTMLAttributes<HTMLAnchorElement>) => {
    void prefetch;
    return <a href={href} {...rest}>{children}</a>;
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/auth/rbac", () => ({
  requireAdmin: vi.fn(),
  requirePermission: vi.fn(),
  checkPermission: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));

vi.mock("@/lib/admin/dashboard", () => ({
  loadDashboardSnapshot: vi.fn(),
}));

vi.mock("@/lib/inventory/queries", () => ({
  listInventory: vi.fn(),
  listMovements: vi.fn(),
}));

vi.mock("@/lib/catalog/queries", () => ({
  listProductsForAdmin: vi.fn(),
  listCategoriesForAdmin: vi.fn(),
  listBrandsForAdmin: vi.fn(),
  getProduct: vi.fn(),
  listVariantsWithCodes: vi.fn(),
}));
vi.mock("@/lib/catalog/media", () => ({ listPrimaryImagesForProducts: vi.fn(async () => new Map()) }));

vi.mock("@/lib/api/serialize", () => ({
  dec: (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : v.toString()),
  decReq: (v: { toString(): string }) => v.toString(),
  iso: (v: Date | null | undefined) => (v === null || v === undefined ? null : v.toISOString()),
  isoReq: (v: Date) => v.toISOString(),
}));

import AdminDashboardPage from "../page";
import AdminInventoryPage from "../inventory/page";
import AdminProductsPage from "../products/page";
import AdminTaxonomyPage from "../taxonomy/page";
import { requireAdmin, requirePermission } from "@/lib/auth/rbac";
import { loadDashboardSnapshot } from "@/lib/admin/dashboard";
import { KPI_CONTRACTS, type DashboardData, type MetricState } from "@/lib/admin/dashboard-contract";
import { resolveDashboardRange } from "@/lib/admin/date-range";
import { listInventory, listMovements } from "@/lib/inventory/queries";
import { listProductsForAdmin, listCategoriesForAdmin, listBrandsForAdmin } from "@/lib/catalog/queries";
import { listPrimaryImagesForProducts } from "@/lib/catalog/media";

const ctx = {
  user: { id: "u-1", name: "مدير الاختبار", email: "admin@example.com" },
  roles: ["SUPER_ADMIN"],
  permissions: ["inventory.view", "products.view"],
};

// Dashboard fixtures are the shared exact model; this is not authenticated/live proof.
function dashboardFixture(state: MetricState = "ready", populated = false): DashboardData {
  const { range } = resolveDashboardRange({ range: "7d" }, new Date("2026-11-12T10:00:00Z"));
  const total = populated ? 10 : 0;
  const note = "سبب واضح من مصدر الاختبار المعزول.";
  return {
    range, capturedAt: "2026-11-12T10:00:00Z",
    metrics: KPI_CONTRACTS.map((contract) => ({
      id: contract.id, state: contract.id === "sales-total" && state === "ready" ? "unavailable" : state,
      value: state === "ready" && contract.id !== "sales-total" ? total : null,
      previous: contract.period === "selected" ? 0 : null, changePercent: null,
      note: state === "ready" && contract.id !== "sales-total" ? null : note,
    })),
    orders: state === "ready" ? { state, data: {
      total, previousTotal: 0,
      byStatus: populated ? [{ status: "NEW", count: 5, previous: 0 }, { status: "DELIVERED", count: 4, previous: 0 }, { status: "UNKNOWN_TEST", count: 1, previous: 0 }] : [],
      daily: [{ day: range.fromDay, count: total }],
      recent: populated ? [{ id: "order-1", orderNumber: "H-1", status: "NEW", createdAt: "2026-11-12T08:00:00Z" }] : [],
    } } : { state, data: null, note },
    inventory: state === "ready" ? { state, data: { total, available: populated ? 6 : 0, low: populated ? 2 : 0, out: populated ? 1 : 0, unknown: populated ? 1 : 0 } } : { state, data: null, note },
    promotions: state === "ready" ? { state, data: populated ? [{ id: "promotion-1", name: "عرض الاختبار", endAt: "2026-11-15T20:00:00Z" }] : [] } : { state, data: null, note },
  };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("admin a11y (axe-core, mocked)", () => {
  it.each(["empty", "populated", "denied", "error", "unavailable"] as const)("dashboard %s exact-model render has no axe violations (isolated, not browser conformance)", async (scenario) => {
    vi.mocked(requireAdmin).mockResolvedValue({ ...ctx, permissions: ["orders.view", "prices.view", "products.view", "inventory.view", "promotions.view"] });
    vi.mocked(loadDashboardSnapshot).mockResolvedValue(dashboardFixture(scenario === "empty" || scenario === "populated" ? "ready" : scenario, scenario === "populated"));
    const { container } = render(await AdminDashboardPage({ searchParams: Promise.resolve({}) }));
    // Definitions/data are native keyboard-operable disclosures; audit expanded content too.
    container.querySelectorAll("details").forEach((details) => { details.open = true; });
    expect(container.querySelectorAll("[data-kpi]")).toHaveLength(14);
    const results = await axe.run(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it("dashboard invalid custom dates retains an accessible GET selector with no analytics query", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(ctx);
    const { container } = render(await AdminDashboardPage({ searchParams: Promise.resolve({ range: "custom", from: "2026-11-12", to: "2026-11-01" }) }));
    expect(loadDashboardSnapshot).not.toHaveBeenCalled();
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

  it("products list (filters + cards) has no axe violations", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx);
    vi.mocked(listPrimaryImagesForProducts).mockResolvedValue(new Map());
    vi.mocked(listProductsForAdmin).mockResolvedValue({
      rows: [
        {
          id: "p-0",
          name: "أرز بسمتي",
          slug: "rice-0",
          productType: "WEIGHT",
          unit: "KG",
          saleStepGrams: 250,
          isActive: true,
          deletedAt: null,
          createdAt: new Date("2026-10-01T00:00:00Z"),
          updatedAt: new Date("2026-10-01T00:00:00Z"),
          category: { id: "c-0", name: "بقالة" },
          brand: null,
          minPrice: "32.00",
          stock: "unknown",
        },
      ],
      nextCursor: null,
    } as unknown as Awaited<ReturnType<typeof listProductsForAdmin>>);
    vi.mocked(listCategoriesForAdmin).mockResolvedValue({
      rows: [{ id: "c-0", name: "بقالة" }],
      nextCursor: null,
    } as unknown as Awaited<ReturnType<typeof listCategoriesForAdmin>>);
    vi.mocked(listBrandsForAdmin).mockResolvedValue({
      rows: [],
      nextCursor: null,
    } as unknown as Awaited<ReturnType<typeof listBrandsForAdmin>>);
    const { container } = render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    const results = await axe.run(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it("taxonomy (two lists + forms) has no axe violations", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx);
    vi.mocked(listCategoriesForAdmin).mockResolvedValue({
      rows: [
        {
          id: "c-0",
          name: "بقالة",
          slug: "grocery",
          parentId: null,
          parentName: null,
          isActive: true,
          deletedAt: null,
          productCount: 12,
        },
      ],
      nextCursor: null,
    } as unknown as Awaited<ReturnType<typeof listCategoriesForAdmin>>);
    vi.mocked(listBrandsForAdmin).mockResolvedValue({
      rows: [
        {
          id: "b-0",
          name: "ماركة",
          slug: "brand",
          isActive: true,
          deletedAt: null,
          productCount: 4,
        },
      ],
      nextCursor: null,
    } as unknown as Awaited<ReturnType<typeof listBrandsForAdmin>>);
    const { container } = render(await AdminTaxonomyPage({ searchParams: Promise.resolve({}) }));
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
