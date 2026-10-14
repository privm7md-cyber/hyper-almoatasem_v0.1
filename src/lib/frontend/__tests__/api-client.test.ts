// FE-1 api-client tests with mocked fetch only — zero real requests.
// Covers: success envelope, HTTP error w/ contract code, network failure,
// invalid JSON, error normalization, abort, secret-hygiene, path guard.
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError, apiRequest, displayFailure } from "../api-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api-client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns data+meta on success envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: { a: 1 }, meta: {} })));
    const res = await apiRequest<{ a: number }>("/api/store/cart");
    expect(res.data).toEqual({ a: 1 });
  });

  it("normalizes contract error codes with status mapping", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: "NOT_FOUND", message: "غير موجود.", details: null } }, 404),
      ),
    );
    const err = await apiRequest("/api/store/catalog/products/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    const app = err as AppError;
    expect(app.code).toBe("NOT_FOUND");
    expect(app.status).toBe(404);
    expect(app.retryable).toBe(false);
  });

  it("marks race losers retryable-after-reread (409)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: "CONFLICT", message: "تعارض.", details: null } }, 409),
      ),
    );
    const err = (await apiRequest("/api/store/orders").catch((e: unknown) => e)) as AppError;
    expect(err.retryable).toBe(true);
  });

  it("maps network failure to a generic message without internals", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const err = (await apiRequest("/api/store/cart").catch((e: unknown) => e)) as AppError;
    expect(err.code).toBe("INTERNAL");
    expect(err.message).not.toMatch(/fetch failed|ECONN|socket/i);
  });

  it("maps invalid JSON to a safe error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json{", { status: 200 })));
    const err = (await apiRequest("/api/store/cart").catch((e: unknown) => e)) as AppError;
    expect(err).toBeInstanceOf(AppError);
  });

  it("treats abort as cancellation, never as failure content", async () => {
    const dom = new DOMException("aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(dom));
    const err = (await apiRequest("/api/store/cart").catch((e: unknown) => e)) as AppError;
    expect(err.message).toBe("أُلغي الطلب.");
  });

  it("rejects non-relative paths (no absolute/backend URL assembly)", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(apiRequest("https://evil.example/x")).rejects.toBeInstanceOf(AppError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("never leaks secrets: error surfaces carry no request material", async () => {
    const secret = "REG_RATE_LIMIT_PHONE_SECRET=deadbeef-raw-token-xyz";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const err = (await apiRequest("/api/store/orders", { body: { idempotencyKey: secret } }).catch(
      (e: unknown) => e,
    )) as AppError;
    const surface = `${err.message} ${JSON.stringify(err.details)}`;
    expect(surface).not.toContain("deadbeef");
    expect(surface).not.toContain("REG_RATE_LIMIT");
  });
});

describe("displayFailure (FE-11 auth-aware hints)", () => {
  it("appends a re-login hint for UNAUTHENTICATED, keeping the server message first", () => {
    const out = displayFailure(new AppError("UNAUTHENTICATED", "Authentication required."), "fallback");
    expect(out.startsWith("Authentication required.")).toBe(true);
    expect(out).toMatch(/سجّل الدخول مجددًا/);
  });

  it("appends a permission hint for FORBIDDEN, keeping the server message first", () => {
    const out = displayFailure(new AppError("FORBIDDEN", "Forbidden."), "fallback");
    expect(out.startsWith("Forbidden.")).toBe(true);
    expect(out).toMatch(/لا تملك الصلاحية/);
  });

  it("returns the bare server message for non-auth failures", () => {
    expect(displayFailure(new AppError("CONFLICT", "تعارض."), "fallback")).toBe("تعارض.");
    expect(displayFailure(new AppError("VALIDATION", "خطأ."), "fallback")).toBe("خطأ.");
  });

  it("returns the fallback for non-AppError failures", () => {
    expect(displayFailure(new Error("boom"), "تعذّرت العملية.")).toBe("تعذّرت العملية.");
    expect(displayFailure(null, "تعذّرت العملية.")).toBe("تعذّرت العملية.");
  });
});
