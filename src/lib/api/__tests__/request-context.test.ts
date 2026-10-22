// Phase-10 remediation unit tests: the centralized request context (G06).
//
// The context is what the audit trail records. The rules under test:
//   * a forwarded header is only read when the deployment declares a trusted
//     proxy — an unproven client header never becomes an "identity";
//   * the value must be a real IP address (the column is `inet`);
//   * the User-Agent is recorded (bounded + sanitized) in every environment;
//   * nothing else is ever read (no cookie, no authorization header).
import { describe, expect, it, vi } from "vitest";

// "server-only" is a Next.js bundling guard; the module under test is
// server-side by contract, so the guard is stubbed here.
vi.mock("server-only", () => ({}));
import {
  buildRequestContext,
  extractClientIp,
  extractForwardedIp,
  extractUserAgent,
  isHttpsRequest,
  isLocalOrigin,
  isTrustedProxyContext,
  MAX_USER_AGENT_LENGTH,
} from "@/lib/api/request-context";

function headers(map: Record<string, string>) {
  return {
    get(name: string) {
      const key = Object.keys(map).find((k) => k.toLowerCase() === name.toLowerCase());
      return key === undefined ? null : map[key];
    },
  };
}

describe("request context (G06)", () => {
  it("ignores forwarded headers when no trusted proxy is declared", () => {
    const h = headers({ "x-forwarded-for": "203.0.113.9" });
    expect(extractClientIp(h, false)).toBeNull();
    expect(buildRequestContext(h, false).ip).toBeNull();
  });

  it("reads the client IP from the forwarded chain when a trusted proxy is declared", () => {
    const h = headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1, 10.0.0.2" });
    expect(extractClientIp(h, true)).toBe("203.0.113.9");
  });

  it("prefers the platform-written header when it is present", () => {
    const h = headers({ "x-vercel-forwarded-for": "198.51.100.4", "x-forwarded-for": "203.0.113.9" });
    expect(extractClientIp(h, true)).toBe("198.51.100.4");
  });

  it("rejects a value that is not an IP address", () => {
    const h = headers({ "x-forwarded-for": "not-an-ip" });
    expect(extractClientIp(h, true)).toBeNull();
    const h2 = headers({ "x-real-ip": "999.999.999.999" });
    expect(extractClientIp(h2, true)).toBeNull();
  });

  it("records the User-Agent, bounded and sanitized", () => {
    expect(extractUserAgent(headers({ "user-agent": "P10/1.0" }))).toBe("P10/1.0");
    const long = "x".repeat(MAX_USER_AGENT_LENGTH + 100);
    expect(extractUserAgent(headers({ "user-agent": long }))?.length).toBe(MAX_USER_AGENT_LENGTH);
    const control = `abc${String.fromCharCode(0)}def`;
    expect(extractUserAgent(headers({ "user-agent": control }))).toBe("abc def");
    expect(extractUserAgent(headers({}))).toBeNull();
  });

  it("never reads a cookie or an authorization header", () => {
    const h = headers({
      cookie: "secret=1",
      authorization: "Bearer secret",
      "user-agent": "P10/1.0",
    });
    const ctx = buildRequestContext(h, true);
    expect(ctx.userAgent).toBe("P10/1.0");
    expect(JSON.stringify(ctx)).not.toContain("secret");
  });

  it("keeps the rate-limit bucket source on the forwarded header (unchanged behaviour)", () => {
    expect(extractForwardedIp(headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(extractForwardedIp(headers({}))).toBeNull();
  });

  it("trusts a proxy only when it is declared", () => {
    expect(isTrustedProxyContext({ TRUSTED_PROXY: "1" })).toBe(true);
    expect(isTrustedProxyContext({})).toBe(false);
  });

  it("detects https and trustworthy local origins", () => {
    expect(isHttpsRequest(headers({ "x-forwarded-proto": "https" }))).toBe(true);
    expect(isHttpsRequest(headers({ "x-forwarded-proto": "http" }))).toBe(false);
    expect(isHttpsRequest(headers({}), "https:")).toBe(true);
    expect(isLocalOrigin("localhost:3000")).toBe(true);
    expect(isLocalOrigin("127.0.0.1:3145")).toBe(true);
    expect(isLocalOrigin("admin.example.com")).toBe(false);
    expect(isLocalOrigin(null)).toBe(false);
  });
});
