import { afterEach, describe, expect, it, vi } from "vitest";

// D01/D14 (FE-11.2 card add island, AC-P3 owner-approved): click resolves the
// variant, POSTs one pack, and the confirmed indicator comes from the cart
// response — never optimistic math.

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
}));

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CardBuy } from "@/components/store/card-buy";

describe("card-buy (D01/D14 approved card add)", () => {
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
    render(<CardBuy productId="p-1" />);
    fireEvent.click(screen.getByRole("button", { name: /أضف إلى السلة/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/لا توجد اختيارات متاحة/);
  });
});
