// Isolated UI contracts: mocked identity and DashboardData, no database/session/network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { KPI_CONTRACTS, metricHref, type DashboardData, type DashboardMetric, type ReadResult } from "@/lib/admin/dashboard-contract";
import { RANGE_LABELS, resolveDashboardRange, type RangePreset } from "@/lib/admin/date-range";
import { formatDate, formatMoney, formatQuantity } from "@/lib/admin/terminology";

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, ...rest }: { href: string; children: ReactNode; prefetch?: boolean } & AnchorHTMLAttributes<HTMLAnchorElement>) => { void prefetch; return <a href={href} {...rest}>{children}</a>; },
}));
vi.mock("@/lib/auth/rbac", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/admin/dashboard", () => ({ loadDashboardSnapshot: vi.fn() }));

import AdminDashboardPage from "../page";
import { requireAdmin } from "@/lib/auth/rbac";
import { loadDashboardSnapshot } from "@/lib/admin/dashboard";

const NOW = new Date("2026-11-12T10:00:00Z");
const adminCtx = {
  user: { id: "u-1", name: "مدير الاختبار", email: "admin@example.com" }, roles: ["SUPER_ADMIN"],
  permissions: ["orders.view", "prices.view", "products.view", "inventory.view", "customers.view", "promotions.view", "coupons.view"],
};
const VALUES: Record<DashboardMetric["id"], number | null> = {
  "orders-total": 41, "orders-new": 7, "orders-awaiting": 7, "orders-confirmed": 2,
  "orders-preparing": 0, "orders-completed": 30, "orders-cancelled": 1, "sales-total": null,
  "order-average": 250.5, "products-displayed": 9539, "products-hidden": 3,
  "products-archived": 4, "stock-low": 4, "stock-out": 1,
};
function snapshot(params: Record<string, string> = {}): DashboardData {
  const { range: calendarRange } = resolveDashboardRange(params, NOW);
  const elapsed = Math.max(0, Math.min(NOW.getTime(), Date.parse(calendarRange.endExclusive)) - Date.parse(calendarRange.start));
  const range = {
    ...calendarRange,
    endExclusive: new Date(Date.parse(calendarRange.start) + elapsed).toISOString(),
    previousEndExclusive: new Date(Date.parse(calendarRange.previousStart) + elapsed).toISOString(),
  };
  return {
    range, capturedAt: NOW.toISOString(),
    metrics: KPI_CONTRACTS.map((contract) => ({
      id: contract.id, state: contract.id === "sales-total" ? "unavailable" : "ready",
      value: VALUES[contract.id], previous: contract.period === "selected" && contract.id !== "sales-total" ? 0 : null,
      changePercent: null, note: contract.id === "sales-total" ? "لا يوجد سجل تحصيل أو استردادات." : null,
    })),
    orders: { state: "ready", data: {
      total: 41, previousTotal: 20,
      byStatus: [{ status: "NEW", count: 7, previous: 5 }, { status: "CONFIRMED", count: 2, previous: 5 }, { status: "DELIVERED", count: 30, previous: 10 }, { status: "CANCELLED", count: 1, previous: 0 }, { status: "FUTURE_STATUS", count: 1, previous: 0 }],
      daily: range.fromDay === range.toDay ? [{ day: range.fromDay, count: 41 }] : [{ day: range.fromDay, count: 7 }, { day: range.toDay, count: 34 }],
      recent: [{ id: "o-1", orderNumber: "H-1001", status: "NEW", createdAt: `${range.toDay}T08:00:00Z` }],
    } },
    inventory: { state: "ready", data: { total: 9539, available: 9532, low: 4, out: 1, unknown: 2 } },
    promotions: { state: "ready", data: [{ id: "promo-1", name: "عرض حقيقي في نموذج الاختبار", endAt: "2026-11-15T20:00:00Z" }] },
  };
}
function zeroSnapshot(): DashboardData {
  const data = snapshot();
  data.metrics = data.metrics.map((metric) => metric.state === "ready" ? { ...metric, value: 0, previous: metric.previous === null ? null : 0 } : metric);
  data.orders = { state: "ready", data: { total: 0, previousTotal: 0, byStatus: [{ status: "NEW", count: 0, previous: 0 }, { status: "DELIVERED", count: 0, previous: 0 }], daily: [{ day: data.range.fromDay, count: 0 }, { day: data.range.toDay, count: 0 }], recent: [] } };
  data.inventory = { state: "ready", data: { total: 0, available: 0, low: 0, out: 0, unknown: 0 } };
  data.promotions = { state: "ready", data: [] };
  return data;
}
async function mount(data = snapshot(), params?: Record<string, string>) {
  vi.mocked(loadDashboardSnapshot).mockResolvedValue(data);
  return render(await AdminDashboardPage({ searchParams: Promise.resolve(params ?? {}) }));
}
const metricCard = (id: DashboardMetric["id"]) => document.querySelector<HTMLElement>(`[data-kpi="${id}"]`)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.mocked(requireAdmin).mockResolvedValue(adminCtx);
});
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

describe("ADM-02 dashboard: isolated exact-model UI contracts", () => {
  it("renders the default range, role greeting and all permitted work lanes", async () => {
    await mount();
    expect(screen.getByRole("heading", { level: 1, name: "لوحة الإدارة" })).toBeVisible();
    expect(screen.getByText(/مرحبًا، مدير الاختبار/)).toBeVisible();
    expect(screen.getByText("مالك المتجر")).toBeVisible();
    expect(screen.getByRole("button", { name: "تشغيل المشهد ثلاثي الأبعاد" })).toHaveAttribute("aria-pressed", "false");
    const lanes = screen.getByRole("region", { name: "أقسام العمل" });
    expect(within(lanes).getAllByRole("link")).toHaveLength(6);
    expect(loadDashboardSnapshot).toHaveBeenCalledWith(adminCtx.permissions, snapshot().range);
    expect(screen.getByLabelText("تاريخ اليوم بتوقيت القاهرة")).toHaveTextContent(formatDate(NOW));
    expect(screen.getByText(/آخر قراءة ناجحة للمصادر المتاحة/)).toBeVisible();
  });

  it("offers a read-only GET refresh preserving the selected custom window", async () => {
    const params = { range: "custom", from: "2026-10-01", to: "2026-10-12" };
    await mount(snapshot(params), params);
    const form = screen.getByRole("form", { name: "تحديث بيانات لوحة التشغيل" });
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/admin");
    const values = new FormData(form as HTMLFormElement);
    expect(Object.fromEntries(values)).toEqual(params);
    expect(within(form).getByRole("button", { name: "تحديث البيانات" })).toHaveAttribute("type", "submit");
  });

  it("renders exactly 14 contracted KPIs with only actual ready values and honest ledger unavailability", async () => {
    await mount();
    expect(document.querySelectorAll("[data-kpi]")).toHaveLength(14);
    for (const contract of KPI_CONTRACTS) {
      const card = metricCard(contract.id);
      expect(within(card).getByRole("heading", { name: contract.label })).toBeVisible();
      const value = card.querySelector("[data-metric-value]");
      if (contract.id === "sales-total") {
        expect(value).toBeNull();
        expect(within(card).getByText("غير متاح من المصدر")).toBeVisible();
        expect(card.querySelector("a")).toBeNull();
      } else {
        expect(value?.textContent).toContain(contract.unit === "EGP" ? formatMoney(VALUES[contract.id]) : formatQuantity(VALUES[contract.id]));
        expect(within(card).getByRole("link", { name: `عرض التفاصيل: ${contract.label}` })).toHaveAttribute("href", metricHref(contract.id, snapshot().range));
      }
    }
    expect(screen.getByRole("heading", { name: "غير متاح: لا يوجد سجل تحصيل واستردادات" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "عدد الطلبات اليومية — ليس مبيعات" })).toBeVisible();
    expect(document.querySelectorAll(".adm-viewport")).toHaveLength(1);
    expect(document.querySelector(".adm-viewport [data-metric-value]")).toBeNull();
  });

  it.each(Object.keys(RANGE_LABELS) as RangePreset[])("synchronizes preset %s across the loader, selector and filtered navigations", async (preset) => {
    const params = { range: preset, from: "2026-10-01", to: "2026-10-12" };
    const data = snapshot(params);
    await mount(data, params);
    expect(screen.getByLabelText("الفترة")).toHaveValue(preset);
    expect(screen.getAllByRole("option")).toHaveLength(7);
    expect(screen.getByLabelText("من تاريخ (للنطاق المخصص)")).toHaveValue(data.range.fromDay);
    expect(screen.getByLabelText("إلى تاريخ (للنطاق المخصص)")).toHaveValue(data.range.toDay);
    expect(loadDashboardSnapshot).toHaveBeenCalledWith(adminCtx.permissions, data.range);
    const form = screen.getByRole("form", { name: "اختيار فترة لوحة التشغيل" });
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/admin");
    expect(within(metricCard("orders-new")).getByRole("link")).toHaveAttribute("href", metricHref("orders-new", data.range));
    expect(screen.getByRole("link", { name: "كل طلبات الفترة" })).toHaveAttribute("href", metricHref("orders-total", data.range));
  });

  it("remounts native selector fields on URL change rather than retaining edited defaults", async () => {
    const first = await mount();
    fireEvent.change(screen.getByLabelText("من تاريخ (للنطاق المخصص)"), { target: { value: "2020-01-01" } });
    const params = { range: "custom", from: "2026-10-01", to: "2026-10-12" };
    vi.mocked(loadDashboardSnapshot).mockResolvedValue(snapshot(params));
    first.rerender(await AdminDashboardPage({ searchParams: Promise.resolve(params) }));
    expect(screen.getByLabelText("من تاريخ (للنطاق المخصص)")).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("إلى تاريخ (للنطاق المخصص)")).toHaveValue("2026-10-12");
    expect(screen.getByLabelText("الفترة")).toHaveValue("custom");
  });

  it.each([
    { range: "custom", from: "2026-02-30", to: "2026-11-12" },
    { range: "custom", from: "2026-11-12", to: "2026-11-01" },
    { range: "custom", from: "2024-01-01", to: "2026-11-12" },
    { range: "custom", from: "", to: "2026-11-12" },
  ])("invalid custom %j shows an accessible correction error without any analytics read", async (params) => {
    render(await AdminDashboardPage({ searchParams: Promise.resolve(params) }));
    expect(loadDashboardSnapshot).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("لم تُجرَ قراءة التحليلات");
    expect(screen.getByRole("button", { name: /تطبيق الفترة/ })).toBeVisible();
    expect(screen.getByLabelText("الفترة")).toHaveValue("custom");
    expect(screen.getByLabelText("من تاريخ (للنطاق المخصص)")).toHaveAttribute("aria-invalid", "true");
    expect(document.querySelector("[data-kpi]")).toBeNull();
  });

  it("guards identity before even accessing searchParams or loading analytics", async () => {
    const read = vi.fn(() => Promise.resolve({ range: "today" }));
    const props = Object.defineProperty({}, "searchParams", { get: read }) as Parameters<typeof AdminDashboardPage>[0];
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(AdminDashboardPage(props)).rejects.toThrow("NEXT_REDIRECT");
    expect(read).not.toHaveBeenCalled();
    expect(loadDashboardSnapshot).not.toHaveBeenCalled();
  });

  it("shows denied labels for all 14 KPIs, never zero values or drill/work links even with an inconsistent ready mock", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ...adminCtx, permissions: [] });
    const { container } = await mount();
    expect(container.querySelectorAll("[data-kpi][data-state=denied]")).toHaveLength(14);
    expect(container.querySelector("[data-metric-value]")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).not.toContain("9539");
    expect(container.textContent).not.toContain("H-1001");
    expect(container.textContent).not.toContain("كل الأصناف فوق");
    expect(container.textContent).not.toContain("مفيش حاجة محتاجة متابعة");
  });

  it("gates monetary and stock data on both required permissions", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ...adminCtx, permissions: ["orders.view", "inventory.view"] });
    await mount();
    for (const id of ["sales-total", "order-average", "stock-low", "stock-out"] as const) {
      expect(metricCard(id)).toHaveAttribute("data-state", "denied");
      expect(metricCard(id).querySelector("[data-metric-value], a")).toBeNull();
    }
    expect(document.querySelector('[data-chart="inventory"]')).toBeNull();
    expect(within(screen.getByRole("region", { name: "أقسام العمل" })).getAllByRole("link")).toHaveLength(2);
  });

  it("renders zero cohorts as empty donuts and undefined radials, not 100% or fake minimum segments", async () => {
    await mount(zeroSnapshot());
    for (const id of ["orders", "inventory"]) expect(document.querySelector(`[data-chart="${id}"] [data-segment]`)).toBeNull();
    for (const id of ["completion", "cancellation"]) {
      const radial = document.querySelector(`[data-radial="${id}"]`)!;
      expect(radial.textContent).toContain("غير معرّفة");
      expect(radial.querySelector("[data-radial-value]")).toBeNull();
    }
    expect(within(metricCard("orders-total")).getByText("لا تغيير؛ الفترتان صفر")).toBeVisible();
    expect(document.querySelector('[data-chart="daily-orders"] rect')).toHaveAttribute("height", "0");
    expect(screen.getByText("لا توجد طلبات منشأة في هذه الفترة.")).toBeVisible();
    expect(screen.queryByText("100%")).toBeNull();
  });

  it("uses exact proportions including small and unknown status segments, accessible legend navigation and cohort denominators", async () => {
    const data = snapshot();
    await mount(data);
    const unknown = document.querySelector('[data-chart="orders"] [data-segment="FUTURE_STATUS"]')!;
    const [share, remainder] = unknown.getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(share).toBeCloseTo(100 / 41, 12);
    expect(share + remainder).toBeCloseTo(100, 12);
    const legend = screen.getByRole("table", { name: /توزيع حالات طلبات الفترة/ });
    expect(within(legend).getByRole("link", { name: "غير معروف" })).toHaveAttribute("href", `/admin/orders?dateFrom=${data.range.fromDay}&dateTo=${data.range.toDay}&status=FUTURE_STATUS`);
    expect(within(legend).getAllByRole("link")).toHaveLength(5);
    expect(document.querySelector('[data-radial="completion"]')?.textContent).toContain("30 من 41");
    expect(document.querySelector('[data-radial="cancellation"]')?.textContent).toContain("1 من 41");
    for (const svg of document.querySelectorAll("svg[data-chart], [data-radial] svg")) expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelector('[data-chart="inventory"] [data-segment="unknown"]')).toHaveAttribute("stroke-dasharray", `${2 / 9539 * 100} ${100 - 2 / 9539 * 100}`);
    expect(within(metricCard("stock-low")).getByRole("link")).toHaveAttribute("href", "/admin/inventory/product-status?status=low");
    expect(within(metricCard("stock-out")).getByRole("link")).toHaveAttribute("href", "/admin/inventory/product-status?status=out");
  });

  it("exposes native accessible definitions, current-snapshot limits, and daily order data without a fabricated sales trend", async () => {
    await mount();
    const definition = within(metricCard("orders-awaiting")).getByText("تعريف ومصدر: تنتظر التأكيد");
    fireEvent.click(definition);
    expect(definition.closest("details")).toHaveAttribute("open");
    expect(within(metricCard("orders-awaiting")).getByText(/نفس الطلبات الجديدة NEW/)).toBeVisible();
    const stock = metricCard("stock-low");
    expect(stock.textContent).toContain("لقطة حالية لا تعتمد على الفترة المختارة");
    expect(stock.textContent).toContain("لا يوجد سجل تاريخي للمقارنة");
    fireEvent.click(screen.getByText("عرض بيانات الطلبات اليومية"));
    expect(screen.getByRole("table", { name: /عدد الطلبات حسب يوم الإنشاء/ })).toBeVisible();
    expect(screen.getByRole("link", { name: "H-1001" })).toHaveAttribute("href", "/admin/orders/o-1");
    expect(screen.getByRole("link", { name: "عرض حقيقي في نموذج الاختبار" })).toHaveAttribute("href", "/admin/promotions/promo-1");
  });

  it.each(["denied", "error", "unavailable"] as const)("handles %s source failures explicitly without numeric/empty-success fallbacks", async (state) => {
    const data = snapshot();
    const fail = <T,>(): ReadResult<T> => ({ state, data: null, note: `سبب المصدر: ${state}` });
    data.metrics = data.metrics.map((metric) => ({ ...metric, state, value: 777777, note: `سبب المصدر: ${state}` }));
    data.orders = fail(); data.inventory = fail(); data.promotions = fail();
    const { container } = await mount(data);
    expect(container.querySelector("[data-metric-value]")).toBeNull();
    expect(container.querySelector("[data-chart]")).toBeNull();
    expect(container.textContent).not.toContain("777777");
    expect(container.textContent).not.toContain("لا توجد عروض نشطة مطابقة");
    expect(container.textContent).not.toContain("لا توجد طلبات منشأة");
    expect(screen.getByText(/وقت محاولة القراءة/)).toBeVisible();
    expect(screen.queryByText(/آخر قراءة ناجحة/)).toBeNull();
    for (const contract of KPI_CONTRACTS) {
      const card = metricCard(contract.id);
      expect(within(card).getByText(`سبب المصدر: ${state}`)).toBeVisible();
      if (state === "error") expect(within(card).getByRole("link", { name: `إعادة المحاولة: ${contract.label}` })).toHaveAttribute("href", `/admin?range=7d&from=${data.range.fromDay}&to=${data.range.toDay}`);
      else expect(card.querySelector("a")).toBeNull();
    }
  });

  it("does not turn missing metrics or ready null/non-finite values into zero", async () => {
    const data = snapshot();
    data.metrics = data.metrics.filter((metric) => metric.id !== "orders-total").map((metric) => metric.id === "order-average" ? { ...metric, value: null } : metric.id === "stock-low" ? { ...metric, value: "NaN" } : metric);
    await mount(data);
    for (const id of ["orders-total", "order-average", "stock-low"] as const) {
      expect(metricCard(id)).toHaveAttribute("data-state", "unavailable");
      expect(metricCard(id).querySelector("[data-metric-value], a")).toBeNull();
    }
  });

  it("handles a zero previous baseline and warns about today's still-open Cairo day", async () => {
    const data = snapshot();
    if (data.orders.state === "ready") data.orders.data.previousTotal = 0;
    await mount(data);
    expect(screen.getAllByText("لا تُحسب نسبة التغيّر؛ الأساس السابق صفر").length).toBeGreaterThan(0);
    expect(screen.getByText(/الفترة تشمل اليوم الذي لم ينتهِ بعد/)).toBeVisible();
    expect(screen.getByText(/السابقة بنفس الزمن المنقضي/)).toHaveTextContent("0 طلب");
    expect(screen.queryByText(/Infinity|NaN/)).toBeNull();
  });

  it("clips the previous query to equal elapsed milliseconds while preserving the selected Cairo dates", async () => {
    await mount();
    const passed = vi.mocked(loadDashboardSnapshot).mock.calls[0][1];
    expect(Date.parse(passed.previousEndExclusive) - Date.parse(passed.previousStart)).toBe(Date.parse(passed.endExclusive) - Date.parse(passed.start));
    const calendar = resolveDashboardRange({}, NOW).range;
    expect(passed.endExclusive).toBe(NOW.toISOString());
    expect(passed.previousEndExclusive).not.toBe(calendar.previousEndExclusive);
    expect(passed.fromDay).toBe(calendar.fromDay);
    expect(passed.toDay).toBe(calendar.toDay);
  });

  it("does not warn or shorten the previous window for a fully historical range", async () => {
    const params = { range: "yesterday" };
    await mount(snapshot(params), params);
    expect(screen.queryByText(/الفترة تشمل اليوم الذي لم ينتهِ بعد/)).toBeNull();
    const passed = vi.mocked(loadDashboardSnapshot).mock.calls[0][1];
    expect(passed).toEqual(resolveDashboardRange(params, NOW).range);
  });

  it("keeps the 3D scene in calm CSS fallback on initial render until toggled on", async () => {
    await mount();
    const fallback = document.querySelector("[data-scene-fallback]");
    expect(fallback).toHaveAttribute("data-scene-fallback", "visible");
    expect(document.querySelector(".adm-scene-canvas")).toBeNull();
    const toggle = screen.getByRole("button", { name: "تشغيل المشهد ثلاثي الأبعاد" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });
});
