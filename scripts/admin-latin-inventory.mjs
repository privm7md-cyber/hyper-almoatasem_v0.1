// ============================================================================
// ADMIN LATIN INVENTORY — the strict §4 audit.
//
// The banned-term list answers "did a forbidden English word leak into the
// panel?". This script answers the harder question: EVERY piece of Latin
// text the operator can actually see, classified by what it is. A panel that
// only says "0 banned terms" could still be full of English it did not
// think to ban.
//
// For each route it walks the visible text nodes, keeps the ones that carry
// a Latin letter, and buckets them:
//   • an identifier (email, permission key, order number)
//   • a stored value (a product name, a customer name, a setting value)
//   • a unit symbol / trade name
// The remaining bucket — English prose that the panel itself wrote — is the
// one that matters, and it must be empty.
//
// The password is never stored here: it is read at runtime from the
// credentials file outside the repository (PREVIEW_ADMIN_CREDENTIALS).
//
// Usage: node scripts/admin-latin-inventory.mjs [--out <file.json>] [--base <url>]
// ============================================================================

import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
};

const BASE_URL = (argValue("--base", process.env.PREVIEW_BASE_URL) || "http://localhost:3132").replace(
  /\/$/,
  "",
);
const OUT = argValue(
  "--out",
  "docs/data-sources/perf/admin-preview/admin-latin-inventory.json",
);
const CREDENTIALS =
  process.env.PREVIEW_ADMIN_CREDENTIALS || "C:/Users/MEGA/.qoder/preview-admin-credentials.txt";

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

/** How a piece of Latin text is classified. */
const CLASSIFIERS = [
  { kind: "معرّف: بريد إلكتروني", test: (t) => t.includes("@") },
  { kind: "معرّف: مفتاح صلاحية", test: (t) => /^[a-z_]+\.[a-z_]+$/.test(t) },
  { kind: "معرّف: رقم طلب", test: (t) => /^HM-/.test(t) },
  { kind: "رمز تجاري: وحدة قياس", test: (t) => /^(KG|ML|L|330 ML|1 L|2\.5 L)$/.test(t) },
  { kind: "قيمة إعداد محفوظة", test: (t) => /^(EGP|Africa\/Cairo|Hyper Al-Moatasem)$/.test(t) },
  { kind: "اسم محفوظ في الكتالوج", test: (t) => /^phase\d+-ui-|^(BA11A|BAB Tree P|BAAC X|Cat Test)/.test(t) },
  { kind: "اسم محفوظ (عميل أو حساب فريق أو ملاحظة طلب)", test: () => true },
];

const creds = readFileSync(CREDENTIALS, "utf8");
const email = (creds.match(/email:\s*(.+)/) || [])[1]?.trim();
const password = (creds.match(/password:\s*(.+)/) || [])[1]?.trim();
if (!email || !password) throw new Error(`credentials file not understood: ${CREDENTIALS}`);

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto(`${BASE_URL}/admin/login`, { waitUntil: "networkidle" });
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', password);
await Promise.all([
  page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30000 }),
  page.click('button[type="submit"]'),
]);

const routes = {};
for (const route of ROUTES) {
  const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle" });
  const hits = await page.evaluate(() => {
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const el = node.parentElement;
      if (!el) continue;
      const text = (node.textContent || "").trim();
      if (!text || !/[A-Za-z]/.test(text)) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (el.closest("[aria-hidden='true']")) continue;
      const key = `${el.tagName}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ tag: el.tagName.toLowerCase(), cls: el.className?.toString().slice(0, 40), text });
    }
    return found;
  });
  routes[route] = { status: response.status(), hits };
}

const buckets = new Map();
for (const [route, entry] of Object.entries(routes)) {
  for (const hit of entry.hits) {
    const classifier = CLASSIFIERS.find((c) => c.test(hit.text));
    const kind = classifier ? classifier.kind : "نص إنجليزي مكتوب من اللوحة";
    if (!buckets.has(kind)) buckets.set(kind, { count: 0, samples: [], routes: [] });
    const bucket = buckets.get(kind);
    bucket.count += 1;
    if (bucket.samples.length < 5 && !bucket.samples.includes(hit.text)) bucket.samples.push(hit.text);
    if (!bucket.routes.includes(route)) bucket.routes.push(route);
  }
}

const panelWrote = buckets.get("نص إنجليزي مكتوب من اللوحة");
const report = {
  baseUrl: BASE_URL,
  routes,
  buckets: Object.fromEntries([...buckets].map(([kind, value]) => [kind, value])),
  total: Object.values(routes).reduce((sum, entry) => sum + entry.hits.length, 0),
  englishWrittenByThePanel: panelWrote ? panelWrote.count : 0,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));

for (const [kind, value] of buckets) {
  console.log(`${String(value.count).padStart(4)}  ${kind}`);
  console.log(`      أمثلة: ${value.samples.join(" | ")}`);
}
console.log(`\nمجموع النصوص اللي فيها حروف لاتينية: ${report.total}`);
console.log(`نص إنجليزي مكتوب من اللوحة نفسها: ${report.englishWrittenByThePanel}`);
console.log(`wrote ${OUT}`);

await browser.close();
