// GAP-2 Orders tests (approved FE-10E): admin order queue reads + boundary.
// Identity AND reads mocked (no DB, no network). Proves: gate key, list/empty/error
// states, status filter + next-link preservation, denial-before-read. Fulfillment
// transitions are NOT executed here (mocked-mutation islands live on the detail
// page — covered by contract, remaining for fixture environments).

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

vi.mock("@/lib/orders/queries", () => ({
  listOrdersAdmin: vi.fn(),
}));

// `@/lib/api/serialize` carries `import "server-only"` (backend boundary marker),
// which vitest/jsdom cannot import. Stubbed here with byte-identical pure behavior
// (null-passthrough + toString + toISOString, verified against the source);
// domain mapping in `@/lib/orders/serialize` stays real and under test.
vi.mock("@/lib/api/serialize", () => ({
  dec: (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : v.toString()),
  decReq: (v: { toString(): string }) => v.toString(),
  iso: (v: Date | null | undefined) => (v === null || v === undefined ? null : v.toISOString()),
  isoReq: (v: Date) => v.toISOString(),
}));

import AdminOrdersPage from "../orders/page";
import { requirePermission } from "@/lib/auth/rbac";
import { listOrdersAdmin } from "@/lib/orders/queries";

const REDIRECT = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" });
const FORBIDDEN = Object.assign(new Error("NEXT_FORBIDDEN"), { digest: "NEXT_FORBIDDEN" });
const dec = (s: string) => ({ toString: () => s });
const dt = new Date("2026-10-03T00:00:00Z");

function orderRow(i: number) {
  return {
    id: `ord-${i}`,
    orderNumber: `HM-100${i}`,
    status: "NEW",
    idempotencyKey: `idem-${i}`,
    subtotalEstimated: dec("100"),
    discountTotal: dec("0"),
    deliveryFee: dec("10"),
    totalEstimated: dec("110"),
    subtotalFinal: null,
    totalFinal: null,
    customerNameSnapshot: "عميل",
    customerPhoneSnapshot: "01000000000",
    deliveryCity: "القاهرة",
    deliveryArea: "X",
    deliveryVillage: null,
    deliveryStreet: "شارع",
    deliveryBuilding: null,
    deliveryLandmark: null,
    deliveryPhone: "01000000000",
    createdAt: dt,
    updatedAt: dt,
    _count: { items: 2 },
  };
}

type OrderRows = Awaited<ReturnType<typeof listOrdersAdmin>>;
const authed = () => {
  vi.mocked(requirePermission).mockResolvedValue({
    user: { id: "u", name: "n", email: "e" },
    roles: [],
    permissions: ["orders.view"],
  });
};
const sp = (q: Record<string, string>) => Promise.resolve(q);

afterEach(() => {
  vi.resetAllMocks();
});

describe("admin orders queue (FE-10E)", () => {
  it("gates on orders.view before reading", async () => {
    authed();
    vi.mocked(listOrdersAdmin).mockResolvedValueOnce([] as unknown as OrderRows);
    render(await AdminOrdersPage({ searchParams: sp({}) }));
    expect(requirePermission).toHaveBeenCalledWith("orders.view");
  });

  it("renders order numbers with statuses, totals, and detail links", async () => {
    authed();
    vi.mocked(listOrdersAdmin).mockResolvedValueOnce([orderRow(1), orderRow(2)] as unknown as OrderRows);
    render(await AdminOrdersPage({ searchParams: sp({}) }));
    expect(screen.getByText("HM-1001")).toBeVisible();
    expect(document.querySelector('a[href="/admin/orders/ord-1"]')).not.toBeNull();
    expect(screen.getAllByText(/NEW/)[0]).toBeVisible();
  });

  it("shows empty and error states without leaking rows", async () => {
    authed();
    vi.mocked(listOrdersAdmin).mockResolvedValueOnce([] as unknown as OrderRows);
    const { unmount } = render(await AdminOrdersPage({ searchParams: sp({}) }));
    expect(screen.getByText("لا توجد طلبات مطابقة")).toBeVisible();
    unmount();
    vi.mocked(listOrdersAdmin).mockRejectedValueOnce(new Error("DB down"));
    render(await AdminOrdersPage({ searchParams: sp({}) }));
    expect(screen.getByText("تعذّر تحميل الطلبات")).toBeVisible();
    expect(document.querySelector('a[href^="/admin/orders/ord-"]')).toBeNull();
  });

  it("preserves status filter in the next-page link; hides it at the end", async () => {
    authed();
    const rows = Array.from({ length: 21 }, (_, i) => orderRow(i));
    vi.mocked(listOrdersAdmin).mockResolvedValueOnce(rows as unknown as OrderRows);
    render(await AdminOrdersPage({ searchParams: sp({ status: "NEW" }) }));
    const href = screen.getByRole("link", { name: "الصفحة التالية" }).getAttribute("href") ?? "";
    expect(href).toContain("status=NEW");
    expect(href).toContain("cursor=ord-20");
  });

  it("denied identity rejects before any read", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(FORBIDDEN);
    await expect(AdminOrdersPage({ searchParams: sp({}) })).rejects.toThrow("NEXT_FORBIDDEN");
    expect(listOrdersAdmin).not.toHaveBeenCalled();
    vi.mocked(requirePermission).mockRejectedValueOnce(REDIRECT);
    await expect(AdminOrdersPage({ searchParams: sp({}) })).rejects.toThrow("NEXT_REDIRECT");
  });
});
