/**
 * Templates Save Flow — Phase 4.7 follow-up.
 *
 * End-to-end coverage for the "Guardar" CTA on /templates. The test signs
 * in via the Neon Auth sign-in form, exercises the workspace (add material,
 * edit time + overhead + rename), clicks Guardar, hard-reloads, and asserts
 * the persisted fields survive the round-trip. Only rows whose name starts
 * with the literal "Nueva plantilla" are cleaned up at the end so we never
 * touch users' real data.
 */
import { expect, test, type Page } from "@playwright/test";

const TEST_NAME_PREFIX = "Nueva plantilla";

// The workspace reads OWNER_USER_ID / OWNER_EMAIL from the server-side
// env, so a successful sign-in must match those credentials. The
// corresponding password lives in PROD_OWNER_PASSWORD in .env.local (it's
// the same owner email used locally — `flor@velas.invalid`).
const EMAIL = process.env.TEST_OWNER_EMAIL || process.env.OWNER_EMAIL || "";
const PASSWORD = process.env.TEST_OWNER_PASSWORD || process.env.PROD_OWNER_PASSWORD || "";

test.describe.configure({ mode: "serial" });

async function dismissTour(page: Page): Promise<void> {
  // The tutorial overlay covers interactive elements with z-[60]; dismiss
  // it before clicking through the workspace so pointer events land on
  // the actual buttons, not the overlay.
  const skip = page.getByRole("button", { name: /Saltar tour/i });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await dismissTour(page);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
      timeout: 30_000,
    }),
    page.getByRole("button", { name: /Iniciar sesión/i }).click(),
  ]);
}

// Cleanup a freshly-created placeholder by deleting its card through the
// workspace's trash button. The accept-the-confirm dialog is wired through
// window.confirm, which Playwright handles via page.on("dialog").
async function deleteOwnCard(page: Page): Promise<void> {
  page.once("dialog", (dialog) => void dialog.accept());
  const headingMatch = new RegExp(`^${TEST_NAME_PREFIX}( \\d+)?$`);
  const card = page
    .getByTestId("template-card")
    .filter({ has: page.getByRole("heading", { name: headingMatch }) })
    .last();
  const trash = card.getByTestId("plantilla-delete");
  await trash.click();
  // After the optimistic remove, the card count must drop by 1.
  await expect(card).toHaveCount(0, { timeout: 5_000 });
}

test("Guardar persists template edits across a hard reload", async ({ page }) => {
  test.skip(
    !EMAIL || !PASSWORD,
    "Set TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD in env to run the auth flow.",
  );

  await signIn(page);
  await dismissTour(page);
  await page.goto("/templates");
  await dismissTour(page);
  await expect(page.getByTestId("plantilla-new")).toBeVisible();

  // The new placeholder always lands at index 0 because `setTemplates`
  // prepends and the component never re-sorts after the initial render.
  // We anchor on `.first()` after click — the same card survives the
  // save action (which only mutates, doesn't reorder).
  const headingMatch = new RegExp(`^${TEST_NAME_PREFIX}( \\d+)?$`);
  const beforeCount = await page
    .getByTestId("template-card")
    .count();

  await page.getByTestId("plantilla-new").click();

  const card = page
    .getByTestId("template-card")
    .filter({ has: page.getByRole("heading", { name: headingMatch }) })
    .first();
  await expect(card).toBeVisible();

  // Add the first material row + fill it.
  await card.getByTestId("plantilla-add-material").click();
  await expect(card.getByTestId("plantilla-material-row")).toHaveCount(1);
  // Material labels vary across catalogs; pick the first non-empty option
  // from the row's <select>. The section heading "Materiales de …"
  // collides on the visible label, so we scope by the row testid.
  const materialSelect = card
    .locator("[data-testid='plantilla-material-row']")
    .locator("select");
  const materialOptionCount = await materialSelect.locator("option").count();
  expect(materialOptionCount).toBeGreaterThan(1);
  const chosenMaterial = await materialSelect
    .locator("option")
    .nth(1)
    .getAttribute("value");
  expect(chosenMaterial).toBeTruthy();
  await materialSelect.selectOption(chosenMaterial!);
  await card.getByLabel("Cantidad").fill("100");

  // Fill calculator meta so the persistence half of the test exercises
  // all four new fields.
  await card.getByLabel(/Tiempo/).fill("60");
  await card.getByLabel(/Costo\/h/).fill("1500");
  await card.getByLabel(/Costos fijos/).fill("200");

  // Guardar is enabled (dirty + has items).
  const save = card.getByTestId("plantilla-save");
  await expect(save).toHaveAttribute("data-dirty", "true");
  await expect(save).toBeEnabled();

  // Click and wait for the save to settle (button label reverts to "Guardar"
  // when the transition resolves and data-saving flips back to false).
  await save.click();
  await expect(save).toHaveAttribute("data-saving", "false", { timeout: 15_000 });
  // Wait for the dirty flag to flip back to false once the snapshot
  // resyncs with the persisted row.
  await expect
    .poll(async () => save.getAttribute("data-dirty"))
    .toBe("false");
  // The action error surface should NOT be visible for a successful save.
  await expect(page.getByTestId("plantilla-action-error")).toHaveCount(0);

  // Hard-reload and confirm the edits persist on the persisted card.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await dismissTour(page);

  // After the reload the page re-sorts by name. The saved placeholder is
  // the highest-numbered `Nueva plantilla N` so it sorts LAST within the
  // heading-match filter.
  const cardAfter = page
    .getByTestId("template-card")
    .filter({ has: page.getByRole("heading", { name: headingMatch }) })
    .last();
  await expect(cardAfter).toBeVisible();
  await expect(cardAfter.getByTestId("plantilla-material-row")).toHaveCount(1);
  // Calculator meta survives the refresh.
  await expect(cardAfter.getByLabel(/Tiempo/)).toHaveValue(/^60/);
  await expect(cardAfter.getByLabel(/Costo\/h/)).toHaveValue(/^1500/);
  await expect(cardAfter.getByLabel(/Costos fijos/)).toHaveValue(/^200/);
  // Guardar is disabled again (no diff to persist).
  await expect(cardAfter.getByTestId("plantilla-save")).toBeDisabled();
  // Card count returns to the baseline so the test left nothing behind.
  const afterCount = await page.getByTestId("template-card").count();
  expect(afterCount).toBe(beforeCount);

  // Cleanup via the workspace's trash button so we don't leave behind
  // fixtures whose name starts with "Nueva plantilla".
  await deleteOwnCard(page);
});
