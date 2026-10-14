// FE-4 purchase-panel tests with mocked fetch (contract mapping, not live proof).
// Live add-to-cart against real data is NOT executed here (no fixtures; writes forbidden).
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PurchasePanel } from "../purchase-panel";
import { ToastProvider } from "@/components/ui/toast";
import type { ProductPageData, ProductPageVariant } from "@/lib/frontend/storefront-reads";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PIECE_VARIANT: ProductPageVariant = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "كيس 5 كجم",
  sizeValue: null,
  sizeUnit: "PIECE",
  price: "320.00",
  compareAt: null,
  stock: "in" as const,
};

const WEIGHT_VARIANT: ProductPageVariant = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "رومي",
  sizeValue: null,
  sizeUnit: "KG",
  price: "320.00",
  compareAt: null,
  stock: "in" as const,
};

function productWith(variants: typeof PIECE_VARIANT[], type: "PIECE" | "WEIGHT"): ProductPageData {
  return {
    id: "p",
    name: "منتج اختبار",
    slug: "s",
    description: null,
    brandName: null,
    categoryName: "قسم",
    productType: type,
    saleStepGrams: type === "WEIGHT" ? 250 : null,
    gallery: [],
    variants,
  };
}

function renderPanel(product: ProductPageData) {
  return render(
    <ToastProvider>
      <PurchasePanel product={product} />
    </ToastProvider>,
  );
}

describe("purchase-panel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("posts variant id + whole-pack qty with stored guest token", async () => {
    window.localStorage.setItem(
      "hyper_cart_guest_token",
      "a".repeat(64),
    );
    const spy = vi.fn().mockResolvedValue(jsonResponse({ data: { cart: {} }, meta: {} }));
    vi.stubGlobal("fetch", spy);
    renderPanel(productWith([PIECE_VARIANT], "PIECE"));
    fireEvent.change(screen.getByLabelText(/الكمية/), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "أضف إلى السلة" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/store/cart/items");
    expect(JSON.parse(init.body as string)).toEqual({
      productVariantId: PIECE_VARIANT.id,
      quantity: "2",
    });
    expect((init.headers as Record<string, string>)["x-guest-token"]).toBe("a".repeat(64));
    expect(await screen.findByText("تمت الإضافة إلى السلة.")).toBeInTheDocument();
  });

  it("mints once then retries when identity is absent (no order credential used)", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (url === "/api/store/cart/items" && calls.filter((c) => c.url === url).length === 1) {
          return Promise.resolve(
            jsonResponse(
              { error: { code: "VALIDATION", message: "Exactly one of guest token sessions.", details: null } },
              400,
            ),
          );
        }
        if (url === "/api/store/cart") {
          return Promise.resolve(jsonResponse({ data: { cart: {}, guestToken: "b".repeat(64) }, meta: {} }, 201));
        }
        return Promise.resolve(jsonResponse({ data: { cart: {} }, meta: {} }));
      }),
    );
    renderPanel(productWith([PIECE_VARIANT], "PIECE"));
    fireEvent.click(screen.getByRole("button", { name: "أضف إلى السلة" }));
    await waitFor(() => expect(calls.filter((c) => c.url === "/api/store/cart/items")).toHaveLength(2));
    const mint = calls.find((c) => c.url === "/api/store/cart");
    expect(mint).toBeDefined();
    const bodies = JSON.stringify(calls.map((c) => c.init?.body ?? null));
    expect(bodies).not.toMatch(/guest-order-token|x-guest-order-token/);
    expect(window.localStorage.getItem("hyper_cart_guest_token")).toBe("b".repeat(64));
    expect(await screen.findByText("تمت الإضافة إلى السلة.")).toBeInTheDocument();
  });

  it("surfaces server rejection without success feedback and keeps selection", async () => {
    window.localStorage.setItem("hyper_cart_guest_token", "c".repeat(64));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: "CONFLICT", message: "تعارض مخزون.", details: null } }, 409),
      ),
    );
    renderPanel(productWith([PIECE_VARIANT], "PIECE"));
    fireEvent.click(screen.getByRole("button", { name: "أضف إلى السلة" }));
    expect(await screen.findByText("تعارض مخزون.")).toBeInTheDocument();
    expect(screen.queryByText("تمت الإضافة إلى السلة.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "أضف إلى السلة" })).toBeInTheDocument();
  });

  it("blocks OOS variants pre-send (zero requests)", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    renderPanel(productWith([{ ...PIECE_VARIANT, stock: "oos" as const }], "PIECE"));
    expect(screen.getByRole("button", { name: "غير متوفر" })).toBeDisabled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects off-step weights pre-send with reason", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    renderPanel(productWith([WEIGHT_VARIANT], "WEIGHT"));
    fireEvent.change(screen.getByLabelText("وزن مخصص بالجرام"), { target: { value: "137" } });
    fireEvent.click(screen.getByRole("button", { name: "أضف إلى السلة" }));
    expect(await screen.findByText(/خطوة البيع/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("single-flights rapid double taps (one request)", async () => {
    window.localStorage.setItem("hyper_cart_guest_token", "d".repeat(64));
    let resolveIt: (v: Response) => void = () => undefined;
    const gate = new Promise<Response>((r) => {
      resolveIt = r;
    });
    const spy = vi.fn().mockReturnValue(gate);
    vi.stubGlobal("fetch", spy);
    renderPanel(productWith([PIECE_VARIANT], "PIECE"));
    const btn = screen.getByRole("button", { name: "أضف إلى السلة" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    resolveIt(jsonResponse({ data: { cart: {} }, meta: {} }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  });
});
