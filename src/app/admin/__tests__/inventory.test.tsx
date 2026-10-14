// GAP-1 + GAP-2 Inventory tests (approved FE-10D): next-page pagination fix +
// read states + permission boundary. Identity AND reads mocked (no DB, no network).
// The invalid-cursor path is backend-owned (DB rejects bad uuid) — here we prove the
// page surfaces ErrorState WITHOUT losing filter context when the read fails.

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

vi.mock("@/lib/inventory/queries", () => ({
  listInventory: vi.fn(),
  listMovements: vi.fn(),
}));

// `@/lib/api/serialize` carries `import "server-only"` (backend boundary marker),
// which vitest/jsdom cannot import. Stubbed here with byte-identical pure behavior
// (null-passthrough + toString + toISOString, verified against the source);
// domain mapping in `@/lib/inventory/serialize` stays real and under test.
vi.mock("@/lib/api/serialize", () => ({
  dec: (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : v.toString()),
  decReq: (v: { toString(): string }) => v.toString(),
  iso: (v: Date | null | undefined) => (v === null || v === undefined ? null : v.toISOString()),
  isoReq: (v: Date) => v.toISOString(),
}));

import AdminInventoryPage from "../inventory/page";
import { requirePermission } from "@/lib/auth/rbac";
import { listInventory, listMovements } from "@/lib/inventory/queries";

const REDIRECT = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" });
const FORBIDDEN = Object.assign(new Error("NEXT_FORBIDDEN"), { digest: "NEXT_FORBIDDEN" });
const dec = (s: string) => ({ toString: () => s });

function invRow(i: number) {
  return {
    id: `inv-${i}`,
    productVariantId: `var-${i}`,
    quantity: dec("10"),
    reservedQuantity: dec("2"),
    availableQuantity: dec("8"),
    lowStockThreshold: dec("3"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
  };
}

type InvRows = Awaited<ReturnType<typeof listInventory>>;
const authed = () => {
  vi.mocked(requirePermission).mockResolvedValue({
    user: { id: "u", name: "n", email: "e" },
    roles: [],
    permissions: ["inventory.view"],
  });
  vi.mocked(listMovements).mockResolvedValue([]);
};
const sp = (q: Record<string, string>) => Promise.resolve(q);

afterEach(() => {
  vi.resetAllMocks();
});

describe("admin inventory pagination (GAP-1 fix)", () => {
  it("gates on inventory.view before reading", async () => {
    authed();
    vi.mocked(listInventory).mockResolvedValueOnce([] as unknown as InvRows);
    render(
      <ToastProvider>{await AdminInventoryPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    expect(requirePermission).toHaveBeenCalledWith("inventory.view");
  });

  it("shows a next-page link with the real backend cursor when a 21st row exists", async () => {
    authed();
    vi.mocked(listInventory).mockResolvedValueOnce(
      Array.from({ length: 21 }, (_, i) => invRow(i)) as unknown as InvRows,
    );
    render(
      <ToastProvider>{await AdminInventoryPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    const next = screen.getByRole("link", { name: "الصفحة التالية" });
    expect(next.getAttribute("href")).toBe("/admin/inventory?cursor=inv-20");
  });

  it("preserves search and filters in the next-page URL", async () => {
    authed();
    vi.mocked(listInventory).mockResolvedValueOnce(
      Array.from({ length: 21 }, (_, i) => invRow(i)) as unknown as InvRows,
    );
    render(
      <ToastProvider>
        {await AdminInventoryPage({ searchParams: sp({ search: "حليب", inStock: "true", lowStock: "true" }) })}
      </ToastProvider>,
    );
    const href = screen.getByRole("link", { name: "الصفحة التالية" }).getAttribute("href") ?? "";
    expect(href).toContain("cursor=inv-20");
    expect(href).toContain("search=");
    expect(href).toContain("inStock=true");
    expect(href).toContain("lowStock=true");
  });

  it("hides the next link on the final page (≤20 rows) and on empty/error", async () => {
    authed();
    vi.mocked(listInventory).mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => invRow(i)) as unknown as InvRows,
    );
    const { unmount } = render(
      <ToastProvider>{await AdminInventoryPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    expect(screen.queryByRole("link", { name: "الصفحة التالية" })).toBeNull();
    unmount();
    vi.mocked(listInventory).mockResolvedValueOnce([] as unknown as InvRows);
    const r2 = render(
      <ToastProvider>{await AdminInventoryPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    expect(screen.queryByRole("link", { name: "الصفحة التالية" })).toBeNull();
    expect(screen.getByText("لا توجد صفوف مطابقة")).toBeVisible();
    r2.unmount();
  });

  it("surfaces ErrorState with filter context intact when the read fails (e.g. bad cursor)", async () => {
    authed();
    vi.mocked(listInventory).mockRejectedValueOnce(new Error('invalid input syntax for type uuid: "nope"'));
    render(
      <ToastProvider>{await AdminInventoryPage({ searchParams: sp({ cursor: "nope" }) })}</ToastProvider>,
    );
    expect(screen.getByText("تعذّر تحميل المخزون")).toBeVisible();
    // Context preserved: search form + adjust/threshold/movements sections still render.
    expect(screen.getByLabelText("بحث المخزون")).toBeInTheDocument();
    expect(screen.getByText("تعديل يدوي (inventory.adjust)")).toBeVisible();
    expect(screen.queryByRole("link", { name: "الصفحة التالية" })).toBeNull();
  });

  it("next navigation is a single idempotent GET link (double-click safe, no mutation)", async () => {
    authed();
    // Persistent (not Once): both renders must see the same 21-row page.
    vi.mocked(listInventory).mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => invRow(i)) as unknown as InvRows,
    );
    const first = render(
      <ToastProvider>{await AdminInventoryPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    const href = screen.getByRole("link", { name: "الصفحة التالية" }).getAttribute("href");
    first.unmount();
    render(
      <ToastProvider>{await AdminInventoryPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    // Deterministic href across renders; anchor GET carries no body/side effects.
    expect(screen.getByRole("link", { name: "الصفحة التالية" }).getAttribute("href")).toBe(href);
    expect(listInventory).toHaveBeenCalledTimes(2);
  });

  it("renders no invented loading placeholders (static server render, admin-wide parity)", async () => {
    authed();
    vi.mocked(listInventory).mockResolvedValueOnce([invRow(0)] as unknown as InvRows);
    const { container } = render(
      <ToastProvider>{await AdminInventoryPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    expect(container.querySelector('[aria-busy="true"], .skeleton, .spinner')).toBeNull();
  });

  it("renders movement history rows when present", async () => {
    authed();
    vi.mocked(listInventory).mockResolvedValueOnce([invRow(0)] as unknown as InvRows);
    vi.mocked(listMovements).mockResolvedValueOnce([
      {
        id: "m-1",
        productVariantId: "var-0",
        movementType: "STOCK_IN",
        quantity: dec("5"),
        previousQuantity: dec("3"),
        newQuantity: dec("8"),
        referenceType: null,
        referenceId: null,
        reason: "توريد",
        createdBy: null,
        createdAt: new Date("2026-10-02T00:00:00Z"),
      },
    ] as unknown as Awaited<ReturnType<typeof listMovements>>);
    render(
      <ToastProvider>{await AdminInventoryPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    // "STOCK_IN" also exists as an adjust-form <option>: assert both the option
    // and the movement row, plus the unique reason text inside the movements table.
    expect(screen.getAllByText("STOCK_IN")).toHaveLength(2);
    expect(screen.getByText("توريد")).toBeVisible();
  });

  it("denied identity rejects before any read (no rows, no forms rendered)", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(FORBIDDEN);
    await expect(AdminInventoryPage({ searchParams: sp({}) })).rejects.toThrow("NEXT_FORBIDDEN");
    expect(listInventory).not.toHaveBeenCalled();
    expect(listMovements).not.toHaveBeenCalled();
    vi.mocked(requirePermission).mockRejectedValueOnce(REDIRECT);
    await expect(AdminInventoryPage({ searchParams: sp({}) })).rejects.toThrow("NEXT_REDIRECT");
  });
});
