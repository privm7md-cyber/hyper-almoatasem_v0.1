// ADM-06 customers — isolated (no database, no network, no writes).
//
// The customers list is an operational screen, not a name list: the filters
// must reach the query, the total must describe the WHOLE matching set (not
// only the rows left after this page), and the order facts must be read in
// one query for the page. The customer file must not leak a single order
// row to an account that may not read orders.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

const m = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  customerFindMany: vi.fn(),
  customerCount: vi.fn(),
  customerFindUnique: vi.fn(),
  addressFindMany: vi.fn(),
  orderFindMany: vi.fn(),
  orderCount: vi.fn(),
  customerOrderSummaries: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/auth/rbac", () => ({
  requireAdmin: vi.fn(),
  requirePermission: m.requirePermission,
  checkPermission: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    customer: {
      findMany: m.customerFindMany,
      count: m.customerCount,
      findUnique: m.customerFindUnique,
    },
    customerAddress: { findMany: m.addressFindMany },
    order: { findMany: m.orderFindMany, count: m.orderCount },
  },
}));

vi.mock("@/lib/customers/admin-reads", () => ({
  customerOrderSummaries: m.customerOrderSummaries,
}));

import AdminCustomersPage from "../customers/page";
import AdminCustomerDetailPage from "../customers/[id]/page";

const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";

function customerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CUSTOMER_ID,
    firstName: "أحمد",
    lastName: "علي",
    phone: "01000000000",
    email: "ahmed@example.test",
    isRegistered: true,
    isActive: true,
    lockedUntil: null,
    autoAcceptReplacements: false,
    deletedAt: null,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    _count: { orders: 3 },
    ...overrides,
  };
}

const authed = (permissions = ["customers.view"]) => {
  m.requirePermission.mockResolvedValue({
    user: { id: "u", name: "n", email: "e" },
    roles: [],
    permissions,
  });
};
const sp = (q: Record<string, string>) => Promise.resolve(q);

afterEach(() => {
  vi.resetAllMocks();
});

describe("ADM-06 customers list", () => {
  it("filters on the server and keeps the filters in the next-page link", async () => {
    authed();
    m.customerFindMany.mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => customerRow({ id: `${i}`, phone: `0100000000${i}` })),
    );
    m.customerCount.mockResolvedValue(41);
    m.customerOrderSummaries.mockResolvedValue(new Map());
    render(
      await AdminCustomersPage({
        searchParams: sp({ search: "0100", account: "yes", active: "no", from: "2026-01-01", to: "2026-03-01" }),
      }),
    );
    const where = m.customerFindMany.mock.calls[0][0].where;
    expect(where.isRegistered).toBe(true);
    expect(where.isActive).toBe(false);
    expect(where.OR.some((entry: Record<string, unknown>) => (entry.phone as { contains?: string } | undefined)?.contains === "0100")).toBe(true);
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(where.createdAt.lt).toBeInstanceOf(Date);
    const href = screen.getByRole("link", { name: "الصفحة اللي بعد كده" }).getAttribute("href") ?? "";
    expect(href).toContain("account=yes");
    expect(href).toContain("active=no");
    expect(href).toContain("from=2026-01-01");
  });

  it("counts the whole matching set, not only the rows after the cursor", async () => {
    authed();
    m.customerFindMany.mockResolvedValue([customerRow()]);
    m.customerCount.mockResolvedValue(41);
    m.customerOrderSummaries.mockResolvedValue(new Map());
    render(await AdminCustomersPage({ searchParams: sp({ cursor: "abc" }) }));
    const countWhere = m.customerCount.mock.calls[0][0].where;
    const listWhere = m.customerFindMany.mock.calls[0][0].where;
    // The cursor is a page position: it is in the page query and NOT in the
    // count, otherwise the total shrinks while the operator walks the pages.
    expect(listWhere.AND).toBeDefined();
    expect(countWhere.AND).toBeUndefined();
    expect(m.customerCount.mock.calls[0][0].where).toBe(countWhere);
  });

  it("reads the order facts of the page in one query", async () => {
    authed();
    m.customerFindMany.mockResolvedValue([customerRow()]);
    m.customerCount.mockResolvedValue(1);
    m.customerOrderSummaries.mockResolvedValue(
      new Map([
        [
          CUSTOMER_ID,
          {
            orderCount: 3,
            total: "450.50",
            lastOrderAt: new Date("2026-05-05T00:00:00.000Z"),
            lastArea: "مدينة نصر",
          },
        ],
      ]),
    );
    render(await AdminCustomersPage({ searchParams: sp({}) }));
    expect(m.customerOrderSummaries).toHaveBeenCalledTimes(1);
    expect(m.customerOrderSummaries.mock.calls[0][0]).toEqual([CUSTOMER_ID]);
    expect(screen.getByText("450.50 ج.م")).toBeVisible();
    expect(screen.getByText("مدينة نصر")).toBeVisible();
  });

  it("refuses an impossible registration day instead of normalising it", async () => {
    authed();
    m.customerFindMany.mockResolvedValue([]);
    m.customerCount.mockResolvedValue(0);
    m.customerOrderSummaries.mockResolvedValue(new Map());
    render(await AdminCustomersPage({ searchParams: sp({ from: "2026-02-30", to: "2026-02-30" }) }));
    expect(m.customerFindMany.mock.calls[0][0].where.createdAt).toBeUndefined();
    expect(screen.getByText(/التاريخ الميكانيكي مش بيتقبل/)).toBeVisible();
  });
});

describe("ADM-06 customer file", () => {
  const detailRow = {
    id: CUSTOMER_ID,
    firstName: "أحمد",
    lastName: "علي",
    phone: "01000000000",
    email: "ahmed@example.test",
    isRegistered: true,
    isActive: true,
    lockedUntil: null,
    autoAcceptReplacements: false,
    deletedAt: null,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
  };

  it("shows the customer, their addresses and their orders", async () => {
    authed(["customers.view", "orders.view"]);
    m.customerFindUnique.mockResolvedValue(detailRow);
    m.addressFindMany.mockResolvedValue([]);
    m.orderFindMany.mockResolvedValue([
      {
        id: "order-1",
        orderNumber: "HM-1001",
        status: "NEW",
        totalFinal: null,
        totalEstimated: { toString: () => "110" },
        createdAt: new Date("2026-05-05T00:00:00.000Z"),
      },
    ]);
    m.orderCount.mockResolvedValue(1);
    render(
      await AdminCustomerDetailPage({
        params: Promise.resolve({ id: CUSTOMER_ID }),
        searchParams: sp({}),
      }),
    );
    expect(screen.getByText("HM-1001")).toBeVisible();
    expect(screen.getByText("110.00 ج.م")).toBeVisible();
    expect(screen.getByText("طلب جديد")).toBeVisible();
  });

  it("never shows an order row to an account without orders.view", async () => {
    authed(["customers.view"]);
    m.customerFindUnique.mockResolvedValue(detailRow);
    m.addressFindMany.mockResolvedValue([]);
    render(
      await AdminCustomerDetailPage({
        params: Promise.resolve({ id: CUSTOMER_ID }),
        searchParams: sp({}),
      }),
    );
    expect(m.orderFindMany).not.toHaveBeenCalled();
    expect(m.orderCount).not.toHaveBeenCalled();
    expect(screen.getByText("الطلبات مش معروضة هنا")).toBeVisible();
    expect(screen.getByText("محجوب — صلاحية عرض الطلبات ناقصة")).toBeVisible();
    expect(screen.queryByText("HM-1001")).toBeNull();
  });
});
