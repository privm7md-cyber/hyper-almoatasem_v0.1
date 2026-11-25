// Isolated server-page rendering. Auth/reads mocked; no live UI or network claim.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
const m = vi.hoisted(() => ({ auth: vi.fn(), full: vi.fn(), replacements: vi.fn(), names: vi.fn(), queue: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get() { throw new Error("Unexpected database access"); } }) }));
vi.mock("@/lib/auth/rbac", () => ({ requirePermission: m.auth }));
vi.mock("@/lib/orders/queries", () => ({ getOrderFull: m.full }));
vi.mock("@/lib/replacements/queries", () => ({ listReplacementsByOrder: m.replacements }));
vi.mock("@/lib/orders/admin-queue", () => ({ listOrderActorNames: m.names, listOrderQueue: m.queue }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/admin/fulfillment-forms", () => ({
  OrderAction: ({ label, path, requireCancelReason }: { label: string; path: string; requireCancelReason?: boolean }) => <button data-path={path} data-reason={requireCancelReason}>{label}</button>,
  PickForm: () => <button>MOCK_PICK</button>, ProposeForm: () => <button>MOCK_PROPOSE</button>, CopyTextButton: () => null,
}));
import Detail from "../orders/[id]/page";
import Queue from "../orders/page";
import { ApiError } from "@/lib/api/errors";
const id = "00000000-0000-4000-8000-000000000001";
const customerId = "00000000-0000-4000-8000-000000000002";
const actorId = "00000000-0000-4000-8000-000000000003";
const date = new Date("2026-10-03T00:00:00Z");
const dec = (value: string) => ({ toString: () => value });
const item = () => ({ id: "item", orderId: id, productVariantId: "variant", productNameSnapshot: "اسم تاريخي", variantNameSnapshot: "عبوة تاريخية", brandNameSnapshot: "علامة تاريخية", productCodeSnapshot: "OLD-CODE", codeTypeSnapshot: "BARCODE", unitSnapshot: "KG", productTypeSnapshot: "WEIGHT", saleStepSnapshot: 125, unitPrice: dec("123.45"), requestedQuantity: dec("2"), actualQuantity: null as ReturnType<typeof dec> | null, estimatedTotal: dec("246.90"), finalTotal: null as ReturnType<typeof dec> | null, itemStatus: "PENDING" });
function row() {
  return { id, customerId: null as string | null, orderNumber: "HM-123", status: "PREPARING", idempotencyKey: null,
    subtotalEstimated: dec("246.90"), discountTotal: dec("5"), deliveryFee: dec("10"), totalEstimated: dec("251.90"), subtotalFinal: null as ReturnType<typeof dec> | null, totalFinal: null as ReturnType<typeof dec> | null,
    customerNameSnapshot: "اسم العميل وقت الطلب", customerPhoneSnapshot: "01000000000", deliveryCity: "القاهرة", deliveryArea: "منطقة تاريخية", deliveryVillage: "قرية تاريخية", deliveryStreet: "شارع تاريخي", deliveryBuilding: "12", deliveryLandmark: "علامة مكان", deliveryPhone: "01100000000", notes: "ملاحظة محفوظة", createdAt: date, updatedAt: date, items: [item()],
    history: [{ id: "history", orderId: id, actorType: "STAFF", actorId, oldStatus: "CONFIRMED", newStatus: "PREPARING", note: "تاريخ محفوظ", createdAt: date }],
  };
}
function replacement() { return { id: "replacement", originalItem: item(), replacementVariantId: "sub", replacementVariant: { name: "شكل البديل", sizeUnit: "KG", product: { name: "البديل", unit: "KG", productType: "WEIGHT" } }, replacementQuantity: dec("2"), replacementUnitPrice: dec("124"), priceDifference: dec("1.10"), reason: "سبب", status: "PROPOSED", proposedByType: "STAFF", decidedByType: null, replacementOrderItemId: null, createdAt: date }; }
function permissions(...keys: string[]) { m.auth.mockResolvedValue({ user: { id: actorId }, roles: [], permissions: ["orders.view", ...keys] }); }
const detail = () => Detail({ params: Promise.resolve({ id }) });
const queue = (values: Record<string, string | string[] | undefined> = {}) => Queue({ searchParams: Promise.resolve(values) });
beforeEach(() => {
  vi.resetAllMocks(); permissions(); m.full.mockResolvedValue(row()); m.replacements.mockResolvedValue([]);
  m.names.mockResolvedValue(new Map([[actorId, "اسم الموظف المحمي"]])); m.queue.mockResolvedValue({ rows: [], nextCursor: null });
});

describe("ADM05 order read and permission boundaries", () => {
  it("orders.view is the actual snapshot/PII boundary", async () => {
    m.auth.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(detail()).rejects.toThrow("FORBIDDEN");
    expect(m.auth).toHaveBeenCalledWith("orders.view");
    expect(m.full).not.toHaveBeenCalled(); expect(m.replacements).not.toHaveBeenCalled(); expect(m.names).not.toHaveBeenCalled();
  });
  it("invalid UUID avoids reads; missing order is distinct from read failure", async () => {
    await expect(Detail({ params: Promise.resolve({ id: "bad" }) })).rejects.toThrow("NOT_FOUND");
    expect(m.full).not.toHaveBeenCalled();
    m.full.mockResolvedValueOnce(null);
    await expect(detail()).rejects.toThrow("NOT_FOUND");
    m.full.mockRejectedValueOnce(new Error("PRIVATE_DATABASE_ERROR"));
    render(await detail());
    expect(screen.getByRole("alert")).toHaveTextContent("مقدرناش نحمّل الطلب");
    expect(document.body.textContent).not.toContain("PRIVATE_DATABASE_ERROR");
    expect(m.replacements).not.toHaveBeenCalled();
  });
  it("read-only operators see frozen snapshots/history but no pick, unavailable, propose or actor-name read", async () => {
    render(await detail());
    for (const text of ["اسم تاريخي", "عبوة تاريخية", "علامة تاريخية", "OLD-CODE", "123.45 ج.م", "اسم العميل وقت الطلب", "منطقة تاريخية", "قرية تاريخية", "شارع تاريخي", "علامة مكان", "ملاحظة محفوظة", "تاريخ محفوظ"]) {
      expect(document.body.textContent).toContain(text);
    }
    expect(m.names).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("اسم الموظف المحمي");
    expect(document.querySelectorAll("button[data-path]")).toHaveLength(0);
    expect(screen.queryByText("MOCK_PICK")).toBeNull(); expect(screen.queryByText("MOCK_PROPOSE")).toBeNull();
    expect(document.querySelector("ol")?.textContent).toContain("فريق المتجر");
  });
  it("users.view alone reveals staff names, not operational controls", async () => {
    permissions("users.view"); render(await detail());
    expect(m.names).toHaveBeenCalledWith([actorId]);
    expect(screen.getByText(/اسم الموظف المحمي/)).toBeVisible();
    expect(screen.queryByText("MOCK_PICK")).toBeNull();
  });
  it("orders.update exposes pending pick/unavailable/propose but not staff names", async () => {
    permissions("orders.update"); render(await detail());
    expect(screen.getByText("MOCK_PICK")).toBeVisible(); expect(screen.getByText("MOCK_PROPOSE")).toBeVisible();
    expect(screen.getByText("الصنف غير متوفر")).toBeVisible(); expect(m.names).not.toHaveBeenCalled();
  });
  it("failed replacement read cannot enable READY even with zero pending lines", async () => {
    permissions("orders.update"); const value = row(); value.items = []; m.full.mockResolvedValue(value);
    m.replacements.mockRejectedValue(new Error("read failed")); render(await detail());
    expect(document.body.textContent).toContain("حالتها مش معروفة");
    expect(document.querySelector('button[data-path$="/ready"]')).toBeNull();
  });
  it("known zero proposals and resolved lines allow READY without modifying stored final totals", async () => {
    permissions("orders.update"); const value = row(); value.items[0].itemStatus = "FULFILLED"; value.items[0].actualQuantity = dec("1"); value.items[0].finalTotal = dec("123.45");
    value.subtotalFinal = dec("123.45"); value.totalFinal = dec("128.45"); m.full.mockResolvedValue(value);
    render(await detail()); expect(document.querySelector('button[data-path$="/ready"]')).not.toBeNull();
    expect(document.body.textContent).toContain("128.45 ج.م"); expect(document.body.textContent).toContain("المبلغ المحصّل");
    expect(document.body.textContent).toContain("مش دليل إن العميل دفع");
  });
  it("registered account links require customers.view; never show guest credential tools", async () => {
    const value = row(); value.customerId = customerId; m.full.mockResolvedValue(value); permissions("orders.update");
    const view = render(await detail()); expect(screen.getByText("عميل مسجل")).toBeVisible();
    expect(document.querySelector('a[href^="/admin/customers/"]')).toBeNull(); expect(document.body.textContent).not.toContain("اعتماد الطلب للضيف");
    view.unmount(); permissions("customers.view"); render(await detail());
    expect(document.querySelector(`a[href="/admin/customers/${customerId}"]`)).not.toBeNull();
  });
  it("guest stays unlinked by phone, can revoke only, and cannot auto-accept", async () => {
    permissions("orders.update", "customers.view"); m.replacements.mockResolvedValue([replacement()]); render(await detail());
    expect(screen.getByText("ضيف — الطلب غير مرتبط بحساب")).toBeVisible();
    expect(document.querySelector('a[href^="/admin/customers/"]')).toBeNull();
    expect(document.querySelector('button[data-path$="/credential/revoke"]')).not.toBeNull();
    expect(document.querySelector('button[data-path$="/credential/rotate"]')).toBeNull();
    expect(document.querySelector('button[data-path$="/auto-accept"]')).toBeNull();
    expect(document.body.textContent).not.toContain("بتلغيه لما الطلب يخلص");
  });
  it("registered autoaccept label requires existing preconsent, cancellation requests reason", async () => {
    permissions("orders.update", "orders.cancel"); const value = row(); value.customerId = customerId; m.full.mockResolvedValue(value);
    m.replacements.mockResolvedValue([replacement()]); render(await detail());
    expect(screen.getByText("قبول حسب موافقة العميل المسبقة")).toBeVisible();
    expect(document.querySelector('button[data-path$="/cancel"]')).toHaveAttribute("data-reason", "true");
    expect(document.body.textContent).toContain("بيفك حجز المخزون بس");
    expect(document.body.textContent).not.toContain("بيرجّع أصناف الطلب للمخزون");
  });
});

describe("ADM05 queue validation UI", () => {
  it.each([{ dateFrom: "2026-02-30" }, { dateTo: "bad" }, { dateFrom: "2026-10-02", dateTo: "2026-10-01" }, { dateFrom: ["2026-10-01", "bad"] }])("invalid dates are rejected without an unfiltered read: %j", async (params) => {
    render(await queue(params)); expect(m.queue).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("اختر تاريخ بداية ونهاية صحيحين");
  });
  it.each([
    ["2026-04-24", "2026-04-23T22:00:00.000Z", "2026-04-24T21:00:00.000Z"],
    ["2026-10-29", "2026-10-28T21:00:00.000Z", "2026-10-29T22:00:00.000Z"],
  ])("keeps the DST-safe half-open Cairo day %s", async (day, start, end) => {
    render(await queue({ dateFrom: day, dateTo: day }));
    expect(m.queue).toHaveBeenCalledWith(expect.objectContaining({ dateFrom: start, dateTo: null, dateBefore: end }));
  });
  it("invalid cursor restart preserves filters, not cursor; unknown status stays filtered", async () => {
    m.queue.mockRejectedValueOnce(new ApiError("VALIDATION", "invalid cursor"));
    render(await queue({ cursor: "bad", status: "FUTURE_STATUS", search: "0100", dateFrom: "2026-10-01", dateTo: "2026-10-02" }));
    const link = screen.getByRole("link", { name: "ابدأ من أول النتائج بنفس الفلترة" });
    const url = new URL(link.getAttribute("href")!, "http://localhost");
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: "FUTURE_STATUS", search: "0100", dateFrom: "2026-10-01", dateTo: "2026-10-02" });
    expect(m.queue).toHaveBeenCalledWith(expect.objectContaining({ status: "FUTURE_STATUS", cursor: "bad" }));
  });
});
