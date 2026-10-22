// Phase-10 admin catalog-form contract tests (mocked fetch; no DB, no network).
//
// Covers the three new/changed operator surfaces:
//   1. ProductCreateForm  — POST /api/admin/catalog/products (products.create)
//   2. VariantCreateForm   — POST /api/admin/catalog/products/[id]/variants (products.create)
//   3. CouponPatchForm     — PATCH /api/admin/coupons/[id] (coupons.update / coupons.disable)
//
// The sale-model rule under test: a PIECE product is never offered a weight
// unit, and a WEIGHT product requires a positive integer sale step in grams
// (mirrors `assertProductWeightShape` in src/lib/catalog/writes.ts).

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/toast";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ProductCreateForm } from "../product-create-form";
import { VariantCreateForm } from "../variant-form";
import { CouponPatchForm } from "../coupon-patch-form";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("ProductCreateForm (POST /api/admin/catalog/products)", () => {
  const cats = [{ id: "c-1", name: "ألبان" }];
  const brands = [{ id: "b-1", name: "ماركة" }];

  it("requires a name and a category before any request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <ToastProvider>
        <ProductCreateForm categories={cats} brands={brands} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "إنشاء المنتج" }));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("offers ONLY the piece unit for a piece product", () => {
    render(
      <ToastProvider>
        <ProductCreateForm categories={cats} brands={brands} />
      </ToastProvider>,
    );
    const unit = screen.getByLabelText(/وحدة البيع/) as HTMLSelectElement;
    expect([...unit.options].map((o) => o.value)).toEqual(["PIECE"]);
  });

  it("offers weight units for a weight product and requires the sale step", () => {
    render(
      <ToastProvider>
        <ProductCreateForm categories={cats} brands={brands} />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText(/نموذج البيع/), { target: { value: "WEIGHT" } });
    const unit = screen.getByLabelText(/وحدة البيع/) as HTMLSelectElement;
    expect([...unit.options].map((o) => o.value)).toEqual(["KG", "GRAM"]);
    expect(screen.getByLabelText(/خطوة البيع/)).toBeInTheDocument();
  });

  it("sends the exact contract for a piece product (no sale step)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ data: { id: "p-1" }, meta: {} }, 201));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <ToastProvider>
        <ProductCreateForm categories={cats} brands={brands} />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText(/اسم المنتج/), { target: { value: "حليب" } });
    fireEvent.change(screen.getByLabelText(/التصنيف/), { target: { value: "c-1" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء المنتج" }));
    await screen.findByText("تم إنشاء المنتج.");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/catalog/products");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "حليب",
      categoryId: "c-1",
      productType: "PIECE",
      unit: "PIECE",
      isActive: true,
    });
  });

  it("sends the weight contract with a positive integer sale step", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ data: { id: "p-1" }, meta: {} }, 201));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <ToastProvider>
        <ProductCreateForm categories={cats} brands={brands} />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText(/اسم المنتج/), { target: { value: "أرز" } });
    fireEvent.change(screen.getByLabelText(/التصنيف/), { target: { value: "c-1" } });
    fireEvent.change(screen.getByLabelText(/نموذج البيع/), { target: { value: "WEIGHT" } });
    fireEvent.change(screen.getByLabelText(/خطوة البيع/), { target: { value: "250" } });
    fireEvent.change(screen.getByLabelText(/العلامة التجارية/), { target: { value: "b-1" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء المنتج" }));
    await screen.findByText("تم إنشاء المنتج.");
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      name: "أرز",
      categoryId: "c-1",
      brandId: "b-1",
      productType: "WEIGHT",
      unit: "KG",
      saleStepGrams: 250,
      isActive: true,
    });
  });

  it("refuses a weight product without a sale step before any request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <ToastProvider>
        <ProductCreateForm categories={cats} brands={brands} />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText(/اسم المنتج/), { target: { value: "أرز" } });
    fireEvent.change(screen.getByLabelText(/التصنيف/), { target: { value: "c-1" } });
    fireEvent.change(screen.getByLabelText(/نموذج البيع/), { target: { value: "WEIGHT" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء المنتج" }));
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
    fireEvent.click(screen.getByRole("button", { name: "إنشاء المتغير" }));
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
    fireEvent.change(screen.getByLabelText(/اسم المتغير/), { target: { value: "كيس 500 جرام" } });
    fireEvent.change(screen.getByLabelText(/سعر البيع/), { target: { value: "25.50" } });
    fireEvent.change(screen.getByLabelText(/حجم المتغير/), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText(/وحدة الحجم/), { target: { value: "GRAM" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء المتغير" }));
    await screen.findByText("تم إنشاء المتغير.");
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
    fireEvent.change(screen.getByLabelText(/اسم المتغير/), { target: { value: "كيس" } });
    fireEvent.change(screen.getByLabelText(/سعر البيع/), { target: { value: "25.00" } });
    fireEvent.change(screen.getByLabelText(/السعر قبل الخصم/), { target: { value: "10.00" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء المتغير" }));
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
    isActive: true,
  };

  it("omits isActive when the operator lacks coupons.disable", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ data: { id: "c-1" }, meta: {} }));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <ToastProvider>
        <CouponPatchForm {...base} canDisable={false} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "حفظ الكوبون" }));
    await screen.findByText("تم حفظ الكوبون.");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/coupons/c-1");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.isActive).toBeUndefined();
    expect(body.usageLimit).toBe(10);
    expect(screen.queryByText(/coupons\.disable/)).not.toBeNull();
  });

  it("sends isActive when the operator holds coupons.disable", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ data: { id: "c-1" }, meta: {} }));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <ToastProvider>
        <CouponPatchForm {...base} canDisable />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "نشط" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ الكوبون" }));
    await screen.findByText("تم حفظ الكوبون.");
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
    const limit = screen.getByLabelText(/حد الاستخدام/);
    fireEvent.change(limit, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الكوبون" }));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
