import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// D02/D10/D33 (checkout): the estimate is refreshed on every term change and
// the order can never be submitted without a live estimate; the guest payload
// carries the full approved optional address fields (FP-00-D015).

const h = vi.hoisted(() => {
  const LINES = [
    {
      productVariantId: "11111111-2222-4333-8444-555555555555",
      productName: "أرز عجينما 1كجم",
      variantName: "عبوة 1 كجم",
      quantity: "2",
      unitPriceSnapshot: "58.00",
      lineTotal: "116.00",
    },
  ];
  return {
    LINES,
    apiRequest: vi.fn(),
    placeOrder: vi.fn(),
    push: vi.fn(),
  };
});

vi.mock("@/lib/frontend/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/frontend/api-client")>();
  return { ...actual, apiRequest: h.apiRequest };
});

vi.mock("@/app/actions/orders", () => ({
  placeOrder: h.placeOrder,
}));

vi.mock("@/components/store/guest-cart-token", () => ({
  readGuestCartToken: () => null,
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ notify: vi.fn() }),
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

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CheckoutFlow } from "@/components/store/checkout-flow";

const ESTIMATE = {
  subtotal: "116.00",
  discountTotal: "0.00",
  deliveryFee: "25.00",
  total: "141.00",
  coupon: null,
};

function guestBackend() {
  h.apiRequest.mockImplementation(async (url: string) => {
    if (url === "/api/store/cart") {
      return { data: { cart: { lines: h.LINES } } };
    }
    if (url === "/api/store/customers/session") {
      throw new Error("not a session");
    }
    if (url === "/api/store/orders/estimate") {
      return { data: ESTIMATE };
    }
    throw new Error(`unexpected ${url}`);
  });
}

const okResult = () => ({
  ok: true,
  orderId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  orderNumber: "T-1",
  replay: false,
});

const applyBtn = () => screen.getByRole("button", { name: /تأكيد إنشاء الطلب/ });
const estimateCalls = () =>
  h.apiRequest.mock.calls.filter((c) => c[0] === "/api/store/orders/estimate");

describe("checkout-flow stale-estimate policy (D02/D10)", () => {
  beforeEach(() => {
    guestBackend();
    h.placeOrder.mockResolvedValue(okResult());
  });

  afterEach(() => {
    cleanup();
    h.apiRequest.mockReset();
    h.placeOrder.mockReset();
  });

  it("auto-fetches an estimate once lines arrive; submit stays blocked until it lands", async () => {
    render(<CheckoutFlow />);
    expect(await screen.findByText(/عناصر السلة/)).toBeInTheDocument();

    // Before the debounced estimate lands: submit blocked, status is honest.
    expect(applyBtn()).toBeDisabled();
    expect(screen.getByText(/بانتظار تقدير الإجمالي/)).toBeInTheDocument();

    await waitFor(() => expect(estimateCalls().length).toBe(1), { timeout: 3000 });
    await waitFor(() => expect(screen.getByText(/قبل الإنشاء/)).toBeInTheDocument());
    await waitFor(() => expect(applyBtn()).toBeEnabled());
  });

  it("re-marks the hint stale and refreshes when any term changes (coupon)", async () => {
    render(<CheckoutFlow />);
    await screen.findByText(/عناصر السلة/);
    await waitFor(() => expect(applyBtn()).toBeEnabled(), { timeout: 3000 });

    fireEvent.change(screen.getByLabelText("كود الكوبون"), { target: { value: "YALA4" } });
    expect(applyBtn()).toBeDisabled();
    expect(screen.getByText(/بانتظار تقدير الإجمالي/)).toBeInTheDocument();

    await waitFor(() => {
      const calls = estimateCalls();
      expect(calls.length).toBe(2);
      expect(calls[1][1]).toMatchObject({ body: { couponCode: "YALA4" } });
    }, { timeout: 3000 });
    await waitFor(() => expect(applyBtn()).toBeEnabled());
  });

  it("keeps the CTA disabled while the estimate is stale (click is a no-op)", async () => {
    render(<CheckoutFlow />);
    await screen.findByText(/عناصر السلة/);
    // The debounced estimate has not landed within this window: the CTA gate
    // (disabled) is the primary guard; a click cannot dispatch at all.
    expect(applyBtn()).toBeDisabled();
    fireEvent.click(applyBtn());
    expect(h.placeOrder).not.toHaveBeenCalled();
  });
});

describe("guest inline payload (D33 optional fields)", () => {
  beforeEach(() => {
    guestBackend();
    h.placeOrder.mockResolvedValue(okResult());
  });

  afterEach(() => {
    cleanup();
    h.apiRequest.mockReset();
    h.placeOrder.mockReset();
  });

  it("sends the full optional address fields (empty ones as null) in the guest payload", async () => {
    render(<CheckoutFlow />);
    await screen.findByText(/عناصر السلة/);

    fireEvent.change(screen.getByLabelText("المدينة *"), { target: { value: "القاهرة" } });
    fireEvent.change(screen.getByLabelText("الهاتف *"), { target: { value: "0123456789" } });
    fireEvent.change(screen.getByLabelText("الاسم الأول *"), { target: { value: "محمد" } });
    fireEvent.change(screen.getByLabelText("المنطقة / الحي (اختياري)"), { target: { value: "المعادي" } });
    fireEvent.change(screen.getByLabelText("علامة مميزة (اختياري)"), { target: { value: "قرب المحطة" } });

    await waitFor(() => expect(applyBtn()).toBeEnabled(), { timeout: 3000 });
    fireEvent.click(applyBtn());

    await waitFor(() => expect(h.placeOrder).toHaveBeenCalledTimes(1));
    const payload = h.placeOrder.mock.calls[0][0] as {
      guestAddress: Record<string, string | null>;
      guestContact: Record<string, string>;
    };
    expect(payload.guestAddress).toMatchObject({
      city: "القاهرة",
      street: null,
      area: "المعادي",
      village: null,
      buildingNumber: null,
      landmark: "قرب المحطة",
      phone: "0123456789",
    });
    expect(payload.guestContact).toEqual({ firstName: "محمد" });
    await waitFor(() =>
      expect(h.push).toHaveBeenCalledWith("/order-confirmation/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"),
    );
  });
});
