// third-agent-ux-inp-probe.mjs — product full review (both viewports, PIECE+WEIGHT)
// + lab interaction latencies (Event Timing + PerformanceObserver — LAB metrics,
//   NOT field INP) + cart/checkout LCP in EMPTY and FILLED states + not-found state.
// Drives system Chrome via Playwright. Nav-type latencies use wall clock (Date.now)
// because performance.now() is per-document and resets on navigation.
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.THIRD_BASE || "http://127.0.0.1:3235";
const SHOTS = "D:/Hyper_Data_Review/Third_Agent_Final_Acceptance/Run_20261107_211349/Site_Shots";
fs.mkdirSync(SHOTS, { recursive: true });

const PEPSI_ID = "01800000-0000-7000-8000-000000000200";
const PEPSI_SLUG = "pepsi";
const ROMI_ID = "01800000-0000-7000-8000-000000000100";
const ROMI_SLUG = "romi-cheese";

// LCP observer installed at document start in EVERY navigation of a context.
const INIT_SCRIPT = `(() => {
  window.__lcpEntries = [];
  try {
    const po = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lcpEntries.push({ start: Math.round(e.startTime), el: (e.element && (e.element.textContent || e.element.tagName) || '').trim().slice(0, 100), size: e.size });
    });
    po.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
  window.__long = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ s: Math.round(e.startTime), d: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: true }); } catch {}
  window.__evs = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__evs.push({ n: e.name, d: Math.round(e.duration), s: Math.round(e.startTime) }); }).observe({ type: 'event', buffered: true, durationThreshold: 16 }); } catch {}
})();`;

const browser = await chromium.launch({ headless: true, channel: "chrome" });

async function scrollCapture(page, name) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  const steps = Math.max(1, Math.ceil(height / 700));
  for (let i = 0; i < steps; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * 700);
    await page.waitForTimeout(120);
  }
  await page.screenshot({ path: `${SHOTS}/${name}-full.png`, fullPage: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  return { height, steps };
}

// ---------------- 1) product page review (both viewports) ----------------
const results = { productReviews: [], notFound: [], interactions: [], lcp: [] };

for (const vp of [
  { name: "mobile", width: 412, height: 915 },
  { name: "desktop", width: 1350, height: 940 },
]) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  for (const [pid, pname, pslug] of [[PEPSI_ID, "pepsi", PEPSI_SLUG], [ROMI_ID, "romi", ROMI_SLUG]]) {
    const url = `${BASE}/p/${pid}/${pslug}`;
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    const info = await page.evaluate(() => {
      const text = document.body.innerText || "";
      const has = (s) => text.includes(s);
      const lcp = (window.__lcpEntries || []).slice(-1)[0] || null;
      return {
        title: document.title,
        hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        hasHeader: !!document.querySelector("header"),
        hasBreadcrumb: text.includes("الرئيسية"),
        hasName: text.length > 20,
        hasImageOrPlaceholder: !!document.querySelector("img") || has("بلا صورة") || has("لا توجد صورة"),
        imageAltClaim: (() => { const im = document.querySelector("img"); return im ? (im.alt || "(no alt)") : null; })(),
        hasPrice: has("ج.م"),
        priceSample: (text.match(/\d+(?:\.\d+)?\s*ج\.م/g) || []).slice(0, 4),
        hasReferencePrice: has("(مرجع") || has("السابق") || has("قبل"),
        hasUnit: has("بالقطعة") || has("بالوزن") || has("كجم") || has("جم") || has("ML") || has("لتر"),
        variantSelector: !!document.querySelector('select[aria-label="اختيار الـVariant"]'),
        qtyInput: !!document.querySelector('input[inputmode="numeric"], input[inputmode="decimal"]'),
        weightPresets: document.querySelectorAll('[role="group"][aria-label="أوزان جاهزة"] button').length,
        hasAddToCart: has("أضف إلى السلة") || has("غير متوفر"),
        hasAvailability: has("متوفر") || has("غير متوفر"),
        hasFooter: !!document.querySelector("footer"),
        lcpElement: lcp ? lcp.el : null,
        lcpStart: lcp ? lcp.start : null,
        textSample: text.slice(0, 400),
      };
    });
    info.status = resp ? resp.status() : null;
    info.longTasks = await page.evaluate(() => (window.__long || []).length);
    const sc = await scrollCapture(page, `${vp.name}-${pname}`);
    results.productReviews.push({ vp: vp.name, product: pname, info, scroll: sc });
  }
  // not-found / invalid id error state
  const nf = await page.goto(`${BASE}/p/00000000-0000-0000-0000-00000000dead/none`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => null);
  const nfInfo = await page.evaluate(() => ({ status: document.body.innerText.slice(0, 160), hasHeader: !!document.querySelector("header") }));
  results.notFound.push({ vp: vp.name, httpStatus: nf ? nf.status() : null, ...nfInfo });
  await context.close();
}

// ---------------- 2) lab interactions (mobile viewport) ----------------
{
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();

  const wall = async (label, fn) => {
    const t0 = Date.now();
    let extra = {};
    try { extra = (await fn()) || {}; } catch (e) { extra.error = String(e).slice(0, 120); }
    const ms = Date.now() - t0;
    const evs = await page.evaluate(() => (window.__evs || []).slice(-4)).catch(() => []);
    const lng = await page.evaluate(() => (window.__long || []).slice(-4)).catch(() => []);
    return { label, wallMs: ms, ...extra, eventTiming: evs, longTasks: lng };
  };

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 45000 });
  const menuBtn = page.getByRole("button", { name: /فتح قائمة المتجر/ });
  await menuBtn.click({ timeout: 5000 }).catch(() => {});
  results.interactions.push(await wall("home-menu-open", async () => {
    await page.waitForTimeout(400);
    return { menuVisible: await page.evaluate(() => document.body.innerText.includes("قائمة المتجر")) };
  }));
  // close menu again
  await page.keyboard.press("Escape").catch(() => {});

  // search typing (stays on page)
  await page.goto(`${BASE}/search`, { waitUntil: "networkidle", timeout: 45000 });
  const input = page.locator("input").first();
  await input.click().catch(() => {});
  results.interactions.push(await wall("search-type-3-chars", async () => {
    await input.type("لبن", { delay: 40 });
    return {};
  }));

  // product qty change (pepsi, packs input)
  await page.goto(`${BASE}/p/${PEPSI_ID}/${PEPSI_SLUG}`, { waitUntil: "networkidle", timeout: 45000 });
  results.interactions.push(await wall("product-qty-change", async () => {
    const q = page.locator('input[inputmode="numeric"]').first();
    await q.click();
    await q.fill("3");
    await page.waitForTimeout(250);
    return { value: await q.inputValue() };
  }));

  // weight change: variant select on romi (select second option if exists)
  await page.goto(`${BASE}/p/${ROMI_ID}/${ROMI_SLUG}`, { waitUntil: "networkidle", timeout: 45000 });
  results.interactions.push(await wall("product-weight-change", async () => {
    const sel = page.locator('select[aria-label="اختيار الـVariant"]');
    const n = await sel.count();
    if (!n) return { ok: false, note: "no variant select" };
    const opts = await sel.locator("option").count();
    if (opts > 1) { await sel.selectOption({ index: 1 }); } else { await sel.selectOption({ index: 0 }); await page.waitForTimeout(100); await sel.selectOption({ index: 0 }); }
    await page.waitForTimeout(300);
    return { ok: true, options: opts };
  }));

  // category change (stays in same document tree — navigation)
  await page.goto(`${BASE}/categories`, { waitUntil: "networkidle", timeout: 45000 });
  results.interactions.push(await wall("category-change-nav", async () => {
    const link = page.locator('a[href^="/c/"]').first();
    const href = await link.getAttribute("href", { timeout: 5000 }).catch(() => null);
    if (!href) return { ok: false };
    await link.click();
    await page.waitForURL("**/c/**", { timeout: 20000 }).catch(() => {});
    await page.waitForLoadState("load", { timeout: 20000 }).catch(() => {});
    return { target: href };
  }));

  // add-to-cart real click (pepsi) — first attempt 400 ("Exactly one of guest
  // token / customer session") is the DOCUMENTED pre-mint step; the panel then
  // mints a guest token and retries. We record the FULL response sequence.
  await page.goto(`${BASE}/p/${PEPSI_ID}/${PEPSI_SLUG}`, { waitUntil: "networkidle", timeout: 45000 });
  const addItemStatuses = [];
  page.on("response", (r) => { if (r.url().includes("/api/store/cart/items")) addItemStatuses.push(r.status()); });
  results.interactions.push(await wall("add-to-cart-click", async () => {
    const btn = page.getByRole("button", { name: /أضف إلى السلة/ }).first();
    await btn.click({ timeout: 5000 });
    await page.waitForTimeout(2000);
    return { cartItemResponseSequence: addItemStatuses };
  }));
  // cart open (has items in localStorage from the add above)
  results.interactions.push(await wall("cart-open-nav", async () => {
    await page.goto(`${BASE}/cart`, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(1500);
    const st = await page.evaluate(async () => {
      const tok = localStorage.getItem("hyper_cart_guest_token");
      const emptyMsg = document.body.innerText.includes("لا توجد سلة نشطة");
      let lines = null;
      if (tok) {
        const r = await fetch("/api/store/cart", { headers: { "x-guest-token": tok }, credentials: "same-origin" });
        const j = await r.json().catch(() => ({}));
        lines = (j?.data?.cart?.lines || []).map((l) => `${l.productName} x${l.quantity}`);
      }
      return { emptyMsg, lineCount: lines ? lines.length : null, lines };
    });
    return { emptyMsgMsg: st.emptyMsg, lineCount: st.lineCount, lines: st.lines };
  }));
  results.interactions.push(await wall("checkout-nav", async () => {
    await page.goto(`${BASE}/checkout`, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(1200);
    return { reviewVisible: await page.evaluate(() => !document.body.innerText.includes("أضف منتجات قبل إتمام الطلب")) };
  }));
  await context.close();
}

// ---------------- 3) cart/checkout LCP: empty vs filled, both viewports ----------------
async function fillGuestCart(page) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  return await page.evaluate(async () => {
    const mint = await fetch("/api/store/cart", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", credentials: "same-origin" });
    const mj = await mint.json().catch(() => ({}));
    const tok = mj?.data?.guestToken;
    if (!tok) return { ok: false, status: mint.status };
    localStorage.setItem("hyper_cart_guest_token", tok);
    const varRes = await fetch("/api/store/catalog/products/01800000-0000-7000-8000-000000000200/variants", { credentials: "same-origin" });
    const vj = await varRes.json().catch(() => ({}));
    // variants route answers ok(rows) → data is an ARRAY
    const arr = Array.isArray(vj?.data) ? vj.data : vj?.data?.variants || [];
    const v = arr.find((x) => x.stock === "in") || arr[0] || null;
    if (!v) return { ok: false, note: "no variant", status: varRes.status };
    // weight-based variants (KG) must respect the sale step; pieces take a whole number
    const qty = String(v.sizeUnit).toUpperCase() === "KG" ? "0.25" : "2";
    const add = await fetch("/api/store/cart/items", { method: "POST", headers: { "content-type": "application/json", "x-guest-token": tok }, body: JSON.stringify({ productVariantId: v.id, quantity: qty }), credentials: "same-origin" });
    await add.json().catch(() => ({}));
    return { ok: add.status === 200 || add.status === 201, mintStatus: mint.status, addStatus: add.status, variant: v.name, qty };
  });
}

for (const vp of [{ name: "desktop", width: 1350, height: 940 }, { name: "mobile", width: 412, height: 915 }]) {
  for (const pageName of ["cart", "checkout"]) {
    for (const state of ["empty", "filled"]) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      await context.addInitScript(INIT_SCRIPT);
      const page = await context.newPage();
      let fill = null;
      if (state === "filled") fill = await fillGuestCart(page);
      const nav = await page.goto(`${BASE}/${pageName}`, { waitUntil: "load", timeout: 45000 });
      await page.waitForTimeout(3500);
      const data = await page.evaluate(() => {
        const lcp = (window.__lcpEntries || []).slice(-1)[0] || null;
        const navE = performance.getEntriesByType("navigation")[0];
        return {
          lcpMs: lcp ? lcp.start : null,
          element: lcp ? lcp.el : null,
          ttfb: navE ? Math.round(navE.responseStart) : null,
          domContentLoaded: navE ? Math.round(navE.domContentLoadedEventEnd) : null,
          filled: !document.body.innerText.includes("لا توجد سلة نشطة") && !document.body.innerText.includes("أضف منتجات قبل إتمام الطلب"),
          emptyMsg: document.body.innerText.includes("لا توجد سلة نشطة") || document.body.innerText.includes("أضف منتجات قبل إتمام الطلب"),
        };
      });
      results.lcp.push({ page: pageName, vp: vp.name, state, http: nav ? nav.status() : null, fill, ...data });
      await context.close();
    }
  }
}

await browser.close();
fs.writeFileSync("D:/Hyper_Data_Review/Third_Agent_Final_Acceptance/Run_20261107_211349/Logs/third-ux-inp-probe.json", JSON.stringify(results, null, 2));
console.log("WROTE third-ux-inp-probe.json");
