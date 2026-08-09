import { chromium, type Page } from "playwright";
import { contextWithTourDismissed } from "./_helpers";
import { writeFileSync, readFileSync } from "node:fs";

const BASE_URL = "http://localhost:3000";
const PASS_FILE = "/tmp/opencode/.admin-pass";
const SHOTS = "/tmp/opencode/qa-delete-final-shots";
const REPORT = "/tmp/opencode/qa-delete-final-report.json";

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
  const ctx = await contextWithTourDismissed(browser, {
    viewport: { width: 1440, height: 900 },
    locale: "es-AR",
  });
  const page = await ctx.newPage();

  // Capture any "couldn't load" flash in the console / page error.
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });

  await login(page);
  await page.goto(`${BASE_URL}/quotes`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  // Find the first card with the Eliminar button visible.
  const firstCard = page.getByTestId("quote-card").first();
  const customerName = (await firstCard.locator("h2").first().textContent())?.trim() ?? "(none)";
  console.log(`▶ Targeting first card: '${customerName}'`);

  const before = await page.getByTestId("quote-card").count();
  console.log(`▶ Cards before delete: ${before}`);

  // Click Eliminar and accept the confirm.
  page.once("dialog", async (dialog) => {
    console.log(`  confirm prompt: ${dialog.message()}`);
    await dialog.accept();
  });
  await firstCard.getByTestId("quote-delete").click();
  // Wait for the post-refresh state.
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  // Give the soft refresh a moment to re-render.
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: `${SHOTS}/01_after_delete.png`, fullPage: true });

  // Did we ever see the "couldn't load" page?
  const sawCouldNotLoad = pageErrors.some((e) => /couldn|server error|reload/i.test(e));
  const crashText = await page
    .getByText(/This page couldn't load|server error occurred/i)
    .first()
    .textContent()
    .catch(() => null);

  const after = await page.getByTestId("quote-card").count().catch(() => -1);
  console.log(`▶ Cards after delete: ${after}`);

  if (sawCouldNotLoad || crashText) {
    console.log(`❌ 'couldn't load' flash detected: ${crashText?.trim() ?? pageErrors.join("; ")}`);
  } else {
    console.log(`✅ No 'couldn't load' flash detected`);
  }
  if (after === before - 1) {
    console.log(`✅ Exactly one card removed`);
  } else {
    console.log(`❌ Expected ${before - 1} cards, found ${after}`);
  }

  writeFileSync(
    REPORT,
    JSON.stringify({ sawCouldNotLoad, crashText, before, after, pageErrors }, null, 2),
  );

  await browser.close();
  process.exit(sawCouldNotLoad || crashText ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
