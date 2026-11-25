// ============================================================================
// ADMIN PREVIEW CAPTURE — opens the real admin panel in a real browser,
// signs in with the preview owner account, walks every section and writes a
// screenshot of each one.
//
// Nothing here fabricates a screen: every PNG is a picture of the running
// app at http://localhost:3132 (or $PREVIEW_BASE_URL). Console errors and
// failed requests are collected per page and printed, so a broken page cannot
// hide behind a nice-looking screenshot.
//
// The password is NEVER stored in this repository. It is read at runtime from
// the credentials file that `scripts/preview-set-admin-password.mjs` wrote
// outside the repo (override with PREVIEW_ADMIN_CREDENTIALS).
//
// Usage:
//   node scripts/preview-shots.mjs [--out <dir>] [--base <url>] [--width 1440]
// ============================================================================

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
};

const BASE_URL = (argValue("--base", process.env.PREVIEW_BASE_URL) || "http://localhost:3132").replace(
  /\/$/,
  "",
);
const OUT_DIR = path.resolve(
  argValue("--out", path.join("docs", "data-sources", "perf", "admin-preview")),
);
const WIDTH = Number(argValue("--width", "1440"));
const HEIGHT = Number(argValue("--height", "900"));
const CREDENTIALS = path.resolve(
  argValue(
    "--credentials",
    process.env.PREVIEW_ADMIN_CREDENTIALS || "C:/Users/MEGA/.qoder/preview-admin-credentials.txt",
  ),
);

/** The sections the owner asked to review, in the order they appear in the rail. */
const PAGES = [
  { slug: "01-home", route: "/admin", title: "الرئيسية — مركز التشغيل" },
  { slug: "02-orders", route: "/admin/orders", title: "الطلبات" },
  { slug: "03-products", route: "/admin/products", title: "المنتجات" },
  { slug: "04-product-new", route: "/admin/products/new", title: "إضافة منتج" },
  { slug: "05-taxonomy", route: "/admin/taxonomy", title: "التصنيفات والعلامات" },
  { slug: "06-inventory", route: "/admin/inventory", title: "المخزون" },
  { slug: "07-promotions", route: "/admin/promotions", title: "العروض والخصومات" },
  { slug: "08-coupons", route: "/admin/coupons", title: "أكواد الخصم" },
  { slug: "09-customers", route: "/admin/customers", title: "العملاء" },
  { slug: "10-users", route: "/admin/users", title: "المستخدمون" },
  { slug: "11-roles", route: "/admin/roles", title: "أدوار الموظفين" },
  { slug: "12-permissions", route: "/admin/permissions", title: "صلاحيات المستخدمين" },
  { slug: "13-settings", route: "/admin/settings", title: "إعدادات المتجر" },
  { slug: "14-delivery-zones", route: "/admin/delivery-zones", title: "مناطق التوصيل" },
  { slug: "15-audit-logs", route: "/admin/audit-logs", title: "سجل التغييرات" },
];

/** Detail pages, discovered from the real lists — no hard-coded ids. */
const DETAIL_SOURCES = [
  { from: "/admin/products", match: /\/admin\/products\/[0-9a-f-]{36}/, slug: "16-product-detail" },
  { from: "/admin/orders", match: /\/admin\/orders\/[0-9a-f-]{36}/, slug: "17-order-detail" },
  { from: "/admin/customers", match: /\/admin\/customers\/[0-9a-f-]{36}/, slug: "18-customer-detail" },
];

/** The two other widths the owner asked to check. */
const RESPONSIVE = [
  {
    name: "tablet",
    width: 834,
    height: 1112,
    routes: ["/admin", "/admin/products", "/admin/orders", "/admin/inventory", "/admin/customers"],
  },
  {
    name: "mobile",
    width: 390,
    height: 844,
    routes: ["/admin", "/admin/products", "/admin/orders", "/admin/inventory", "/admin/customers"],
  },
];

function readCredentials(file) {
  if (!existsSync(file)) throw new Error(`credentials file not found: ${file}`);
  const text = readFileSync(file, "utf8");
  const email = text.match(/email:\s*(\S+)/i)?.[1];
  const password = text.match(/password:\s*(\S+)/i)?.[1];
  if (!email || !password) throw new Error("credentials file is missing email/password");
  return { email, password };
}

async function main() {
  const { email, password } = readCredentials(CREDENTIALS);
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    locale: "ar-EG",
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) =>
    failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText}`),
  );

  // ---------------------------------------------------------------- sign in
  await page.goto(`${BASE_URL}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith("/admin/login"), { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ]);
  console.log(`signed in → ${page.url()}`);

  // ------------------------------------------------------------ walk pages
  const report = [];

  const capture = async (target, { slug, title, route }) => {
    const before = consoleErrors.length;
    const failedBefore = failedRequests.length;
    const response = await target.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle" });
    // Let the entrance motion settle so the capture is not a half-drawn frame.
    await target.waitForTimeout(2200);

    const shot = path.join(OUT_DIR, `${slug}.png`);
    await target.screenshot({ path: shot, fullPage: true });

    const resources = await target.evaluate(() =>
      performance.getEntriesByType("resource").map((entry) => ({
        name: entry.name,
        bytes: entry.transferSize,
        kind: entry.initiatorType,
      })),
    );
    const threeChunk = resources.filter((r) => /three|webgl|\.glsl/i.test(r.name));
    const status = response ? response.status() : 0;

    const entry = {
      title,
      route,
      status,
      url: target.url(),
      screenshot: path.relative(process.cwd(), shot).replace(/\\/g, "/"),
      consoleErrors: consoleErrors.slice(before),
      failedRequests: failedRequests.slice(failedBefore),
      resourceCount: resources.length,
      transferredBytes: resources.reduce((sum, r) => sum + (r.bytes || 0), 0),
      threeRelatedResources: threeChunk.map((r) => r.name),
    };
    report.push(entry);
    console.log(
      `${String(status).padEnd(3)} ${route.padEnd(30)} errors=${entry.consoleErrors.length} failed=${entry.failedRequests.length} -> ${slug}.png`,
    );
    return entry;
  };

  for (const entry of PAGES) {
    await capture(page, entry);
  }

  // ------------------------------------------------------- detail pages
  for (const source of DETAIL_SOURCES) {
    await page.goto(`${BASE_URL}${source.from}`, { waitUntil: "networkidle" });
    const href = await page.evaluate((pattern) => {
      const re = new RegExp(pattern);
      const link = [...document.querySelectorAll("a[href]")]
        .map((a) => a.getAttribute("href"))
        .find((h) => h && re.test(h));
      return link || null;
    }, source.match.source);
    if (!href) {
      console.log(`?? no detail link found on ${source.from} - ${source.slug} skipped`);
      continue;
    }
    await capture(page, { slug: source.slug, title: `تفاصيل (${source.from})`, route: href });
  }

  // ------------------------------------------------------- responsive pass
  for (const size of RESPONSIVE) {
    const sized = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
      locale: "ar-EG",
      storageState: await context.storageState(),
    });
    const sizedPage = await sized.newPage();
    for (const route of size.routes) {
      const slug = `19-${size.name}-${route.replace(/\//g, "-").replace(/^-/, "")}`;
      await capture(sizedPage, { slug, title: `${size.name} - ${route}`, route });
    }
    await sized.close();
  }

  // ------------------------------------------------- reduced-motion check
  const reduced = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    locale: "ar-EG",
    reducedMotion: "reduce",
    storageState: await context.storageState(),
  });
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(`${BASE_URL}/admin`, { waitUntil: "networkidle" });
  await reducedPage.waitForTimeout(2500);
  await reducedPage.screenshot({ path: path.join(OUT_DIR, "20-reduced-motion-home.png"), fullPage: true });
  const reducedResources = await reducedPage.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => entry.name),
  );
  const reducedThree = reducedResources.filter((name) => /three|webgl/i.test(name));
  const reducedMotion = {
    screenshot: "20-reduced-motion-home.png",
    threeRelatedResources: reducedThree,
    canvasPresent: await reducedPage.evaluate(() => Boolean(document.querySelector("canvas"))),
  };
  console.log(`reduced-motion: three chunks=${reducedThree.length} canvas=${reducedMotion.canvasPresent}`);
  await reduced.close();

  await writeFile(
    path.join(OUT_DIR, "capture-report.json"),
    JSON.stringify(
      { baseUrl: BASE_URL, viewport: { width: WIDTH, height: HEIGHT }, reducedMotion, pages: report },
      null,
      2,
    ),
    "utf8",
  );

  await browser.close();

  const bad = report.filter((p) => p.status !== 200 || p.consoleErrors.length || p.failedRequests.length);
  if (bad.length) {
    console.log(`\n${bad.length} page(s) reported problems — see capture-report.json`);
  } else {
    console.log("\nall pages returned 200 with no console errors and no failed requests");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
