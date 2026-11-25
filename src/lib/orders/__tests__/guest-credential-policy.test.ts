// A7 — the guest access policy must not regress.
//
// These tests pin the CONTRACT of the guest access paths, not their
// implementation:
//   * fixed TTLs — 90 days for the order credential, 24 hours for the
//     checkout recovery session; no sliding extension on read;
//   * hash-only storage — the raw bearer token is never persisted;
//   * the credential lives ONLY in an HttpOnly cookie, Secure in production,
//     SameSite=Lax, and its transport header is never a URL parameter;
//   * the recovery session is a DIFFERENT credential from the order
//     credential — separate cookie, separate header, separate TTL;
//   * reading an order NEVER extends a lifetime.
//
// The database-backed behaviour (real expiry, revocation, rotation) is
// asserted by the live harness in the run's evidence, not by a source scan;
// what is asserted here is the policy that governs it.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));
// The policy constants live next to the credential domain, which owns the DB
// client. The client is never used here — the policy is asserted statically.
vi.mock("@/lib/db", () => ({ prisma: {} }));
import { GUEST_ORDER_CREDENTIAL_TTL_DAYS, GUEST_ORDER_TOKEN_HEADER } from "@/lib/orders/guest-access";
import { GUEST_CHECKOUT_SESSION_TTL_HOURS } from "@/lib/orders/guest-checkout-session";
import {
  GUEST_ORDER_COOKIE_PREFIX_DEV,
  GUEST_ORDER_COOKIE_PREFIX_PROD,
  GUEST_TTL_SECONDS,
  guestOrderCookieName,
  isGuestOrderCookieName,
} from "@/lib/orders/guest-order-cookie";
import {
  GUEST_CHECKOUT_COOKIE_NAMES,
  GUEST_CHECKOUT_SESSION_HEADER,
  guestCheckoutCookieName,
  isGuestCheckoutCookieName,
  readGuestCheckoutToken,
} from "@/lib/orders/guest-checkout-cookie";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

function source(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

/** The SET clause of every UPDATE statement against a table. */
function updateSetClauses(text: string, table: string): string[] {
  const pattern = new RegExp(`UPDATE\\s+${table}[\\s\\S]{0,400}?;`, "gi");
  return (text.match(pattern) ?? []).map((statement) => {
    const setIndex = statement.search(/\bSET\b/i);
    if (setIndex === -1) return "";
    const rest = statement.slice(setIndex + 3);
    const whereIndex = rest.search(/\bWHERE\b/i);
    return whereIndex === -1 ? rest : rest.slice(0, whereIndex);
  });
}

describe("A7 — fixed TTLs", () => {
  it("keeps the guest order credential at 90 days", () => {
    expect(GUEST_ORDER_CREDENTIAL_TTL_DAYS).toBe(90);
  });

  it("keeps the cookie lifetime aligned with the credential lifetime", () => {
    expect(GUEST_TTL_SECONDS).toBe(90 * 24 * 3600);
    expect(GUEST_TTL_SECONDS / (24 * 3600)).toBe(GUEST_ORDER_CREDENTIAL_TTL_DAYS);
  });

  it("keeps the checkout recovery session at 24 hours", () => {
    expect(GUEST_CHECKOUT_SESSION_TTL_HOURS).toBe(24);
  });

  it("computes both expiries in SQL from now(), never from a sliding read", () => {
    const credential = source("src/lib/orders/guest-access.ts");
    expect(credential).toContain("now() + (${GUEST_ORDER_CREDENTIAL_TTL_DAYS}::text || ' days')::interval");
    const session = source("src/lib/orders/guest-checkout-session.ts");
    expect(session).toContain(
      "now() + (${GUEST_CHECKOUT_SESSION_TTL_HOURS}::text || ' hours')::interval",
    );
  });

  it("never extends an expiry on read — no UPDATE writes expires_at", () => {
    const credential = source("src/lib/orders/guest-access.ts");
    const credentialSets = updateSetClauses(credential, "guest_order_credentials");
    expect(credentialSets.length).toBeGreaterThan(0);
    for (const setClause of credentialSets) {
      expect(setClause).not.toContain("expires_at");
    }
    const session = source("src/lib/orders/guest-checkout-session.ts");
    const sessionSets = updateSetClauses(session, "guest_checkout_sessions");
    expect(sessionSets.length).toBeGreaterThan(0);
    for (const setClause of sessionSets) {
      expect(setClause).not.toContain("expires_at");
    }
  });
});

describe("A7 — hash-only storage", () => {
  it("stores only the hash of the token", () => {
    const credential = source("src/lib/orders/guest-access.ts");
    expect(credential).toContain("hashToken(token)");
    // The raw token is never part of an INSERT column list.
    expect(credential).not.toMatch(/INSERT INTO guest_order_credentials[^)]*token[^_]/i);
  });

  it("hashes the checkout session token the same way", () => {
    const session = source("src/lib/orders/guest-checkout-session.ts");
    expect(session).toContain("hashToken(token)");
  });
});

describe("A7 — the credential is an HttpOnly cookie", () => {
  it("uses the __Host- prefix in production and a separate dev name", () => {
    // `process.env.NODE_ENV` is read-only in the Node typings: the
    // environment is stubbed (and restored) instead of assigned.
    vi.stubEnv("NODE_ENV", "production");
    const prodName = guestOrderCookieName("11111111-1111-1111-1111-111111111111");
    vi.stubEnv("NODE_ENV", "development");
    const devName = guestOrderCookieName("11111111-1111-1111-1111-111111111111");
    vi.unstubAllEnvs();
    expect(prodName.startsWith(GUEST_ORDER_COOKIE_PREFIX_PROD)).toBe(true);
    expect(devName.startsWith(GUEST_ORDER_COOKIE_PREFIX_DEV)).toBe(true);
    expect(prodName.startsWith("__Host-")).toBe(true);
    expect(devName.startsWith("__Host-")).toBe(false);
    expect(isGuestOrderCookieName(prodName)).toBe(true);
    expect(isGuestOrderCookieName(devName)).toBe(true);
  });

  it("sets HttpOnly, SameSite=Lax, Secure in production and Path=/", () => {
    const actions = source("src/app/actions/orders.ts");
    const block = actions.slice(
      actions.indexOf("jar.set(guestOrderCookieName(orderId)"),
      actions.indexOf("jar.set(guestOrderCookieName(orderId)") + 400,
    );
    expect(block).toContain("httpOnly: true");
    expect(block).toContain('secure: process.env.NODE_ENV === "production"');
    expect(block).toContain('sameSite: "lax"');
    expect(block).toContain('path: "/"');
    expect(block).toContain("maxAge: GUEST_TTL_SECONDS");
  });

  it("carries the credential in a header, never in a URL", () => {
    expect(GUEST_ORDER_TOKEN_HEADER).toBe("x-guest-order-token");
    const credential = source("src/lib/orders/guest-access.ts");
    expect(credential).toContain('request.headers.get(GUEST_ORDER_TOKEN_HEADER)');
    expect(credential).not.toMatch(/searchParams\.get\(GUEST_ORDER_TOKEN_HEADER/);
  });
});

describe("A7 — the recovery session is a separate credential", () => {
  it("uses a different cookie name and a different header", () => {
    const checkoutName = guestCheckoutCookieName();
    const orderName = guestOrderCookieName("11111111-1111-1111-1111-111111111111");
    expect(checkoutName).not.toBe(orderName);
    expect(isGuestCheckoutCookieName(orderName)).toBe(false);
    expect(isGuestOrderCookieName(checkoutName)).toBe(false);
    expect(GUEST_CHECKOUT_SESSION_HEADER).not.toBe(GUEST_ORDER_TOKEN_HEADER);
    expect(GUEST_CHECKOUT_COOKIE_NAMES).not.toContain(orderName);
  });

  it("reads the session from its own header or cookie only", () => {
    const request = new Request("https://example.test/orders", {
      headers: {
        cookie: `${GUEST_CHECKOUT_COOKIE_NAMES[0]}=session-token; ${GUEST_ORDER_COOKIE_PREFIX_DEV}11111111-1111-1111-1111-111111111111=order-token`,
      },
    });
    expect(readGuestCheckoutToken(request)).toBe("session-token");
  });

  it("is read-only: no mutating route opts into the checkout session", () => {
    const guestAccess = source("src/lib/orders/guest-access.ts");
    // The opt-in flag exists, but the mutating routes must never pass it.
    expect(guestAccess).toContain("allowCheckoutSession");
    const mutatingRoutes = [
      "src/app/api/store/orders/[id]/cancel/route.ts",
      "src/app/api/store/orders/[id]/replacements/[replacementId]/decide/route.ts",
      "src/app/api/store/orders/route.ts",
      "src/app/api/store/orders/checkout-session/route.ts",
    ];
    for (const route of mutatingRoutes) {
      expect(source(route)).not.toContain("allowCheckoutSession");
    }
    // The READ routes are the only ones allowed to recover through it.
    expect(source("src/app/api/store/orders/[id]/route.ts")).toContain("allowCheckoutSession");
    expect(source("src/app/api/store/orders/[id]/replacements/route.ts")).toContain(
      "allowCheckoutSession",
    );
  });
});
