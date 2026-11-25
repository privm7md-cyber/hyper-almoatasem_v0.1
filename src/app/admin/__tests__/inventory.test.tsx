import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));
const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/auth/rbac", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/frontend/api-client", () => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/inventory/queries", () => ({ listMovements: vi.fn() }));
vi.mock("@/lib/inventory/overview", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/inventory/overview")>(),
  listInventoryVariants: vi.fn(), getInventoryOverview: vi.fn(), getInventoryVariant: vi.fn(),
}));

import AdminInventoryPage from "../inventory/page";
import InventoryVariantPage from "../inventory/[variantId]/page";
import { requirePermission } from "@/lib/auth/rbac";
import { listMovements } from "@/lib/inventory/queries";
import { getInventoryOverview, getInventoryVariant, listInventoryVariants, inventoryFormOptions, type InventoryVariant } from "@/lib/inventory/overview";
import { InventoryAddStockForm, InventoryAdjustForm } from "@/components/admin/inventory-forms";
import { apiRequest } from "@/lib/frontend/api-client";

const id = (i: number) => `01800000-0000-7000-8000-${String(i).padStart(12, "0")}`;
const dec = (s: string) => ({ toString: () => s });
function variant(i = 0): InventoryVariant {
  return {
    id: id(i), name: `شكل ${i}`, sizeValue: dec("125"), sizeUnit: "GRAM", isActive: true, deletedAt: null,
    product: { id: id(i + 100), name: `منتج ${i}`, productType: "WEIGHT", isActive: true, deletedAt: null,
      category: { id: id(200), name: "تصنيف" }, brand: null },
    codes: [{ code: "12345", type: "BARCODE", isPrimary: true }],
    inventory: { quantity: dec("10"), reservedQuantity: dec("2"), availableQuantity: dec("8"),
      lowStockThreshold: dec("3"), updatedAt: new Date("2026-10-01T00:00:00Z") },
  } as unknown as InventoryVariant;
}
const permissions = (values = ["inventory.view", "inventory.adjust", "products.view"]) => {
  vi.mocked(requirePermission).mockResolvedValue({ user: { id: "u", name: "n", email: "e" }, roles: [], permissions: values });
};
const page = (q: Record<string, string> = {}) => AdminInventoryPage({ searchParams: Promise.resolve(q) });
const detail = (q: Record<string, string> = {}) => InventoryVariantPage({ params: Promise.resolve({ variantId: id(0) }), searchParams: Promise.resolve(q) });

beforeEach(() => {
  permissions();
  vi.mocked(listInventoryVariants).mockResolvedValue([variant()]);
  vi.mocked(getInventoryVariant).mockResolvedValue(variant());
  vi.mocked(getInventoryOverview).mockResolvedValue({ total: 9, known: 6, low: 2, zero: 1, missing: 3 });
  vi.mocked(listMovements).mockResolvedValue([]);
});
afterEach(() => vi.resetAllMocks());

describe("inventory operational desk", () => {
  it("gates reads and parameters before denied identities", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(page()).rejects.toThrow("FORBIDDEN");
    expect(listInventoryVariants).not.toHaveBeenCalled();
    expect(getInventoryOverview).not.toHaveBeenCalled();
    expect(listMovements).not.toHaveBeenCalled();
    vi.mocked(requirePermission).mockRejectedValueOnce(new Error("REDIRECT"));
    await expect(detail()).rejects.toThrow("REDIRECT");
    expect(getInventoryVariant).not.toHaveBeenCalled();
  });
  it("shows last visible variant as next cursor, not the lookahead", async () => {
    vi.mocked(listInventoryVariants).mockResolvedValue(Array.from({ length: 21 }, (_, i) => variant(i)));
    render(await page({ search: "حليب", status: "low_stock" }));
    const href = screen.getByRole("link", { name: "الصفحة اللي بعد كده" }).getAttribute("href")!;
    const query = new URL(href, "http://localhost").searchParams;
    expect(query.get("cursor")).toBe(id(19));
    expect(query.get("search")).toBe("حليب");
    expect(query.get("status")).toBe("low_stock");
    expect(screen.queryByText("شكل 20")).toBeNull();
  });
  it.each([0, 20])("has no next link for %i rows", async count => {
    vi.mocked(listInventoryVariants).mockResolvedValue(Array.from({ length: count }, (_, i) => variant(i)));
    render(await page());
    expect(screen.queryByRole("link", { name: "الصفحة اللي بعد كده" })).toBeNull();
    if (!count) expect(screen.getByText("مفيش أصناف مطابقة للفلتر ده.")).toBeVisible();
  });
  it("rejects malformed cursors before reads instead of silently restarting", async () => {
    render(await page({ cursor: "nope" }));
    expect(screen.getByText("تعذّر تحميل المخزون")).toBeVisible();
    expect(screen.getByRole("link", { name: "ابدأ من الأول" })).toHaveAttribute("href", "/admin/inventory");
    expect(listInventoryVariants).not.toHaveBeenCalled();
  });
  it("preserves filters and operation context when a scoped read fails", async () => {
    vi.mocked(listInventoryVariants).mockRejectedValueOnce(new Error("Read failed"));
    render(await page({ search: "حليب", cursor: id(0) }));
    expect(screen.getByText("تعذّر تحميل المخزون")).toBeVisible();
    expect(screen.getByLabelText("بحث")).toHaveValue("حليب");
    const href = screen.getByRole("link", { name: "ابدأ من الأول بنفس الفلاتر" }).getAttribute("href")!;
    expect(href).not.toContain("cursor");
    expect(new URL(href, "http://localhost").searchParams.get("search")).toBe("حليب");
    expect(screen.getByText("إضافة كمية", { selector: ".adm-panel-title" })).toBeVisible();
  });
  it("keeps next navigation a stable read-only link", async () => {
    vi.mocked(listInventoryVariants).mockResolvedValue(Array.from({ length: 21 }, (_, i) => variant(i)));
    const first = render(await page());
    const href = screen.getByRole("link", { name: "الصفحة اللي بعد كده" }).getAttribute("href");
    first.unmount(); render(await page());
    expect(screen.getByRole("link", { name: "الصفحة اللي بعد كده" })).toHaveAttribute("href", href);
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it("names product and variant, shows actual GRAM unit, and has no fabricated loading state", async () => {
    const { container } = render(await page());
    const table = screen.getByRole("table", { name: "أرصدة المخزون لكل صنف في المتجر" });
    expect(within(table).getByRole("link", { name: "منتج 0" })).toHaveAttribute("href", `/admin/products/${id(100)}`);
    expect(within(table).getByRole("link", { name: "شكل 0" })).toHaveAttribute("href", `/admin/inventory/${id(0)}`);
    expect(within(table).getByText(id(0))).toBeVisible();
    expect(within(table).getByText("جم")).toBeVisible();
    expect(container.querySelector('[aria-busy="true"], .skeleton, .spinner')).toBeNull();
    expect(container.textContent).not.toContain("out_of_stock");
  });
  it("does not present absent inventory as zero or create an opening balance", async () => {
    const row = variant(); row.inventory = null;
    vi.mocked(listInventoryVariants).mockResolvedValue([row]);
    render(await page());
    const table = screen.getByRole("table", { name: "أرصدة المخزون لكل صنف في المتجر" });
    expect(within(table).getByText("الرصيد غير معروف")).toBeVisible();
    expect(within(table).queryByText("0")).toBeNull();
    expect(screen.queryByRole("button", { name: /رصيد افتتاحي/ })).toBeNull();
  });
  it("uses independent actual counts, not page length or summed units", async () => {
    render(await page());
    expect(screen.getByText("9")).toBeVisible();
    expect(screen.getByText("6")).toBeVisible();
    expect(screen.getByText(/وليست مجموع كميات/)).toBeVisible();
  });
  it("separates all four operations with honest explanatory notes", async () => {
    render(await page());
    for (const title of ["مراجعة الرصيد", "إضافة كمية", "تسوية الكمية", "حد التنبيه"]) {
      expect(screen.getByText(title, { selector: ".adm-panel-title" })).toBeVisible();
    }
    for (const note of [/العملية دي بتعرض الرصيد بس/, /بتزوّد الكمية المسجّلة/, /بتضبط الرصيد/, /بتحدد الرقم/]) {
      expect(screen.getByText(note)).toBeVisible();
    }
  });
  it("hides mutation controls and product links without their permissions", async () => {
    permissions(["inventory.view"]);
    render(await page());
    expect(screen.queryByRole("button", { name: "سجّل الإضافة" })).toBeNull();
    expect(screen.queryByRole("button", { name: "سجّل التسوية" })).toBeNull();
    expect(screen.queryByRole("button", { name: "سجّل حد التنبيه" })).toBeNull();
    expect(screen.queryByRole("link", { name: "منتج 0" })).toBeNull();
    expect(screen.getByRole("link", { name: "شكل 0" })).toBeVisible();
  });
  it("offers only manual movement types in Arabic", async () => {
    render(await page());
    for (const name of ["سجّل الإضافة", "سجّل التسوية", "سجّل حد التنبيه"]) expect(screen.getByRole("button", { name })).toBeVisible();
    const labels = screen.getAllByRole("radio").map(radio => radio.getAttribute("value"));
    expect(labels).toEqual(expect.arrayContaining(["STOCK_IN", "RETURN", "WASTE", "ADJUSTMENT"]));
    expect(labels).not.toEqual(expect.arrayContaining(["SALE", "REPLACEMENT", "CANCELLED_ORDER"]));
    expect(screen.queryByText("ADJUSTMENT")).toBeNull();
  });
  it("remounts uncontrolled filters after URL navigation", async () => {
    const result = render(await page({ search: "حليب" }));
    fireEvent.change(screen.getByLabelText("بحث"), { target: { value: "تعديل غير مرسل" } });
    result.rerender(await page({ search: "أرز" }));
    expect(screen.getByLabelText("بحث")).toHaveValue("أرز");
  });
  it("shows paginated movement units, source and before/after without exposing actor identifiers", async () => {
    vi.mocked(listMovements).mockResolvedValue(Array.from({ length: 21 }, (_, i) => ({
      id: id(i + 500), productVariantId: id(0), movementType: "STOCK_IN", quantity: dec("5"),
      previousQuantity: dec("3"), newQuantity: dec("8"), referenceType: "MANUAL", referenceId: id(700),
      reason: "توريد", createdBy: "private-actor-id", createdAt: new Date("2026-10-02T00:00:00Z"),
      variant: { id: id(0), name: "شكل 0", sizeUnit: "GRAM", product: { id: id(100), name: "منتج 0", productType: "WEIGHT" } },
    })) as unknown as Awaited<ReturnType<typeof listMovements>>);
    render(await page({ status: "history" }));
    expect(listInventoryVariants).not.toHaveBeenCalled();
    const table = screen.getByRole("table", { name: "حركات المخزون المسجلة" });
    const cells = within(within(table).getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("إضافة كمية للمخزون");
    expect(cells[3]).toHaveTextContent("جم");
    expect(cells[4]).toHaveTextContent("3"); expect(cells[5]).toHaveTextContent("8");
    expect(table.textContent).not.toContain("private-actor-id");
    expect(screen.getByRole("link", { name: "الصفحة اللي بعد كده" }).getAttribute("href")).toContain(id(519));
  });
});

describe("inventory detail and exact-decimal forms", () => {
  it("details a missing balance without adjustment forms", async () => {
    const row = variant(); row.inventory = null;
    vi.mocked(getInventoryVariant).mockResolvedValue(row);
    render(await detail());
    expect(screen.getByText("الرصيد مفقود أو غير معروف")).toBeVisible();
    expect(screen.getByText("لا يوجد رصيد مسجّل")).toBeVisible();
    expect(screen.queryByRole("button", { name: "سجّل التسوية" })).toBeNull();
    expect(screen.getByText(/12345/)).toBeVisible();
  });
  it("distinguishes a failed detail read from a nonexistent variant", async () => {
    vi.mocked(getInventoryVariant).mockRejectedValueOnce(new Error("unavailable"));
    render(await detail());
    expect(screen.getByText("تعذّر تحميل تفاصيل المخزون")).toBeVisible();
    vi.mocked(getInventoryVariant).mockResolvedValueOnce(null);
    await expect(detail()).rejects.toThrow("NOT_FOUND");
  });
  it("requires a reason and explicit confirmation, calculates an exact counted delta", async () => {
    const row = variant(); row.inventory!.quantity = dec("0.300") as never;
    render(<InventoryAdjustForm variants={inventoryFormOptions([row])} />);
    fireEvent.change(screen.getByLabelText(/الكمية اللي اتقادت بالعدّ/), { target: { value: "0.475" } });
    fireEvent.click(screen.getByRole("button", { name: "سجّل التسوية" }));
    expect(apiRequest).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/سبب التسوية/), { target: { value: "إعادة وزن" } });
    fireEvent.click(screen.getByRole("checkbox"));
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { movementId: "m" }, meta: {} });
    fireEvent.click(screen.getByRole("button", { name: "سجّل التسوية" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledOnce());
    expect(apiRequest).toHaveBeenCalledWith("/api/admin/inventory/adjustments", { method: "POST", body: expect.objectContaining({
      delta: "0.175", expectedQuantity: "0.300", reason: "إعادة وزن", confirmed: true, requestId: expect.any(String),
    }) });
  });
  it("retains the request key after uncertain failure and prevents simultaneous requests", async () => {
    render(<InventoryAddStockForm variants={inventoryFormOptions([variant()])} />);
    fireEvent.change(screen.getByLabelText(/الكمية اللي وصلت/), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("textbox", { name: "السبب" }), { target: { value: "توريد" } });
    fireEvent.click(screen.getByRole("checkbox"));
    let reject!: (error: Error) => void;
    vi.mocked(apiRequest).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const button = screen.getByRole("button", { name: "سجّل الإضافة" });
    fireEvent.click(button); fireEvent.click(button);
    expect(apiRequest).toHaveBeenCalledOnce();
    reject(new Error("network"));
    await screen.findByRole("alert");
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { movementId: "m" }, meta: {} });
    fireEvent.click(button);
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
    expect(vi.mocked(apiRequest).mock.calls[1][1]).toEqual(vi.mocked(apiRequest).mock.calls[0][1]);
  });
  it("clears confirmation when terms change and refuses malformed decimal values", () => {
    render(<InventoryAdjustForm variants={inventoryFormOptions([variant()])} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText(/الكمية اللي اتقادت بالعدّ/), { target: { value: "1.2345" } });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "سجّل التسوية" }));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
