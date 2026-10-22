// Phase-12 customer session cookie tests (pure, no network).
//
// The storefront session had the same defect the admin session had: a
// `__Host-` cookie WITHOUT `Secure` outside production is rejected by the
// browser, so a customer signed in on a plain-HTTP localhost appeared signed
// out. The production name and its `Secure` flag are unchanged; a real local
// development process gets its own non-prefixed name.

import { describe, expect, it } from "vitest";
import {
  CUSTOMER_SESSION_COOKIE_NAMES,
  customerSessionCookieName,
  readCustomerToken,
} from "@/lib/customers/cookies";

const LOCAL_SCRATCH = "postgresql://u:p@localhost:5432/hyper_almoatasem_scratch";
const PRODUCTION_DB = "postgresql://u:p@localhost:5432/hyper_almoatasem";
const REMOTE = "postgresql://u:p@db.example.com:5432/hyper_almoatasem_scratch";

describe("customer session cookie (Phase-12)", () => {
  it("keeps the __Host- name in production", () => {
    const env = { NODE_ENV: "production", DATABASE_URL: LOCAL_SCRATCH };
    expect(customerSessionCookieName(env)).toBe("__Host-customer-session");
  });

  it("uses a separate non-prefixed name in a real local development process", () => {
    const env = { NODE_ENV: "development", DATABASE_URL: LOCAL_SCRATCH };
    expect(customerSessionCookieName(env)).toBe("hyper-customer-session-dev");
  });

  it("never falls back to the dev name outside local development", () => {
    expect(customerSessionCookieName({ NODE_ENV: "development", DATABASE_URL: PRODUCTION_DB })).toBe(
      "__Host-customer-session",
    );
    expect(customerSessionCookieName({ NODE_ENV: "development", DATABASE_URL: REMOTE })).toBe(
      "__Host-customer-session",
    );
  });

  it("reads a session presented under either cookie name", () => {
    const withProd = new Request("https://x.test/", {
      headers: { cookie: "__Host-customer-session=token-a" },
    });
    expect(readCustomerToken(withProd)).toBe("token-a");
    const withDev = new Request("https://x.test/", {
      headers: { cookie: "hyper-customer-session-dev=token-b" },
    });
    expect(readCustomerToken(withDev)).toBe("token-b");
  });

  it("prefers the explicit token header", () => {
    const req = new Request("https://x.test/", {
      headers: { cookie: "__Host-customer-session=token-a", "x-customer-token": "token-header" },
    });
    expect(readCustomerToken(req)).toBe("token-header");
  });

  it("ignores an unrelated cookie and an empty value", () => {
    const other = new Request("https://x.test/", { headers: { cookie: "theme=dark" } });
    expect(readCustomerToken(other)).toBeNull();
    const empty = new Request("https://x.test/", {
      headers: { cookie: "__Host-customer-session=" },
    });
    expect(readCustomerToken(empty)).toBeNull();
  });

  it("exposes exactly the two known names", () => {
    expect([...CUSTOMER_SESSION_COOKIE_NAMES]).toEqual([
      "__Host-customer-session",
      "hyper-customer-session-dev",
    ]);
  });
});
