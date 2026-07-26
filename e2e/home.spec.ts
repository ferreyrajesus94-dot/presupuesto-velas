import { expect, test } from "@playwright/test";

test("home redirects to /sign-in when unauthenticated (proxy optimistic check)", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
});
