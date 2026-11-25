// @vitest-environment node
// E-5 closure — the canonical contract is applied to the RIGHT pages.
//
// A canonical on a private page is a mistake (it tells a crawler which URL to
// keep for a page that must never be indexed); a missing canonical on an
// indexable page is a duplicate-content hole. This test reads the SOURCE and
// compares three sets:
//   1. the static pages the sitemap publishes,
//   2. the static pages that publish a canonical,
//   3. the pages that are explicitly noindex (they must publish NONE).
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../../..");
const APP = join(ROOT, "src/app");

function pageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "_prototype" || entry.name === "api") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) pageFiles(path, out);
    else if (entry.isFile() && entry.name === "page.tsx") out.push(path);
  }
  return out;
}

const pages = pageFiles(APP).map((file) => {
  const src = readFileSync(file, "utf8");
  const rel = relative(APP, file).replace(/\\/g, "/");
  const route = ("/" + rel.replace(/page\.tsx$/, "").replace(/\[(\w+)\]/g, ":$1")).replace(/\/$/, "") || "/";
  return {
    file,
    route,
    src,
    noindex: /robots:\s*\{\s*index:\s*false/.test(src),
    hasCanonical: src.includes("canonicalMetadata("),
  };
});

const sitemapSrc = readFileSync(join(APP, "sitemap.ts"), "utf8");
const staticPages = [...sitemapSrc.matchAll(/\{ path: "([^"]+)"/g)].map((m) => m[1]);

describe("E-5 — canonical coverage", () => {
  it("every static page in the sitemap also publishes a canonical", () => {
    for (const path of staticPages) {
      const route = path === "/" ? "/" : path;
      const page = pages.find((p) => p.route === route);
      expect(page, `no page for ${route}`).toBeTruthy();
      expect(page!.hasCanonical, `${route} must publish a canonical`).toBe(true);
    }
  });

  it("no static page outside the sitemap publishes a canonical", () => {
    const published = pages
      .filter((page) => page.hasCanonical && !page.route.includes(":"))
      .map((page) => page.route);
    expect(published.sort()).toEqual([...staticPages].sort());
  });

  it("the dynamic catalogue routes publish a canonical built from the CANONICAL slug", () => {
    for (const prefix of ["/p/", "/c/", "/brand/"]) {
      const page = pages.find((p) => p.route.startsWith(prefix));
      expect(page, `missing dynamic page for ${prefix}`).toBeTruthy();
      expect(page!.hasCanonical).toBe(true);
      expect(page!.src).toContain("wireSlugOf(");
    }
  });

  it("no private, session, cart, search or admin page publishes a canonical", () => {
    const offenders = pages
      .filter((page) => page.hasCanonical)
      .filter((page) => page.noindex || page.route.startsWith("/admin") || page.route === "/cart" ||
        page.route === "/checkout" || page.route === "/login" || page.route === "/register" ||
        page.route === "/account" || page.route.startsWith("/orders") || page.route === "/search" ||
        page.route.startsWith("/order-confirmation"))
      .map((page) => page.route);
    expect(offenders).toEqual([]);
  });

  it("keeps the search page noindex and canonical-free", () => {
    const search = pages.find((page) => page.route === "/search");
    expect(search).toBeTruthy();
    expect(search!.noindex).toBe(true);
    expect(search!.hasCanonical).toBe(false);
  });
});
