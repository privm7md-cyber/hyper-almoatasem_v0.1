// Isolated stock-drilldown UI contracts: synthetic shared-model fixtures only.
// Await the page before rendering, as in the existing async admin page tests;
// this is not a Next.js runtime, live authorization, or backend classifier test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import axe from "axe-core";
import type { DashboardStockPage, DashboardStockProduct, ProductStockState } from "@/lib/admin/dashboard-contract";

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, ...rest }: { href: string; children: ReactNode; prefetch?: boolean } & AnchorHTMLAttributes<HTMLAnchorElement>) => {
    void prefetch;
    return <a href={href} {...rest}>{children}</a>;
  },
}));
const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: navigation.refresh }) }));
vi.mock("@/lib/auth/rbac", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/admin/dashboard", () => ({ listDashboardStockProducts: vi.fn() }));
// Fail closed if a future dependency escapes the mocked identity/read boundaries.
vi.mock("@/lib/db", () => { throw new Error("Unexpected database import in isolated stock UI tests"); });

import ProductStockPage from "../inventory/product-status/page";
import { requirePermission } from "@/lib/auth/rbac";
import { listDashboardStockProducts } from "@/lib/admin/dashboard";

const PATH = "/admin/inventory/product-status";
const NEXT_LABEL = "الصفحة اللي بعد كده";
const STATUS_LABEL = "حالة مخزون المنتج";
const START_LABEL = "بداية المنتجات بنفس الحالة";
const FIRST_EMPTY = "لا توجد منتجات مطابقة لهذه الحالة";
const END_EMPTY = "وصلت لنهاية المنتجات المطابقة";
const STATES: { state: ProductStockState; label: string }[] = [
  { state: "available", label: "متوفرة" },
  { state: "low", label: "منخفضة المخزون" },
  { state: "out", label: "غير متوفرة" },
  { state: "unknown", label: "توافرها غير معروف" },
];
const admin = {
  user: { id: "00000000-0000-4000-8000-000000000100", name: "مدير اختبار", email: "stock-ui@example.invalid" },
  roles: [], permissions: ["inventory.view", "products.view"],
};
const FORBIDDEN = Object.assign(new Error("NEXT_FORBIDDEN"), { digest: "NEXT_FORBIDDEN" });
const REDIRECT = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" });
type Params = Record<string, string | string[] | undefined>;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stockCursor = (state: ProductStockState, n = 1) => `${state}:${uuid(n)}`;
const emptyPage = (): DashboardStockPage => ({ rows: [], nextCursor: null, invalidCursor: false });
function product(state: ProductStockState = "low", n = 1): DashboardStockProduct {
  return { id: uuid(n), name: `منتج اختبار ${n}`, state, variantCount: 5, knownCount: state === "unknown" ? 0 : 5 };
}
async function mount(params: Params = {}, page = emptyPage()) {
  vi.mocked(listDashboardStockProducts).mockResolvedValue(page);
  return render(await ProductStockPage({ searchParams: Promise.resolve(params) }));
}
function expectNoResults() {
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: NEXT_LABEL })).not.toBeInTheDocument();
  expect(screen.queryByText(FIRST_EMPTY)).not.toBeInTheDocument();
  expect(screen.queryByText(END_EMPTY)).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(admin);
});
afterEach(() => { vi.resetAllMocks(); });

describe("product stock page: isolated permission and URL gates", () => {
  it("authorizes inventory then products before accessing any URL props, values or query", async () => {
    const events: string[] = [];
    vi.mocked(requirePermission).mockImplementation(async (permission) => {
      events.push(permission);
      return admin;
    });
    vi.mocked(listDashboardStockProducts).mockImplementation(async () => {
      events.push("query");
      return emptyPage();
    });
    const params = Object.defineProperty({}, "status", { get: () => { events.push("status"); return "out"; } });
    const props = Object.defineProperty({}, "searchParams", {
      get: () => { events.push("searchParams"); return Promise.resolve(params); },
    }) as Parameters<typeof ProductStockPage>[0];
    render(await ProductStockPage(props));
    expect(events.slice(0, 3)).toEqual(["inventory.view", "products.view", "searchParams"]);
    expect(events.indexOf("status")).toBeGreaterThan(events.indexOf("searchParams"));
    expect(events.at(-1)).toBe("query");
    expect(requirePermission).toHaveBeenCalledTimes(2);
    expect(listDashboardStockProducts).toHaveBeenCalledExactlyOnceWith("out", null, 20);
  });

  it.each([
    { held: [], calls: ["inventory.view"] },
    { held: ["products.view"], calls: ["inventory.view"] },
    { held: ["inventory.view"], calls: ["inventory.view", "products.view"] },
  ])("denied permissions with held=$held never touch params or stock reads", async ({ held, calls }) => {
    vi.mocked(requirePermission).mockImplementation(async (permission) => {
      if (!held.includes(permission)) throw FORBIDDEN;
      return { ...admin, permissions: held };
    });
    const readParams = vi.fn(() => { throw new Error("URL accessed before permissions"); });
    const props = Object.defineProperty({}, "searchParams", { get: readParams }) as Parameters<typeof ProductStockPage>[0];
    await expect(ProductStockPage(props)).rejects.toBe(FORBIDDEN);
    expect(requirePermission).toHaveBeenCalledTimes(calls.length);
    expect(vi.mocked(requirePermission).mock.calls.map(([permission]) => permission)).toEqual(calls);
    expect(readParams).not.toHaveBeenCalled();
    expect(listDashboardStockProducts).not.toHaveBeenCalled();
    expect(document.body).toBeEmptyDOMElement();
  });

  it("propagates an unauthenticated redirect without awaiting searchParams or querying", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(REDIRECT);
    const awaitParams = vi.fn();
    const params = { then: awaitParams } as unknown as Promise<Params>;
    await expect(ProductStockPage({ searchParams: params })).rejects.toBe(REDIRECT);
    expect(requirePermission).toHaveBeenCalledExactlyOnceWith("inventory.view");
    expect(awaitParams).not.toHaveBeenCalled();
    expect(listDashboardStockProducts).not.toHaveBeenCalled();
  });

  it("defaults only an absent status to low and uses the fixed 20-product read limit", async () => {
    await mount();
    expect(listDashboardStockProducts).toHaveBeenCalledExactlyOnceWith("low", null, 20);
    expect(screen.getByRole("combobox", { name: STATUS_LABEL })).toHaveValue("low");
    expect(screen.getByRole("heading", { level: 1, name: "منتجات منخفضة المخزون" })).toBeVisible();
  });

  it.each(STATES)("accepts $state and synchronizes the heading, native filter and query", async ({ state, label }) => {
    await mount({ status: state });
    expect(listDashboardStockProducts).toHaveBeenCalledExactlyOnceWith(state, null, 20);
    expect(screen.getByRole("heading", { level: 1, name: `منتجات ${label}` })).toBeVisible();
    const select = screen.getByRole("combobox", { name: STATUS_LABEL });
    expect(select).toHaveValue(state);
    expect(within(select).getAllByRole("option").map((option) => [option.getAttribute("value"), option.textContent])).toEqual(STATES.map(({ state, label }) => [state, label]));
  });

  it.each(["", "LOW", "invalid", "constructor", "__proto__", "toString", [], ["low"], ["low", "out"]].map((status) => ({ status })))("invalid or repeated status $status shows correction without querying", async ({ status }) => {
    await mount({ status, cursor: stockCursor("out") });
    expect(listDashboardStockProducts).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("فلتر حالة المخزون غير صالح");
    expect(screen.getByRole("link", { name: "اختر حالة صحيحة" })).toHaveAttribute("href", `${PATH}?status=low`);
    expect(screen.getByRole("combobox", { name: STATUS_LABEL })).toHaveValue("low");
    expectNoResults();
  });

  it.each([[], [stockCursor("out")], [stockCursor("out"), stockCursor("out", 2)]].map((cursor) => ({ cursor })))("malformed repeated cursor $cursor preserves status recovery without querying", async ({ cursor }) => {
    await mount({ status: "out", cursor });
    expect(listDashboardStockProducts).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("رابط الصفحة لم يعد متاحًا");
    expect(screen.getByRole("link", { name: START_LABEL })).toHaveAttribute("href", `${PATH}?status=out`);
    expect(screen.getByRole("combobox", { name: STATUS_LABEL })).toHaveValue("out");
    expectNoResults();
  });
});

describe("product stock page: honest backend result states", () => {
  // Cursor syntax, scope and anchor validation belong to the already-tested
  // backend. Here the fixtures prove only forwarding and invalidCursor handling.
  it.each([
    { state: "low" as const, cursor: stockCursor("out") },
    { state: "out" as const, cursor: "" },
    { state: "unknown" as const, cursor: "not-a-cursor" },
    { state: "available" as const, cursor: stockCursor("available", 99) },
  ])("backend invalidCursor for $state/$cursor offers same-status cursor-free recovery", async ({ state, cursor }) => {
    await mount({ status: state, cursor }, { ...emptyPage(), invalidCursor: true });
    expect(listDashboardStockProducts).toHaveBeenCalledExactlyOnceWith(state, cursor, 20);
    expect(screen.getByRole("alert")).toHaveTextContent("رابط الصفحة لم يعد متاحًا");
    const recovery = screen.getByRole("link", { name: START_LABEL });
    expect(recovery).toHaveAttribute("href", `${PATH}?status=${state}`);
    expect(screen.getByRole("combobox", { name: STATUS_LABEL })).toHaveValue(state);
    expectNoResults();
  });

  it.each([undefined, stockCursor("unknown")])("read failure with cursor=%s is an explicit error, never zero/empty/end/invalid", async (cursor) => {
    vi.mocked(listDashboardStockProducts).mockRejectedValue(new Error("PRIVATE_SYNTHETIC_READ_DETAILS"));
    const { container } = render(await ProductStockPage({ searchParams: Promise.resolve({ status: "unknown", cursor }) }));
    expect(listDashboardStockProducts).toHaveBeenCalledExactlyOnceWith("unknown", cursor ?? null, 20);
    expect(screen.getByRole("alert")).toHaveTextContent("البيانات غير متاحة حاليًا");
    expect(screen.getByRole("alert")).toHaveTextContent("تعذّر قراءة أرصدة المنتجات؛ لا يعني ذلك أن المخزون صفر.");
    expect(screen.queryByText("رابط الصفحة لم يعد متاحًا")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("PRIVATE_SYNTHETIC_READ_DETAILS");
    expect(screen.getByRole("combobox", { name: STATUS_LABEL })).toHaveValue("unknown");
    expectNoResults();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
    expect(listDashboardStockProducts).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, stockCursor("out")])("valid empty result with cursor=%s distinguishes first-page emptiness from end", async (cursor) => {
    await mount({ status: "out", cursor });
    expect(listDashboardStockProducts).toHaveBeenCalledExactlyOnceWith("out", cursor ?? null, 20);
    expect(screen.getByText(cursor ? END_EMPTY : FIRST_EMPTY)).toBeVisible();
    expect(screen.queryByText(cursor ? FIRST_EMPTY : END_EMPTY)).not.toBeInTheDocument();
    expect(screen.getByText("التصنيف يعتمد على بيانات المخزون المعروفة فقط.")).toBeVisible();
    expect(screen.getByRole("link", { name: START_LABEL })).toHaveAttribute("href", `${PATH}?status=out`);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: NEXT_LABEL })).not.toBeInTheDocument();
  });
});

describe("product stock page: row projection, Pager and GET form URL state", () => {
  it.each(STATES)("projects $state rows with Arabic status, exact counts and real product-detail links", async ({ state, label }) => {
    const row = product(state);
    await mount({ status: state }, { rows: [row], nextCursor: null, invalidCursor: false });
    const table = screen.getByRole("table", { name: `المنتجات ${label}` });
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["المنتج", "الحالة", "أشكال البيع النشطة", "الأرصدة المعروفة"]);
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([row.name, label, "5", state === "unknown" ? "0" : "5"]);
    expect(within(rows[1]).getByRole("link", { name: row.name })).toHaveAttribute("href", `/admin/products/${row.id}`);
    expect(screen.queryByRole("link", { name: NEXT_LABEL })).not.toBeInTheDocument();
    expect(screen.getByText("وصلت لآخر منتج المطابقة.")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(STATES)("forwards the backend next cursor unchanged and preserves only status=$state in Pager", async ({ state, label }) => {
    const rows = Array.from({ length: 20 }, (_, i) => product(state, i + 1));
    // The backend already proves last-displayed-row vs lookahead selection.
    const nextCursor = stockCursor(state, 20);
    const first = await mount({ status: state, cursor: stockCursor(state, 0), dateFrom: "2026-11-01", search: "ignored" }, { rows, nextCursor, invalidCursor: false });
    expect(listDashboardStockProducts).toHaveBeenCalledExactlyOnceWith(state, stockCursor(state, 0), 20);
    const table = screen.getByRole("table", { name: `المنتجات ${label}` });
    expect(within(table).getAllByRole("row")).toHaveLength(21);
    const next = screen.getByRole("link", { name: NEXT_LABEL });
    expect(next).toHaveAttribute("href", `${PATH}?status=${state}&cursor=${encodeURIComponent(nextCursor)}`);
    const url = new URL(next.getAttribute("href")!, "https://stock-ui.example.invalid");
    expect(Array.from(url.searchParams)).toEqual([["status", state], ["cursor", nextCursor]]);
    expect(screen.queryByText("وصلت لآخر منتج المطابقة.")).not.toBeInTheDocument();
    first.unmount();
    // Follow the GET URL by invoking the mocked page, never a browser/API request.
    await mount(Object.fromEntries(url.searchParams));
    expect(listDashboardStockProducts).toHaveBeenNthCalledWith(2, state, nextCursor, 20);
    expect(screen.getByText(END_EMPTY)).toBeVisible();
  });

  it("does not invent a next cursor even when a full 20-row final page is returned", async () => {
    await mount({ status: "low" }, { rows: Array.from({ length: 20 }, (_, i) => product("low", i + 1)), nextCursor: null, invalidCursor: false });
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.queryByRole("link", { name: NEXT_LABEL })).not.toBeInTheDocument();
    expect(screen.getByText("وصلت لآخر منتج المطابقة.")).toBeVisible();
  });

  it("submits only the chosen status by native GET, drops the cursor, and remounts on URL status changes", async () => {
    const first = await mount({ status: "low", cursor: stockCursor("low") });
    const select = screen.getByRole("combobox", { name: STATUS_LABEL });
    const form = select.closest("form")!;
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", PATH);
    expect(within(form).getByRole("button", { name: "عرض المنتجات" })).toHaveAttribute("type", "submit");
    fireEvent.change(select, { target: { value: "available" } });
    const fields = Array.from(new FormData(form));
    expect(fields).toEqual([["status", "available"]]);
    expect(listDashboardStockProducts).toHaveBeenCalledTimes(1);
    const query = new URLSearchParams(fields as [string, string][]);
    expect(`${form.getAttribute("action")}?${query}`).toBe(`${PATH}?status=available`);
    vi.mocked(listDashboardStockProducts).mockResolvedValue(emptyPage());
    first.rerender(await ProductStockPage({ searchParams: Promise.resolve({ status: "out" }) }));
    expect(screen.getByRole("combobox", { name: STATUS_LABEL })).toHaveValue("out");
    expect(screen.getByRole("heading", { level: 1, name: "منتجات غير متوفرة" })).toBeVisible();
    expect(listDashboardStockProducts).toHaveBeenNthCalledWith(2, "out", null, 20);
    expect(Array.from(new FormData(screen.getByRole("combobox", { name: STATUS_LABEL }).closest("form")!))).toEqual([["status", "out"]]);
  });
});

describe("product stock page: existing axe-core isolated-render gate", () => {
  it.each(["populated", "empty", "end", "invalid-status", "invalid-cursor", "read-error"] as const)("has no axe violations in the %s state (not browser conformance)", async (scenario) => {
    vi.mocked(listDashboardStockProducts).mockResolvedValue(scenario === "populated"
      ? { rows: [product()], nextCursor: stockCursor("low"), invalidCursor: false }
      : { ...emptyPage(), invalidCursor: scenario === "invalid-cursor" });
    if (scenario === "read-error") vi.mocked(listDashboardStockProducts).mockRejectedValue(new Error("Synthetic read failure"));
    const params: Params = {
      status: scenario === "invalid-status" ? "invalid" : "low",
      cursor: scenario === "end" || scenario === "invalid-cursor" ? stockCursor("low") : undefined,
    };
    const { container } = render(await ProductStockPage({ searchParams: Promise.resolve(params) }));
    const results = await axe.run(container);
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
