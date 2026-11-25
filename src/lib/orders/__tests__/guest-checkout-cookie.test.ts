// Guest checkout recovery-session transport (pure): cookie naming policy and
// header-first/cookie-second parsing. Raw tokens are never logged or emitted;
// these tests only pin selection behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GUEST_CHECKOUT_COOKIE_DEV,
  GUEST_CHECKOUT_COOKIE_PROD,
  GUEST_CHECKOUT_SESSION_HEADER,
  guestCheckoutCookieName,
  isGuestCheckoutCookieName,
  readGuestCheckoutToken,
} from "../guest-checkout-cookie";

function request(headers: Record<string, string>): Request {
  return new Request("https://x.test/", { headers });
}

describe("guest checkout cookie naming", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the __Host- name only in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(guestCheckoutCookieName()).toBe(GUEST_CHECKOUT_COOKIE_PROD);
    expect(GUEST_CHECKOUT_COOKIE_PROD.startsWith("__Host-")).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(guestCheckoutCookieName()).toBe(GUEST_CHECKOUT_COOKIE_DEV);
  });

  it("recognizes both names but not the per-order credential cookie", () => {
    expect(isGuestCheckoutCookieName(GUEST_CHECKOUT_COOKIE_PROD)).toBe(true);
    expect(isGuestCheckoutCookieName(GUEST_CHECKOUT_COOKIE_DEV)).toBe(true);
    expect(isGuestCheckoutCookieName("guest-order-11111111-1111-4111-8111-111111111111")).toBe(false);
    expect(isGuestCheckoutCookieName("__Host-guest-order-11111111-1111-4111-8111-111111111111")).toBe(false);
  });
});

describe("readGuestCheckoutToken", () => {
  it("prefers the explicit header", () => {
    expect(
      readGuestCheckoutToken(
        request({
          [GUEST_CHECKOUT_SESSION_HEADER]: "a".repeat(64),
          cookie: `${GUEST_CHECKOUT_COOKIE_DEV}=${"b".repeat(64)}`,
        }),
      ),
    ).toBe("a".repeat(64));
  });

  it("accepts either cookie name and ignores unrelated cookies", () => {
    expect(
      readGuestCheckoutToken(request({ cookie: `theme=dark; ${GUEST_CHECKOUT_COOKIE_PROD}=${"c".repeat(64)}` })),
    ).toBe("c".repeat(64));
    expect(
      readGuestCheckoutToken(request({ cookie: `theme=dark; ${GUEST_CHECKOUT_COOKIE_DEV}=${"d".repeat(64)}` })),
    ).toBe("d".repeat(64));
    expect(readGuestCheckoutToken(request({ cookie: "theme=dark; guest-order-x=1" }))).toBeNull();
  });

  it("returns null for absent/blank values", () => {
    expect(readGuestCheckoutToken(request({}))).toBeNull();
    expect(readGuestCheckoutToken(request({ [GUEST_CHECKOUT_SESSION_HEADER]: "   " }))).toBeNull();
    expect(readGuestCheckoutToken(request({ cookie: `${GUEST_CHECKOUT_COOKIE_DEV}=` }))).toBeNull();
  });
});
