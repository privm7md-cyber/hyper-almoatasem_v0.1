// FE-10F platform gates (read-only GETs, unauthenticated): every new admin surface
// redirects to /admin/login. No mutations, no credentials — gate behavior only.
import { expect, test } from "@playwright/test";

const GATED = [
  "/admin/customers",
  "/admin/users",
  "/admin/roles",
  "/admin/permissions",
  "/admin/settings",
  "/admin/audit-logs",
];

for (const path of GATED) {
  test(`unauthenticated ${path} redirects to admin login`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/login/);
  });
}

test("admin login page renders credential form (no mock strings)", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: /دخول الإدارة/ })).toBeVisible();
  const body = await page.innerText("body");
  expect(body).not.toMatch(/MOCK|mock|تجريبي/);
});
