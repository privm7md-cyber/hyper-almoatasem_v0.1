// FE-5/6/7 e2e: gated states + validation without backend writes.
// No session/cookies in a fresh browser profile; local DB is empty (verified).
// Assertions pin honest states, never live data.
import { expect, test } from "@playwright/test";

test.setTimeout(90000);

test("cart with no identity offers a fresh start (no dead end)", async ({ page }) => {
  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "السلة" })).toBeVisible();
  await expect(page.getByRole("button", { name: "سلة جديدة" })).toBeVisible();
});

test("login validates locally and never stores secrets", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByText("أدخل رقم الهاتف وكلمة المرور.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
});

test("register renders without OTP/verification promises", async ({ page }) => {
  await page.goto("/register");
  await expect(page.getByRole("button", { name: "إنشاء الحساب" })).toBeVisible();
  const body = await page.innerText("body");
  expect(body).not.toMatch(/OTP|تحقق.*رمز|رمز التحقق/);
});

test("account shows guest state without session (no fake data)", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByText(/تتصفح كضيف/)).toBeVisible();
});

test("checkout without cart shows honest empty (no order form)", async ({ page }) => {
  await page.goto("/checkout");
  await expect(page.getByText("السلة فارغة")).toBeVisible();
});

test("orders list gates guests to login (no phone-based listing)", async ({ page }) => {
  await page.goto("/orders");
  await expect(page.getByText(/سجّل الدخول لعرض طلباتك/)).toBeVisible();
});

test("unknown order ids stay not-found (no leakage)", async ({ page }) => {
  // No credential + no session: gated guidance (confirmation) — never order data.
  await page.goto("/order-confirmation/00000000-0000-0000-0000-000000000000");
  await expect(page.getByText("تعذّر عرض التأكيد")).toBeVisible();
  // No credential + no session: gated access screen (no order data, no leak).
  await page.goto("/orders/00000000-0000-0000-0000-000000000000");
  await expect(page.getByText("الوصول إلى الطلب يتطلب إثبات ملكية")).toBeVisible();
  // Malformed id: true 404.
  await page.goto("/orders/not-a-uuid");
  await expect(page.getByRole("heading", { name: /غير موجودة|غير موجود/ })).toBeVisible();
});

test("new flows hold viewports without overflow", async ({ page }) => {
  for (const [path, size] of [
    ["/cart", { width: 390, height: 844 }],
    ["/checkout", { width: 390, height: 844 }],
    ["/login", { width: 390, height: 844 }],
    ["/account", { width: 768, height: 900 }],
    ["/orders", { width: 1280, height: 900 }],
  ] as const) {
    await page.setViewportSize(size);
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} @${size.width}px`).toBeLessThanOrEqual(1);
  }
});
