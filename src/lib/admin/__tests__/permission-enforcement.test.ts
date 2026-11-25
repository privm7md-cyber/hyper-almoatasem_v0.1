// @vitest-environment node
// E-3 closure — NO permission key may be "provisioned but unbound".
//
// The previous review could only prove that 30 of the 33 catalogued keys were
// enforced somewhere in the API. The three remaining keys were granted by the
// seed and displayed in the admin UI, yet nothing in the code consumed them:
//   • delivery.view  — the delivery-zone screens were gated by settings.view
//   • delivery.assign — no assignment feature existed at all
//   • reports.view   — no reporting surface existed at all
//
// This test scans the SOURCE and proves, for every catalogued key, that it is
// consumed by a server-side guard (a route guard, a delegated check, or a
// server-side capability gate). A key that appears ONLY in the catalogue and
// the seed FAILS the test — that is the whole point of the file.
//
// It also pins the E-3 decisions so a later change cannot silently widen or
// narrow them:
//   • delivery zones READ  = delivery.view OR settings.view
//   • delivery zones WRITE = settings.manage AND delivery.assign
//   • the financial dashboard aggregate = orders.view AND prices.view AND
//     reports.view
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { PERMISSION_GROUPS } from "@/lib/admin/terminology";

const ROOT = resolve(__dirname, "../../../..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      sourceFiles(path, out);
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

type Mode = "single" | "all" | "any" | "dynamic" | "session";

interface Hit {
  file: string;
  mode: Mode;
}

const GUARDS: { re: RegExp; mode: Mode }[] = [
  { re: /denyUnlessAll\(\s*\[([^\]]*)\]/g, mode: "all" },
  { re: /adminOrDenyAll\(\s*\[([^\]]*)\]/g, mode: "all" },
  { re: /denyUnlessAny\(\s*\[([^\]]*)\]/g, mode: "any" },
  { re: /denyUnless\(\s*"([^"]+)"/g, mode: "single" },
  { re: /adminOrDeny\(\s*"([^"]+)"/g, mode: "single" },
  { re: /checkPermission\(\s*"([^"]+)"/g, mode: "single" },
  { re: /adminSessionOrDeny\(\s*"([^"]+)"/g, mode: "session" },
  { re: /required\.push\(\s*"([^"]+)"/g, mode: "dynamic" },
];

const routeHits = new Map<string, Hit[]>();
const serverHits = new Map<string, Hit[]>();

function record(map: Map<string, Hit[]>, key: string, hit: Hit) {
  const list = map.get(key) ?? [];
  list.push(hit);
  map.set(key, list);
}

for (const file of sourceFiles(join(ROOT, "src"))) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const isRoute = rel.startsWith("src/app/api/") && rel.endsWith("/route.ts");
  const src = readFileSync(file, "utf8");
  for (const { re, mode } of GUARDS) {
    re.lastIndex = 0;
    for (const match of src.matchAll(re)) {
      const keys = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      if (keys.length === 0 && match[1].trim() && match[1].trim() !== "null") keys.push(match[1].trim());
      for (const key of keys) record(isRoute ? routeHits : serverHits, key, { file: rel, mode });
    }
  }
  if (!isRoute) {
    // Server-side capability gates (`can("orders.view", "prices.view")`).
    for (const match of src.matchAll(/\bcan\(\s*"([^"]+)"([^)]*)\)/g)) {
      const keys = [match[1], ...[...match[2].matchAll(/"([^"]+)"/g)].map((m) => m[1])];
      for (const key of keys) record(serverHits, key, { file: rel, mode: "single" });
    }
  }
}

const catalogueKeys = [...new Set(PERMISSION_GROUPS.flatMap((group) => group.permissions.map((p) => p.key)))].sort();

describe("E-3 — every catalogued permission is consumed by a server-side guard", () => {
  it("binds all 33 keys (route guard, delegated check, or server capability gate)", () => {
    const unbound = catalogueKeys.filter(
      (key) => (routeHits.get(key) ?? []).length === 0 && (serverHits.get(key) ?? []).length === 0,
    );
    expect(unbound, `unbound permission keys: ${unbound.join(", ")}`).toEqual([]);
  });

  it("`delivery.view` is enforced on the delivery-zone read path (any-of with settings.view)", () => {
    const hits = routeHits.get("delivery.view") ?? [];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.mode === "any")).toBe(true);
    expect(hits.map((hit) => hit.file)).toContain("src/app/api/admin/delivery-zones/route.ts");
  });

  it("`delivery.assign` is enforced on the delivery-zone write path (all-of with settings.manage)", () => {
    const hits = routeHits.get("delivery.assign") ?? [];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.mode === "all")).toBe(true);
    const files = hits.map((hit) => hit.file);
    expect(files).toContain("src/app/api/admin/delivery-zones/route.ts");
    expect(files).toContain("src/app/api/admin/delivery-zones/[id]/route.ts");
  });

  it("`reports.view` is enforced on the dashboard financial aggregate", () => {
    const hits = serverHits.get("reports.view") ?? [];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((hit) => hit.file)).toContain("src/lib/admin/dashboard.ts");
  });

  it("keeps the read path a union and the write path an intersection (no silent widening)", () => {
    const read = readFileSync(join(ROOT, "src/app/api/admin/delivery-zones/route.ts"), "utf8");
    expect(read).toContain('denyUnlessAny(["delivery.view", "settings.view"])');
    expect(read).toContain('adminOrDenyAll(["settings.manage", "delivery.assign"])');
    const patch = readFileSync(join(ROOT, "src/app/api/admin/delivery-zones/[id]/route.ts"), "utf8");
    expect(patch).toContain('adminOrDenyAll(["settings.manage", "delivery.assign"])');
  });

  it("never lets the delivery-zone write path be reached by `delivery.assign` alone", () => {
    const read = readFileSync(join(ROOT, "src/app/api/admin/delivery-zones/route.ts"), "utf8");
    // `settings.manage` must stay in the write gate — the fee is a
    // store-wide money change (same trust class as store settings).
    expect(read).not.toMatch(/denyUnlessAny\(\s*\[\s*"delivery\.assign"/);
  });

  it("keeps `notifications.view` bound to the inbox read endpoints", () => {
    const hits = routeHits.get("notifications.view") ?? [];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((hit) => hit.file)).toContain("src/app/api/admin/notifications/route.ts");
  });
});
