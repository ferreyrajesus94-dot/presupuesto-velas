import { expect, test } from "@playwright/test";

test("home page renders default scaffold heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /to get started/i })).toBeVisible();
});
