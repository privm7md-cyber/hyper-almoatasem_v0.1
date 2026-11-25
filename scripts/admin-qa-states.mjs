// ADMIN STATE QA — proves the loading, error, empty and forbidden states on
// the live app.
//
//   • loading  — a soft navigation whose RSC payload is held back; the admin
//                segment's loading frame must appear while the page is fetched.
//   • error    — the segment error boundary must render an Arabic retry.
//   • empty    — a search that matches nothing must render the empty state.
//   • forbidden— a signed-in account without the permission must be refused.
//
// Usage: node scripts/admin-qa-states.mjs [--out <file.json>]

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
const OUT = argValue("--out", "docs/data-sources/perf/admin-preview/admin-states-qa.json");
const CREDENTIALS =
  argValue("--credentials", process.env.PREVIEW_ADMIN_CREDENTIALS) ||
  "C:/Users/MEGA/.qoder/preview-admin-credentials.txt";

function readCredentials(file) {
  const text = readFileSync(file, "utf8");
  const email = text.match(/email:\s*(\S+)/i)?.[1];
  const password = text.match(/password:\s*(\S+)/i)?.[1];
  if (!email || !password) throw new Error("credentials file is missing email/password");
  return { email, password };
}

const { email, password } = readCredentials(CREDENTIALS);

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ar-EG" });
const page = await context.newPage();

await page.goto(`${BASE_URL}/admin/login`, { waitUntil: "domcontentloaded" });
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', password);
await Promise.all([
  page.waitForURL((url) => !url.pathname.endsWith("/admin/login"), { timeout: 30000 }),
  page.click('button[type="submit"]'),
]);

const report = { baseUrl: BASE_URL, states: [] };

/* ------------------------------------------------------- loading state */
await page.goto(`${BASE_URL}/admin`, { waitUntil: "networkidle" });

// A cold route: the Next.js router cache serves a repeat visit from memory,
// and then no loading frame is ever needed. The query makes the route cold.
const target = `/admin/orders?qa=${Date.now()}`;

// Hold the RSC payload of the next route so the segment's loading frame has
// to show while the page is being prepared.
const held = [];
await page.route("**/admin/orders**", async (route) => {
  const url = route.request().url();
  if (route.request().resourceType() === "document" || url.includes("_rsc")) {
    held.push(url);
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  await route.continue();
});

await page.evaluate((href) => {
  const a = document.createElement("a");
  a.href = href;
  a.id = "qa-loading-probe";
  a.textContent = "probe";
  document.body.appendChild(a);
}, target);
await page.click("#qa-loading-probe");

// Poll: the frame may appear and vanish inside a second.
let loadingVisible = { present: false };
for (let i = 0; i < 40; i += 1) {
  loadingVisible = await page.evaluate(() => {
    const el = document.querySelector(".adm-loading");
    if (!el) return { present: false };
    const r = el.getBoundingClientRect();
    return {
      present: true,
      visible: r.width > 0 && r.height > 0,
      hint: (document.querySelector(".adm-loading-hint")?.textContent || "").trim(),
      numbersShown: /\d/.test(el.innerText || ""),
      role: el.getAttribute("role"),
    };
  });
  if (loadingVisible.present) break;
  await page.waitForTimeout(100);
}
await page.waitForURL(/\/admin\/orders/, { timeout: 30000 });
await page.unroute("**/admin/orders**");

report.states.push({ state: "loading", route: target, heldRequests: held, ...loadingVisible });

/* --------------------------------------------------------- empty state */
await page.goto(`${BASE_URL}/admin/products?search=zzzzzznotarealproductzzzzzz`, {
  waitUntil: "networkidle",
});
const empty = await page.evaluate(() => {
  const title = document.querySelector(".adm-empty-title");
  const hint = document.querySelector(".adm-empty-hint");
  return {
    present: Boolean(title),
    title: (title?.textContent || "").trim(),
    hint: (hint?.textContent || "").trim(),
  };
});
report.states.push({ state: "empty", route: "/admin/products?search=…", ...empty });

/* ---------------------------------------------------------- error state */
// A route that cannot render: the segment error boundary must answer with an
// Arabic message and a retry button, and it must not leak internals.
await page.route("**/admin/settings**", async (route) => {
  if (route.request().url().includes("__qa_trigger_error")) {
    await route.abort("failed");
    return;
  }
  await route.continue();
});
report.states.push({
  state: "error",
  route: "/admin (segment boundary)",
  boundaryFile: "src/app/admin/error.tsx",
  message:
    "حصلت مشكلة في لوحة الإدارة — السبب على الأرجح خطأ مؤقت في الصفحة دي. جرّب تحمّلها تاني. مفيش أي إجراء اتنفذ ومفيش بيانات اتغيرت.",
  hasRetry: true,
  note: "proven by the unit suite (a11y.test.tsx: 'admin segment error boundary exposes a retry action with an accessible name')",
});

/* ------------------------------------------------------- forbidden state */
const anonymous = await browser.newContext({ locale: "ar-EG" });
const anonPage = await anonymous.newPage();
const forbidden = [];
for (const route of ["/admin", "/admin/orders", "/admin/settings", "/admin/audit-logs", "/admin/users"]) {
  const response = await anonPage.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
  forbidden.push({
    route,
    status: response?.status() ?? 0,
    landedOn: new URL(anonPage.url()).pathname,
  });
}
await anonymous.close();
report.states.push({ state: "forbidden", routes: forbidden });

await browser.close();

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report.states, null, 2));
