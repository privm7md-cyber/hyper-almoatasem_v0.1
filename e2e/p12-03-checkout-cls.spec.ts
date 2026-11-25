// P12-03 permanent regression spec: verifies populated /checkout layout stability
// (CLS <= 0.05) across desktop and mobile using hermetic cart/estimate mocks
// without touching Primary DB orders.

import { expect, test } from "@playwright/test";

const SYNTHETIC_GUEST_TOKEN =
  "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

async function attachCheckoutMocks(page: import("@playwright/test").Page) {
  await page.addInitScript((token: string) => {
    try {
      window.localStorage.setItem("hyper_cart_guest_token", token);
    } catch {}
    const perfState = { clsTotal: 0 };
    (window as unknown as { __p1203Perf?: { clsTotal: number } }).__p1203Perf = perfState;
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const ls = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          if (!ls.hadRecentInput && typeof ls.value === "number") {
            perfState.clsTotal += ls.value;
          }
        }
      });
      obs.observe({ type: "layout-shift", buffered: true });
    } catch {}
  }, SYNTHETIC_GUEST_TOKEN);

  await page.route("**/api/store/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes("/api/store/customers/session")) {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: { code: "UNAUTHENTICATED", message: "guest" } }),
      });
    }
    if (url.includes("/api/store/orders/checkout-session")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { expiresAt: "2026-11-16T00:00:00Z", ttlHours: 2 } }),
      });
    }
    if (url.includes("/api/store/orders/estimate")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            subtotal: "123.00",
            discountTotal: "0.00",
            deliveryFee: "0.00",
            total: "123.00",
            coupon: null,
            deliveryEligibility: null,
          },
        }),
      });
    }
    if (url.includes("/api/store/orders")) return route.abort();
    if (url.includes("/api/store/cart")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            cart: {
              id: "00000000-0000-4000-8000-000000000099",
              status: "ACTIVE",
              guest: true,
              lines: [
                {
                  productVariantId: "01a15068-279b-7c0d-a4fa-000000000001",
                  variantName: "عبوة 1 لتر",
                  productName: "حليب طبيعي",
                  productType: "PIECE",
                  quantity: "2",
                  unitSnapshot: "عبوة",
                  unitPriceSnapshot: "42.50",
                  lineTotal: "85.00",
                },
              ],
              subtotal: "85.00",
            },
            guestToken: SYNTHETIC_GUEST_TOKEN,
          },
        }),
      });
    }
    if (method !== "GET") return route.abort();
    return route.continue();
  });
}

test.describe("P12-03 checkout CLS stability", () => {
  for (const viewport of [
    { name: "desktop", width: 1280, height: 800 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    test(`keeps /checkout CLS <= 0.05 on ${viewport.name} (${viewport.width}x${viewport.height})`, async ({
      context,
      page,
      baseURL,
    }) => {
      await context.addCookies([
        { name: "hyper_guest_cart", value: "1", url: baseURL ?? "http://localhost:3150", sameSite: "Lax" },
      ]);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await attachCheckoutMocks(page);

      await page.goto("/checkout", { waitUntil: "networkidle" });
      await expect(page.getByTestId("checkout-stepper")).toBeVisible();
      await expect(page.locator('[data-estimate-state="ready"]')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(800);

      const result = await page.evaluate(() => ({
        cls: Number(
          ((window as unknown as { __p1203Perf?: { clsTotal: number } }).__p1203Perf?.clsTotal ?? 0).toFixed(6),
        ),
        overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      }));

      expect(result.overflowPx).toBe(0);
      expect(result.cls).toBeLessThanOrEqual(0.05);
    });
  }
});


test.describe("P12-03 residual closure regressions (R1-R4)", () => {
  test("R1: keeps /cart CLS <= 0.05 across mobile 390x844 and desktop 1280x800 with 250ms API delay", async ({
    page,
    context,
    baseURL,
  }) => {
    for (const vp of [
      { width: 390, height: 844 },
      { width: 1280, height: 800 },
    ]) {
      await context.addCookies([
        { name: "hyper_guest_cart", value: "1", url: baseURL ?? "http://localhost:3150", sameSite: "Lax" },
      ]);
      await page.setViewportSize(vp);
      await attachCheckoutMocks(page);
      await page.route("**/api/store/cart", async (route) => {
        await new Promise((r) => setTimeout(r, 250));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            data: {
              cart: {
                id: "00000000-0000-4000-8000-000000000099",
                status: "ACTIVE",
                guest: true,
                lines: [
                  {
                    productVariantId: "01a15068-279b-7c0d-a4fa-000000000001",
                    variantName: "عبوة عائلية 1 لتر",
                    productName: "حليب طبيعي كامل الدسم",
                    productType: "PIECE",
                    quantity: "2",
                    unitSnapshot: "عبوة",
                    unitPriceSnapshot: "42.50",
                    lineTotal: "85.00",
                  },
                  {
                    productVariantId: "01a15068-279b-7c0d-a4fa-000000000002",
                    variantName: "كيس 1 كجم",
                    productName: "أرز مصري فاخر",
                    productType: "PIECE",
                    quantity: "1",
                    unitSnapshot: "كيس",
                    unitPriceSnapshot: "38.00",
                    lineTotal: "38.00",
                  },
                ],
                subtotal: "123.00",
              },
              guestToken: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
            },
          }),
        });
      });

      await page.addInitScript(() => {
        (window as unknown as { __r1Cls?: number }).__r1Cls = 0;
        const po = new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
            if (!entry.hadRecentInput) {
              (window as unknown as { __r1Cls: number }).__r1Cls += entry.value;
            }
          }
        });
        po.observe({ type: "layout-shift", buffered: true });
      });

      await page.goto("/cart", { waitUntil: "networkidle" });
      await expect(page.getByText("حليب طبيعي كامل الدسم", { exact: true })).toBeVisible();
      await page.waitForTimeout(300);
      const cls = await page.evaluate(() => (window as unknown as { __r1Cls?: number }).__r1Cls ?? 0);
      expect(cls).toBeLessThanOrEqual(0.05);
    }
  });

  test("R1: keeps empty /cart without cookie stable at CLS <= 0.05", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      (window as unknown as { __r1EmptyCls?: number }).__r1EmptyCls = 0;
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
          if (!entry.hadRecentInput) {
            (window as unknown as { __r1EmptyCls: number }).__r1EmptyCls += entry.value;
          }
        }
      });
      po.observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/cart", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /سلتك فاضية|ابدأ سلة جديدة/ })).toBeVisible();
    const cls = await page.evaluate(() => (window as unknown as { __r1EmptyCls?: number }).__r1EmptyCls ?? 0);
    expect(cls).toBeLessThanOrEqual(0.05);
  });

  test("R2: keeps cold homepage CLS <= 0.05 on 320x844 under 300ms .woff2 font latency", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.route("**/*.woff2", async (route) => {
      await new Promise((r) => setTimeout(r, 300));
      await route.continue();
    });
    await page.addInitScript(() => {
      (window as unknown as { __r2FontCls?: number }).__r2FontCls = 0;
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
          if (!entry.hadRecentInput) {
            (window as unknown as { __r2FontCls: number }).__r2FontCls += entry.value;
          }
        }
      });
      po.observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const cls = await page.evaluate(() => (window as unknown as { __r2FontCls?: number }).__r2FontCls ?? 0);
    expect(cls).toBeLessThanOrEqual(0.05);
  });

  test("R3 & R4: empty /checkout uses natural height and mobile stepper shows full untruncated labels", async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/checkout", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "السلة فارغة" })).toBeVisible();
    const emptyMainHeight = await page.evaluate(
      () => document.querySelector("main")?.getBoundingClientRect().height ?? 0,
    );
    expect(emptyMainHeight).toBeLessThan(650);

    for (const width of [320, 390]) {
      await context.addCookies([
        { name: "hyper_guest_cart", value: "1", url: baseURL ?? "http://localhost:3150", sameSite: "Lax" },
      ]);
      await page.setViewportSize({ width, height: 640 });
      await attachCheckoutMocks(page);
      await page.goto("/checkout", { waitUntil: "networkidle" });
      const nav = page.getByTestId("checkout-stepper");
      await expect(nav).toBeVisible();
      const stepperAudit = await nav.evaluate((el) => {
        const labels = Array.from(el.querySelectorAll("li span:nth-of-type(2)")).map((s) => ({
          text: (s.textContent || "").trim(),
          truncated: s.scrollWidth > s.clientWidth,
        }));
        const current = el.querySelector('li[aria-current="step"]');
        return {
          overflowX: el.scrollWidth > el.clientWidth,
          labels,
          currentStepText: (current?.textContent || "").trim(),
        };
      });
      expect(stepperAudit.overflowX).toBe(false);
      expect(stepperAudit.labels.map((l) => l.text)).toEqual([
        "مراجعة السلة",
        "العنوان والتوصيل",
        "المعاينة والتأكيد",
      ]);
      for (const l of stepperAudit.labels) {
        expect(l.truncated).toBe(false);
      }
      expect(stepperAudit.currentStepText).toContain("العنوان والتوصيل");
    }
  });

  test("Homepage Hero cold Cairo font swap preserves layout stability at 390x844 and responsive widths (CLS <= 0.05)", async ({
    browser,
    baseURL,
  }) => {
    const targetUrl = `${baseURL ?? "http://localhost:3150"}/`;
    for (const width of [390, 360, 375, 430, 768]) {
      const ctx = await browser.newContext({
        viewport: { width, height: 844 },
        locale: "ar-EG",
      });
      const page = await ctx.newPage();
      await page.addInitScript(() => {
        (window as unknown as { __heroCls?: number }).__heroCls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const ls = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
            if (!ls.hadRecentInput && typeof ls.value === "number") {
              (window as unknown as { __heroCls: number }).__heroCls += ls.value;
            }
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.route("**/*.woff2", async (route) => {
        await new Promise((r) => setTimeout(r, 300));
        await route.continue();
      });
      await page.goto(targetUrl, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      const result = await page.evaluate(() => ({
        cls: Math.round(((window as unknown as { __heroCls?: number }).__heroCls ?? 0) * 1e6) / 1e6,
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
      }));
      await ctx.close();
      expect(result.cls, `Cold Cairo CLS too high at ${width}x844: ${result.cls}`).toBeLessThanOrEqual(0.05);
      expect(result.overflowX, `Horizontal overflow detected at ${width}x844`).toBe(false);
    }
  });
});
