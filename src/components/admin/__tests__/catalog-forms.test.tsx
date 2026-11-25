// Admin catalog-form contract tests (mocked fetch; no DB, no network).
//
// Covers the operator surfaces:
//   1. ProductCreateForm — the four separated panels, POST /api/admin/catalog/products
//      then POST .../variants then POST /api/admin/catalog/codes (products.create)
//   2. ProductEditForm   — full PATCH /api/admin/catalog/products/[id] (GD-2/BL-02 contract)
//   3. VariantCreateForm — POST /api/admin/catalog/products/[id]/variants (products.create)
//   4. CouponPatchForm   — PATCH /api/admin/coupons/[id] (coupons.update / coupons.disable)
//
// The sale-model rule under test: a PIECE product is never offered a weight
// unit, and a WEIGHT product requires a positive integer sale step in grams
// (mirrors `assertProductWeightShape` in src/lib/catalog/writes.ts).
//
// The operator never reads a machine token: the assertions check the Arabic
// labels that replace them.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/toast";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ProductCreateForm } from "../product-create-form";
import { ProductEditForm } from "../product-edit-form";
import { VariantCreateForm } from "../variant-form";
import { CouponPatchForm } from "../coupon-patch-form";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("ProductCreateForm — separated panels (POST /api/admin/catalog/products)", () => {
  const cats = [{ id: "c-1", name: "ألبان" }];
  const brands = [{ id: "b-1", name: "ماركة" }];

  function renderForm() {
    return render(
      <ToastProvider>
        <ProductCreateForm categories={cats} brands={brands} />
      </ToastProvider>,
    );
  }

  it("shows the four panels in the order the operator fills them", () => {
    renderForm();
    expect(screen.getByText("بيانات المنتج الأساسية")).toBeVisible();
    expect(screen.getByText("التصنيف والعلامة التجارية")).toBeVisible();
    expect(screen.getByText("طريقة البيع والوحدة")).toBeVisible();
    expect(screen.getByText("أول شكل للبيع")).toBeVisible();
    expect(screen.getByLabelText(/اسم المنتج/)).toBeVisible();
  });

  it("blocks an empty name before any request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "احفظ المنتج" }));
    // Every empty field speaks up in its own line; the name is the first one.
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((node) => node.textContent?.includes("اكتب اسم المنتج"))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("names the piece unit in Arabic and never shows the machine token", () => {
    renderForm();
    expect(screen.getByText(/وحدة البيع/)).toHaveTextContent("قطعة");
    expect(document.body.textContent).not.toContain("PIECE");
    expect(screen.queryByLabelText(/وحدة البيع/)).toBeNull();
  });

  it("offers weight units for a weight product and requires the sale step", () => {
    renderForm();
    fireEvent.click(screen.getByLabelText(/بالوزن/));
    const unit = screen.getByLabelText(/وحدة البيع/) as HTMLSelectElement;
    expect([...unit.options].map((o) => o.value)).toEqual(["KG", "GRAM"]);
    expect([...unit.options].map((o) => o.textContent)).toEqual(["كجم", "جم"]);
    expect(screen.getByLabelText(/خطوة البيع/)).toBeInTheDocument();
  });

  it("refuses a weight product without a sale step before any request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderForm();
    fireEvent.change(screen.getByLabelText(/اسم المنتج/), { target: { value: "أرز" } });
    fireEvent.click(screen.getByLabelText(/بالوزن/));
    fireEvent.change(screen.getByLabelText(/خطوة البيع/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "احفظ المنتج" }));
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((node) => node.textContent?.includes("اكتب خطوة البيع"))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the exact piece contract, then the first shape and its barcode", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: "p-1" }, meta: {} }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "v-1" }, meta: {} }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "code-1" }, meta: {} }, 201));
    vi.stubGlobal("fetch", fetchSpy);
    renderForm();
    fireEvent.change(screen.getByLabelText(/اسم المنتج/), { target: { value: "حليب" } });
    fireEvent.change(screen.getByLabelText(/التصنيف/), { target: { value: "c-1" } });
    fireEvent.change(screen.getByLabelText(/اسم الشكل/), { target: { value: "كيس 500 جرام" } });
    fireEvent.change(screen.getByLabelText(/سعر البيع/), { target: { value: "25.50" } });
    fireEvent.change(screen.getByLabelText(/باركود الشكل/), { target: { value: "6221031492019" } });
    fireEvent.click(screen.getByRole("button", { name: "احفظ المنتج" }));

    await screen.findByText("تم إنشاء المنتج وأول شكل للبيع.");
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const [productUrl, productInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(productUrl).toBe("/api/admin/catalog/products");
    expect(productInit.method).toBe("POST");
    expect(JSON.parse(productInit.body as string)).toEqual({
      name: "حليب",
      categoryId: "c-1",
      productType: "PIECE",
      unit: "PIECE",
      isActive: true,
    });

    const [variantUrl, variantInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(variantUrl).toBe("/api/admin/catalog/products/p-1/variants");
    expect(variantInit.method).toBe("POST");
    expect(JSON.parse(variantInit.body as string)).toEqual({
      name: "كيس 500 جرام",
      price: "25.50",
      isActive: true,
    });

    const [codeUrl, codeInit] = fetchSpy.mock.calls[2] as [string, RequestInit];
    expect(codeUrl).toBe("/api/admin/catalog/codes");
    expect(codeInit.method).toBe("POST");
    expect(JSON.parse(codeInit.body as string)).toEqual({
      productVariantId: "v-1",
      code: "6221031492019",
      type: "BARCODE",
      isPrimary: true,
    });
  });

  it("sends the weight contract with a positive integer sale step", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: "p-1" }, meta: {} }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "v-1" }, meta: {} }, 201));
    vi.stubGlobal("fetch", fetchSpy);
    renderForm();
    fireEvent.change(screen.getByLabelText(/اسم المنتج/), { target: { value: "أرز" } });
    fireEvent.change(screen.getByLabelText(/التصنيف/), { target: { value: "c-1" } });
    fireEvent.change(screen.getByLabelText(/العلامة التجارية/), { target: { value: "b-1" } });
    fireEvent.click(screen.getByLabelText(/بالوزن/));
    fireEvent.change(screen.getByLabelText(/خطوة البيع/), { target: { value: "250" } });
    fireEvent.change(screen.getByLabelText(/اسم الشكل/), { target: { value: "كيلو" } });
    fireEvent.change(screen.getByLabelText(/سعر البيع/), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "احفظ المنتج" }));

    await screen.findByText("تم إنشاء المنتج وأول شكل للبيع.");
    const [, productInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(productInit.body as string)).toEqual({
      name: "أرز",
      categoryId: "c-1",
      brandId: "b-1",
      productType: "WEIGHT",
      unit: "KG",
      saleStepGrams: 250,
      isActive: true,
    });
  });

  it("surfaces a rejected create as an Arabic alert without a fake success", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: "CONFLICT", message: "duplicate", details: null } }, 409),
    );
    vi.stubGlobal("fetch", fetchSpy);
    renderForm();
    fireEvent.change(screen.getByLabelText(/اسم المنتج/), { target: { value: "حليب" } });
    fireEvent.change(screen.getByLabelText(/التصنيف/), { target: { value: "c-1" } });
    fireEvent.change(screen.getByLabelText(/اسم الشكل/), { target: { value: "عبوة" } });
    fireEvent.change(screen.getByLabelText(/سعر البيع/), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "احفظ المنتج" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("فيه حد تاني عدّل نفس الحاجة");
    expect(alert.textContent).not.toContain("duplicate");
  });
});

describe("ProductEditForm (full PATCH /api/admin/catalog/products/[id])", () => {
  const cats = [
    { id: "c-1", name: "ألبان" },
    { id: "c-2", name: "منظفات" },
  ];
  const brands = [{ id: "b-1", name: "جهينة" }];

  function renderEdit(overrides?: Partial<Parameters<typeof ProductEditForm>[0]["product"]>) {
    return render(
      <ToastProvider>
        <ProductEditForm
          productId="p-1"
          product={{
            name: "حليب",
            description: "حليب كامل الدسم",
            isActive: true,
            categoryId: "c-1",
            brandId: null,
            productType: "PIECE",
            unit: "PIECE",
            saleStepGrams: null,
            ...overrides,
          }}
          categories={cats}
          brands={brands}
        />
      </ToastProvider>,
    );
  }

  it("sends the exact expanded PATCH contract (GD-2/BL-02) on rename + recategorize", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ data: { id: "p-1" }, meta: {} }));
    vi.stubGlobal("fetch", fetchSpy);
    renderEdit();
    fireEvent.change(screen.getByLabelText(/اسم المنتج/), { target: { value: "حليب جهينة" } });
    fireEvent.change(screen.getByLabelText(/التصنيف/), { target: { value: "c-2" } });
    fireEvent.click(screen.getByRole("button", { name: "احفظ التعديلات" }));
    await screen.findByText("تم حفظ التعديلات.");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/catalog/products/p-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "حليب جهينة",
      description: "حليب كامل الدسم",
      isActive: true,
      categoryId: "c-2",
      brandId: null,
      productType: "PIECE",
      unit: "PIECE",
      saleStepGrams: null,
    });
  });

  it("refuses an empty name before any request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderEdit();
    fireEvent.change(screen.getByLabelText(/اسم المنتج/), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "احفظ التعديلات" }));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("warns when the sale model changes and sends the weight shape", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ data: { id: "p-1" }, meta: {} }));
    vi.stubGlobal("fetch", fetchSpy);
    renderEdit();
    fireEvent.click(screen.getByLabelText(/بالوزن/));
    expect(screen.getByRole("status")).toBeVisible();
    fireEvent.change(screen.getByLabelText(/خطوة البيع/), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "احفظ التعديلات" }));
    await screen.findByText("تم حفظ التعديلات.");
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      productType: "WEIGHT",
      unit: "KG",
      saleStepGrams: 500,
    });
  });

  it("refuses a weight product without a sale step before any request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderEdit();
    fireEvent.click(screen.getByLabelText(/بالوزن/));
    fireEvent.change(screen.getByLabelText(/خطوة البيع/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "احفظ التعديلات" }));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("VariantCreateForm (POST /api/admin/catalog/products/[id]/variants)", () => {
  it("blocks an empty name before any request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <ToastProvider>
        <VariantCreateForm productId="p-1" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "أضف الشكل" }));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the exact create contract", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ data: { id: "v-1" }, meta: {} }, 201));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <ToastProvider>
        <VariantCreateForm productId="p-1" />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText(/اسم الشكل/), { target: { value: "كيس 500 جرام" } });
    fireEvent.change(screen.getByLabelText(/سعر البيع/), { target: { value: "25.50" } });
    fireEvent.change(screen.getByLabelText(/حجم الشكل/), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText(/وحدة الحجم/), { target: { value: "GRAM" } });
    fireEvent.click(screen.getByRole("button", { name: "أضف الشكل" }));
    await screen.findByText("تم إنشاء الشكل.");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/catalog/products/p-1/variants");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "كيس 500 جرام",
      sizeValue: "500",
      sizeUnit: "GRAM",
      price: "25.50",
      isActive: true,
    });
  });

  it("refuses a compare-at price below the selling price before any request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <ToastProvider>
        <VariantCreateForm productId="p-1" />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText(/اسم الشكل/), { target: { value: "كيس" } });
    fireEvent.change(screen.getByLabelText(/سعر البيع/), { target: { value: "25.00" } });
    fireEvent.change(screen.getByLabelText(/السعر قبل الخصم/), { target: { value: "10.00" } });
    fireEvent.click(screen.getByRole("button", { name: "أضف الشكل" }));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("CouponPatchForm (PATCH /api/admin/coupons/[id])", () => {
  const base = {
    id: "c-1",
    usageLimit: 10,
    perCustomerLimit: 1,
    minimumOrderAmount: "50.00",
    startAt: null,
    endAt: null,
    isActive: true,
  };

  it("omits isActive when the operator lacks the stop capability", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ data: { id: "c-1" }, meta: {} }));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <ToastProvider>
        <CouponPatchForm {...base} canDisable={false} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديلات" }));
    await screen.findByText("اتحفظت التعديلات على الكود.");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/coupons/c-1");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.isActive).toBeUndefined();
    expect(body.usageLimit).toBe(10);
    expect(screen.getByText(/إيقاف وحذف أكواد الخصم/)).toBeVisible();
    expect(screen.queryByText(/coupons\.disable/)).toBeNull();
  });

  it("sends isActive when the operator holds the stop capability", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ data: { id: "c-1" }, meta: {} }));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <ToastProvider>
        <CouponPatchForm {...base} canDisable />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("radio", { name: /موقوف/ }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديلات" }));
    await screen.findByText("اتحفظت التعديلات على الكود.");
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.isActive).toBe(false);
  });

  it("rejects a non-positive usage limit before any request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <ToastProvider>
        <CouponPatchForm {...base} canDisable={false} />
      </ToastProvider>,
    );
    const limit = screen.getByLabelText(/الحد الأقصى للاستخدام/);
    fireEvent.change(limit, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديلات" }));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
