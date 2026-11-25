// FE-7 adapter tests: placeOrder server action with mocked next/headers + fetch.
// Proves credential custody WITHOUT any backend write: cookie set server-side,
// raw token never returned, replay carries no credential, ambiguous stays ambiguous,
// and every create carries an abort signal (timeout-after-execution must never be
// mistaken for "not created"). The order cookie name is environment-aware: the
// `__Host-` prefix is production-only (browsers drop it on plain-HTTP dev).
import { afterEach, describe, expect, it, vi } from "vitest";

const mockCookieSet = vi.fn();
const mockCookieGet = vi.fn<(name: string) => { name: string; value: string } | undefined>(() => undefined);
let mockHost: string | null = "localhost:3141";
let mockOrigin: string | null = null;
let mockCookieList: Array<{ name: string; value: string }> = [{ name: "other", value: "1" }];

vi.mock("next/headers", () => ({
  headers: vi.fn().mockImplementation(async () => ({
    get: (k: string) => {
      if (k === "host") return mockHost;
      if (k === "origin") return mockOrigin;
      return null;
    },
  })),
  cookies: vi.fn().mockImplementation(async () => ({
    getAll: () => mockCookieList,
    get: (...args: unknown[]) => mockCookieGet(...(args as [string])),
    set: (...args: unknown[]) =>
      mockCookieSet(...(args as [string, string, Record<string, unknown>])),
  })),
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
  // The reviewed fee is REQUIRED by the create contract (the storefront always
  // previews the fee before ordering).
  expectedDeliveryFee: "20.00",
};

describe("placeOrder adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    mockCookieSet.mockClear();
    mockCookieGet.mockReturnValue(undefined);
    mockHost = "localhost:3141";
    mockOrigin = null;
    mockCookieList = [{ name: "other", value: "1" }];
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
    expect(res).toEqual({
      ok: true,
      orderId: "11111111-1111-4111-8111-111111111111",
      orderNumber: "HM-1",
      replay: false,
      credentialAvailable: true,
    });
    expect(mockCookieSet).toHaveBeenCalledTimes(1);
    const [name, value, opts] = mockCookieSet.mock.calls[0] as [string, string, Record<string, unknown>];
    // vitest runs as NODE_ENV=test → plain-HTTP-safe name (the browser would DROP
    // `__Host-…` because it is not Secure on http://localhost).
    expect(name).toBe("guest-order-11111111-1111-4111-8111-111111111111");
    expect(value).toBe(raw);
    expect(opts).toMatchObject({ httpOnly: true, secure: false, sameSite: "lax", path: "/" });
    expect(JSON.stringify(res)).not.toContain(raw.slice(0, 16));
  });

  it("uses the __Host- prefix with Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const raw = "e".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { data: { orderId: "11111111-1111-4111-8111-111111111111", orderNumber: "HM-1", guestOrderToken: raw }, meta: {} },
          201,
        ),
      ),
    );
    await placeOrder({ ...BASE_INPUT });
    const [name, , opts] = mockCookieSet.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(name).toBe("__Host-guest-order-11111111-1111-4111-8111-111111111111");
    expect(opts).toMatchObject({ secure: true, path: "/" });
  });

  it("replay resolves without credential (keep-same honored)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ data: { orderId: "11111111-1111-4111-8111-111111111111", orderNumber: "HM-1" }, meta: { replay: true } }, 200),
      ),
    );
    const res = await placeOrder({ ...BASE_INPUT });
    expect(res).toEqual({
      ok: true,
      orderId: "11111111-1111-4111-8111-111111111111",
      orderNumber: "HM-1",
      replay: true,
      // No order cookie was present in this request: the original 201 credential
      // is gone and the keep-same contract never reissues it.
      credentialAvailable: false,
    });
    expect(mockCookieSet).not.toHaveBeenCalled();
  });

  it("replay with the previously stored order cookie is readable", async () => {
    mockCookieGet.mockReturnValue({ name: "guest-order-11111111-1111-4111-8111-111111111111", value: "a".repeat(64) });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ data: { orderId: "11111111-1111-4111-8111-111111111111", orderNumber: "HM-1" }, meta: { replay: true } }, 200),
      ),
    );
    const res = await placeOrder({ ...BASE_INPUT });
    expect(res).toMatchObject({ ok: true, replay: true, credentialAvailable: true });
  });

  it("replay with a server-verified recovery session is readable without a new credential", async () => {
    // Lost-201 closure: the checkout session cookie is HttpOnly and the server
    // answers meta.recoveryAvailable=true only after checking the DB binding.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { data: { orderId: "11111111-1111-4111-8111-111111111111", orderNumber: "HM-1" }, meta: { replay: true, recoveryAvailable: true } },
          200,
        ),
      ),
    );
    const res = await placeOrder({ ...BASE_INPUT });
    expect(res).toMatchObject({ ok: true, replay: true, credentialAvailable: true });
    expect(mockCookieSet).not.toHaveBeenCalled();
  });

  it("sends the reviewed fee as expectedDeliveryFee (assertion only)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { orderId: "11111111-1111-4111-8111-111111111111" }, meta: {} }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await placeOrder({ ...BASE_INPUT, expectedDeliveryFee: "20.00" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.expectedDeliveryFee).toBe("20.00");
  });

  it("always carries expectedDeliveryFee on the wire (null when there is no reviewed fee)", async () => {
    // D2: the field is EXPLICIT on every create request. A NEW order without a
    // reviewed fee is rejected by the SERVER (400 VALIDATION, enforced after
    // the idempotency lookup so a same-key verification is never blocked) —
    // the client never substitutes a price of its own.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { orderId: "11111111-1111-4111-8111-111111111111" }, meta: {} }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const withoutFee = { ...BASE_INPUT, expectedDeliveryFee: undefined };
    await placeOrder(withoutFee as Parameters<typeof placeOrder>[0]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toHaveProperty("expectedDeliveryFee", null);
  });

  it("refuses a malformed fee locally (never asks the server to charge it)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await placeOrder({ ...BASE_INPUT, expectedDeliveryFee: "12,50" });
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the create request with an abort signal (bounded wait)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { orderId: "11111111-1111-4111-8111-111111111111" }, meta: {} }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await placeOrder({ ...BASE_INPUT });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("transport failure stays ambiguous (never blind success/failure)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("down")));
    const res = await placeOrder({ ...BASE_INPUT });
    expect(res).toEqual({ ok: false, code: "TRANSPORT", message: "تعذّر تأكيد نتيجة الطلب.", ambiguous: true });
  });

  it("abort/timeout after the server may have committed stays ambiguous", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    const res = await placeOrder({ ...BASE_INPUT });
    expect(res).toMatchObject({ ok: false, code: "TRANSPORT", ambiguous: true });
  });

  it("propagates contract error details (409 cause classification)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: "CONFLICT",
              message: "Prices changed since items were added to the cart.",
              details: { variants: ["11111111-1111-4111-8111-111111111111"] },
            },
          },
          409,
        ),
      ),
    );
    const res = await placeOrder({ ...BASE_INPUT });
    expect(res).toMatchObject({
      ok: false,
      code: "CONFLICT",
      details: { variants: ["11111111-1111-4111-8111-111111111111"] },
    });
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

  it("BUG-13: isolates admin session cookies and never forwards them to storefront order endpoints", async () => {
    mockCookieList = [
      { name: "__Host-admin-session", value: "admin-secret-token" },
      { name: "hyper-admin-session-dev", value: "admin-dev-secret" },
      { name: "__Host-customer-session", value: "customer-ok-token" },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { orderId: "11111111-1111-4111-8111-111111111111" }, meta: {} }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await placeOrder({ ...BASE_INPUT });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headersObj = init.headers as Record<string, string>;
    expect(headersObj.Cookie).toBe("__Host-customer-session=customer-ok-token");
    expect(headersObj.Cookie).not.toContain("admin-secret-token");
    expect(headersObj.Cookie).not.toContain("admin-dev-secret");
  });

  it("BUG-03: rejects malformed/SSRF host header and falls back to 127.0.0.1", async () => {
    mockHost = "evil.attacker.example/ssrf@internal";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { orderId: "11111111-1111-4111-8111-111111111111" }, meta: {} }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await placeOrder({ ...BASE_INPUT });
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toBe("http://127.0.0.1:3000/api/store/orders");
  });
});
