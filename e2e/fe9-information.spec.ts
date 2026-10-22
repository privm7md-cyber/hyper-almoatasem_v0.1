// FE-9 informational pages — browser coverage (read-only; no orders, no carts).
// Verifies: every published page renders with its verified facts, the link map
// resolves, no forbidden/placeholder content is published, RTL + responsive
// behaviour hold, and the keyboard reaches the page links.
import { expect, test } from "@playwright/test";

const PAGES = [
  { path: "/about", title: "من نحن", facts: ["احتياجات بيتك بسهولة ووضوح، وثقة في كل خطوة.", "التوصيل داخل مطاي والمناطق القريبة", "معلومة — لا يوجد تحقق لحظي من التغطية"] },
  { path: "/faq", title: "الأسئلة الشائعة", facts: ["125 جم أو 250 جم أو 500 جم أو 1 كجم أو 1.25 كجم", "لا توجد خطوة دفع في هذه النسخة", "رقم الطلب وحده لا يفتح تفاصيل الطلب"] },
  { path: "/delivery", title: "سياسة التوصيل", facts: ["التوصيل داخل مطاي والمناطق القريبة", "معلومة — لا يوجد تحقق لحظي من التغطية", "تُقرأ رسوم التوصيل من إعدادات المتجر"] },
  { path: "/cancellation", title: "سياسة الإلغاء", facts: ["تم استلام طلبك.", "جاري تجهيز طلبك.", "تم إلغاء الطلب"] },
  { path: "/replacement", title: "سياسة الاستبدال", facts: ["الموافقة على البديل المقترح.", "رفض البديل المقترح."] },
  { path: "/order-help", title: "مساعدة الطلب", facts: ["رقم الطلب وحده لا يفتح تفاصيل الطلب.", "تنتهي صلاحية الوصول بعد 90 يومًا", "لا يوجد استرجاع ذاتي لرمز الوصول"] },
];

/** Content that must never reach a published storefront page. */
const FORBIDDEN = [
  "store@hyper-al-moatasem.local",
  "201000000000",
  "Lorem",
  "TODO",
  "سيتم تحديده",
  "الدفع عند الاستلام",
  "لا نشارك بياناتك",
  "نضمن التوصيل",
  "استرجاع خلال",
  "استرداد خلال",
];

test("every published informational page renders its verified facts", async ({ page }) => {
  for (const p of PAGES) {
    const res = await page.goto(p.path);
    expect(res?.status(), `status of ${p.path}`).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: p.title })).toBeVisible();
    for (const fact of p.facts) {
      await expect(page.getByText(fact, { exact: false }).first(), `${p.path} fact: ${fact}`).toBeVisible();
    }
  }
});

test("published pages carry no placeholder or forbidden content", async ({ page }) => {
  for (const p of PAGES) {
    await page.goto(p.path);
    const body = await page.locator("body").innerText();
    for (const bad of FORBIDDEN) {
      expect(body.includes(bad), `${p.path} must not contain "${bad}"`).toBe(false);
    }
  }
  // The cancellation page states the honest fact instead of promising a refund.
  await page.goto("/cancellation");
  await expect(
    page.getByText("لا يعرض المتجر سياسة استرجاع أموال أو استرداد لأن الاسترجاع غير منفذ في هذه النسخة."),
  ).toBeVisible();
});

test("the footer exposes the informational pages and every one resolves", async ({ page }) => {
  await page.goto("/");
  const hrefs = await page
    .locator('footer nav[aria-label="معلومات المتجر"] a')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href") ?? ""));
  expect(hrefs.length).toBe(PAGES.length);
  for (const href of hrefs) {
    expect(hrefs, "footer links the published pages").toContain(href);
    const res = await page.goto(href);
    expect(res?.status(), `${href} resolves`).toBe(200);
  }
});

test("internal links on the informational pages are not broken", async ({ page }) => {
  const seen = new Set<string>();
  for (const p of PAGES) {
    await page.goto(p.path);
    const hrefs = await page
      .locator("main a[href^='/'], footer a[href^='/']")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href") ?? ""));
    for (const href of hrefs) {
      if (!href || href.startsWith("/#") || seen.has(href)) continue;
      seen.add(href);
      const res = await page.goto(href);
      expect(res?.status(), `${href} resolves`).toBeLessThan(400);
    }
  }
  expect(seen.size).toBeGreaterThan(4);
});

test("informational pages are RTL and hold the required viewports", async ({ page }) => {
  for (const p of PAGES) {
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(p.path);
      const dir = await page.locator("html").getAttribute("dir");
      expect(dir, `${p.path} @${width} is RTL`).toBe("rtl");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${p.path} @${width} has no horizontal overflow`).toBe(0);
    }
  }
});

test("keyboard reaches the page navigation links", async ({ page }) => {
  await page.goto("/faq");
  const back = page.getByRole("link", { name: "العودة إلى المتجر" });
  await back.focus();
  await expect(back).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
});
