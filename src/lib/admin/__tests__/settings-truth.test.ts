// @vitest-environment node
// ADM-10 (final round) — the settings screen must not lie.
//
// Source-level proof: for every registered key the test scans the application
// source and decides whether ANY file reads that key. The registry's
// `consumedByApp` claim must match that scan exactly, so the badge the
// operator reads ("consumed" / "stored only") is evidence, not a promise.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { SETTING_REGISTRY } from "@/lib/admin/settings-registry";

const ROOT = resolve(__dirname, "../../../..");
const SRC = join(ROOT, "src");

/** Files that NAME a key without reading it. */
const NOT_CONSUMERS = new Set([
  "src/lib/admin/settings-registry.ts",
  "src/lib/admin/terminology.ts",
  "src/app/admin/settings/page.tsx",
]);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      sourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function consumerFiles(key: string): string[] {
  const needle = `"${key}"`;
  const single = `'${key}'`;
  const hits: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (NOT_CONSUMERS.has(rel)) continue;
    const text = readFileSync(file, "utf8");
    if (text.includes(needle) || text.includes(single)) hits.push(rel);
  }
  return hits;
}

describe("ADM-10 — settings consumption truth", () => {
  it("matches the registry claim for every key", () => {
    for (const entry of SETTING_REGISTRY) {
      const consumers = consumerFiles(entry.key);
      if (entry.consumedByApp) {
        expect(consumers.length, entry.key).toBeGreaterThan(0);
        expect(entry.consumedAt, entry.key).not.toBeNull();
      } else {
        expect(consumers, entry.key).toEqual([]);
        expect(entry.consumedAt, entry.key).toBeNull();
      }
    }
  });

  it("points every consumed key at a line that really names it", () => {
    const consumed = SETTING_REGISTRY.filter((entry) => entry.consumedByApp);
    expect(consumed.length).toBeGreaterThan(0);
    for (const entry of consumed) {
      const where = entry.consumedAt as string;
      const [file, line] = where.split(":");
      const lines = readFileSync(resolve(ROOT, file), "utf8").split("\n");
      expect(lines[Number(line) - 1], where).toContain(entry.key);
    }
  });

  it("keeps every non-consumed key explicit about being stored only", () => {
    for (const entry of SETTING_REGISTRY.filter((item) => !item.consumedByApp)) {
      expect(entry.effect.length, entry.key).toBeGreaterThan(20);
      expect(entry.effect, entry.key).toMatch(/مفيش|محفوظ|محجوز|مجمّد|قرار/);
    }
  });
});
