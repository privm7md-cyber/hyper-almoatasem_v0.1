// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CartView } from "@/components/store/cart-view";
import { CheckoutFlow } from "@/components/store/checkout-flow";
import { resetCartStore } from "@/lib/frontend/cart-lines-store";
import { ToastProvider } from "@/components/ui/toast";

const h = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  notify: vi.fn(),
  push: vi.fn(),
  token: vi.fn<() => string | null>(() => "guest-token-1"),
}));

vi.mock("@/lib/frontend/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/frontend/api-client")>();
  return { ...actual, apiRequest: h.apiRequest };
});

vi.mock("@/app/actions/orders", () => ({
  placeOrder: vi.fn(),
}));

vi.mock("@/components/store/guest-cart-token", () => ({
  readGuestCartToken: () => h.token(),
  writeGuestCartToken: vi.fn(),
  clearGuestCartToken: vi.fn(),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ notify: h.notify }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const populatedCart = {
  id: "cart-r-1",
  status: "ACTIVE",
  guest: true,
  lines: [
    {
      productVariantId: "v-r-1",
      variantName: "1 لتر",
      productName: "حليب طازج",
      productType: "PIECE" as const,
      quantity: "2",
      unitSnapshot: "عبوة",
      unitPriceSnapshot: "45.00",
      lineTotal: "90.00",
    },
    {
      productVariantId: "v-r-2",
      variantName: "1 كجم",
      productName: "أرز مصري",
      productType: "PIECE" as const,
      quantity: "1",
      unitSnapshot: "كيس",
      unitPriceSnapshot: "38.00",
      lineTotal: "38.00",
    },
  ],
  subtotal: "128.00",
};

describe("P12-03 residual closure UI state & stepper contracts", () => {
  beforeEach(() => {
    resetCartStore();
    h.apiRequest.mockReset();
    h.notify.mockReset();
    h.push.mockReset();
    h.token.mockReturnValue("guest-token-1");
  });

  afterEach(() => {
    cleanup();
  });

  it("renders 2-column layout-matched CartView skeleton and distinct state key container on ready transition", async () => {
    let resolveCart!: (value: unknown) => void;
    h.apiRequest.mockImplementation(
      (url: string) =>
        new Promise((resolve) => {
          if (url === "/api/store/cart") {
            resolveCart = resolve;
          } else {
            resolve({
              ok: true,
              data: { subtotal: "128.00", discountTotal: "0.00", deliveryFee: "0.00", total: "128.00", coupon: null },
            });
          }
        }),
    );

    const { container } = render(
      <ToastProvider>
        <CartView initialEmpty={false} />
      </ToastProvider>,
    );

    const loadingRoot = container.querySelector('[data-cart-state="loading"]');
    expect(loadingRoot).not.toBeNull();
    expect(loadingRoot?.getAttribute("aria-busy")).toBe("true");
    expect(loadingRoot?.className).not.toContain("min-h-[860px]");

    resolveCart({ ok: true, data: { cart: populatedCart, guestToken: "guest-token-1" } });

    await waitFor(() => expect(container.querySelector('[data-cart-state="ready"]')).not.toBeNull());
    expect(screen.getByText("حليب طازج")).toBeInTheDocument();
  });

  it("renders CheckoutFlow loading and empty states without artificial min-h-[1080px] voids", async () => {
    h.token.mockReturnValue(null);
    h.apiRequest.mockResolvedValue({ ok: true, data: { cart: null } });

    const { container, unmount } = render(<CheckoutFlow initialEmpty />);
    const emptyRoot = container.querySelector('[data-checkout-phase="empty"]');
    expect(emptyRoot).not.toBeNull();
    expect(emptyRoot?.className).not.toContain("min-h-[1080px]");
    expect(screen.getByText("السلة فارغة")).toBeInTheDocument();
    unmount();

    h.token.mockReturnValue("guest-token-1");
    h.apiRequest.mockImplementation(
      () => new Promise(() => {}),
    );
    const loadingRender = render(<CheckoutFlow initialEmpty={false} />);
    const coLoading = loadingRender.container.querySelector('[data-checkout-phase="loading"]');
    expect(coLoading).not.toBeNull();
    expect(coLoading?.className).not.toContain("min-h-[1080px]");
  });

  it("shows untruncated grouped 3-stage checkout stepper and keeps Step 2 active when delivery is unserviceable", async () => {
    h.apiRequest.mockImplementation(async (url: string) => {
      if (url === "/api/store/customers/session") throw new Error("unauthenticated");
      if (url === "/api/store/cart") {
        return { ok: true, data: { cart: populatedCart, guestToken: "guest-token-1" } };
      }
      if (url === "/api/store/delivery/zones") return { ok: true, data: { zones: [] } };
      if (url === "/api/store/orders/checkout-session") {
        return { ok: true, data: { expiresAt: "2026-11-16T00:00:00Z", ttlHours: 2 } };
      }
      if (url === "/api/store/orders/estimate") {
        return {
          ok: true,
          data: {
            subtotal: "128.00",
            discountTotal: "0.00",
            deliveryFee: "0.00",
            total: "128.00",
            coupon: null,
            deliveryEligibility: { serviceable: false, reasonCode: "UNMATCHED_ZONE", reason: "خارج نطاق التوصيل" },
          },
        };
      }
      return { ok: true, data: {} };
    });

    render(<CheckoutFlow initialEmpty={false} />);

    await waitFor(() => expect(screen.getByTestId("checkout-stepper")).toBeInTheDocument());
    const nav = screen.getByTestId("checkout-stepper");
    expect(nav.innerHTML).not.toContain("truncate");
    expect(screen.getByText("مراجعة السلة")).toBeInTheDocument();
    expect(screen.getByText("العنوان والتوصيل")).toBeInTheDocument();
    expect(screen.getByText("المعاينة والتأكيد")).toBeInTheDocument();
    expect(screen.getByText(/بيانات العميل والعنوان والتوصيل/)).toBeInTheDocument();

    const step2Item = screen.getByText("العنوان والتوصيل").closest("li");
    expect(step2Item?.getAttribute("aria-current")).toBe("step");

    // Fill required guest fields while delivery remains unserviceable -> Step 2 must stay current (no false completion)
    fireEvent.change(screen.getByLabelText(/الاسم الأول/), { target: { value: "أحمد" } });
    fireEvent.change(screen.getByLabelText(/الهاتف/), { target: { value: "01001234567" } });
    fireEvent.change(screen.getByLabelText(/المدينة/), { target: { value: "مطاي" } });

    await waitFor(() => {
      expect(h.apiRequest.mock.calls.some((c) => c[0] === "/api/store/orders/estimate")).toBe(true);
    });
    expect(screen.getByText("العنوان والتوصيل").closest("li")?.getAttribute("aria-current")).toBe("step");
  });
});
