/**
 * PR6a — E2E happy path: sign-in → create quote → send → accept → PDF → WhatsApp.
 *
 * Runs against the preview environment via `npm run e2e`. The test is skipped
 * unless `E2E_OWNER_EMAIL` and `E2E_OWNER_PASSWORD` are set (preview env
 * secrets); it also skips if the test database has no recipes to attach to
 * the new quote, since the create form requires a recipe selection.
 *
 * Lifecycle, snapshot, PDF, and WhatsApp behaviors are asserted against the
 * actual UI and API surface shipped by PR4a–PR5b. No production code is
 * modified by this test.
 */
import { expect, test } from "@playwright/test";

const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? "";
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "";

/** Format `Date` as `YYYY-MM-DD` for HTML `<input type="date">`. */
function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Today + N days (local time), formatted as `YYYY-MM-DD`. */
function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return ymd(d);
}

/** Decode the `text` query parameter from a `wa.me` share URL. */
function decodeWaText(href: string): string {
  const match = href.match(/[?&]text=([^&]+)/);
  if (!match) throw new Error(`Missing text parameter in wa.me URL: ${href}`);
  return decodeURIComponent(match[1]);
}

test.describe("Quote lifecycle — sign-in to PDF to WhatsApp", () => {
  test.beforeEach(() => {
    test.skip(
      !OWNER_EMAIL || !OWNER_PASSWORD,
      "E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD env vars are required for this E2E test",
    );
  });

  test("owner can create, send, accept a quote and export PDF + WhatsApp link", async ({
    page,
    request,
  }) => {
    // ----- 1. Sign in -----
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: /^sign in$/i })).toBeVisible();
    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password").fill(OWNER_PASSWORD);
    await Promise.all([
      page.waitForURL((u) => u.pathname === "/", { timeout: 15_000 }),
      page.getByRole("button", { name: /^sign in$/i }).click(),
    ]);

    // ----- 2. Create a quote -----
    await page.goto("/quotes");
    await expect(page.getByRole("heading", { name: /cotizaciones/i })).toBeVisible();
    await page.getByRole("link", { name: /\+ nueva cotización/i }).click();
    await expect(page).toHaveURL(/\/quotes\/new$/);

    await page.getByLabel("Cliente").fill("Cliente Test E2E");
    await page.getByLabel("Vencimiento").fill(todayPlus(30));

    // Pick the first non-empty recipe (the empty option is the placeholder)
    const recipeSelect = page.locator("#quote-model-0-recipe");
    await expect(recipeSelect).toBeVisible();
    const optionValues = await recipeSelect
      .locator("option")
      .evaluateAll((opts) =>
        (opts as HTMLOptionElement[]).map((o) => o.value).filter((value) => value !== ""),
      );
    test.skip(
      optionValues.length === 0,
      "Test database has no recipes; create at least one before running this E2E",
    );
    await recipeSelect.selectOption(optionValues[0]);

    await page.locator("#quote-model-0-quantity").fill("5");
    await page.getByLabel(/porcentaje de ganancia/i).fill("30");
    await page.getByLabel(/porcentaje de seña/i).fill("50");

    // Visibility toggles default to checked; no action needed.

    // Capture the rendered grand total to cross-check on the detail view.
    const grandTotalText = await page.locator('[data-testid="grand-total"]').innerText();

    await Promise.all([
      page.waitForURL(/\/quotes\/[a-z0-9-]+$/, { timeout: 15_000 }),
      page.getByRole("button", { name: /crear borrador/i }).click(),
    ]);

    const quoteIdMatch = page.url().match(/\/quotes\/([a-z0-9-]+)$/);
    expect(quoteIdMatch).not.toBeNull();
    const quoteId = quoteIdMatch![1];

    // ----- 3. Verify detail view -----
    const statusBadge = page.locator('[data-testid="quote-status"]').first();
    await expect(statusBadge).toHaveText("draft");
    await expect(page.getByText("Cliente Test E2E", { exact: false })).toBeVisible();

    // The "Totales" section must echo the pre-submit grand total
    const totales = page.locator('[aria-label="Totales"]');
    await expect(totales.getByText(grandTotalText)).toBeVisible();

    // The "Seña" section must render the 50% deposit
    const senia = page.locator('[aria-label="Seña"]');
    await expect(senia.getByText(/50%/)).toBeVisible();
    await expect(senia.getByText(/ARS\s/)).toBeVisible();

    // ----- 4. Transition draft → sent -----
    await page.getByRole("button", { name: /marcar como enviado/i }).click();
    await expect(statusBadge).toHaveText("sent", { timeout: 15_000 });

    // ----- 5. Transition sent → accepted -----
    await page.getByRole("button", { name: /marcar como aceptado/i }).click();
    await expect(statusBadge).toHaveText("accepted", { timeout: 15_000 });

    // After accepted: Editar (link) + Eliminar (button) are hidden
    await expect(page.getByRole("link", { name: /^editar$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^eliminar$/i })).toHaveCount(0);

    // The lifecycle section renders the immutability message
    await expect(page.getByText(/inmutable/i)).toBeVisible();

    // ----- 6. PDF download -----
    const pdfResponse = await request.get(`/api/quotes/${quoteId}/pdf`);
    expect(pdfResponse.status()).toBe(200);
    expect(pdfResponse.headers()["content-type"] ?? "").toContain("application/pdf");
    expect(pdfResponse.headers()["content-disposition"] ?? "").toContain(
      `cotizacion-${quoteId}.pdf`,
    );
    const pdfBytes = await pdfResponse.body();
    expect(pdfBytes.subarray(0, 5).toString("utf8")).toBe("%PDF-");

    // ----- 7. WhatsApp share link -----
    const whatsappLink = page.getByRole("link", { name: /compartir por whatsapp/i });
    await expect(whatsappLink).toBeVisible();
    const href = await whatsappLink.getAttribute("href");
    expect(href).not.toBeNull();
    const shareHref = href!;
    expect(shareHref).toContain("wa.me/?text=");

    const decoded = decodeWaText(shareHref);
    expect(decoded).toContain("Cliente Test E2E");
    expect(decoded).toContain("Total:");
    expect(decoded).toMatch(/ARS\s/);
  });
});
