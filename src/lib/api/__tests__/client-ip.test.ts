// D4 — trusted client identity.
//
// A rate-limit bucket is only as strong as the identity that keys it. These
// tests pin the trust model that makes the bucket un-rotatable:
//
//   * Vercel runtime → the platform wrote the header; the client cannot
//     choose it.
//   * Self-hosted with `TRUSTED_PROXY=1` → the operator declares that a
//     trusted proxy REPLACES the header with a single address.
//   * Otherwise → UNKNOWN. The client-supplied header is ignored entirely,
//     so rotating it gains nothing.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  UNKNOWN_CLIENT_IP,
  clientIpBucketKey,
  isDeclaredTrustedProxy,
  isVercelRuntime,
  parseSingleIp,
  resolveClientIp,
} from "@/lib/api/client-ip";

function headers(map: Record<string, string>) {
  return {
    get(name: string) {
      const key = Object.keys(map).find((k) => k.toLowerCase() === name.toLowerCase());
      return key === undefined ? null : map[key];
    },
  };
}

const VERCEL = { VERCEL: "1" };
const PROXY = { TRUSTED_PROXY: "1" };
const NONE = {};

describe("parseSingleIp", () => {
  it("accepts an IPv4 and an IPv6 address", () => {
    expect(parseSingleIp("203.0.113.9")).toBe("203.0.113.9");
    expect(parseSingleIp("2001:db8::1")).toBe("2001:db8::1");
    expect(parseSingleIp("::ffff:127.0.0.1")).toBe("::ffff:127.0.0.1");
  });

  it("rejects a chain, an empty value and a non-address", () => {
    expect(parseSingleIp("203.0.113.9, 10.0.0.1")).toBeNull();
    expect(parseSingleIp("")).toBeNull();
    expect(parseSingleIp("   ")).toBeNull();
    expect(parseSingleIp(null)).toBeNull();
    expect(parseSingleIp(undefined)).toBeNull();
    expect(parseSingleIp("not-an-ip")).toBeNull();
    expect(parseSingleIp("999.999.999.999")).toBeNull();
  });
});

describe("deployment detection", () => {
  it("detects the Vercel runtime from the environment, never from a header", () => {
    expect(isVercelRuntime(VERCEL)).toBe(true);
    expect(isVercelRuntime(NONE)).toBe(false);
    expect(isDeclaredTrustedProxy(PROXY)).toBe(true);
    expect(isDeclaredTrustedProxy(NONE)).toBe(false);
  });
});

describe("resolveClientIp on a Vercel deployment", () => {
  it("prefers the platform-written header", () => {
    const h = headers({ "x-vercel-forwarded-for": "198.51.100.4", "x-forwarded-for": "203.0.113.9" });
    expect(resolveClientIp(h, VERCEL)).toEqual({ ip: "198.51.100.4", source: "vercel-platform" });
  });

  it("falls back to the overwritten x-forwarded-for", () => {
    const h = headers({ "x-forwarded-for": "203.0.113.9" });
    expect(resolveClientIp(h, VERCEL)).toEqual({ ip: "203.0.113.9", source: "vercel-platform" });
  });

  it("ignores a forged chain and a malformed value", () => {
    expect(resolveClientIp(headers({ "x-vercel-forwarded-for": "1.2.3.4, 5.6.7.8" }), VERCEL).ip).toBeNull();
    expect(resolveClientIp(headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }), VERCEL).ip).toBeNull();
    expect(resolveClientIp(headers({ "x-vercel-forwarded-for": "nope" }), VERCEL).ip).toBeNull();
  });

  it("is unknown when no usable header arrives", () => {
    expect(resolveClientIp(headers({}), VERCEL)).toEqual({ ip: null, source: "unknown" });
  });
});

describe("resolveClientIp on a self-hosted deployment", () => {
  it("ignores the client-supplied header when no trusted proxy is declared", () => {
    const h = headers({ "x-forwarded-for": "203.0.113.9" });
    expect(resolveClientIp(h, NONE)).toEqual({ ip: null, source: "unknown" });
  });

  it("ignores a forged platform header — the platform is detected from the env", () => {
    const h = headers({ "x-vercel-forwarded-for": "203.0.113.9", "x-real-ip": "198.51.100.4" });
    expect(resolveClientIp(h, NONE).ip).toBeNull();
  });

  it("accepts a single address when a trusted proxy is declared", () => {
    const h = headers({ "x-forwarded-for": "203.0.113.9" });
    expect(resolveClientIp(h, PROXY)).toEqual({ ip: "203.0.113.9", source: "declared-proxy" });
  });

  it("rejects a chain under a declared proxy — the hop count is not evidence", () => {
    const h = headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(resolveClientIp(h, PROXY)).toEqual({ ip: null, source: "unknown" });
  });
});

describe("clientIpBucketKey", () => {
  it("falls back to the shared unknown bucket, which no client can rotate", () => {
    const key = clientIpBucketKey(headers({ "x-forwarded-for": "203.0.113.9" }), NONE);
    expect(key).toBe(UNKNOWN_CLIENT_IP);
    const other = clientIpBucketKey(headers({ "x-forwarded-for": "198.51.100.4" }), NONE);
    expect(other).toBe(key);
  });

  it("keys by the trusted address when one exists", () => {
    expect(clientIpBucketKey(headers({ "x-vercel-forwarded-for": "198.51.100.4" }), VERCEL)).toBe(
      "198.51.100.4",
    );
    expect(clientIpBucketKey(headers({ "x-forwarded-for": "203.0.113.9" }), PROXY)).toBe("203.0.113.9");
  });
});
