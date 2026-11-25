// ./scripts/csp-probe.mjs — drives a real headless browser through key pages and
// records every CSP report the browser POSTS for the Report-Only policy, plus
// console notices. Uses the system Chrome (the same binary the Lighthouse runs
// used) because the Playwright-managed browser cache is not installed here.
import { chromium } from "playwright";

const BASE = process.env.CSP_BASE || "http://localhost:3131";
const pages = ["/", "/categories", "/cart", "/checkout", "/search?q=%D9%86%D8%B3%D9%83%D8%A7%D9%81%D9%8A%D9%87", "/admin/login"];

const browser = await chromium.launch({
  headless: true,
  channel: "chrome", // system Google Chrome, not the absent ms-playwright cache
});
const context = await browser.newContext();
const page = await context.newPage();

const violations = [];
page.on("console", (msg) => {
  const t = msg.text?.() ?? "";
  if (t.includes("Content-Security-Policy") || t.toLowerCase().includes("csp")) {
    violations.push({ page: page.url(), kind: "console", text: t.slice(0, 300) });
  }
});
page.on("response", async (res) => {
  if (res.url().includes("/api/csp-report") && res.status() === 204) {
    const req = res.request();
    let fields = {};
    try {
      const parsed = JSON.parse(req.postData() ?? "{}");
      const r = parsed["csp-report"] ?? {};
      // Keep only bounded, safe fields (same allowlist the collector logs).
      fields = {
        documentUri: r["document-uri"],
        effectiveDirective: r["effective-directive"],
        violatedDirective: r["violated-directive"],
        blockedUri: r["blocked-uri"],
        disposition: r["disposition"],
        scriptSample: typeof r["script-sample"] === "string" ? String(r["script-sample"]).slice(0, 120) : undefined,
        sourceFile: r["source-file"],
        lineNumber: r["line-number"],
        columnNumber: r["column-number"],
      };
    } catch {
      fields = { parse: "failed" };
    }
    violations.push({ page: page.url(), kind: "report-posted", report: fields });
  }
});
const cspErrors = [];
page.on("pageerror", (err) => cspErrors.push({ page: page.url(), error: String(err).slice(0, 300) }));

for (const p of pages) {
  await page.goto(BASE + p, { waitUntil: "load", timeout: 60000 });
  // Let hydration + islands settle so every style/script violation surfaces.
  await page.waitForTimeout(2500);
}
await browser.close();

console.log(JSON.stringify({ count: violations.length, violations, pageErrors: cspErrors }, null, 1));
