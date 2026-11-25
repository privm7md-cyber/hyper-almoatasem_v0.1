// @vitest-environment node
// E-5 closure — the canonical URL contract.
//
// The rule under test: a canonical is published ONLY when the deployment may
// advertise its origin. A production build without a valid explicit origin
// publishes NONE (a guessed host is worse than a missing canonical); a
// validated explicit origin always publishes an absolute URL; a preview
// deployment host and a malformed / loopback-in-production value never do.
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGIN_KEYS = ["NEXT_PUBLIC_SITE_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL"] as const;

async function loadCanonical(env: Partial<Record<(typeof ORIGIN_KEYS)[number] | "NODE_ENV", string>>) {
  vi.resetModules();
  for (const key of ORIGIN_KEYS) vi.stubEnv(key, env[key] ?? "");
  if (env.NODE_ENV !== undefined) vi.stubEnv("NODE_ENV", env.NODE_ENV);
  const canonical = await import("@/lib/seo/canonical");
  const origin = await import("@/lib/site-origin");
  return { ...canonical, ...origin };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("E-5 — canonical path normalization", () => {
  it("normalizes to a single leading slash, no query, no hash, no trailing slash", async () => {
    const { canonicalPath } = await loadCanonical({ NEXT_PUBLIC_SITE_URL: "https://store.example" });
    expect(canonicalPath("/")).toBe("/");
    expect(canonicalPath("about")).toBe("/about");
    expect(canonicalPath("/about/")).toBe("/about");
    expect(canonicalPath("//about//faq//")).toBe("/about/faq");
    expect(canonicalPath("/categories?page=2")).toBe("/categories");
    expect(canonicalPath("/categories#top")).toBe("/categories");
    expect(canonicalPath("/search?q=milk&page=3")).toBe("/search");
    expect(canonicalPath("")).toBe("/");
  });
});

describe("E-5 — publication rule", () => {
  it("publishes an absolute canonical for an explicit origin", async () => {
    const { canonicalUrl, canonicalMetadata } = await loadCanonical({
      NEXT_PUBLIC_SITE_URL: "https://store.example",
    });
    expect(canonicalUrl("/about")).toBe("https://store.example/about");
    expect(canonicalUrl("/")).toBe("https://store.example/");
    expect(canonicalMetadata("/faq")).toEqual({ alternates: { canonical: "https://store.example/faq" } });
  });

  it("never publishes a canonical in a production build without an explicit origin", async () => {
    const { canonicalUrl, canonicalMetadata } = await loadCanonical({ NODE_ENV: "production" });
    expect(canonicalUrl("/about")).toBeNull();
    expect(canonicalMetadata("/about")).toEqual({});
  });

  it("publishes the localhost fallback outside production so the contract is verifiable locally", async () => {
    const { canonicalUrl } = await loadCanonical({ NODE_ENV: "development" });
    expect(canonicalUrl("/about")).toBe("http://localhost:3000/about");
  });

  it("prefers the explicit origin over every fallback (trailing slash normalized)", async () => {
    const { canonicalUrl } = await loadCanonical({
      NEXT_PUBLIC_SITE_URL: "https://store.example/",
      VERCEL_PROJECT_PRODUCTION_URL: "other.example",
      VERCEL_URL: "preview.vercel.app",
    });
    expect(canonicalUrl("/about")).toBe("https://store.example/about");
  });

  it("keeps the query string out of the canonical (no duplicate URLs)", async () => {
    const { canonicalUrl } = await loadCanonical({ NEXT_PUBLIC_SITE_URL: "https://store.example" });
    expect(canonicalUrl("/search?q=milk")).toBe("https://store.example/search");
  });
});

describe("E-5 — origin validation (no misleading canonical)", () => {
  it("never advertises a per-deployment preview host in production", async () => {
    const { canonicalUrl, SITE_ORIGIN_INFO } = await loadCanonical({
      NODE_ENV: "production",
      VERCEL_URL: "hyper-git-feature-abc.vercel.app",
    });
    expect(SITE_ORIGIN_INFO.previewHost).toBe(true);
    expect(SITE_ORIGIN_INFO.explicit).toBe(false);
    expect(canonicalUrl("/about")).toBeNull();
  });

  it("never advertises a preview host even outside production", async () => {
    const { canonicalUrl } = await loadCanonical({ NODE_ENV: "development", VERCEL_URL: "preview.vercel.app" });
    expect(canonicalUrl("/about")).toBeNull();
  });

  it.each([
    ["store.example", "not an absolute URL"],
    ["ftp://store.example", "unsupported protocol"],
    ["http://store.example", "plain http"],
    ["https://store.example/shop", "a path is not allowed"],
    ["https://store.example/?utm=1", "query string"],
    ["https://user:pw@store.example", "credentials"],
  ])("rejects NEXT_PUBLIC_SITE_URL=%s (%s) and publishes no canonical in production", async (value, reason) => {
    const { canonicalUrl, SITE_ORIGIN_INFO } = await loadCanonical({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: value });
    expect(SITE_ORIGIN_INFO.invalidReason).toContain(reason);
    expect(SITE_ORIGIN_INFO.explicit).toBe(false);
    expect(canonicalUrl("/about")).toBeNull();
  });

  it("rejects a loopback origin in a production build", async () => {
    const { canonicalUrl, SITE_ORIGIN_INFO } = await loadCanonical({
      NODE_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3150",
    });
    expect(SITE_ORIGIN_INFO.invalidReason).toContain("loopback");
    expect(canonicalUrl("/")).toBeNull();
  });

  it("accepts a loopback http origin for local verification only", async () => {
    const { canonicalUrl } = await loadCanonical({ NODE_ENV: "development", NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3150" });
    expect(canonicalUrl("/faq")).toBe("http://127.0.0.1:3150/faq");
  });

  it("uses the platform production domain when no explicit origin is set", async () => {
    const { canonicalUrl } = await loadCanonical({ NODE_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "hyper.example.com" });
    expect(canonicalUrl("/")).toBe("https://hyper.example.com/");
  });
});
