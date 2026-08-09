/**
 * Headed Playwright verification that the unitCost migration fixed
 * the templates. Before: 'Materiales: ARS 5.000.000,00'. After:
 * 'Materiales: ARS 5.000,00' (or 'ARS 5K' in compact form).
 */
import { chromium } from "playwright";
import { contextWithTourDismissed } from "./_helpers";
import { writeFileSync, readFileSync } from "node:fs";

const BASE_URL = "http://localhost:3000";
const PASS_FILE = "/tmp/opencode/.admin-pass";
const SHOTS = "/tmp/opencode/qa-unitcost-shots";
const REPORT = "/tmp/opencode/qa-unitcost-report.json";

const EMAIL = "adminvelas@gmail.com";
const PASSWORD = readFileSync(PASS_FILE, "utf8");

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const ctx = await contextWithTourDismissed(browser, {
    viewport: { width: 1440, height: 900 },
    locale: "es-AR",
  });
  const page = await ctx.newPage();

  // Login
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByLabel("Email").first().fill(EMAIL);
  await page.getByLabel("Contraseña").first().fill(PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30_000 }),
    page.getByRole("button", { name: /Iniciar sesión/i }).click(),
  ]);
  await page.waitForLoadState("networkidle").catch(() => {});

  // Go to /templates
  await page.goto(`${BASE_URL}/templates`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const tourSkip = page.getByRole("button", { name: /Saltar tour/i });
  if (await tourSkip.isVisible().catch(() => false)) {
    await tourSkip.click();
    await page
      .waitForFunction(() => !document.querySelector('[data-testid="tour-root"]'))
      .catch(() => {});
  }

  // The card we care about
  const targetCard = page
    .getByTestId("template-card")
    .filter({ hasText: "msl8r87q-1" })
    .first();
  await targetCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/01_card.png`, fullPage: true });

  const summary = {
    materiales: (await targetCard.getByTestId("summary-materials").textContent())?.trim() ?? "",
    manoObra: (await targetCard.getByTestId("summary-labor").textContent())?.trim() ?? "",
    costosFijos: (await targetCard.getByTestId("summary-overhead").textContent())?.trim() ?? "",
    total: (await targetCard.getByTestId("summary-total").textContent())?.trim() ?? "",
    sugerido: (await targetCard.getByTestId("summary-suggested").textContent())?.trim() ?? "",
  };

  const passes: string[] = [];
  const fails: string[] = [];
  console.log("\n=== Template summary after unitCost migration ===");
  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${k}: ${v}`);
  }

  // The migration should have dropped Materiales from 'ARS 5.000.000,00'
  // (six zeros) to a small hundreds-of-pesos figure. Any number in the
  // millions is a regression. The exact value depends on the per-template
  // quantity — 'msl8r87q-1' has quantity 100 → ARS 500; a hypothetical
  // 1000g template would be ARS 5.000.
  if (/ARS\s*5\.000\.000/.test(summary.materiales)) {
    fails.push(
      `Materiales still reads '${summary.materiales}' — the migration did not take effect`,
    );
  } else if (/^ARS\s*(500|5\.?000(,00)?)\b/.test(summary.materiales)) {
    passes.push(
      `Materiales reads '${summary.materiales}' — within the small-hundreds ARS range the user expected (was 5.000.000 pre-fix).`,
    );
  } else {
    fails.push(
      `Materiales reads '${summary.materiales}' — unexpected format. The pre-fix value was 5.000.000; the post-fix value should be a small hundreds-of-pesos figure.`,
    );
  }

  console.log(`\n=== Results ===`);
  for (const p of passes) console.log(`✅ ${p}`);
  for (const f of fails) console.log(`❌ ${f}`);

  writeFileSync(
    REPORT,
    JSON.stringify({ allPassed: fails.length === 0, summary, passes, fails }, null, 2),
  );
  console.log(`\nReport: ${REPORT}`);

  await browser.close();
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
