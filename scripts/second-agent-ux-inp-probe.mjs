// second-agent-ux-inp-probe.mjs — product-page full-scroll review + interaction
// timing probe. Drives system Chrome via Playwright (same harness as csp-probe).
// Writes screenshots to Site_Shots/ and prints JSON summary to stdout.
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:3223";
const SHOTS = "D:/Hyper_Data_Review/Second_Agent_Completion/Run_20261106_210603/Site_Shots";
fs.mkdirSync(SHOTS, { recursive: true });

const PEPSI_ID = "01800000-0000-7000-8000-000000000200";
const PEPSI_SLUG = "pepsi";
const ROMI_ID = "01800000-0000-7000-8000-000000000100";
const ROMI_SLUG = "romi-cheese";

const browser = await chromium.launch({ headless: true, channel: "chrome" });

async function scrollCapture(page, name) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  const steps = Math.max(1, Math.ceil(height / 700));
  for (let i = 0; i < steps; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * 700);
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: `${SHOTS}/${name}-full.png`, fullPage: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  return { height, steps };
}

async function timing(page, label, fn) {
  const t0 = await page.evaluate(() => performance.now());
  await fn();
  await page.waitForTimeout(120);
  const t1 = await page.evaluate(() => performance.now());
  return { label, interactionMs: Math.round(t1 - t0) };
}

const results = [];
for (const vp of [
  { name: "mobile", width: 412, height: 915 },
  { name: "desktop", width: 1350, height: 940 },
]) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  for (const [pid, pname, pslug] of [[PEPSI_ID, "pepsi", PEPSI_SLUG], [ROMI_ID, "romi", ROMI_SLUG]]) {
    await page.goto(`${BASE}/p/${pid}/${pslug}`, { waitUntil: "networkidle", timeout: 45000 });
    const info = await page.evaluate(() => {
      const text = document.body.innerText || "";
      const priceM = text.match(/\d+(\.\d+)?/g)?.slice(0, 8);
      return {
        title: document.title,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        hasPrice: text.includes("ج.م") || text.includes("EGP") || /\d/.test(text),
        sample: priceM,
        hasWeight: text.includes("كجم") || text.includes("جم") || text.includes("kg") || text.includes("330") || text.includes("كيلو"),
      };
    });
    const sc = await scrollCapture(page, `${vp.name}-${pname}`);
    results.push({ vp: vp.name, product: pname, info, scroll: sc });
  }
  await context.close();
}

// INP interaction timing on home + product (mobile viewport).
{
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 45000 });
  const interactions = [];
  // menu open: click first header button-ish
  interactions.push(await timing(page, "home-menu-click", async () => {
    const btn = page.locator("header button, nav button, button[aria-label]").first();
    await btn.click({ timeout: 5000 }).catch(() => null);
  }));
  // search typing
  await page.goto(`${BASE}/search`, { waitUntil: "networkidle", timeout: 45000 });
  interactions.push(await timing(page, "search-type", async () => {
    const input = page.locator("input").first();
    await input.click().catch(() => null);
    await input.type("لبن", { delay: 30 }).catch(() => null);
  }));
  // product qty change
  await page.goto(`${BASE}/p/${PEPSI_ID}/${PEPSI_SLUG}`, { waitUntil: "networkidle", timeout: 45000 });
  interactions.push(await timing(page, "qty-plus-click", async () => {
    const btn = page.getByRole("button", { name: /[+\u2212-]/ }).first();
    await btn.click({ timeout: 5000 }).catch(() => null);
  }));
  results.push({ inp: interactions });
  await context.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
