// ADMIN RESPONSIVE / KEYBOARD / STATE QA — the measurable half of the visual
// QA pass. For every admin route it records, at three widths:
//   • horizontal overflow (does the page scroll sideways? it must not)
//   • whether the rail is the navigation or the overlay trigger is
//   • the tap-target size of the primary controls
// and, at desktop width:
//   • the keyboard path from the top of the document to the main content
//   • whether the focused element paints a visible focus ring
//   • the empty / error / forbidden state the page renders when its data fails
//
// Usage: node scripts/admin-qa-responsive.mjs [--out <file.json>]

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
const OUT = argValue("--out", "docs/data-sources/perf/admin-preview/admin-responsive-qa.json");
const CREDENTIALS =
  argValue("--credentials", process.env.PREVIEW_ADMIN_CREDENTIALS) ||
  "C:/Users/MEGA/.qoder/preview-admin-credentials.txt";

const ROUTES = [
  "/admin",
  "/admin/orders",
  "/admin/products",
  "/admin/products/new",
  "/admin/taxonomy",
  "/admin/inventory",
  "/admin/promotions",
  "/admin/coupons",
  "/admin/customers",
  "/admin/users",
  "/admin/roles",
  "/admin/permissions",
  "/admin/settings",
  "/admin/delivery-zones",
  "/admin/audit-logs",
];

const WIDTHS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
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
const context = await browser.newContext({ locale: "ar-EG" });
const page = await context.newPage();

await page.goto(`${BASE_URL}/admin/login`, { waitUntil: "domcontentloaded" });
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', password);
await Promise.all([
  page.waitForURL((url) => !url.pathname.endsWith("/admin/login"), { timeout: 30000 }),
  page.click('button[type="submit"]'),
]);

const report = { baseUrl: BASE_URL, widths: [], keyboard: [], states: [] };

/* ------------------------------------------------------------- per width */
for (const size of WIDTHS) {
  await page.setViewportSize({ width: size.width, height: size.height });
  for (const route of ROUTES) {
    const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle" });
    const measured = await page.evaluate(() => {
      const doc = document.documentElement;
      const rail = document.querySelector(".adm-rail");
      const trigger = document.querySelector(".adm-rail-trigger");
      const railVisible = rail ? getComputedStyle(rail).display !== "none" : false;
      const triggerVisible = trigger ? getComputedStyle(trigger).display !== "none" : false;

      const controls = Array.from(
        document.querySelectorAll(".adm-btn, .adm-rail-link, .adm-input, .adm-select, .adm-tab"),
      ).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          label: (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      });
      const tooSmall = controls.filter((c) => c.h > 0 && c.h < 32);

      return {
        horizontalOverflow: doc.scrollWidth - doc.clientWidth,
        railVisible,
        triggerVisible,
        controlCount: controls.length,
        tooSmallTargets: tooSmall.slice(0, 8),
        tooSmallCount: tooSmall.length,
      };
    });
    report.widths.push({ width: size.name, route, status: response?.status() ?? 0, ...measured });
  }
}

/* --------------------------------------------------------------- keyboard */
await page.setViewportSize({ width: 1440, height: 1000 });
for (const route of ["/admin", "/admin/products", "/admin/inventory", "/admin/settings"]) {
  await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.body.focus());
  const path = [];
  for (let i = 0; i < 24; i += 1) {
    await page.keyboard.press("Tab");
    const step = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const ring =
        style.outlineStyle !== "none" && parseFloat(style.outlineWidth || "0") > 0
          ? `outline ${style.outlineWidth}`
          : style.boxShadow && style.boxShadow !== "none"
            ? "box-shadow"
            : "none";
      return {
        tag: el.tagName,
        label: (el.innerText || el.getAttribute("aria-label") || el.getAttribute("name") || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 45),
        ring,
      };
    });
    if (!step) break;
    path.push(step);
  }
  const mainReached = await page.evaluate(() => {
    const main = document.querySelector("main#main");
    return main ? main.contains(document.activeElement) || document.activeElement === main : false;
  });
  report.keyboard.push({
    route,
    tabStops: path.length,
    withoutFocusRing: path.filter((s) => s.ring === "none").length,
    reachedMain: mainReached,
    firstStops: path.slice(0, 6),
  });
}

/* ----------------------------------------------------------------- states */
// The empty state and the error state are proven by the unit suite (which
// mocks the data source); here we prove the FORBIDDEN state on the live app:
// a route that requires a permission, requested without a session.
const anonymous = await browser.newContext({ locale: "ar-EG" });
const anonPage = await anonymous.newPage();
for (const route of ["/admin", "/admin/orders", "/admin/settings", "/admin/audit-logs"]) {
  const response = await anonPage.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
  report.states.push({
    state: "forbidden",
    route,
    status: response?.status() ?? 0,
    redirectedTo: new URL(anonPage.url()).pathname,
  });
}
await anonymous.close();

await browser.close();

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
console.log(`wrote ${OUT}`);

// --------------------------------------------------------------- summary
const overflow = report.widths.filter((w) => w.horizontalOverflow > 1);
const noRing = report.keyboard.filter((k) => k.withoutFocusRing > 0);
console.log(`horizontal overflow rows: ${overflow.length}`);
if (overflow.length) console.log(overflow.map((o) => `  ${o.width} ${o.route} +${o.horizontalOverflow}px`).join("\n"));
console.log(`routes with a focus-less tab stop: ${noRing.length}`);
console.log(`forbidden states: ${report.states.map((s) => `${s.route}->${s.status}@${s.redirectedTo}`).join(", ")}`);
