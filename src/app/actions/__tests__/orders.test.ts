// FE-7 adapter tests: placeOrder server action with mocked next/headers + fetch.
// Proves credential custody WITHOUT any backend write: cookie set server-side,
// raw token never returned, replay carries no credential, ambiguous stays ambiguous.
import { afterEach, describe, expect, it, vi } from "vitest";

const mockCookieSet = vi.fn();
const mockCookieGet = vi.fn(() => undefined);

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    get: (k: string) => {
      if (k === "host") return "localhost:3141";
      if (k === "origin") return null;
      return null;
    },
  }),
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [{ name: "other", value: "1" }],
    get: (...args: unknown[]) => mockCookieGet(...(args as [])),
    set: (...args: unknown[]) =>
      mockCookieSet(...(args as [string, string, Record<string, unknown>])),
  }),
}));

import { placeOrder } from "@/app/actions/orders";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const BASE_INPUT = {
  guestAddress: { city: "مطاي", phone: "01001234567" },
  guestContact: { firstName: "أحمد" },
  idempotencyKey: "key-123",
  cartToken: null,
  addressId: null,
  couponCode: null,
};

describe("placeOrder adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mockCookieSet.mockClear();
  });

  it("captures the one-time credential into an HttpOnly order cookie, never returned", async () => {
    const raw = "f".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { data: { orderId: "11111111-1111-4111-8111-111111111111", orderNumber: "HM-1", guestOrderToken: raw }, meta: {} },
          201,
        ),
      ),
    );
    const res = await placeOrder({ ...BASE_INPUT });
    expect(res).toEqual({ ok: true, orderId: "11111111-1111-4111-8111-111111111111", orderNumber: "HM-1", replay: false });
    expect(mockCookieSet).toHaveBeenCalledTimes(1);
    const [name, value, opts] = mockCookieSet.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(name).toBe("__Host-guest-order-11111111-1111-4111-8111-111111111111");
    expect(value).toBe(raw);
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(JSON.stringify(res)).not.toContain(raw.slice(0, 16));
  });

  it("replay resolves without credential (keep-same honored)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ data: { orderId: "11111111-1111-4111-8111-111111111111", orderNumber: "HM-1" }, meta: { replay: true } }, 200),
      ),
    );
    const res = await placeOrder({ ...BASE_INPUT });
    expect(res).toEqual({ ok: true, orderId: "11111111-1111-4111-8111-111111111111", orderNumber: "HM-1", replay: true });
    expect(mockCookieSet).not.toHaveBeenCalled();
  });

  it("transport failure stays ambiguous (never blind success/failure)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("down")));
    const res = await placeOrder({ ...BASE_INPUT });
    expect(res).toEqual({ ok: false, code: "TRANSPORT", message: "تعذّر الاتصال بالخادم.", ambiguous: true });
  });

  it("rejects ambiguous identity locally (addressId + guest side together)", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const res = await placeOrder({
      ...BASE_INPUT,
      addressId: "22222222-2222-4222-8222-222222222222",
    });
    expect(res.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
