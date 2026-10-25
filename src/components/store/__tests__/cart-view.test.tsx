// FE-5 cart-view tests with mocked fetch (no backend writes; contract mapping only).
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CartView } from "../cart-view";
import { ToastProvider } from "@/components/ui/toast";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CART = {
  id: "cart-1",
  status: "ACTIVE",
  guest: true,
  lines: [
    {
      productVariantId: "11111111-1111-4111-8111-111111111111",
      variantName: "كيس",
      productName: "أرز",
      productType: "PIECE",
      quantity: "2",
      unitSnapshot: "PIECE",
      unitPriceSnapshot: "320.00",
      lineTotal: "640.00",
    },
  ],
  subtotal: "640.00",
};

function renderCart() {
  return render(
    <ToastProvider>
      <CartView />
    </ToastProvider>,
  );
}

describe("cart-view", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("renders lines and informational subtotal from the echo (no local math)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: { cart: CART }, meta: {} })));
    renderCart();
    expect(await screen.findByText("أرز")).toBeInTheDocument();
    // Line total + informational subtotal coincide on a single-line cart (server echo, twice shown).
    expect(screen.getAllByText("640.00 ج.م").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/^الإجمالي النهائي/)).not.toBeInTheDocument();
  });

  it("shows honest empty for zero lines", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ data: { cart: { ...CART, lines: [], subtotal: "0.00" } }, meta: {} })),
    );
    renderCart();
    expect(await screen.findByText("سلتك فاضية")).toBeInTheDocument();
  });

  it("expired cart offers a fresh mint path plus browsing alternatives (NAV-03)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { code: "NOT_FOUND", message: "x", details: null } }, 404)));
    renderCart();
    expect(await screen.findByText("ابدأ سلة جديدة")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "سلة جديدة" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "تصفّح الأقسام" }).getAttribute("href")).toBe("/categories");
    expect(screen.getByRole("link", { name: "ابحث عن منتج" }).getAttribute("href")).toBe("/search");
  });

  it("set-quantity PATCHes the variant line and adopts the echo", async () => {
    const spy = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { cart: CART }, meta: {} }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { cart: { ...CART, lines: [{ ...CART.lines[0], quantity: "3" }] } }, meta: {} }),
      );
    vi.stubGlobal("fetch", spy);
    renderCart();
    const input = (await screen.findByLabelText(/الكمية لـ/)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.blur(input);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const [, init] = spy.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ quantity: "3" });
  });

  it("coupon refusal surfaces the server reason without claiming applied", async () => {
    const spy = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { cart: CART }, meta: {} }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: { subtotal: "640.00", discountTotal: "0.00", deliveryFee: "20.00", total: "660.00", coupon: { code: "X", applicable: false, reason: "سبب تجريبي.", amount: "0.00" } },
          meta: {},
        }),
      );
    vi.stubGlobal("fetch", spy);
    renderCart();
    await screen.findByText("أرز");
    fireEvent.change(screen.getByLabelText("كود الكوبون"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "تطبيق" }));
    expect(await screen.findByText("سبب تجريبي.")).toBeInTheDocument();
    expect(screen.queryByText("تم تطبيق الكوبون.")).not.toBeInTheDocument();
  });

  it("never sends order credentials on cart calls", async () => {
    window.localStorage.setItem("hyper_cart_guest_token", "a".repeat(64));
    const spy = vi.fn().mockResolvedValue(jsonResponse({ data: { cart: CART }, meta: {} }));
    vi.stubGlobal("fetch", spy);
    renderCart();
    await screen.findByText("أرز");
    const sent = JSON.stringify(spy.mock.calls.map((c) => c[1]));
    expect(sent).not.toMatch(/guest-order-token|x-guest-order-token/);
  });

  it("offers the checkout and the catalogue once the cart has lines (Phase-11)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: { cart: CART }, meta: {} })));
    renderCart();
    await screen.findByText("أرز");
    const checkout = screen.getByRole("link", { name: "متابعة الشراء" });
    expect(checkout.getAttribute("href")).toBe("/checkout");
    expect(screen.getByRole("link", { name: "متابعة التسوق" }).getAttribute("href")).toBe("/categories");
  });

  it("carries the coupon code into the checkout link (Phase-11)", async () => {
    const spy = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { cart: CART }, meta: {} }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            subtotal: "640.00",
            discountTotal: "20.00",
            deliveryFee: "20.00",
            total: "640.00",
            coupon: { code: "SAVE10", applicable: true, reason: null, amount: "20.00" },
          },
          meta: {},
        }),
      );
    vi.stubGlobal("fetch", spy);
    renderCart();
    await screen.findByText("أرز");
    fireEvent.change(screen.getByLabelText("كود الكوبون"), { target: { value: "SAVE10" } });
    fireEvent.click(screen.getByRole("button", { name: "تطبيق" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const href = screen.getByRole("link", { name: "متابعة الشراء" }).getAttribute("href");
    expect(href).toBe("/checkout?coupon=SAVE10");
  });

  it("offers a way back when the cart is empty (Phase-11)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ data: { cart: { ...CART, lines: [], subtotal: "0.00" } }, meta: {} })),
    );
    renderCart();
    expect(await screen.findByText("سلتك فاضية")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "تصفّح الأقسام" }).getAttribute("href")).toBe("/categories");
    expect(screen.getByRole("link", { name: "ابحث عن منتج" }).getAttribute("href")).toBe("/search");
  });
});
