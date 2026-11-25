// ============================================================================
// ADMIN VISIBLE-TEXT AUDIT — checks the RENDERED admin panel for English.
//
// The static scanner (scripts/admin-text-audit.mjs) reads source files and
// cannot tell a class name from a sentence the operator reads. This one walks
// the running app, extracts the text the operator actually sees on every
// section, and reports the Latin words in it.
//
// A finding is only a problem when the Latin word is an ENGLISH TECHNICAL
// TERM (the banned list below). Latin text that comes from the store's own
// data — product names, codes, e-mail addresses, barcodes — is printed as
// context, because that text is the data, not the interface.
//
// Usage:
//   node scripts/admin-visible-text-audit.mjs [--base <url>]
// ============================================================================

import { chromium } from "playwright";
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
const CREDENTIALS = path.resolve(
  argValue(
    "--credentials",
    process.env.PREVIEW_ADMIN_CREDENTIALS || "C:/Users/MEGA/.qoder/preview-admin-credentials.txt",
  ),
);

/** The English terms §4 bans from the operator's screen. */
const BANNED_WORDS = [
  "dashboard", "products", "product", "inventory", "orders", "order", "customers", "customer",
  "variant", "variants", "stock in", "manual adjustment", "low stock threshold", "promotions",
  "promotion", "coupons", "coupon", "roles", "role", "permissions", "permission", "audit logs",
  "settings", "create", "update", "delete", "save", "cancel", "apply", "status", "active",
  "inactive", "pending", "draft", "expired", "base", "bases", "sku", "barcode", "slug", "session",
  "token", "json", "uuid", "api", "email", "password", "login", "logout", "search", "filter",
  "sort", "next", "previous", "edit", "add", "remove", "view", "list", "detail", "details",
  "action", "actions", "button", "modal", "drawer", "table", "column", "row", "rows", "total",
  "count", "price", "quantity", "stock", "brand", "brands", "category", "categories", "discount",
  "tax", "shipping", "zone", "zones", "toggle", "checkbox", "submit", "reset", "refresh",
  "loading", "empty", "error", "profile", "overview", "summary",
];

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
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar-EG" });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith("/admin/login"), { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ]);

  let banned = 0;
  let identifiers = 0;
  const latinSamples = new Map();

  for (const route of ROUTES) {
    await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);

    const lines = await page.evaluate(() =>
      (document.body.innerText || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    );

    const routeBanned = [];
    const routeIdentifiers = [];
    for (const line of lines) {
      const latin = line.match(/[A-Za-z][A-Za-z0-9._@-]*/g) || [];
      if (!latin.length) continue;
      for (const word of latin) {
        const lower = word.toLowerCase();
        const hit = BANNED_WORDS.find((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, "i").test(lower));
        if (hit) {
          // A dotted permission key (products.view) is a technical identifier,
          // not interface copy: the panel prints it muted next to its Arabic
          // reading so the operator can match it against the role record.
          if (/^[a-z][a-z_]*\.[a-z][a-z_]*$/.test(word)) {
            routeIdentifiers.push(`${word} — ${line.slice(0, 120)}`);
          } else {
            routeBanned.push(`${word} — ${line.slice(0, 120)}`);
          }
        } else {
          latinSamples.set(word, (latinSamples.get(word) || 0) + 1);
        }
      }
    }
    banned += routeBanned.length;
    identifiers += routeIdentifiers.length;
    console.log(
      `${route.padEnd(26)} lines=${String(lines.length).padEnd(5)} banned=${routeBanned.length} identifiers=${routeIdentifiers.length}`,
    );
    for (const finding of routeBanned) console.log(`    ! ${finding}`);
  }

  console.log(`\n--- Latin words that are store data, not interface copy (${latinSamples.size} distinct) ---`);
  const sorted = [...latinSamples.entries()].sort((a, b) => b[1] - a[1]);
  console.log(sorted.slice(0, 40).map(([word, count]) => `${word} ×${count}`).join(", "));
  if (sorted.length > 40) console.log(`… and ${sorted.length - 40} more`);

  await browser.close();
  console.log(`\nEnglish technical terms in the rendered admin UI: ${banned}`);
  console.log(`Technical identifiers kept on purpose (permission keys): ${identifiers}`);
  process.exit(banned ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
