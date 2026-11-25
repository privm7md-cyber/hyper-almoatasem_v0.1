// @vitest-environment node
// Census + direct handler tests: real guards, no proxy, no DB/network.
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import ts from "typescript";
import { NextRequest } from "next/server";
// Installed package still exports the legacy helper name despite proxy docs.
import { unstable_doesMiddlewareMatch as doesProxyMatch } from "next/experimental/testing/server";

const mocks = await vi.hoisted(async () => {
  // Next normally initializes this before its runtime modules are imported.
  const { AsyncLocalStorage } = await import("node:async_hooks");
  Object.assign(globalThis, { AsyncLocalStorage });
  return { dbAccess: vi.fn(), headers: vi.fn() };
});
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, {
  get(_target, key) {
    mocks.dbAccess(String(key));
    throw new Error("Unexpected database access in isolated preview census");
  },
}) }));
vi.mock("next/headers", () => ({
  headers: mocks.headers,
  cookies: async () => ({ get: () => ({ value: "a".repeat(64) }) }),
}));
vi.mock("@/lib/api/log-events", () => ({ logOperationalEvent: vi.fn() }));

const ROOT = resolve(__dirname, "../../../..");
const ADMIN_API = join(ROOT, "src/app/api/admin");
const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const METHODS = new Set([...MUTATIONS, "GET", "HEAD", "OPTIONS"]);
const UUID = "00000000-0000-4000-8000-000000000001";

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() && entry.name !== "__tests__" ? routeFiles(path) :
      entry.isFile() && entry.name === "route.ts" ? [path] : [];
  });
}

const census = routeFiles(ADMIN_API).flatMap((file) => {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const exports = source.statements.filter((node) =>
    ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
  );
  // Reject unknown export forms rather than silently omitting a new handler.
  const otherMethods = exports.flatMap((node) => ts.isVariableStatement(node) ?
    node.declarationList.declarations.map((d) => d.name.getText(source)).filter((n) => METHODS.has(n)) : []);
  expect(otherMethods, file).toEqual([]);
  for (const node of source.statements) {
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const clause = node.exportClause;
      const names = clause && ts.isNamedExports(clause) ? clause.elements.map((e) => e.name.text) : ["*"];
      expect(names.some((n) => METHODS.has(n) || n === "*"), file).toBe(false);
    }
  }
  return exports.flatMap((node) => {
    if (!ts.isFunctionDeclaration(node) || !node.name || !METHODS.has(node.name.text)) return [];
    const method = node.name.text;
    const calls: string[] = [];
    function visit(n: ts.Node) {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) calls.push(n.expression.text);
      ts.forEachChild(n, visit);
    }
    if (node.body) visit(node.body);
    return [{ file, route: relative(ADMIN_API, file).replace(/\\/g, "/"), method, calls }];
  });
});

beforeAll(() => {
  vi.stubEnv("ADMIN_READ_ONLY_PREVIEW", "1");
  vi.stubEnv("NODE_ENV", "development");
  mocks.headers.mockResolvedValue(new Headers({ host: "localhost:3000", purpose: "prefetch" }));
  vi.resetModules();
});
afterAll(() => { vi.unstubAllEnvs(); });

const directGuards = new Set([
  "denyUnless", "denyUnlessAll", "denyUnlessAny", "adminOrDeny", "adminOrDenyAll", "adminOrDenyAny", "adminSessionOrDeny", "checkPermission", "requirePermission", "requirePermissionAny",
]);

// A POST that is READ-ONLY by design. The coupon preview takes a sample basket
// in the body but performs no write (no usage bump, no audit row). It is kept
// out of the "mutation must be blocked before DB" loop because in preview mode
// it is supposed to read real prices. Its write-free source shape is asserted
// separately below.
const READ_ONLY_POST_ROUTES = new Set(["coupons/[id]/preview/route.ts"]);

describe("complete admin handler census", () => {
  it("enumerates all handlers, with no mutation auth gaps or read-only claims", () => {
    expect(census.length).toBeGreaterThan(100);
    const mutations = census.filter((row) => MUTATIONS.has(row.method));
    expect(new Set(mutations.map((r) => r.method))).toEqual(MUTATIONS);
    for (const row of census) {
      const guarded = row.calls.some((c) => directGuards.has(c)) ||
        (row.method === "PATCH" && ["coupons/[id]/route.ts", "promotions/[id]/route.ts"].includes(row.route) && row.calls.includes("requireWrite")) ||
        (row.route === "session/route.ts" && row.calls.includes(row.method === "GET" ? "getCurrentAdmin" : "denyAdminPreviewRequest"));
      expect(guarded, `${row.method} ${row.route}`).toBe(true);
    }
    const facts = {
      scope: "Isolated source census and direct invocations only; no live/authenticated UI no-write verification.",
      routeFiles: routeFiles(ADMIN_API).length, handlers: census.length, mutations: mutations.length,
      methods: [...MUTATIONS], handlersByRoute: census,
      exceptions: ["session POST/DELETE: explicit transport/core veto", "coupon/promotion PATCH: unconditional requireWrite -> checkPermission", "coupons/[id]/preview POST: read-only transport for a sample basket; excluded from the mutation loop"],
    };
    console.info(`PREVIEW census: ${facts.routeFiles} route files; ${facts.handlers} handlers; ${facts.mutations} mutations`);
    const evidenceDir = process.env.PREVIEW_EVIDENCE_DIRECTORY;
    if (evidenceDir) writeFileSync(join(evidenceDir, "PREVIEW-census.json"), JSON.stringify(facts, null, 2));
  });

  it("keeps the read-only coupon preview POST free of writes and behind a guard", () => {
    const file = join(ADMIN_API, "coupons/[id]/preview/route.ts");
    const source = readFileSync(file, "utf8");
    expect(source).toContain("denyUnless(");
    for (const write of ["$executeRaw", "$transaction", "auditInTx", ".create(", ".update(", ".delete(", ".upsert("]) {
      expect(source, write).not.toContain(write);
    }
  });

  for (const row of census.filter((r) => MUTATIONS.has(r.method) && !READ_ONLY_POST_ROUTES.has(r.route))) {
    it(`blocks direct ${row.method} ${row.route} before DB (prefetch bypass)`, async () => {
      mocks.dbAccess.mockClear();
      const routeModule = await import(/* @vite-ignore */ row.file.replace(/\\/g, "/"));
      const request = new Request(`http://localhost:3000/api/admin/${row.route.replace("/route.ts", "")}?ADMIN_READ_ONLY_PREVIEW=0`, {
        method: row.method,
        headers: {
          host: "localhost:3000", "content-type": "application/json", purpose: "prefetch",
          "next-router-prefetch": "1", "admin-read-only-preview": "0", "x-forwarded-host": "evil.invalid",
        },
        body: JSON.stringify({}),
      });
      const response = await routeModule[row.method](request, { params: Promise.resolve({
        id: UUID, itemId: UUID, variantId: UUID, addressId: UUID,
        permissionId: UUID, roleId: UUID, targetId: UUID, key: "site_name",
      }) });
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("FORBIDDEN");
      expect(mocks.dbAccess).not.toHaveBeenCalled();
    });
  }
});

describe("proxy early preview veto (not the only boundary)", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("blocks %s on admin pages/API/login without session", async (method) => {
    const { proxy } = await import("@/proxy");
    for (const path of ["/admin", "/admin/login", "/admin/orders", "/api/admin", "/api/admin/session", "/api/admin/orders"]) {
      const result = proxy(new NextRequest(`http://localhost:3000${path}`, {
        method, headers: { host: "localhost:3000" },
      }));
      expect(result.status).toBe(403);
      expect(result.headers.get("location")).toBeNull();
    }
  });
  it.each(["GET", "HEAD", "OPTIONS"])("allows safe local %s to reach API authentication", async (method) => {
    const { proxy } = await import("@/proxy");
    expect(proxy(new NextRequest("http://localhost:3000/api/admin/session", {
      method, headers: { host: "[::1]:3000", "x-forwarded-host": "remote.invalid" },
    })).status).toBe(200);
  });
  it.each(["remote.invalid", "localhost.evil.invalid", "localhost:65536", "http://localhost", ""])("fails closed on Host %s with forwarded spoof", async (host) => {
    const { proxy } = await import("@/proxy");
    expect(proxy(new NextRequest("http://localhost:3000/api/admin/session", {
      headers: { host, "x-forwarded-host": "localhost:3000" },
    })).status).toBe(403);
  });
  it("keeps storefront methods untouched", async () => {
    const { proxy } = await import("@/proxy");
    expect(proxy(new NextRequest("http://localhost:3000/api/store/orders", {
      method: "POST", headers: { host: "localhost:3000" },
    })).status).toBe(200);
  });
  it("records spoofed prefetch matcher bypass; direct handler tests enforce the independent boundary", async () => {
    const { config } = await import("@/proxy");
    for (const headers of [{ purpose: "prefetch" }, { "next-router-prefetch": "1" }]) {
      expect(doesProxyMatch({ config, nextConfig: {}, url: "/api/admin/session", headers })).toBe(false);
    }
  });
  it("production/default-off preserves proxy behavior; request toggles are ineffective", async () => {
    vi.stubEnv("ADMIN_READ_ONLY_PREVIEW", undefined);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_ADMIN_READ_ONLY_PREVIEW", "1");
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const result = proxy(new NextRequest("http://localhost:3000/api/admin/session?ADMIN_READ_ONLY_PREVIEW=1", {
      method: "POST", headers: { host: "localhost:3000", "admin-read-only-preview": "1", cookie: "ADMIN_READ_ONLY_PREVIEW=1" },
    }));
    expect(result.status).toBe(200);
  });
});
