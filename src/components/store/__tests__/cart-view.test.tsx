// Phase 09 (P09-T02/§6) — cart page island tests:
// - the merge control probe reads the session INSIDE the ApiSuccess envelope
//   (D1 fix — logged-in customers were previously told to log in);
// - the real re-entrancy guard on writes (same-tick double click → one request);
// - draft quantities revert to the last CONFIRMED server text on rejection
//   (never pin an unconfirmed value);
// - an uncertain mutation outcome (timeout/transport) shows the honest message
//   and reconciles with ONE fresh read (never an automatic second write);
// - an unusable estimate response is never displayed with invented values.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  return {
    apiRequest: vi.fn(),
    token: vi.fn<() => string | null>(() => "a".repeat(64)),
    writeToken: vi.fn(),
    clearToken: vi.fn(),
  };
});

vi.mock("@/lib/frontend/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/frontend/api-client")>();
  return { ...actual, apiRequest: h.apiRequest };
});

vi.mock("@/components/store/guest-cart-token", () => ({
  readGuestCartToken: h.token,
  writeGuestCartToken: h.writeToken,
  clearGuestCartToken: h.clearToken,
}));

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppError } from "@/lib/frontend/api-client";
import { resetCartStore } from "@/lib/frontend/cart-lines-store";
import { CartView } from "@/components/store/cart-view";
import { ToastProvider } from "@/components/ui/toast";

function lineFixture(over: Partial<Record<string, string | null>> = {}) {
  return {
    productVariantId: "v-1",
    variantName: "عبوة 1 كجم",
    productName: "منتج",
    productType: "PIECE",
    quantity: "2",
    unitPriceSnapshot: "59.00",
    lineTotal: "118.00",
    ...over,
  };
}

function cartFixture(lines: Array<Record<string, unknown>>, subtotal = "118.00") {
  return { id: "c-1", status: "ACTIVE", guest: true, lines, subtotal };
}

describe("CartView (Phase 09)", () => {
  beforeEach(() => {
    resetCartStore();
  });

  afterEach(() => {
    cleanup();
    h.apiRequest.mockReset();
    h.clearToken.mockReset();
  });

  function mount() {
    return render(
      <ToastProvider>
        <CartView />
      </ToastProvider>,
    );
  }

  it("renders the confirmed line (variant + price text verbatim from the response)", async () => {
    h.apiRequest.mockImplementation(async (url: string) => {
      if (url === "/api/store/cart") {
        return { data: { cart: cartFixture([lineFixture()]) } };
      }
      throw new AppError("INTERNAL", `unexpected ${url}`);
    });
    mount();
    await waitFor(() => expect(screen.getByText("منتج")).toBeInTheDocument());
    expect(screen.getAllByText(/118\.00 ج\.م/).length).toBeGreaterThan(0);
  });

  it("D1: merge for a logged-in customer proceeds to POST /cart/merge (session read from data.customer)", async () => {
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart" && !init?.method) {
        return { data: { cart: cartFixture([lineFixture()]) } };
      }
      if (url === "/api/store/customers/session") {
        return { data: { customer: { id: "cjt-1" }, addresses: [] } };
      }
      if (url === "/api/store/cart/merge" && init?.method === "POST") {
        return { data: { cart: cartFixture([lineFixture({ quantity: "3" })], "177.00") } };
      }
      throw new AppError("INTERNAL", `unexpected ${url} ${init?.method ?? ""}`);
    });
    mount();
    await waitFor(() => expect(screen.getByText("منتج")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /دمج سلة الضيف/ }));
    await waitFor(() =>
      expect(screen.getByText(/تم دمج سلة الضيف في حسابك/)).toBeInTheDocument(),
    );
    const mergeCalls = h.apiRequest.mock.calls.filter((c) => c[0] === "/api/store/cart/merge");
    expect(mergeCalls).toHaveLength(1);
  });

  it("D1: without a session the merge never fires and says so", async () => {
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart" && !init?.method) {
        return { data: { cart: cartFixture([lineFixture()]) } };
      }
      if (url === "/api/store/customers/session") {
        return { data: {} }; // no customer (guest only)
      }
      throw new AppError("INTERNAL", `unexpected ${url} ${init?.method ?? ""}`);
    });
    mount();
    await waitFor(() => expect(screen.getByText("منتج")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /دمج سلة الضيف/ }));
    await waitFor(() => expect(screen.getByText(/سجّل الدخول أولًا لدمج/)).toBeInTheDocument());
    expect(h.apiRequest.mock.calls.filter((c) => c[0] === "/api/store/cart/merge")).toHaveLength(0);
  });

  it("D3: a same-tick double click on delete sends ONE delete request", async () => {
    let resolveDelete!: (v: unknown) => void;
    const pending = new Promise<unknown>((res) => {
      resolveDelete = res;
    });
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart" && !init?.method) {
        return { data: { cart: cartFixture([lineFixture()]) } };
      }
      if (url === "/api/store/cart/items/v-1" && init?.method === "DELETE") {
        return pending.then(() => ({ data: { cart: cartFixture([]), "0.00": undefined } as unknown }));
      }
      throw new AppError("INTERNAL", `unexpected ${url} ${init?.method ?? ""}`);
    });
    mount();
    await waitFor(() => expect(screen.getByText("منتج")).toBeInTheDocument());
    const btn = screen.getByRole("button", { name: "حذف" });
    fireEvent.click(btn);
    fireEvent.click(btn); // same tick — must be swallowed by the JS guard
    await new Promise((r) => setTimeout(r, 20));
    expect(h.apiRequest.mock.calls.filter((c) => c[0] === "/api/store/cart/items/v-1")).toHaveLength(1);
    resolveDelete({ data: { cart: cartFixture([]) } });
    await waitFor(() => expect(screen.getByText(/سلتك فاضية/)).toBeInTheDocument());
  });

  it("D4: a rejected quantity edit reverts the input to the confirmed server text", async () => {
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart" && !init?.method) {
        return { data: { cart: cartFixture([lineFixture()]) } };
      }
      if (url === "/api/store/cart/items/v-1" && init?.method === "PATCH") {
        throw new AppError("BUSINESS_RULE", "Weight quantity violates the sale step.");
      }
      throw new AppError("INTERNAL", `unexpected ${url} ${init?.method ?? ""}`);
    });
    mount();
    const input = (await screen.findByRole("textbox", { name: /الكمية لـمنتج/ })) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("2"));
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);
    await waitFor(() => {
      const el = screen.getByRole("textbox", { name: /الكمية لـمنتج/ }) as HTMLInputElement;
      expect(el.value).toBe("2"); // confirmed text; the rejected value is never pinned
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/sale step|violates|Weight/);
  });

  it("D4: quantity 0 is refused client-side with the contract wording (removal is DELETE)", async () => {
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart" && !init?.method) {
        return { data: { cart: cartFixture([lineFixture()]) } };
      }
      throw new AppError("INTERNAL", `unexpected ${url} ${init?.method ?? ""}`);
    });
    mount();
    const input = (await screen.findByRole("textbox", { name: /الكمية لـمنتج/ })) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("2"));
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/زر الحذف/));
    expect(screen.getByRole("textbox", { name: /الكمية لـمنتج/ })).toHaveValue("2");
    expect(h.apiRequest.mock.calls.filter((c) => c[0] === "/api/store/cart/items/v-1")).toHaveLength(0);
  });

  it("D2: an uncertain PATCH outcome shows the honest message and reconciles with ONE fresh read", async () => {
    let reconcileReads = 0;
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart" && !init?.method) {
        // Mount read answers qty 2; the post-failure reconcile read answers 7
        // (the operation HAD been applied before the connection dropped).
        reconcileReads += 1;
        const qty = reconcileReads > 1 ? "7" : "2";
        return { data: { cart: cartFixture([lineFixture({ quantity: qty })]) } };
      }
      if (url === "/api/store/cart/items/v-1" && init?.method === "PATCH") {
        throw new TypeError("offline"); // transport failure — outcome unknown
      }
      throw new AppError("INTERNAL", `unexpected ${url} ${init?.method ?? ""}`);
    });
    mount();
    await waitFor(() => expect(screen.getByText("منتج")).toBeInTheDocument());
    const input = screen.getByRole("textbox", { name: /الكمية لـمنتج/ }) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("2"));
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.blur(input);
    // No second PATCH was ever auto-sent; ONE reconcile read showed the truth.
    // (The transient «تعذّر التأكد» alert is asserted in the delayed-transport
    // e2e — unit asserts the honest final state: reconciled confirmed truth.)
    await waitFor(() => {
      const el = screen.getByRole("textbox", { name: /الكمية لـمنتج/ }) as HTMLInputElement;
      expect(el.value).toBe("7"); // reconciled confirmed truth
    });
    expect(h.apiRequest.mock.calls.filter((c) => c[0] === "/api/store/cart/items/v-1")).toHaveLength(1);
    expect(reconcileReads).toBe(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); // certainty restored
  });

  it("P09-C23: an unusable estimate response is never displayed with invented values", async () => {
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: unknown }) => {
      if (url === "/api/store/cart") {
        return { data: { cart: cartFixture([lineFixture()]) } };
      }
      if (url === "/api/store/orders/estimate" && init?.method === "POST") {
        return { data: { subtotal: "118.00", deliveryFee: "10.00", total: "118.00" } as unknown }; // discountTotal missing
      }
      throw new AppError("INTERNAL", `unexpected ${url}`);
    });
    mount();
    await waitFor(() => expect(screen.getByText("منتج")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("textbox", { name: "كود الكوبون" }), { target: { value: "X1" } });
    fireEvent.click(screen.getByRole("button", { name: "تطبيق" }));
    await waitFor(() =>
      expect(screen.getByText(/استجابة تقدير غير صالحة من الخادم/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/الإجمالي التقديري/)).not.toBeInTheDocument();
  });

  it("P09-C24/C25: the estimate block only shows what the response carried (no invented fees/discounts)", async () => {
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: unknown }) => {
      if (url === "/api/store/cart") {
        return { data: { cart: cartFixture([lineFixture()]) } };
      }
      if (url === "/api/store/orders/estimate" && init?.method === "POST") {
        return {
          data: {
            subtotal: "118.00",
            discountTotal: "0.00",
            deliveryFee: "10.00",
            total: "128.00",
            coupon: { code: "X1", applicable: false, reason: "Coupon minimum order amount not reached.", amount: "0.00" },
          },
        };
      }
      throw new AppError("INTERNAL", `unexpected ${url}`);
    });
    mount();
    await waitFor(() => expect(screen.getByText("منتج")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "تطبيق" }));
    await waitFor(() => {
      const discountRow = screen.getByText((_, el) => el?.tagName === "P" && (el.textContent ?? "").startsWith("الخصم: 0.00"));
      const feeRow = screen.getByText((_, el) => el?.tagName === "P" && (el.textContent ?? "").startsWith("التوصيل: 10.00"));
      expect(discountRow).toBeInTheDocument();
      expect(feeRow).toBeInTheDocument();
    });
    // The cart-subtotal label stays informational and non-final.
    expect(screen.getByText(/المجموع الاسترشادي \(غير نهائي\)/)).toBeInTheDocument();
  });

  it("P12-02: exposes per-line mutation state and pulses subtotal on confirmed total update", async () => {
    let resolveDelete: ((v: unknown) => void) | null = null;
    h.apiRequest.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart") {
        return Promise.resolve({ data: { cart: cartFixture([lineFixture(), lineFixture({ productVariantId: "v-2", productName: "منتج 2", lineTotal: "50.00" })], "168.00") } });
      }
      if (url === "/api/store/cart/items/v-1" && init?.method === "DELETE") {
        return new Promise((r) => { resolveDelete = r; });
      }
      return Promise.reject(new AppError("INTERNAL", `unexpected ${url}`));
    });
    mount();
    await waitFor(() => expect(screen.getByText("منتج")).toBeInTheDocument());
    const item = screen.getByText("منتج").closest("li") as HTMLElement;
    expect(item).toHaveAttribute("data-line-state", "idle");

    const removeButtons = screen.getAllByRole("button", { name: "حذف" });
    fireEvent.click(removeButtons[0]);
    expect(item).toHaveAttribute("data-line-state", "remove");

    resolveDelete!({ data: { cart: cartFixture([lineFixture({ productVariantId: "v-2", productName: "منتج 2", lineTotal: "50.00" })], "50.00") } });
    await waitFor(() => {
      const subtotalEl = document.querySelector("[data-subtotal-pulse]");
      expect(subtotalEl).toHaveAttribute("data-subtotal-pulse", "true");
    });
  });
});
