import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phase 10 checkout safety suite (D02/D10/D33 + ambiguity policy):
//  • the estimate is refreshed on every term change and the order can never be
//    submitted without a live estimate of its EXACT terms;
//  • a late response for old terms can never overwrite a newer one;
//  • one click/Enter burst creates at most one request;
//  • ambiguous outcomes keep the SAME key and lock the form;
//  • the unresolved key survives a reload (sessionStorage: key + timestamp only);
//  • definite 4xx rejections are explained in Arabic with a recovery path;
//  • a guest replay without the original credential never pretends access.

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
    notify: vi.fn(),
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
  useToast: () => ({ notify: h.notify }),
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
import { AppError } from "@/lib/frontend/api-client";

const PENDING_KEY = "hyper_checkout_pending_v1";
const ORDER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

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
      return { data: { cart: { id: "cart-1", lines: h.LINES } } };
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
  orderId: ORDER_ID,
  orderNumber: "T-1",
  replay: false,
  credentialAvailable: true,
});

const applyBtn = () => screen.getByRole("button", { name: /تأكيد إنشاء الطلب/ });
const resolveBtn = () => screen.getByRole("button", { name: /تحقق من نتيجة الطلب السابق/ });
const estimateCalls = () =>
  h.apiRequest.mock.calls.filter((c) => c[0] === "/api/store/orders/estimate");

function fillGuest() {
  fireEvent.change(screen.getByLabelText("المدينة *"), { target: { value: "القاهرة" } });
  fireEvent.change(screen.getByLabelText("الهاتف *"), { target: { value: "0123456789" } });
  fireEvent.change(screen.getByLabelText("الاسم الأول *"), { target: { value: "محمد" } });
}

async function fillGuestReady() {
  fillGuest();
  // Guest identity is part of the terms: the estimate must refresh before the
  // confirm CTA becomes available again.
  await waitFor(() => expect(applyBtn()).toBeEnabled(), { timeout: 3000 });
}

async function readyWithEstimate() {
  render(<CheckoutFlow />);
  await screen.findByText(/عناصر السلة/);
  await waitFor(() => expect(applyBtn()).toBeEnabled(), { timeout: 3000 });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  window.sessionStorage.clear();
  guestBackend();
  h.placeOrder.mockResolvedValue(okResult());
});

afterEach(() => {
  cleanup();
  h.apiRequest.mockReset();
  h.placeOrder.mockReset();
  h.push.mockClear();
  h.notify.mockClear();
  window.sessionStorage.clear();
});

describe("checkout-flow stale-estimate policy (D02/D10)", () => {
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
    await readyWithEstimate();

    fireEvent.change(screen.getByLabelText("كود الكوبون"), { target: { value: "YALA4" } });
    expect(applyBtn()).toBeDisabled();
    // The previous totals stay visible but are explicitly labeled non-authoritative.
    expect(screen.getByText(/تقدير سابق/)).toBeInTheDocument();
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

  it("a late response for OLD terms can never replace the newer estimate", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    h.apiRequest.mockImplementation(async (url: string, init?: { body?: { couponCode?: string } }) => {
      if (url === "/api/store/cart") return { data: { cart: { id: "cart-1", lines: h.LINES } } };
      if (url === "/api/store/customers/session") throw new Error("not a session");
      if (url === "/api/store/orders/estimate") {
        return init?.body?.couponCode === "NEW" ? second.promise : first.promise;
      }
      throw new Error(`unexpected ${url}`);
    });

    render(<CheckoutFlow />);
    await screen.findByText(/عناصر السلة/);
    await waitFor(() => expect(estimateCalls().length).toBe(1), { timeout: 3000 });

    fireEvent.change(screen.getByLabelText("كود الكوبون"), { target: { value: "NEW" } });
    await waitFor(() => expect(estimateCalls().length).toBe(2), { timeout: 3000 });

    // Newer terms answer first…
    second.resolve({ data: { ...ESTIMATE, total: "222.00" } });
    await waitFor(() => expect(screen.getByText(/222\.00/)).toBeInTheDocument());
    expect(applyBtn()).toBeEnabled();

    // …and the stale answer arrives afterwards; it must be ignored.
    first.resolve({ data: { ...ESTIMATE, total: "111.00" } });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/111\.00/)).not.toBeInTheDocument();
    expect(screen.getByText(/222\.00/)).toBeInTheDocument();
  });
});

describe("double-submit and key retention", () => {
  it("a click burst creates at most one request", async () => {
    h.placeOrder.mockReturnValue(new Promise(() => {}));
    await readyWithEstimate();
    await fillGuestReady();

    const btn = applyBtn();
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);

    await waitFor(() => expect(h.placeOrder).toHaveBeenCalledTimes(1));
  });

  it("ambiguous outcome locks the form and same-key verification reuses the key", async () => {
    h.placeOrder
      .mockResolvedValueOnce({ ok: false, code: "TRANSPORT", message: "x", ambiguous: true })
      .mockResolvedValueOnce({
        ok: true,
        orderId: ORDER_ID,
        orderNumber: "T-1",
        replay: true,
        credentialAvailable: true,
      });
    await readyWithEstimate();
    await fillGuestReady();

    fireEvent.click(applyBtn());
    expect(await screen.findByText(/محاولة طلب غير مؤكدة/)).toBeInTheDocument();

    const firstKey = (h.placeOrder.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey;
    expect(applyBtn()).toBeDisabled();
    expect(resolveBtn()).toBeEnabled();

    fireEvent.click(resolveBtn());
    await waitFor(() => expect(h.placeOrder).toHaveBeenCalledTimes(2));
    const secondKey = (h.placeOrder.mock.calls[1][0] as { idempotencyKey: string }).idempotencyKey;
    expect(secondKey).toBe(firstKey);
    await waitFor(() =>
      expect(h.push).toHaveBeenCalledWith(`/order-confirmation/${ORDER_ID}`),
    );
    expect(window.sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(h.notify).toHaveBeenCalledWith("success", "تم تأكيد الطلب السابق — لم يُنشأ طلب جديد.");
  });

  it("persists ONLY the unresolved key + timestamp (no PII, no address)", async () => {
    h.placeOrder.mockResolvedValueOnce({ ok: false, code: "TRANSPORT", message: "x", ambiguous: true });
    await readyWithEstimate();
    await fillGuestReady();
    fireEvent.change(screen.getByLabelText("المنطقة / الحي (اختياري)"), { target: { value: "المعادي" } });
    await waitFor(() => expect(applyBtn()).toBeEnabled(), { timeout: 3000 });

    fireEvent.click(applyBtn());
    await screen.findByText(/محاولة طلب غير مؤكدة/);

    const raw = window.sessionStorage.getItem(PENDING_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["at", "key"]);
    expect(raw).not.toContain("0123456789");
    expect(raw).not.toContain("القاهرة");
    expect(raw).not.toContain("المعادي");
  });

  it("recovers a pending key after reload and verifies with the SAME key", async () => {
    const persistedKey = "persisted-attempt-key";
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify({ key: persistedKey, at: Date.now() }));
    h.placeOrder.mockResolvedValue({
      ok: true,
      orderId: ORDER_ID,
      orderNumber: "T-1",
      replay: true,
      credentialAvailable: true,
    });

    render(<CheckoutFlow />);
    await screen.findByText(/محاولة طلب غير مؤكدة/);
    fillGuest();
    await waitFor(() => expect(resolveBtn()).toBeEnabled());

    fireEvent.click(resolveBtn());
    await waitFor(() => expect(h.placeOrder).toHaveBeenCalledTimes(1));
    expect((h.placeOrder.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey).toBe(persistedKey);
  });

  it("a definite rejection releases the lock (no pending key survives)", async () => {
    h.placeOrder.mockResolvedValueOnce({
      ok: false,
      code: "CONFLICT",
      message: "Prices changed since items were added to the cart.",
      details: { variants: [h.LINES[0].productVariantId] },
    });
    await readyWithEstimate();
    await fillGuestReady();
    fireEvent.click(applyBtn());

    expect(await screen.findByText(/تغيّرت أسعار أو شروط الطلب/)).toBeInTheDocument();
    expect(screen.queryByText(/محاولة طلب غير مؤكدة/)).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(PENDING_KEY)).toBeNull();
    // 409 triggers a fresh (read-only) estimate; reprice stays an explicit action.
    await waitFor(() => expect(estimateCalls().length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    expect(screen.getByRole("button", { name: /تحديث الأسعار/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /مراجعة السلة/ })).toHaveAttribute("href", "/cart");
  });
});

describe("pre-submit cart preflight", () => {
  it("blocks submit when another tab changed a line, refreshes review and estimate", async () => {
    let cartCalls = 0;
    h.apiRequest.mockImplementation(async (url: string) => {
      if (url === "/api/store/cart") {
        cartCalls += 1;
        if (cartCalls === 1) return { data: { cart: { id: "cart-1", lines: h.LINES } } };
        return { data: { cart: { id: "cart-1", lines: [{ ...h.LINES[0], quantity: "3" }] } } };
      }
      if (url === "/api/store/customers/session") throw new Error("not a session");
      if (url === "/api/store/orders/estimate") return { data: ESTIMATE };
      throw new Error(`unexpected ${url}`);
    });

    await readyWithEstimate();
    await fillGuestReady();
    fireEvent.click(applyBtn());

    expect(
      await screen.findByText(/تغيّرت عناصر السلة في نافذة أو جهاز آخر/),
    ).toBeInTheDocument();
    expect(h.placeOrder).not.toHaveBeenCalled();
    // The review was replaced with the live line…
    expect(screen.getByText("3")).toBeInTheDocument();
    // …and the estimate is re-requested for the NEW quantity (never stale terms).
    await waitFor(() => {
      const calls = estimateCalls();
      const last = calls[calls.length - 1];
      expect(last[1]).toMatchObject({
        body: {
          lines: [{ productVariantId: h.LINES[0].productVariantId, quantity: "3" }],
        },
      });
    });
  });

  it("blocks submit when the cart was consumed elsewhere", async () => {
    let cartCalls = 0;
    h.apiRequest.mockImplementation(async (url: string) => {
      if (url === "/api/store/cart") {
        cartCalls += 1;
        if (cartCalls === 1) return { data: { cart: { id: "cart-1", lines: h.LINES } } };
        throw new AppError("NOT_FOUND", "Active cart not found.");
      }
      if (url === "/api/store/customers/session") throw new Error("not a session");
      if (url === "/api/store/orders/estimate") return { data: ESTIMATE };
      throw new Error(`unexpected ${url}`);
    });

    await readyWithEstimate();
    await fillGuestReady();
    fireEvent.click(applyBtn());

    expect(await screen.findByText(/السلة لم تعد متاحة/)).toBeInTheDocument();
    expect(h.placeOrder).not.toHaveBeenCalled();
  });
  it("registered session lost before submit is reported as expiry, not a consumed cart", async () => {
    const me = {
      customer: { id: "cust-1", firstName: "محمد", phone: "201234567890" },
      addresses: [
        {
          id: "addr-1",
          label: "المنزل",
          city: "القاهرة",
          area: null,
          village: null,
          street: null,
          buildingNumber: null,
          landmark: null,
          phone: "201234567890",
          isDefault: true,
        },
      ],
    };
    let cartCalls = 0;
    h.apiRequest.mockImplementation(async (url: string) => {
      if (url === "/api/store/cart") {
        cartCalls += 1;
        if (cartCalls === 1) return { data: { cart: { id: "cart-1", lines: h.LINES } } };
        // The session cookie disappeared: the cart route now has no identity.
        throw new AppError("VALIDATION", "A cart owner is required.");
      }
      if (url === "/api/store/customers/session") return { data: me };
      if (url === "/api/store/orders/estimate") return { data: ESTIMATE };
      throw new Error(`unexpected ${url}`);
    });

    render(<CheckoutFlow />);
    await screen.findByText(/عناصر السلة/);
    await waitFor(() => expect(applyBtn()).toBeEnabled(), { timeout: 3000 });

    fireEvent.click(applyBtn());
    expect(await screen.findByText(/انتهت جلسة تسجيل الدخول قبل إرسال الطلب/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "تسجيل الدخول" })).toHaveAttribute(
      "href",
      "/login?next=%2Fcheckout",
    );
    expect(h.placeOrder).not.toHaveBeenCalled();
  });
});

describe("Arabic failure mapping and credential limits", () => {
  it("session expiry offers the login return path", async () => {
    h.placeOrder.mockResolvedValueOnce({ ok: false, code: "UNAUTHENTICATED", message: "Authentication is required." });
    await readyWithEstimate();
    await fillGuestReady();
    fireEvent.click(applyBtn());

    const link = await screen.findByRole("link", { name: "تسجيل الدخول" });
    expect(link).toHaveAttribute("href", "/login?next=%2Fcheckout");
    expect(screen.getByText(/انتهت جلسة تسجيل الدخول/)).toBeInTheDocument();
  });

  it("coupon business rejection is explained in Arabic", async () => {
    h.placeOrder.mockResolvedValueOnce({
      ok: false,
      code: "BUSINESS_RULE",
      message: "Coupon is not applicable to this customer.",
    });
    await readyWithEstimate();
    await fillGuestReady();
    fireEvent.click(applyBtn());

    expect(await screen.findByText(/تعذّر تطبيق الكوبون/)).toBeInTheDocument();
  });

  it("guest replay without the original credential never fakes access or duplicates", async () => {
    h.placeOrder.mockResolvedValueOnce({
      ok: true,
      orderId: ORDER_ID,
      orderNumber: "T-9",
      replay: true,
      credentialAvailable: false,
    });
    await readyWithEstimate();
    await fillGuestReady();
    fireEvent.click(applyBtn());

    expect(await screen.findByText(/رمز الوصول الأصلي غير متاح/)).toBeInTheDocument();
    expect(screen.getByText(/لم يُنشأ طلب جديد/)).toBeInTheDocument();
    expect(h.push).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });
});

describe("guest inline payload (D33 optional fields)", () => {
  it("sends the full optional address fields (empty ones as null) in the guest payload", async () => {
    await readyWithEstimate();

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
      expect(h.push).toHaveBeenCalledWith(`/order-confirmation/${ORDER_ID}`),
    );
  });

  it("P12-02: exposes checkout progression and estimate state attributes cleanly", async () => {
    await readyWithEstimate();
    const container = document.querySelector("[data-checkout-step]");
    expect(container).toHaveAttribute("data-checkout-step", "2");
    fireEvent.change(screen.getByLabelText("المدينة *"), { target: { value: "القاهرة" } });
    fireEvent.change(screen.getByLabelText("الهاتف *"), { target: { value: "0123456789" } });
    fireEvent.change(screen.getByLabelText("الاسم الأول *"), { target: { value: "محمد" } });
    await waitFor(() => expect(container).toHaveAttribute("data-checkout-step", "3"));
    await waitFor(() => expect(document.querySelector('[data-estimate-state="ready"]')).not.toBeNull(), { timeout: 3000 });
  });
});
