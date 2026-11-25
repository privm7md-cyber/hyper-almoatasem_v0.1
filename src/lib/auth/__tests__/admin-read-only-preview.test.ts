// @vitest-environment node
// Isolated: real auth/policy code, deterministic SQL executor, no DB/network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  cookies: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
  user: vi.fn(),
  rate: vi.fn(),
  audit: vi.fn(),
  log: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  verifyDummy: vi.fn(),
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
  forbidden: vi.fn(() => { throw new Error("forbidden"); }),
}));
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, forbidden: mocks.forbidden }));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
vi.mock("@/lib/db", () => ({ prisma: {
  $queryRaw: mocks.query, $executeRaw: mocks.execute, $transaction: mocks.transaction,
  user: { findUnique: mocks.user },
} }));
vi.mock("@/lib/api/log-events", () => ({ logOperationalEvent: mocks.log }));
vi.mock("@/lib/auth/audit", () => ({ writeAuthAudit: mocks.audit }));
vi.mock("@/lib/auth/password", () => ({
  checkPasswordPolicy: () => null, hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword, verifyDummyPassword: mocks.verifyDummy,
}));
vi.mock("@/lib/auth/rate-limit", () => ({
  checkAndRecordRateLimit: mocks.rate,
  ipBucket: () => "ip", accountBucket: () => "account",
  IP_BUCKET_LIMIT: 20, ACCOUNT_BUCKET_LIMIT: 10,
}));

const TOKEN = "a".repeat(64); // Synthetic, never a real credential.
const USER = "00000000-0000-4000-8000-000000000001";
const SESSION = "00000000-0000-4000-8000-000000000002";
const tokenHash = createHash("sha256").update(TOKEN).digest("hex");
const NOW = Date.UTC(2026, 10, 12);
let requestHeaders: Headers;
let cookieToken: string | undefined;
let tokenState: "valid" | "unknown" | "revoked" | "expired";

async function load(flag: string | null = "1", mode = "development") {
  vi.stubEnv("ADMIN_READ_ONLY_PREVIEW", flag ?? undefined);
  vi.stubEnv("NODE_ENV", mode);
  vi.resetModules();
  return {
    policy: await import("@/lib/auth/admin-read-only-preview"),
    session: await import("@/lib/auth/session"),
    rbac: await import("@/lib/auth/rbac"),
    gates: await import("@/lib/api/route-auth"),
    login: await import("@/lib/auth/login"),
    actions: await import("@/app/actions/auth"),
    route: await import("@/app/api/admin/session/route"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requestHeaders = new Headers({ host: "localhost:3000" });
  cookieToken = TOKEN;
  tokenState = "valid";
  mocks.headers.mockImplementation(async () => requestHeaders);
  mocks.cookies.mockImplementation(async () => ({
    get: () => cookieToken ? { value: cookieToken } : undefined,
    set: mocks.setCookie, delete: mocks.deleteCookie,
  }));
  // Evaluate the actual SQL predicates against a synthetic stored row. If a
  // predicate is removed, revoked/expired fixtures would incorrectly return.
  mocks.query.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    expect(sql).toMatch(/^\s*SELECT id, user_id, expires_at, revoked_at/);
    expect(sql).toContain("WHERE token_hash = ?::text");
    expect(sql).toContain("AND revoked_at IS NULL");
    expect(sql).toContain("AND expires_at > now()");
    expect(values).toEqual([tokenHash]);
    expect(values).not.toContain(TOKEN);
    const storedHash = tokenState === "unknown" ? "other-hash" : tokenHash;
    const revokedAt = tokenState === "revoked" ? NOW - 1 : null;
    const expiresAt = tokenState === "expired" ? NOW : NOW + 8 * 3600_000;
    if (storedHash !== values[0] || revokedAt !== null || expiresAt <= NOW) return [];
    // Deliberately shifted decoded timestamp: SQL, not JS, is authoritative.
    return [{ id: SESSION, user_id: USER, expires_at: new Date(0), revoked_at: null }];
  });
  mocks.execute.mockResolvedValue(1);
  mocks.user.mockResolvedValue({
    id: USER, name: "Synthetic", email: "synthetic@example.invalid",
    isActive: true, deletedAt: null,
    userRoles: [
      { role: { name: "SUPER_ADMIN", isActive: true, rolePermissions: [
        { permission: { key: "orders.view", isActive: true } },
        { permission: { key: "orders.update", isActive: true } },
        { permission: { key: "prices.view", isActive: false } },
      ] } },
      { role: { name: "disabled", isActive: false, rolePermissions: [
        { permission: { key: "users.view", isActive: true } },
      ] } },
    ],
  });
  mocks.rate.mockResolvedValue({ allowed: true });
  mocks.audit.mockResolvedValue(undefined);
  mocks.verifyPassword.mockResolvedValue(true);
  mocks.hashPassword.mockResolvedValue("synthetic-hash");
});
afterEach(() => { vi.unstubAllEnvs(); });

function expectNoDatabaseCalls() {
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.user).not.toHaveBeenCalled();
  expect(mocks.rate).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
  expect(mocks.setCookie).not.toHaveBeenCalled();
  expect(mocks.deleteCookie).not.toHaveBeenCalled();
}

describe("admin preview session SQL and context", () => {
  it("validates the opaque hash with unchanged SQL and skips only last_seen_at", async () => {
    const { session } = await load();
    expect(session.SESSION_TTL_HOURS).toBe(8);
    expect(await session.validateSessionToken(TOKEN)).toEqual({ sessionId: SESSION, userId: USER });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["unknown", "revoked", "expired"] as const)("rejects %s using SQL, without telemetry", async (state) => {
    tokenState = state;
    const { session } = await load();
    expect(await session.validateSessionToken(TOKEN)).toBeNull();
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each([null, undefined, "", "short", "a".repeat(65)])("rejects malformed token shape without SQL (%s)", async (token) => {
    const { session } = await load();
    expect(await session.validateSessionToken(token)).toBeNull();
    expectNoDatabaseCalls();
  });
  it.each(["localhost", "LOCALHOST:3000", "127.0.0.1:65535", "[::1]", "[::1]:3000"])("allows strict development loopback Host %s", async (host) => {
    requestHeaders.set("host", host);
    const { session } = await load();
    expect(await session.validateSessionToken(TOKEN)).not.toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each([
    "example.invalid", "192.168.1.2:3000", "localhost.example.invalid", "127.1",
    "2130706433", "0x7f000001", "127.0.0.2", "::1", "[::ffff:127.0.0.1]",
    "http://localhost", "localhost@evil.invalid", "localhost/path", "localhost#x",
    "localhost?x", "localhost, evil.invalid", "localhost.", "localhost:",
    "localhost:0", "localhost:65536", "localhost:999999", "localhost:abc", "",
  ])("fails closed on invalid/non-loopback Host %s even with forwarded spoof", async (host) => {
    requestHeaders.set("host", host);
    requestHeaders.set("x-forwarded-host", "localhost:3000");
    vi.stubEnv("TRUSTED_PROXY", "1");
    const { session, login } = await load();
    expect(await session.validateSessionToken(TOKEN)).toBeNull();
    await expect(login.authenticateAdmin("synthetic@example.invalid", "synthetic-password")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoDatabaseCalls();
  });
  it.each([" localhost", "localhost ", "localhost\n", "localhost\r\n", "localhost\t", "localhost\u0000"])("rejects malformed raw Host authority %j", async (host) => {
    const { policy } = await load();
    expect(policy.isAdminPreviewLocalHost(host)).toBe(false);
  });
  it("does not use XFH, URL, toggles or cookies to recover a missing Host", async () => {
    requestHeaders.delete("host");
    requestHeaders.set("x-forwarded-host", "localhost:3000");
    requestHeaders.set("admin-read-only-preview", "1");
    const { session } = await load();
    expect(await session.validateSessionToken(TOKEN)).toBeNull();
    expectNoDatabaseCalls();
  });
  it("fails closed without request scope", async () => {
    mocks.headers.mockRejectedValue(new Error("no request"));
    const { session } = await load();
    expect(await session.validateSessionToken(TOKEN)).toBeNull();
    expectNoDatabaseCalls();
  });
  it.each([null, "0", "true"])("default-off/non-exact flag %s keeps telemetry", async (flag) => {
    const { session } = await load(flag, "production");
    expect(await session.validateSessionToken(TOKEN)).not.toBeNull();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][0].join("?")).toContain("UPDATE admin_sessions SET last_seen_at = now()");
    expect(mocks.headers).not.toHaveBeenCalled();
  });
  it.each(["production", "test"])("configured %s cannot activate preview or fall back to writes", async (mode) => {
    const { session, login } = await load("1", mode);
    expect(await session.validateSessionToken(TOKEN)).toBeNull();
    await expect(login.authenticateAdmin("synthetic@example.invalid", "synthetic-password")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoDatabaseCalls();
  });
  it("flag is captured at module startup, not toggled per request", async () => {
    const { policy } = await load();
    vi.stubEnv("ADMIN_READ_ONLY_PREVIEW", "0");
    expect(policy.isAdminReadOnlyPreviewConfigured()).toBe(true);
    expect(() => policy.assertAdminPreviewWritesAllowed()).toThrow();
  });
});

describe("authenticated reads and capability veto (no new RBAC grants)", () => {
  it("preserves grant union but refuses write capabilities, including requirePermission", async () => {
    const { rbac } = await load();
    const admin = await rbac.getCurrentAdmin();
    expect(admin?.permissions).toEqual(["orders.view", "orders.update"]);
    expect((await rbac.checkPermission("orders.view")).ok).toBe(true);
    expect(await rbac.checkPermission("orders.update")).toEqual({ ok: false, code: "FORBIDDEN" });
    await expect(rbac.requirePermission("orders.update")).rejects.toThrow("forbidden");
    expect(await rbac.requirePermission("orders.view")).toEqual(admin);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it(".view is not a grant and SUPER_ADMIN is not a wildcard", async () => {
    const { rbac, gates } = await load();
    expect(await rbac.checkPermission("users.view")).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await rbac.checkPermission("prices.view")).toEqual({ ok: false, code: "FORBIDDEN" });
    expect((await gates.denyUnless("users.view"))?.status).toBe(403);
  });
  it("reads still require a real token and active user", async () => {
    const { gates, rbac, route } = await load();
    cookieToken = undefined;
    expect((await gates.denyUnless("orders.view"))?.status).toBe(401);
    expect((await route.GET()).status).toBe(401);
    cookieToken = TOKEN;
    tokenState = "revoked";
    expect(await rbac.getCurrentAdmin()).toBeNull();
    tokenState = "expired";
    expect(await rbac.getCurrentAdmin()).toBeNull();
    tokenState = "valid";
    const user = await mocks.user();
    mocks.user.mockResolvedValue({ ...user, isActive: false });
    expect(await rbac.getCurrentAdmin()).toBeNull();
    mocks.user.mockResolvedValue({ ...user, deletedAt: new Date(NOW) });
    expect(await rbac.getCurrentAdmin()).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each([false, true])("session GET vetoes a non-loopback Host without a cookie, prefetch=%s", async (prefetch) => {
    cookieToken = undefined;
    requestHeaders.set("host", "remote.invalid");
    requestHeaders.set("x-forwarded-host", "localhost:3000");
    if (prefetch) requestHeaders.set("purpose", "prefetch");
    const { route } = await load();
    expect((await route.GET()).status).toBe(403);
    expectNoDatabaseCalls();
  });
  it("default-off session GET keeps unauthenticated behavior outside loopback", async () => {
    cookieToken = undefined;
    requestHeaders.set("host", "remote.invalid");
    const { route } = await load(null, "production");
    expect((await route.GET()).status).toBe(401);
    expectNoDatabaseCalls();
  });
  it("all four shared guards allow authenticated granted reads but veto writes/empty lists", async () => {
    const { gates } = await load();
    expect(await gates.denyUnless("orders.view")).toBeNull();
    expect(await gates.denyUnlessAll(["orders.view"])).toBeNull();
    expect(await gates.adminOrDeny("orders.view")).toHaveProperty("admin");
    expect(await gates.adminOrDenyAll(["orders.view"])).toHaveProperty("admin");
    expect((await gates.denyUnless("orders.update"))?.status).toBe(403);
    expect((await gates.denyUnlessAll(["orders.view", "orders.update"]))?.status).toBe(403);
    expect(await gates.adminOrDeny("orders.update")).toHaveProperty("denied.status", 403);
    expect(await gates.adminOrDenyAll(["orders.view", "orders.update"])).toHaveProperty("denied.status", 403);
    expect((await gates.denyUnlessAll([]))?.status).toBe(403);
    expect(await gates.adminOrDenyAll([])).toHaveProperty("denied.status", 403);
    expect((await gates.denyUnless("users.view"))?.status).toBe(403);
    requestHeaders.set("host", "remote.invalid");
    expect((await gates.denyUnless("orders.view"))?.status).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("default-off keeps ordinary RBAC write authorization and rejects missing grants", async () => {
    const { rbac, gates } = await load(null, "production");
    expect((await rbac.checkPermission("orders.update")).ok).toBe(true);
    expect(await gates.denyUnless("orders.update")).toBeNull();
    expect(await rbac.checkPermission("users.manage")).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mocks.execute).toHaveBeenCalled();
  });
  it("request headers/query/cookie and NEXT_PUBLIC flag cannot enable preview", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_READ_ONLY_PREVIEW", "1");
    requestHeaders.set("admin-read-only-preview", "1");
    requestHeaders.set("x-admin-read-only-preview", "1");
    requestHeaders.set("cookie", "ADMIN_READ_ONLY_PREVIEW=1");
    const { rbac, policy, session } = await load(null);
    expect(policy.isAdminReadOnlyPreviewConfigured()).toBe(false);
    expect((await rbac.checkPermission("orders.update")).ok).toBe(true);
    await session.validateSessionToken(TOKEN);
    expect(mocks.execute).toHaveBeenCalled();
  });
});

describe("raw admin action/core invocation before any DB or cookie mutation", () => {
  it.each(["development", "production"])("blocks login/logout/session cores in configured %s", async (mode) => {
    const { actions, session, login, route } = await load("1", mode);
    const form = new FormData();
    form.set("email", "synthetic@example.invalid");
    form.set("password", "synthetic-password");
    await expect(actions.loginAction({}, form)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(actions.logoutAction()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(login.authenticateAdmin("synthetic@example.invalid", "synthetic-password")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(login.changePassword(USER, "synthetic-password")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(session.createSession({ userId: USER })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(session.revokeSession(TOKEN)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(session.revokeAllSessions(USER)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(session.revokeAllSessions(USER, SESSION)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(session.setSessionCookie(TOKEN)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(session.clearSessionCookie()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const request = new Request("http://localhost:3000/api/admin/session?ADMIN_READ_ONLY_PREVIEW=0", {
      method: "POST", headers: { host: "localhost:3000", purpose: "prefetch", "x-admin-read-only-preview": "0" },
      body: JSON.stringify({ email: "synthetic@example.invalid", password: "synthetic-password" }),
    });
    expect((await route.POST(request)).status).toBe(403);
    expect((await route.DELETE(request)).status).toBe(403);
    expect(mocks.headers).not.toHaveBeenCalled();
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expectNoDatabaseCalls();
  });
  it("default-off core writes still execute with fixed eight-hour session lifetime", async () => {
    const { session, login } = await load(null, "production");
    mocks.query.mockResolvedValue([{ id: SESSION, user_id: USER, expires_at: new Date(NOW), revoked_at: null }]);
    await session.createSession({ userId: USER });
    const [strings, ...values] = mocks.query.mock.calls[0];
    expect(strings.join("?")).toContain("INSERT INTO admin_sessions");
    expect(values[2]).toBe(8);
    expect(await session.revokeSession(TOKEN)).toBe(true);
    expect(await session.revokeAllSessions(USER)).toBe(1);
    await session.setSessionCookie(TOKEN);
    await session.clearSessionCookie();
    expect(mocks.setCookie).toHaveBeenCalled();
    expect(mocks.deleteCookie).toHaveBeenCalledWith({
      name: "__Host-admin-session",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    mocks.transaction.mockResolvedValue(undefined);
    await login.changePassword(USER, "synthetic-password");
    expect(mocks.transaction).toHaveBeenCalled();
    const user = await mocks.user();
    mocks.user.mockResolvedValue({ ...user, passwordHash: "synthetic-hash" });
    mocks.query.mockResolvedValue([{ locked: false }]);
    await login.authenticateAdmin("synthetic@example.invalid", "synthetic-password");
    expect(mocks.rate).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });
});
