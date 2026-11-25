import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// D01/D14 (FE-11.2 card add island, AC-P3 owner-approved): click resolves the
// variant, POSTs one pack, and the confirmed indicator comes from the cart
// response — never optimistic math.
// Phase 07 extension: the island is now BOUND to the shared cart-lines store —
// mount probe fan-in, IN-CART stepper (+/− per contract), per-line duplicate
// guard, and confirmation only from the server text. The existing approved
// add-flow tests above stay verbatim.

const h = vi.hoisted(() => {
  return {
    apiRequest: vi.fn(),
    token: vi.fn<() => string | null>(() => "tok-1"),
    notify: vi.fn(),
  };
});

vi.mock("@/lib/frontend/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/frontend/api-client")>();
  return { ...actual, apiRequest: h.apiRequest };
});

vi.mock("@/components/store/guest-cart-token", () => ({
  readGuestCartToken: h.token,
  writeGuestCartToken: vi.fn(),
  clearGuestCartToken: vi.fn(),
}));

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppError } from "@/lib/frontend/api-client";
import { publishCartSnapshot, resetCartStore } from "@/lib/frontend/cart-lines-store";
import { CardBuy } from "@/components/store/card-buy";

function cartOf(lines: Array<Record<string, unknown>>) {
  return { lines };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("card-buy (D01/D14 approved card add)", () => {
  beforeEach(() => {
    // The store is a module singleton: each test starts from a clean confirmed space.
    resetCartStore();
  });

  afterEach(() => {
    cleanup();
    h.apiRequest.mockReset();
  });

  it("resolves the variant on click and shows the line from the confirmed cart", async () => {
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string; body?: unknown }) => {
      if (url === "/api/store/catalog/products/p-1/variants" && init?.method === undefined) {
        return { data: [{ id: "v-1" }, { id: "v-2" }] };
      }
      if (url === "/api/store/cart/items" && init?.method === "POST") {
        expect(init.body).toMatchObject({ productVariantId: "v-1", quantity: "1" });
        expect((init.body as Record<string, unknown>).quantity).toBe("1");
        return {
          data: {
            cart: {
              lines: [
                {
                  productVariantId: "v-1",
                  variantName: "عبوة 1 كجم",
                  quantity: "1",
                  lineTotal: "59.00",
                },
              ],
            },
          },
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    render(<CardBuy productId="p-1" />);
    const btn = screen.getByRole("button", { name: /أضف إلى السلة/ });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText(/في السلة:/)).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(/في السلة: عبوة 1 كجم × 1/);
    expect(screen.getByRole("status")).toHaveTextContent(/59\.00 ج\.م/);
  });

  it("mint-once-then-retry: a guest-token validation error retries after minting", async () => {
    h.token.mockReturnValue(null);
    const { AppError } = await import("@/lib/frontend/api-client");
    let minted = false;
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart" && init?.method === "POST") {
        minted = true;
        // NOTE: the guest mint token is delivered INSIDE the response data payload.
        return { data: { cart: {}, guestToken: "mint-1" }, guestToken: "mint-1" };
      }
      if (url === "/api/store/catalog/products/p-1/variants") {
        return { data: [{ id: "v-1" }] };
      }
      if (url === "/api/store/cart/items") {
        if (!minted) {
          throw new AppError("VALIDATION", "-- Exactly one of guest token or session/");
        }
        return {
          data: { cart: { lines: [{ productVariantId: "v-1", variantName: "ل", quantity: "1", lineTotal: null }] } },
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    render(<CardBuy productId="p-1" />);
    fireEvent.click(screen.getByRole("button", { name: /أضف إلى السلة/ }));
    await waitFor(() => expect(screen.getByText(/في السلة:/)).toBeInTheDocument());
    expect(minted).toBe(true);
  });

  it("reports failure honestly when the variants read or the add fails", async () => {
    h.apiRequest.mockImplementation(async (url: string) => {
      if (url === "/api/store/catalog/products/p-1/variants") {
        return { data: [] }; // no variants at all
      }
      throw new Error(`unexpected ${url}`);
    });
    render(<CardBuy productId="p-1" slug="aruz-basmati" />);
    fireEvent.click(screen.getByRole("button", { name: /أضف إلى السلة/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/لا توجد اختيارات متاحة/);
    expect(screen.getByRole("link", { name: "صفحة التفاصيل" }).getAttribute("href")).toBe("/p/p-1/aruz-basmati");
  });
});

describe("card-buy Phase 07 (store-bound island: stepper, rapid tap, failure truth)", () => {
  beforeEach(() => {
    resetCartStore();
  });

  afterEach(() => {
    cleanup();
    h.apiRequest.mockReset();
  });

  it("rapid double-tap on the add button sends ONE variants read and ONE add request", async () => {
    const dPost = deferred<unknown>(); // the add stays inflight past both taps
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/catalog/products/p-1/variants" && !init?.method) {
        return { data: [{ id: "v-1" }] };
      }
      if (url === "/api/store/cart/items" && init?.method === "POST") return dPost.promise;
      throw new Error(`unexpected ${url}`);
    });
    render(<CardBuy productId="p-1" />);
    const btn = screen.getByRole("button", { name: /أضف إلى السلة/ });
    fireEvent.click(btn);
    fireEvent.click(btn); // while first is inflight — must be swallowed
    await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());
    await new Promise((r) => setTimeout(r, 10));
    const itemsCalls = h.apiRequest.mock.calls.filter((c) => c[0] === "/api/store/cart/items").length;
    const variantCalls = h.apiRequest.mock.calls.filter((c) =>
      c[0] === "/api/store/catalog/products/p-1/variants",
    ).length;
    // Settle before leaving: the op must not hang inflight into other tests.
    await act(async () => {
      dPost.resolve({ data: { cart: cartOf([{ ...cartLineFixture(), quantity: "1" }]) } });
      await dPost.promise;
    });
    expect(itemsCalls).toBe(1);
    expect(variantCalls).toBe(1);
  });

  it("IN CART: the stepper shows the server quantity; + aggregates, − steps, − at 1 removes via DELETE", async () => {
    // Confirmed store snapshot proves the product already has one line (qty 2).
    publishCartSnapshot(cartOf([cartLineFixture() /* quantity "2" */]));
    const patchBodies: Array<string> = [];
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string; body?: unknown }) => {
      if (url === "/api/store/cart/items" && init?.method === "POST") {
        return { data: { cart: cartOf([{ ...cartLineFixture(), quantity: "3" }]) } };
      }
      if (url === "/api/store/cart/items/v-9" && init?.method === "PATCH") {
        const requested = (init.body as { quantity: string }).quantity;
        patchBodies.push(requested);
        return { data: { cart: cartOf([{ ...cartLineFixture(), quantity: requested }]) } };
      }
      if (url === "/api/store/cart/items/v-9" && init?.method === "DELETE") {
        return { data: { cart: cartOf([]) } };
      }
      throw new Error(`unexpected ${url} ${init?.method ?? ""}`);
    });
    render(<CardBuy productId="p-1" />);

    // Stepper controls with accessible names; the value is the SERVER text.
    const plus = screen.getByRole("button", { name: "زيادة الكمية" });
    const minus = screen.getByRole("button", { name: "تقليل الكمية" });
    expect(screen.getByText(/في السلة:/)).toHaveTextContent("2");

    fireEvent.click(plus);
    await waitFor(() => expect(screen.getByText(/في السلة:/)).toHaveTextContent("3"));

    fireEvent.click(minus); // 3 → absolute set "2"
    await waitFor(() => expect(screen.getByText(/في السلة:/)).toHaveTextContent("2"));

    fireEvent.click(minus); // 2 → absolute set "1"
    await waitFor(() => expect(screen.getByText(/في السلة:/)).toHaveTextContent("1"));

    // Reaching zero is a DELETE (contract rejects a 0 PATCH): back to the add state.
    fireEvent.click(minus);
    await waitFor(() => expect(screen.getByRole("button", { name: /أضف إلى السلة/ })).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(/أُزيل من السلة/);
    expect(patchBodies).toEqual(["2", "1"]); // never "0" on the PATCH wire
  });

  it("IN CART: a failed step keeps the last confirmed quantity and reports an honest error", async () => {
    publishCartSnapshot(cartOf([cartLineFixture() /* qty 2 */]));
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart/items" && init?.method === "POST") {
        throw new AppError("CONFLICT", "تعارض في السلة.");
      }
      throw new Error(`unexpected ${url}`);
    });
    render(<CardBuy productId="p-1" />);
    fireEvent.click(screen.getByRole("button", { name: "زيادة الكمية" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/تعذّرت زيادة الكمية/);
    // The confirmed quantity never changed (no optimistic math, no availability claim).
    expect(screen.getByText(/في السلة:/)).toHaveTextContent("2");
  });

  function cartLineFixture() {
    return {
      productVariantId: "v-9",
      productId: "p-1",
      productName: "منتج",
      variantName: "عبوة",
      productType: "PIECE",
      quantity: "2",
      lineTotal: null,
    };
  }

  it("multiple lines for one product render the neutral pointer, never an invented aggregate", () => {
    publishCartSnapshot(
      cartOf([
        { ...cartLineFixture(), productVariantId: "v-9", quantity: "1" },
        { ...cartLineFixture(), productVariantId: "v-10", quantity: "2" },
      ]),
    );
    render(<CardBuy productId="p-1" />);
    expect(screen.getByText(/في السلة — عدّل الكمية/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /أضف إلى السلة/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "زيادة الكمية" })).not.toBeInTheDocument();
  });

  it("a failed shared mount probe does not block the add flow (aggregation safety)", async () => {
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart" && !init?.method) throw new TypeError("offline");
      if (url === "/api/store/catalog/products/p-1/variants" && !init?.method) {
        return { data: [{ id: "v-1" }] };
      }
      if (url === "/api/store/cart/items" && init?.method === "POST") {
        return {
          data: {
            cart: cartOf([
              {
                productVariantId: "v-1",
                productId: "p-1",
                productName: "منتج",
                variantName: "عبوة",
                productType: "PIECE",
                quantity: "1",
                lineTotal: null,
              },
            ]),
          },
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    render(<CardBuy productId="p-1" />);
    fireEvent.click(screen.getByRole("button", { name: /أضف إلى السلة/ }));
    // Probe failed → note persists, but the add succeeded (server aggregate truth).
    await waitFor(() => expect(screen.getByText(/في السلة:/)).toHaveTextContent("1"));
  });
});
