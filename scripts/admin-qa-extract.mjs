// ADMIN QA EXTRACTOR — reads the rendered admin and records, per route, the
// page's own self-description: the heading, the intro line, every panel title
// and sub-line, every explanatory note, every form field label, and every
// button. This is the raw material for the content/usability QA — the evidence
// comes from the live page, not from memory.
//
// Usage: node scripts/admin-qa-extract.mjs [--out <file.json>]

import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const BASE_URL = (argValue("--base", process.env.PREVIEW_BASE_URL) || "http://localhost:3132").replace(
  /\/$/,
  "",
);
const OUT = argValue(
  "--out",
  "docs/data-sources/perf/admin-preview/admin-qa-extract.json",
);
const CREDENTIALS =
  argValue("--credentials", process.env.PREVIEW_ADMIN_CREDENTIALS) ||
  "C:/Users/MEGA/.qoder/preview-admin-credentials.txt";

const ROUTES = [
  { slug: "home", route: "/admin" },
  { slug: "orders", route: "/admin/orders" },
  { slug: "products", route: "/admin/products" },
  { slug: "product-new", route: "/admin/products/new" },
  { slug: "taxonomy", route: "/admin/taxonomy" },
  { slug: "inventory", route: "/admin/inventory" },
  { slug: "promotions", route: "/admin/promotions" },
  { slug: "coupons", route: "/admin/coupons" },
  { slug: "customers", route: "/admin/customers" },
  { slug: "users", route: "/admin/users" },
  { slug: "roles", route: "/admin/roles" },
  { slug: "permissions", route: "/admin/permissions" },
  { slug: "settings", route: "/admin/settings" },
  { slug: "delivery-zones", route: "/admin/delivery-zones" },
  { slug: "audit-logs", route: "/admin/audit-logs" },
];

/** Detail pages are reached through the list pages, so their ids are discovered live. */
const DETAIL_SOURCES = [
  { from: "/admin/products", match: /\/admin\/products\/[0-9a-f-]{36}/, slug: "product-detail" },
  { from: "/admin/orders", match: /\/admin\/orders\/[0-9a-f-]{36}/, slug: "order-detail" },
  { from: "/admin/customers", match: /\/admin\/customers\/[0-9a-f-]{36}/, slug: "customer-detail" },
  { from: "/admin/coupons", match: /\/admin\/coupons\/[0-9a-f-]{36}/, slug: "coupon-detail" },
  { from: "/admin/promotions", match: /\/admin\/promotions\/[0-9a-f-]{36}/, slug: "promotion-detail" },
  { from: "/admin/users", match: /\/admin\/users\/[0-9a-f-]{36}/, slug: "user-detail" },
  { from: "/admin/roles", match: /\/admin\/roles\/[0-9a-f-]{36}/, slug: "role-detail" },
  { from: "/admin/audit-logs", match: /\/admin\/audit-logs\/[0-9a-f-]{36}/, slug: "audit-detail" },
];

function readCredentials(file) {
  const text = readFileSync(file, "utf8");
  const email = text.match(/email:\s*(\S+)/i)?.[1];
  const password = text.match(/password:\s*(\S+)/i)?.[1];
  if (!email || !password) throw new Error("credentials file is missing email/password");
  return { email, password };
}

const { email, password } = readCredentials(CREDENTIALS);

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "ar-EG",
});
const page = await context.newPage();

await page.goto(`${BASE_URL}/admin/login`, { waitUntil: "domcontentloaded" });
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', password);
await Promise.all([
  page.waitForURL((url) => !url.pathname.endsWith("/admin/login"), { timeout: 30000 }),
  page.click('button[type="submit"]'),
]);

const results = [];

async function extract(route) {
  const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle" });
  const extracted = await page.evaluate(() => {
    const text = (node) => (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
    const many = (selector) => Array.from(document.querySelectorAll(selector)).map(text).filter(Boolean);

    const head = {
      eyebrow: text(document.querySelector(".adm-eyebrow")),
      title: text(document.querySelector(".adm-page-title")),
      intro: text(document.querySelector(".adm-page-intro")),
    };

    const panels = Array.from(document.querySelectorAll(".adm-panel")).map((panel) => ({
      full: text(panel.querySelector(".adm-panel-title")),
      sub: text(panel.querySelector(".adm-panel-sub")),
    }));

    const notes = many(".adm-note");
    const labels = many(".adm-label");
    const buttons = many(".adm-btn");
    const sections = many(".adm-section-title");
    const sectionIntros = many(".adm-section-intro");

    const headings = Array.from(document.querySelectorAll("h1,h2,h3")).map(
      (el) => `${el.tagName}:${text(el)}`,
    );

    const empties = many(".adm-empty-title, .adm-empty-hint");
    const rail = many(".adm-rail-link, .adm-nav-link");
    const captions = many("caption");
    const tableHeaders = many("thead th");

    const dir = document.documentElement.getAttribute("dir") || "";
    const lang = document.documentElement.getAttribute("lang") || "";
    const canvasCount = document.querySelectorAll("canvas").length;

    return {
      head,
      panels,
      notes,
      labels,
      buttons,
      sections,
      sectionIntros,
      headings,
      empties,
      rail,
      captions,
      tableHeaders,
      dir,
      lang,
      canvasCount,
      bodyText: text(document.body).slice(0, 6000),
    };
  });
  return { route, status: response?.status() ?? 0, ...extracted };
}

for (const entry of ROUTES) {
  results.push({ slug: entry.slug, ...(await extract(entry.route)) });
}

// The detail pages are found by following the real links on their list pages.
for (const source of DETAIL_SOURCES) {
  await page.goto(`${BASE_URL}${source.from}`, { waitUntil: "networkidle" });
  const href = await page.evaluate((match) => {
    const re = new RegExp(match);
    const link = Array.from(document.querySelectorAll("a[href]")).find((a) => re.test(a.getAttribute("href")));
    return link ? link.getAttribute("href") : null;
  }, source.match);
  if (!href) continue;
  results.push({ slug: source.slug, ...(await extract(href)) });
}

await browser.close();

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ baseUrl: BASE_URL, routes: results }, null, 2), "utf8");
console.log(`wrote ${OUT} (${results.length} routes)`);
