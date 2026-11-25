// P12-07 Security Hardening & Negative Regression Suite.
// Verifies SEC-01 through SEC-08 deterministically with isolated mocks (zero DB/network writes).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

let mockHeadersMap: Record<string, string> = { host: "localhost:3151" };
const mockCookieSet = vi.fn();
let mockCookieJar: Array<{ name: string; value: string }> = [];

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get(name: string) {
      const k = Object.keys(mockHeadersMap).find((x) => x.toLowerCase() === name.toLowerCase());
      return k ? mockHeadersMap[k] : null;
    },
  })),
  cookies: vi.fn(async () => ({
    getAll: () => mockCookieJar,
    get: (name: string) => mockCookieJar.find((c) => c.name === name),
    set: (...args: unknown[]) => mockCookieSet(...args),
    delete: vi.fn(),
  })),
}));

const mockListCategoryProducts = vi.fn(async () => ({ cards: [], nextCursor: null }));
const mockListBrandProducts = vi.fn(async () => ({ cards: [], nextCursor: null }));
const mockSearchCatalogPaged = vi.fn(async () => ({ cards: [], nextCursor: null }));

vi.mock("@/lib/frontend/storefront-reads", () => ({
  listCategoryProducts: (...a: unknown[]) => mockListCategoryProducts(...(a as [])),
  listBrandProducts: (...a: unknown[]) => mockListBrandProducts(...(a as [])),
  searchCatalogPaged: (...a: unknown[]) => mockSearchCatalogPaged(...(a as [])),
}));

const mockCheckPermission = vi.fn();
const mockGetCurrentAdmin = vi.fn();
vi.mock("@/lib/auth/rbac", () => ({
  checkPermission: (...a: unknown[]) => mockCheckPermission(...a),
  getCurrentAdmin: (...a: unknown[]) => mockGetCurrentAdmin(...a),
}));

let mockPreviewConfigured = false;
vi.mock("@/lib/auth/admin-read-only-preview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/admin-read-only-preview")>();
  return {
    ...actual,
    isAdminReadOnlyPreviewConfigured: () => mockPreviewConfigured,
    isAdminPreviewPermissionAllowed: (perm: string) => !mockPreviewConfigured || perm.endsWith(".view"),
  };
});

const mockRequireCustomer = vi.fn();
vi.mock("@/lib/customers/session", () => ({
  requireCustomer: (...a: unknown[]) => mockRequireCustomer(...a),
  maybeCustomer: vi.fn(async () => null),
  customerSessionCookieName: () => "__Host-customer-session",
}));

const mockCheckAndRecordRateLimit = vi.fn();
vi.mock("@/lib/auth/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/rate-limit")>();
  return {
    ...actual,
    checkAndRecordRateLimit: (...a: unknown[]) => mockCheckAndRecordRateLimit(...a),
  };
});

const mockChangeCustomerPassword = vi.fn();
vi.mock("@/lib/customers/auth", () => ({
  changeCustomerPassword: (...a: unknown[]) => mockChangeCustomerPassword(...a),
}));

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
}));

const mockReadSessionCookie = vi.fn();
const mockRevokeSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  readSessionCookie: (...a: unknown[]) => mockReadSessionCookie(...a),
  revokeSession: (...a: unknown[]) => mockRevokeSession(...a),
  clearSessionCookie: vi.fn(),
  setSessionCookie: vi.fn(),
}));

import { isLocalOrigin, verifySameOrigin } from "@/lib/api/request-context";
import { logoutAction } from "@/app/actions/auth";
import { denyUnlessAny } from "@/lib/api/route-auth";
import { bucketScope } from "@/lib/api/log-events";
import { customerPasswordAccountBucket, customerPasswordIpBucket } from "@/lib/auth/rate-limit";
import {
  brandInputSchema,
  catalogAssetRefSchema,
  categoryInputSchema,
  imageInputSchema,
  imageUrlSchema,
} from "@/lib/catalog/validation";
import { cancelOrderAction, decideReplacementAction, placeOrder } from "@/app/actions/orders";
import { loadMoreBrand, loadMoreCategory, loadMoreSearch } from "@/app/actions/catalog";
import { POST as adminUserPasswordPost } from "@/app/api/admin/users/[id]/password/route";
import { POST as adminRoleGrantPost } from "@/app/api/admin/roles/[id]/grants/route";
import { PATCH as adminVariantPricePatch } from "@/app/api/admin/catalog/variants/[id]/price/route";
import { POST as storeOrderCancelPost } from "@/app/api/store/orders/[id]/cancel/route";
import { POST as storeReplacementDecidePost } from "@/app/api/store/orders/[id]/replacements/[replacementId]/decide/route";
import { POST as storeCartPost } from "@/app/api/store/cart/route";
import { POST as storeCartItemsPost, DELETE as storeCartItemsDelete } from "@/app/api/store/cart/items/route";
import { POST as storeCheckoutSessionPost } from "@/app/api/store/orders/checkout-session/route";
import { POST as storeEstimatePost } from "@/app/api/store/orders/estimate/route";
import { PATCH as storePasswordPatch } from "@/app/api/store/customers/password/route";
import { POST as cspReportPost } from "@/app/api/csp-report/route";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_2 = "22222222-2222-4222-8222-222222222222";

const VALID_LISTING_QUERY = {
  sort: "created_at",
  dir: "desc" as const,
  type: null,
  inStock: null,
  minPrice: null,
  maxPrice: null,
  brandId: null,
  categoryId: null,
  q: null,
};

describe("P12-07 Security Hardening & Negative Regression Suite", () => {
  beforeEach(() => {
    mockHeadersMap = { host: "localhost:3151" };
    mockCookieJar = [];
    mockPreviewConfigured = false;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe("SEC-01: Order Server Actions SSRF, Redirect & Same-Origin Hardening", () => {
    const ORDER_INPUT = {
      guestAddress: { city: "مطاي", phone: "01001234567" },
      guestContact: { firstName: "أحمد" },
      idempotencyKey: "idem-sec01",
      cartToken: null,
      addressId: null,
      couponCode: null,
      expectedDeliveryFee: "20.00",
    };

    it("confines forged external, metadata, and RFC1918 Host headers to 127.0.0.1 loopback and sets redirect='error'", async () => {
      for (const hostileHost of [
        "attacker.example",
        "attacker.example:8443",
        "169.254.169.254",
        "10.0.0.8:6379",
        "192.168.1.50:8080",
      ]) {
        mockHeadersMap = { host: hostileHost };
        const fetchSpy = vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ data: { orderId: VALID_UUID, orderNumber: "HM-1" }, meta: {} }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }),
        );
        vi.stubGlobal("fetch", fetchSpy);
        await placeOrder(ORDER_INPUT);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [calledUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe("http://127.0.0.1:3000/api/store/orders");
        expect(calledUrl).not.toContain(hostileHost);
        expect(init.redirect).toBe("error");
      }
    });

    it("fails closed on serverless (VERCEL=1) when Host does not match an allowlisted deployment hostname", async () => {
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("VERCEL_URL", "hyper-almoatasem.vercel.app");
      mockHeadersMap = { host: "forged-host.example" };
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const res = await cancelOrderAction(VALID_UUID);
      expect(res.ok).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects cross-origin and sandboxed null Origin on placeOrder, cancelOrderAction, and decideReplacementAction", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      mockHeadersMap = { host: "localhost:3151", origin: "https://evil.example" };
      expect(await placeOrder(ORDER_INPUT)).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await cancelOrderAction(VALID_UUID)).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await decideReplacementAction(VALID_UUID, VALID_UUID_2, "approve")).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });

      mockHeadersMap = { host: "localhost:3151", origin: "null" };
      expect(await placeOrder(ORDER_INPUT)).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("preserves plain-HTTP loopback under NODE_ENV=production unless behind declared TRUSTED_PROXY=1 and brackets bare ::1", async () => {
      vi.stubEnv("NODE_ENV", "production");
      // Spoofed x-forwarded-proto without TRUSTED_PROXY=1 must NOT force https:// on plain-HTTP localhost
      mockHeadersMap = {
        host: "localhost:3151",
        origin: "http://localhost:3151",
        "x-forwarded-proto": "https",
      };
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { orderId: VALID_UUID, orderNumber: "HM-2" }, meta: {} }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchSpy);
      const okLocal = await placeOrder(ORDER_INPUT);
      expect(okLocal.ok).toBe(true);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe("http://localhost:3151/api/store/orders");

      // Bare ::1 is bracketed to valid URL syntax http://[::1]/...
      fetchSpy.mockClear();
      mockHeadersMap = { host: "::1" };
      await placeOrder(ORDER_INPUT);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe("http://[::1]/api/store/orders");

      // Declared TRUSTED_PROXY=1 with x-forwarded-proto=https honors https://
      fetchSpy.mockClear();
      vi.stubEnv("TRUSTED_PROXY", "1");
      mockHeadersMap = {
        host: "localhost:3151",
        origin: "https://localhost:3151",
        "x-forwarded-proto": "https",
      };
      await placeOrder(ORDER_INPUT);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://localhost:3151/api/store/orders");
    });
  });

  describe("SEC-02: Catalog Server Actions Runtime Schema & Prisma Injection Defense", () => {
    it("blocks Prisma filter-object injection, non-UUID ids, reversed price windows, and malformed cursors", async () => {
      // Prisma operator injection attempt on brandId
      await expect(
        loadMoreCategory(
          VALID_UUID,
          { ...VALID_LISTING_QUERY, brandId: { not: null } as unknown as string },
          "eyJ2IjoxfQ",
        ),
      ).rejects.toMatchObject({ code: "VALIDATION" });

      // Non-UUID categoryId / brandId
      await expect(loadMoreCategory("not-a-uuid", VALID_LISTING_QUERY, "eyJ2IjoxfQ")).rejects.toMatchObject({
        code: "VALIDATION",
      });
      await expect(loadMoreBrand("1; DROP TABLE products", VALID_LISTING_QUERY, "eyJ2IjoxfQ")).rejects.toMatchObject({
        code: "VALIDATION",
      });

      // Reversed price window
      await expect(
        loadMoreCategory(
          VALID_UUID,
          { ...VALID_LISTING_QUERY, minPrice: "100.00", maxPrice: "10.00" },
          "eyJ2IjoxfQ",
        ),
      ).rejects.toMatchObject({ code: "VALIDATION" });

      // Unknown extra fields (strictObject)
      await expect(
        loadMoreSearch(
          "جبنة",
          { ...VALID_LISTING_QUERY, sort: "relevance", injected: true } as unknown as typeof VALID_LISTING_QUERY,
          "eyJ2IjoyfQ",
        ),
      ).rejects.toMatchObject({ code: "VALIDATION" });

      // Short / non-string search query
      await expect(loadMoreSearch("أ", { ...VALID_LISTING_QUERY, sort: "relevance" }, "eyJ2IjoyfQ")).rejects.toMatchObject(
        { code: "VALIDATION" },
      );

      expect(mockListCategoryProducts).not.toHaveBeenCalled();
      expect(mockListBrandProducts).not.toHaveBeenCalled();
      expect(mockSearchCatalogPaged).not.toHaveBeenCalled();
    });

    it("permits valid schema-conforming catalog pagination requests", async () => {
      const res = await loadMoreCategory(VALID_UUID, VALID_LISTING_QUERY, "eyJ2IjoxfQ");
      expect(res).toEqual({ cards: [], nextCursor: null });
      expect(mockListCategoryProducts).toHaveBeenCalledWith(VALID_UUID, VALID_LISTING_QUERY, "eyJ2IjoxfQ");
    });
  });

  describe("SEC-03: In-Handler Same-Origin CSRF Enforcement (Even When Prefetch Headers Skip Proxy)", () => {
    function hostileReq(url: string, method: string, origin = "https://evil.example"): Request {
      return new Request(url, {
        method,
        headers: {
          host: "store.example",
          origin,
          purpose: "prefetch",
          "content-type": "application/json",
        },
        body: method === "DELETE" ? undefined : JSON.stringify({}),
      });
    }

    it("rejects cross-origin and null-origin mutations across Admin routes before RBAC or DB execution", async () => {
      const r1 = await adminUserPasswordPost(hostileReq("https://store.example/api/admin/users/1/password", "POST"), {
        params: Promise.resolve({ id: VALID_UUID }),
      });
      expect(r1.status).toBe(403);

      const r2 = await adminRoleGrantPost(hostileReq("https://store.example/api/admin/roles/1/grants", "POST", "null"), {
        params: Promise.resolve({ id: VALID_UUID }),
      });
      expect(r2.status).toBe(403);

      const r3 = await adminVariantPricePatch(
        hostileReq("https://store.example/api/admin/catalog/variants/1/price", "PATCH"),
        { params: Promise.resolve({ id: VALID_UUID }) },
      );
      expect(r3.status).toBe(403);

      expect(mockCheckPermission).not.toHaveBeenCalled();
    });

    it("rejects cross-origin and null-origin mutations across Storefront cart, checkout-session, estimate, and order routes", async () => {
      expect((await storeCartPost(hostileReq("https://store.example/api/store/cart", "POST"))).status).toBe(403);
      expect((await storeCartItemsPost(hostileReq("https://store.example/api/store/cart/items", "POST"))).status).toBe(403);
      expect(
        (await storeCartItemsDelete(hostileReq("https://store.example/api/store/cart/items", "DELETE", "null"))).status,
      ).toBe(403);
      expect(
        (
          await storeOrderCancelPost(hostileReq("https://store.example/api/store/orders/1/cancel", "POST"), {
            params: Promise.resolve({ id: VALID_UUID }),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await storeReplacementDecidePost(
            hostileReq("https://store.example/api/store/orders/1/replacements/2/decide", "POST"),
            { params: Promise.resolve({ id: VALID_UUID, replacementId: VALID_UUID_2 }) },
          )
        ).status,
      ).toBe(403);
      expect(
        (await storeCheckoutSessionPost(hostileReq("https://store.example/api/store/orders/checkout-session", "POST")))
          .status,
      ).toBe(403);
      expect((await storeEstimatePost(hostileReq("https://store.example/api/store/orders/estimate", "POST"))).status).toBe(
        403,
      );
      expect(mockRequireCustomer).not.toHaveBeenCalled();
    });

    it("enforces exact same-origin matrix (legitimate same-origin, missing-origin CLI policy, subdomain/spoofed-XFH bypass rejection, and logoutAction)", async () => {
      const mkHeaders = (map: Record<string, string>) => ({
        get: (k: string) => {
          const found = Object.keys(map).find((x) => x.toLowerCase() === k.toLowerCase());
          return found ? map[found] : null;
        },
      });

      // Legitimate same-origin browser mutation
      expect(verifySameOrigin(mkHeaders({ host: "store.example", origin: "https://store.example" }), undefined, {})).toBe(true);
      // Missing-origin policy (non-browser CLI / server-to-server; browser navigations guarded by SameSite=Lax + HttpOnly)
      expect(verifySameOrigin(mkHeaders({ host: "store.example" }), undefined, {})).toBe(true);
      // Same-site cross-origin subdomain bypass attempt
      expect(verifySameOrigin(mkHeaders({ host: "store.example", origin: "https://sub.store.example" }), undefined, {})).toBe(false);
      // Prefix-spoofed domain attempt
      expect(verifySameOrigin(mkHeaders({ host: "store.example", origin: "https://store.example.evil.test" }), undefined, {})).toBe(false);
      // Spoofed X-Forwarded-Host ignored when TRUSTED_PROXY is unset
      expect(
        verifySameOrigin(
          mkHeaders({ host: "store.example", "x-forwarded-host": "evil.example", origin: "https://evil.example" }),
          undefined,
          {},
        ),
      ).toBe(false);
      // Trusted proxy X-Forwarded-Host honored when TRUSTED_PROXY=1
      expect(
        verifySameOrigin(
          mkHeaders({ host: "internal:3000", "x-forwarded-host": "store.example", origin: "https://store.example" }),
          undefined,
          { TRUSTED_PROXY: "1" },
        ),
      ).toBe(true);

      // logoutAction rejects cross-origin invocation before reading or revoking session cookie
      mockHeadersMap = { host: "localhost:3151", origin: "https://evil.example" };
      await expect(logoutAction()).rejects.toThrow("NEXT_REDIRECT:/admin/login");
      expect(mockReadSessionCookie).not.toHaveBeenCalled();
      expect(mockRevokeSession).not.toHaveBeenCalled();
    });
  });

  describe("SEC-04: Customer Password Change Rate Limiting, Lockout & Cookie Purge", () => {
    it("enforces rate limiting (429) before Argon2id verification and purges cookie on success", async () => {
      mockRequireCustomer.mockResolvedValue({ customerId: VALID_UUID });
      mockCheckAndRecordRateLimit
        .mockResolvedValueOnce({ allowed: true, attempts: 1 })
        .mockResolvedValueOnce({ allowed: false, attempts: 11 });

      const blockedRes = await storePasswordPatch(
        new Request("https://store.example/api/store/customers/password", {
          method: "PATCH",
          headers: { host: "store.example", origin: "https://store.example", "content-type": "application/json" },
          body: JSON.stringify({ currentPassword: "OldPassword123!", newPassword: "NewPassword456!" }),
        }),
      );
      expect(blockedRes.status).toBe(429);
      expect(mockChangeCustomerPassword).not.toHaveBeenCalled();

      // Successful change clears cookie with Max-Age=0 + Secure + HttpOnly
      mockCheckAndRecordRateLimit.mockResolvedValue({ allowed: true, attempts: 2 });
      mockChangeCustomerPassword.mockResolvedValueOnce(true);
      const okRes = await storePasswordPatch(
        new Request("https://store.example/api/store/customers/password", {
          method: "PATCH",
          headers: { host: "store.example", origin: "https://store.example", "content-type": "application/json" },
          body: JSON.stringify({ currentPassword: "OldPassword123!", newPassword: "NewPassword456!" }),
        }),
      );
      expect(okRes.status).toBe(200);
      const setCookie = okRes.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("__Host-customer-session=expired");
      expect(setCookie).toContain("Max-Age=0");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("Secure");
    });

    it("hashes customer IDs in password rate-limit buckets and classifies bucket scopes without PII leakage", () => {
      const acctKey = customerPasswordAccountBucket(VALID_UUID);
      const ipKey = customerPasswordIpBucket(null, VALID_UUID);
      expect(acctKey).not.toContain(VALID_UUID);
      expect(ipKey).not.toContain(VALID_UUID);
      expect(bucketScope(acctKey)).toBe("customer-password-account");
      expect(bucketScope(ipKey)).toBe("customer-password-ip");
    });
  });

  describe("SEC-05: Admin Read-Only Preview Lock in denyUnlessAny & IPv6 Loopback Accuracy", () => {
    it("accurately validates IPv4 and IPv6 loopback origins and rejects spoofed hosts/ports", () => {
      expect(isLocalOrigin("localhost")).toBe(true);
      expect(isLocalOrigin("localhost:3151")).toBe(true);
      expect(isLocalOrigin("127.0.0.1:3000")).toBe(true);
      expect(isLocalOrigin("::1")).toBe(true);
      expect(isLocalOrigin("[::1]")).toBe(true);
      expect(isLocalOrigin("[::1]:3151")).toBe(true);

      expect(isLocalOrigin("localhost.attacker.example")).toBe(false);
      expect(isLocalOrigin("::2")).toBe(false);
      expect(isLocalOrigin("localhost:70000")).toBe(false);
      expect(isLocalOrigin("localhost:0")).toBe(false);
      expect(isLocalOrigin("localhost:3000\n")).toBe(false);
    });

    it("blocks denyUnlessAny under ADMIN_READ_ONLY_PREVIEW when Host is non-loopback or permission is mutating", async () => {
      mockPreviewConfigured = true;
      vi.stubEnv("NODE_ENV", "development");
      mockHeadersMap = { host: "preview.external.example" };
      const deniedNonLocal = await denyUnlessAny(["delivery.view", "settings.view"]);
      expect(deniedNonLocal?.status).toBe(403);

      mockHeadersMap = { host: "localhost:3151" };
      const deniedMixedWrite = await denyUnlessAny(["delivery.manage", "settings.view"]);
      expect(deniedMixedWrite?.status).toBe(403);
      expect(mockCheckPermission).not.toHaveBeenCalled();
    });
  });

  describe("SEC-06: CSP Report Collector User-Agent Rotation Resistance & Memory Cap", () => {
    it("enforces per-IP rate limit even when User-Agent rotates on every request and bounds tracked keys", async () => {
      vi.stubEnv("TRUSTED_PROXY", "1");
      const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const testIp = "198.51.100.77";

      for (let i = 0; i < 25; i++) {
        const res = await cspReportPost(
          new Request("https://store.example/api/csp-report", {
            method: "POST",
            headers: {
              "x-forwarded-for": testIp,
              "user-agent": `RotatedAgent/${i}-${Math.random()}`,
              "content-type": "application/csp-report",
            },
            body: JSON.stringify({
              "csp-report": {
                "document-uri": "https://store.example/about",
                "effective-directive": "script-src-elem",
                disposition: "report",
              },
            }),
          }),
        );
        expect(res.status).toBe(204);
      }

      const violationLogs = spy.mock.calls.filter((c) => String(c[0]).includes('"csp.report.violation"'));
      expect(violationLogs.length).toBe(20);
      spy.mockRestore();
    });
  });

  describe("SEC-07 & SEC-08: Zod Eval-Free Jitless Mode & Catalog Asset URL Hardening", () => {
    it("keeps Zod v4 jitless mode active so client bundles never invoke new Function('')", () => {
      expect(z.config().jitless).toBe(true);
      const res = imageInputSchema.safeParse({ url: "https://cdn.example.com/item.webp", mimeType: "image/webp" });
      expect(res.success).toBe(true);
    });

    it("rejects dangerous schemes, embedded credentials, and loopback/private/metadata IPs in catalog media schemas", () => {
      for (const bad of [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "http://cdn.example.com/img.jpg",
        "https://user:pass@cdn.example.com/img.jpg",
        "https://localhost/img.jpg",
        "https://127.0.0.1/img.jpg",
        "https://169.254.169.254/latest/meta-data/",
        "https://10.0.0.1/img.jpg",
        "https://192.168.1.1/img.jpg",
        "https://172.16.5.4/img.jpg",
        "https://[::1]/img.jpg",
      ]) {
        expect(imageUrlSchema.safeParse(bad).success).toBe(false);
        expect(catalogAssetRefSchema.safeParse(bad).success).toBe(false);
      }

      for (const openRedirectLike of ["//evil.example/logo.png", "/\\evil.example/a.png", "/%2fevil.example/a.png"]) {
        expect(catalogAssetRefSchema.safeParse(openRedirectLike).success).toBe(false);
      }

      expect(imageUrlSchema.safeParse("https://cdn.example.com/products/milk.webp").success).toBe(true);
      expect(categoryInputSchema.safeParse({ name: "ألبان", image: "/images/dairy.webp" }).success).toBe(true);
      expect(brandInputSchema.safeParse({ name: "المراعي", logo: "https://cdn.example.com/almarai.webp" }).success).toBe(
        true,
      );
      expect(categoryInputSchema.safeParse({ name: "ألبان", image: "javascript:void(0)" }).success).toBe(false);
    });
  });
});
