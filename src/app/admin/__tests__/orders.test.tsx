// GAP-2 Orders tests (approved FE-10E): admin order queue reads + boundary.
// Identity AND reads mocked (no DB, no network). Proves: gate key, list/empty/error
// states, server-side filtering, the keyset cursor convention, and the Arabic
// wording of the queue and of the order detail screen. Fulfillment transitions are
// NOT executed here (mocked-mutation islands live on the detail page — covered by
// contract, remaining for fixture environments).

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/auth/rbac", () => ({
  requireAdmin: vi.fn(),
  requirePermission: vi.fn(),
  checkPermission: vi.fn(),
}));

vi.mock("@/lib/orders/admin-queue", () => ({
  listOrderQueue: vi.fn(),
  listOrderActorNames: vi.fn(),
}));

vi.mock("@/lib/orders/queries", () => ({
  getOrderFull: vi.fn(),
}));

vi.mock("@/lib/replacements/queries", () => ({
  listReplacementsByOrder: vi.fn(),
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
import AdminOrderDetailPage from "../orders/[id]/page";
import { requirePermission } from "@/lib/auth/rbac";
import { listOrderActorNames, listOrderQueue } from "@/lib/orders/admin-queue";
import { getOrderFull } from "@/lib/orders/queries";
import { listReplacementsByOrder } from "@/lib/replacements/queries";

const REDIRECT = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" });
const FORBIDDEN = Object.assign(new Error("NEXT_FORBIDDEN"), { digest: "NEXT_FORBIDDEN" });
const dec = (s: string) => ({ toString: () => s });
const dt = new Date("2026-10-03T00:00:00Z");

/**
 * Order ids are UUIDs in the database (`@db.Uuid`), and the detail screen
 * rejects anything that is not one before it touches the database. The
 * fixtures therefore use a real UUID shape, not a readable label.
 */
const ORDER_ID = "0f1e2d3c-4b5a-4978-8899-aabbccddeeff";

/* ------------------------------------------------------------- queue rows */

function queueRow(i: number) {
  return {
    id: `ord-${i}`,
    orderNumber: `HM-100${i}`,
    status: "NEW",
    customerName: "عميل",
    customerPhone: "01000000000",
    totalFinal: null,
    totalEstimated: "110",
    createdAt: dt,
  };
}

/**
 * Mirrors the read model: one extra row is fetched, the extra is cut, and the
 * cursor is the id of the LAST row that is shown — so the next page starts
 * exactly where this one ended.
 */
function queuePage(all: ReturnType<typeof queueRow>[], limit = 20) {
  const hasMore = all.length > limit;
  const rows = hasMore ? all.slice(0, limit) : all;
  return { rows, nextCursor: hasMore ? rows[rows.length - 1].id : null };
}

type QueueCall = Awaited<ReturnType<typeof listOrderQueue>>;

/* ----------------------------------------------------------- detail rows */

function detailItem(picked: boolean) {
  return {
    id: "item-1",
    orderId: "ord-1",
    productVariantId: "var-1",
    productNameSnapshot: "أرز مصري",
    variantNameSnapshot: "كيس 1 كجم",
    brandNameSnapshot: "الهدى",
    productCodeSnapshot: "6221031492014",
    codeTypeSnapshot: "BARCODE",
    unitSnapshot: "KG",
    productTypeSnapshot: "WEIGHT",
    saleStepSnapshot: null,
    unitPrice: dec("100"),
    requestedQuantity: dec("2"),
    actualQuantity: picked ? dec("2") : null,
    estimatedTotal: dec("200"),
    finalTotal: null,
    itemStatus: picked ? "FULFILLED" : "PENDING",
  };
}

function detailRow(status: string, picked = false) {
  return {
    id: ORDER_ID,
    orderNumber: "HM-1001",
    status,
    idempotencyKey: "idem-1",
    subtotalEstimated: dec("100"),
    discountTotal: dec("0"),
    deliveryFee: dec("10"),
    totalEstimated: dec("110"),
    subtotalFinal: null,
    totalFinal: null,
    customerNameSnapshot: "أحمد",
    customerPhoneSnapshot: "01000000000",
    deliveryCity: "القاهرة",
    deliveryArea: "مدينة نصر",
    deliveryVillage: null,
    deliveryStreet: "شارع مصطفى النحاس",
    deliveryBuilding: "12",
    deliveryLandmark: "جنب مسجد النور",
    deliveryPhone: "01000000000",
    notes: "الاتصال قبل التوصيل",
    createdAt: dt,
    updatedAt: dt,
    items: [detailItem(picked)],
    history: [
      {
        id: "h-1",
        orderId: ORDER_ID,
        oldStatus: null,
        newStatus: "NEW",
        actorType: "CUSTOMER",
        actorId: null,
        note: null,
        createdAt: dt,
      },
    ],
  };
}

/* --------------------------------------------------------------- helpers */

const authed = (permissions: string[] = ["orders.view", "orders.update", "orders.cancel"]) => {
  vi.mocked(requirePermission).mockResolvedValue({
    user: { id: "u", name: "n", email: "e" },
    roles: [],
    permissions,
  });
};
const sp = (q: Record<string, string>) => Promise.resolve(q);
const body = () => document.body.textContent ?? "";

afterEach(() => {
  vi.resetAllMocks();
});

describe("admin orders queue (FE-10E)", () => {
  it("gates on orders.view before reading", async () => {
    authed();
    vi.mocked(listOrderQueue).mockResolvedValueOnce(queuePage([]) as unknown as QueueCall);
    render(await AdminOrdersPage({ searchParams: sp({}) }));
    expect(requirePermission).toHaveBeenCalledWith("orders.view");
    expect(listOrderQueue).toHaveBeenCalledTimes(1);
  });

  it("renders order numbers with Arabic statuses, totals, and detail links", async () => {
    authed();
    vi.mocked(listOrderQueue).mockResolvedValueOnce(queuePage([queueRow(1), queueRow(2)]) as unknown as QueueCall);
    render(await AdminOrdersPage({ searchParams: sp({}) }));
    expect(screen.getByText("HM-1001")).toBeVisible();
    expect(document.querySelector('a[href="/admin/orders/ord-1"]')).not.toBeNull();
    expect(screen.getAllByText("طلب جديد").length).toBeGreaterThan(0);
    // The machine token must never reach the operator.
    expect(document.querySelector("tbody")?.textContent ?? "").not.toContain("NEW");
    expect(screen.getAllByText(/110\.00 ج\.م/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/تقديري/).length).toBeGreaterThan(0);
    expect(screen.getByRole("columnheader", { name: "وقت الوصول" })).toBeVisible();
  });

  it("shows empty and error states without leaking rows", async () => {
    authed();
    vi.mocked(listOrderQueue).mockResolvedValueOnce(queuePage([]) as unknown as QueueCall);
    const { unmount } = render(await AdminOrdersPage({ searchParams: sp({}) }));
    expect(screen.getByText("مفيش طلبات مطابقة للفلترة")).toBeVisible();
    unmount();
    vi.mocked(listOrderQueue).mockRejectedValueOnce(new Error("DB down"));
    render(await AdminOrdersPage({ searchParams: sp({}) }));
    expect(screen.getByText("مقدرناش نحمّل الطلبات")).toBeVisible();
    expect(document.querySelector('a[href^="/admin/orders/ord-"]')).toBeNull();
  });

  it("preserves the filters in the next-page link and carries the last shown row as the cursor", async () => {
    authed();
    const rows = Array.from({ length: 21 }, (_, i) => queueRow(i));
    vi.mocked(listOrderQueue).mockImplementation(async () => queuePage(rows) as unknown as QueueCall);
    render(await AdminOrdersPage({ searchParams: sp({ status: "NEW" }) }));
    const href = screen.getByRole("link", { name: /الصفحة اللي بعد كده/ }).getAttribute("href") ?? "";
    expect(href).toContain("status=NEW");
    // The cursor is the id of the LAST row on screen (ord-19), not the first
    // row of the next page (ord-20) — that off-by-one used to skip a row.
    expect(href).toContain("cursor=ord-19");
    expect(href).not.toContain("cursor=ord-20");
    expect(document.querySelectorAll("tbody tr")).toHaveLength(20);
    expect(screen.queryByText("HM-10020")).toBeNull();
  });

  it("ends the pager without a next link when there is no further page", async () => {
    authed();
    vi.mocked(listOrderQueue).mockResolvedValueOnce(queuePage([queueRow(1)]) as unknown as QueueCall);
    render(await AdminOrdersPage({ searchParams: sp({}) }));
    expect(screen.queryByRole("link", { name: /الصفحة اللي بعد كده/ })).toBeNull();
    expect(screen.getByText(/وصلت لآخر نتيجة المطابقة/)).toBeVisible();
  });

  it("filters on the server, never in the browser", async () => {
    authed();
    vi.mocked(listOrderQueue).mockResolvedValueOnce(queuePage([]) as unknown as QueueCall);
    render(
      await AdminOrdersPage({
        searchParams: sp({ status: "PREPARING", search: "0100", dateFrom: "2026-10-01", dateTo: "2026-10-03" }),
      }),
    );
    const call = vi.mocked(listOrderQueue).mock.calls[0][0];
    expect(call.status).toBe("PREPARING");
    expect(call.search).toBe("0100");
    expect(call.limit).toBe(20);
    expect(call.dateFrom).toBe("2026-09-30T21:00:00.000Z");
    expect(call.dateTo).toBeNull();
    expect(call.dateBefore).toBe("2026-10-03T21:00:00.000Z");
    // The filter toolbar is a plain GET form, so the query is rebuilt by the server.
    const form = document.querySelector("form.adm-filters");
    expect(form?.getAttribute("method")).toBe("get");
    expect(form?.getAttribute("action")).toBe("/admin/orders");
    expect(screen.getByLabelText("حالة الطلب")).toBeVisible();
    expect(screen.getByLabelText("بحث في الطلبات")).toBeVisible();
    expect(screen.getByLabelText("من تاريخ")).toBeVisible();
    expect(screen.getByLabelText("لحد تاريخ")).toBeVisible();
  });

  it.each([
    ["2026-04-24", "2026-04-23T22:00:00.000Z", "2026-04-24T21:00:00.000Z"],
    ["2026-10-29", "2026-10-28T21:00:00.000Z", "2026-10-29T22:00:00.000Z"],
  ])("filters the complete Cairo DST day %s", async (day, start, end) => {
    authed();
    vi.mocked(listOrderQueue).mockResolvedValueOnce(queuePage([]) as unknown as QueueCall);
    render(await AdminOrdersPage({ searchParams: sp({ dateFrom: day, dateTo: day }) }));
    expect(vi.mocked(listOrderQueue).mock.calls[0][0]).toMatchObject({ dateFrom: start, dateTo: null, dateBefore: end });
  });

  it("does not normalize an impossible calendar day into another date", async () => {
    authed();
    vi.mocked(listOrderQueue).mockResolvedValueOnce(queuePage([]) as unknown as QueueCall);
    render(await AdminOrdersPage({ searchParams: sp({ dateFrom: "2026-02-30", dateTo: "2026-02-30" }) }));
    // An impossible day is refused BEFORE the queue is read: the query never
    // runs with a guessed date, and the operator is told what to fix.
    expect(listOrderQueue).not.toHaveBeenCalled();
    expect(screen.getByText("راجع فلاتر الطلبات")).toBeVisible();
  });

  it("preserves a future status from a dashboard drill-down without expanding to all orders", async () => {
    authed();
    vi.mocked(listOrderQueue).mockResolvedValueOnce(queuePage([]) as unknown as QueueCall);
    render(await AdminOrdersPage({ searchParams: sp({ status: "FUTURE_STATUS" }) }));
    expect(vi.mocked(listOrderQueue).mock.calls[0][0].status).toBe("FUTURE_STATUS");
    expect(screen.getByLabelText("حالة الطلب")).toHaveValue("FUTURE_STATUS");
  });

  it.each(["NEW;DROP TABLE orders", "new", "A".repeat(65)])("rejects malformed status %s", async (status) => {
    authed();
    vi.mocked(listOrderQueue).mockResolvedValueOnce(queuePage([]) as unknown as QueueCall);
    render(await AdminOrdersPage({ searchParams: sp({ status }) }));
    expect(vi.mocked(listOrderQueue).mock.calls[0][0].status).toBeNull();
  });

  it("denied identity rejects before any read", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(FORBIDDEN);
    await expect(AdminOrdersPage({ searchParams: sp({}) })).rejects.toThrow("NEXT_FORBIDDEN");
    expect(listOrderQueue).not.toHaveBeenCalled();
    vi.mocked(requirePermission).mockRejectedValueOnce(REDIRECT);
    await expect(AdminOrdersPage({ searchParams: sp({}) })).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("admin order detail (FE-10E)", () => {
  const detail = async (status: string, picked = false) => {
    vi.mocked(getOrderFull).mockResolvedValueOnce(detailRow(status, picked) as never);
    vi.mocked(listReplacementsByOrder).mockResolvedValueOnce([] as never);
    vi.mocked(listOrderActorNames).mockResolvedValueOnce(new Map() as never);
    return render(await AdminOrderDetailPage({ params: Promise.resolve({ id: ORDER_ID }) }));
  };

  it("shows the order, the customer and the items in Arabic, with no machine token", async () => {
    authed();
    await detail("NEW");
    expect(screen.getByText("الطلب HM-1001")).toBeVisible();
    expect(screen.getByText("بيانات العميل والتوصيل")).toBeVisible();
    expect(screen.getByText("أصناف الطلب")).toBeVisible();
    expect(screen.getByText("الحساب")).toBeVisible();
    expect(screen.getByText("الخطوة الجاية")).toBeVisible();
    expect(screen.getByText("سجل حركة الطلب")).toBeVisible();
    expect(screen.getAllByText("أحمد").length).toBeGreaterThan(0);
    expect(screen.getAllByText("01000000000").length).toBeGreaterThan(0);
    expect(screen.getByText("أرز مصري")).toBeVisible();
    expect(screen.getByText("6221031492014")).toBeVisible();
    expect(screen.getByText("كجم")).toBeVisible();
    expect(screen.getByText("لسه متجهّزش")).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "الكمية المجهّزة" })).toBeVisible();
    expect(body()).not.toContain("PENDING");
    expect(body()).not.toContain("KG");
    expect(body()).not.toContain("BARCODE");
  });

  it("offers only the cancel step on a brand new order", async () => {
    authed();
    await detail("NEW");
    expect(screen.getByRole("button", { name: "ألغِ الطلب" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "ابدأ تجهيز الطلب" })).toBeNull();
    expect(screen.getByText(/الخطوة الوحيدة المتاحة هنا هي الإلغاء/)).toBeVisible();
  });

  it("asks for the picked quantity per line and holds the order back while a line is pending", async () => {
    authed();
    await detail("PREPARING");
    expect(screen.getByRole("button", { name: "سجّل الكمية اللي اتجهّزت" })).toBeVisible();
    expect(screen.getByRole("button", { name: "الصنف غير متوفر" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "انهي التجهيز" })).toBeNull();
    expect(screen.getByText(/1 صنف لسه متجهّزش/)).toBeVisible();
  });

  it("closes the preparation when every line is picked", async () => {
    authed();
    await detail("PREPARING", true);
    expect(screen.getByRole("button", { name: "انهي التجهيز" })).toBeVisible();
    expect(screen.getByText("تم تجهيزه")).toBeVisible();
    // A picked line means the order can no longer be cancelled.
    expect(screen.queryByRole("button", { name: "ألغِ الطلب" })).toBeNull();
    expect(screen.getByText(/الطلب ده اتجهّز منه جزء، ومينفعش يتلغى/)).toBeVisible();
  });

  it("hides the cancel control from an account without the permission", async () => {
    authed(["orders.view", "orders.update"]);
    await detail("NEW");
    expect(screen.queryByRole("button", { name: "ألغِ الطلب" })).toBeNull();
    expect(screen.getByText(/غير متاح لحسابك/)).toBeVisible();
  });

  it("tells who moved the order and when, in Arabic", async () => {
    authed(["orders.view", "orders.update", "orders.cancel", "users.view"]);
    vi.mocked(getOrderFull).mockResolvedValueOnce({
      ...detailRow("CONFIRMED"),
      history: [
        {
          id: "h-1",
          orderId: ORDER_ID,
          oldStatus: "NEW",
          newStatus: "CONFIRMED",
          actorType: "STAFF",
          actorId: "u-1",
          note: "اتأكد من النادل",
          createdAt: dt,
        },
      ],
    } as never);
    vi.mocked(listReplacementsByOrder).mockResolvedValueOnce([] as never);
    vi.mocked(listOrderActorNames).mockResolvedValueOnce(new Map([["u-1", "محمد"]]) as never);
    render(await AdminOrderDetailPage({ params: Promise.resolve({ id: ORDER_ID }) }));
    expect(screen.getByText("من «طلب جديد» إلى «الطلب متأكد»")).toBeVisible();
    expect(screen.getByText(/فريق المتجر · محمد/)).toBeVisible();
    expect(screen.getByText("ملاحظة: اتأكد من النادل")).toBeVisible();
    expect(body()).not.toContain("CONFIRMED");
  });

  it("keeps the staff name out of the history without the users.view permission", async () => {
    authed(["orders.view", "orders.update", "orders.cancel"]);
    vi.mocked(getOrderFull).mockResolvedValueOnce({
      ...detailRow("CONFIRMED"),
      history: [
        {
          id: "h-1",
          orderId: ORDER_ID,
          oldStatus: "NEW",
          newStatus: "CONFIRMED",
          actorType: "STAFF",
          actorId: "u-1",
          note: "اتأكد من النادل",
          createdAt: dt,
        },
      ],
    } as never);
    vi.mocked(listReplacementsByOrder).mockResolvedValueOnce([] as never);
    render(await AdminOrderDetailPage({ params: Promise.resolve({ id: ORDER_ID }) }));
    // The staff roster is a separate permission: without it the history says
    // WHO in terms of role only, and the names are never even looked up.
    expect(screen.getByText(/فريق المتجر/)).toBeVisible();
    expect(body()).not.toContain("محمد");
    expect(listOrderActorNames).not.toHaveBeenCalled();
  });

  it("does not read the order before the permission check", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(FORBIDDEN);
    await expect(AdminOrderDetailPage({ params: Promise.resolve({ id: ORDER_ID }) })).rejects.toThrow("NEXT_FORBIDDEN");
    expect(getOrderFull).not.toHaveBeenCalled();
  });

  it("refuses an id that is not an order uuid before it reads anything", async () => {
    authed();
    await expect(
      AdminOrderDetailPage({ params: Promise.resolve({ id: "ord-1" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getOrderFull).not.toHaveBeenCalled();
  });
});
