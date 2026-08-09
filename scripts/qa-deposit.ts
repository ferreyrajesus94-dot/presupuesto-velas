/**
 * Reproduce the user's reported deposit-calculation scenario and dump
 * every numeric field the form exposes so we can pin down exactly which
 * "ARS X" the screenshot refers to.
 */
import { chromium, type Page } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";

const BASE_URL = "http://localhost:3000";
const PASS_FILE = "/tmp/opencode/.admin-pass";
const SHOTS = "/tmp/opencode/qa-deposit-shots";
const REPORT = "/tmp/opencode/qa-deposit-report.json";

const EMAIL = "adminvelas@gmail.com";
const PASSWORD = readFileSync(PASS_FILE, "utf8");

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByLabel("Email").first().fill(EMAIL);
  await page.getByLabel("Contraseña").first().fill(PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30_000 }),
    page.getByRole("button", { name: /Iniciar sesión/i }).click(),
  ]);
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    locale: "es-AR",
  });
  const page = await ctx.newPage();
  await login(page);

  // Use the cheapest template (Cera de soja) — the bug needs only one
  // material line; the model is auto-populated with templateId 0.
  await page.goto(`${BASE_URL}/quotes/new`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const tourSkip = page.getByRole("button", { name: /Saltar tour/i });
  if (await tourSkip.isVisible().catch(() => false)) {
    await tourSkip.click();
    await page
      .waitForFunction(() => !document.querySelector('[data-testid="tour-root"]'))
      .catch(() => {});
  }

  // Set quantity 100, profit 1000, deposit 50 (the exact scenario the
  // user reported: materiales 1000, indirect 0, profit 1000 → total 2000
  // and a 50% deposit should round-trip to ARS 1000).
  // The Receta select is the FIRST <select> inside the model row.
  const recetaSelect = page.locator("#quote-model-0-recipe");
  // Pick the first non-empty option (the placeholder is "Elegí un modelo"
  // with value="").
  const optionValues = await recetaSelect.locator("option").evaluateAll(
    (els) => els.map((el) => (el as HTMLOptionElement).value),
  );
  const firstReal = optionValues.find((v) => v && v.length > 0) ?? "";
  console.log(`First recipe option value: '${firstReal}'`);
  if (!firstReal) {
    throw new Error("No template available in the recipe select — nothing to test");
  }
  await recetaSelect.selectOption(firstReal);

  const qty = page.locator("#quote-model-0-quantity");
  await qty.fill("100");
  const profit = page.locator("#quote-profit-percent");
  await profit.fill("1000");
  // Default deposit is the auto-suggested percent. Read it.
  const deposit = page.locator("#quote-deposit-percent");
  const suggestedPercent = await deposit.inputValue();
  console.log(`Auto-suggested deposit percent: ${suggestedPercent}`);

  // Force the user-typed 50% so we can see what the helper renders.
  await deposit.fill("50");

  // Screenshot the full page for context.
  await page.screenshot({ path: `${SHOTS}/01_state.png`, fullPage: true });

  // Capture the four data-testid anchors the form exposes.
  const materialsTotal = (await page.getByTestId("materials-total").textContent())?.trim() ?? "";
  const indirectTotal = (await page.getByTestId("grand-indirect-total").textContent())?.trim() ?? "";
  const profitTotal = (await page.getByTestId("profit-total").textContent())?.trim() ?? "";
  const grandTotal = (await page.getByTestId("grand-total").textContent())?.trim() ?? "";
  const suggested = (await page.getByTestId("suggested-percent").textContent())?.trim() ?? "";

  // Read the deposit-percent field value (user input).
  const typedPercent = await deposit.inputValue();

  console.log("\n=== Form totals ===");
  console.log(`  materiales: ${materialsTotal}`);
  console.log(`  indirectos: ${indirectTotal}`);
  console.log(`  ganancia:   ${profitTotal}`);
  console.log(`  total:      ${grandTotal}`);

  // Read the suggestion line as it appears in the UI (this is the text
  // the user is reporting on).
  const suggestionLine = page.locator(`text=/Sugerencia para cubrir materiales/`);
  const suggestionText = (await suggestionLine.textContent())?.trim() ?? "";
  console.log(`\n=== UI rendering ===`);
  console.log(`  suggested-percent:  ${suggested}`);
  console.log(`  typed deposit %:    ${typedPercent}`);
  console.log(`  full suggestion:    ${suggestionText}`);

  // Now compute what the deposit amount should be in two ways:
  //   - using the TOTAL (which is what the form actually does)
  //   - the exact "cubre materiales" amount the user might expect
  // Show both so we can disambiguate.
  const totalNumber = Number(grandTotal.replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", "."));
  const materialsNumber = Number(
    materialsTotal.replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", "."),
  );
  const depositOverTotal = (totalNumber * Number(typedPercent)) / 100;
  const materialsCoverageRatio = (materialsNumber / totalNumber) * 100;

  console.log(`\n=== Cross-check ===`);
  console.log(`  deposit over total (${grandTotal}):       ${depositOverTotal.toFixed(2)}`);
  console.log(`  materials coverage ratio at ${typedPercent}%: ${((depositOverTotal / materialsNumber) * 100).toFixed(1)}% of materials`);
  console.log(`  exact 'covers materials' percent needed: ${materialsCoverageRatio.toFixed(2)}%`);

  writeFileSync(
    REPORT,
    JSON.stringify(
      {
        totals: { materialsTotal, indirectTotal, profitTotal, grandTotal },
        suggested,
        typedPercent,
        suggestionText,
        derived: { depositOverTotal, materialsCoverageRatio },
      },
      null,
      2,
    ),
  );

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
