/**
 * Reproduce the "This page couldn't load" error the user reported when
 * clicking the Eliminar button on a presupuesto card. Captures the
 * dev server's error output and dumps the console so we can see
 * exactly which path blows up.
 */
import { chromium, type Page } from "playwright";
import { contextWithTourDismissed } from "./_helpers";
import { writeFileSync, readFileSync } from "node:fs";

const BASE_URL = "http://localhost:3000";
const PASS_FILE = "/tmp/opencode/.admin-pass";
const SHOTS = "/tmp/opencode/qa-delete-error-shots";
const REPORT = "/tmp/opencode/qa-delete-error-report.json";

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

async function dismissTour(page: Page): Promise<void> {
  const skip = page.getByRole("button", { name: /Saltar tour/i });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await page
      .waitForFunction(() => !document.querySelector('[data-testid="tour-root"]'))
      .catch(() => {});
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const ctx = await contextWithTourDismissed(browser, {
    viewport: { width: 1440, height: 900 },
    locale: "es-AR",
  });
  const page = await ctx.newPage();

  // Capture all console + pageerror + network failures so we see what
  // the delete request does.
  const consoleMsgs: { type: string; text: string }[] = [];
  page.on("console", (msg) => {
    consoleMsgs.push({ type: msg.type(), text: msg.text() });
    if (msg.type() === "error" || msg.type() === "warning") {
      console.log(`  [console.${msg.type()}] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    consoleMsgs.push({ type: "pageerror", text: err.message });
    console.log(`  [pageerror] ${err.message}`);
  });
  const requestFailures: { url: string; status: number; method: string }[] = [];
  page.on("response", (resp) => {
    if (resp.status() >= 500) {
      requestFailures.push({
        url: resp.url(),
        status: resp.status(),
        method: resp.request().method(),
      });
      console.log(`  [response ${resp.status()}] ${resp.request().method()} ${resp.url()}`);
    }
  });

  await login(page);
  await page.goto(`${BASE_URL}/quotes`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await dismissTour(page);

  // Read the first quote's customer name + id by inspecting the card.
  const firstCard = page.getByTestId("quote-card").first();
  const customerName = (await firstCard.locator("h2").first().textContent())?.trim() ?? "";
  console.log(`▶ Targeting first card: '${customerName}'`);

  // Click its Eliminar button and accept the confirm dialog.
  const eliminar = firstCard.getByTestId("quote-delete");
  if (!(await eliminar.isVisible().catch(() => false))) {
    console.log("❌ Delete button not visible on the first card");
    await browser.close();
    process.exit(1);
  }
  page.once("dialog", async (dialog) => {
    console.log(`  confirm prompt: ${dialog.message()}`);
    await dialog.accept();
  });
  await eliminar.click();
  // The button calls window.location.reload() on success — wait for
  // the page to settle so we can read the post-delete state.
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/01_after_delete.png`, fullPage: true });

  // Look for the "couldn't load" page.
  const crashText = await page
    .getByText(/This page couldn't load|server error occurred/i)
    .first()
    .textContent()
    .catch(() => null);
  if (crashText) {
    console.log(`❌ Page crashed: '${crashText.trim()}'`);
  } else {
    const remaining = await page.getByTestId("quote-card").count();
    console.log(`▶ Remaining cards after delete: ${remaining}`);
  }

  writeFileSync(
    REPORT,
    JSON.stringify(
      {
        crashText,
        remainingCards: await page.getByTestId("quote-card").count().catch(() => -1),
        consoleMsgs,
        requestFailures,
      },
      null,
      2,
    ),
  );

  await browser.close();
  process.exit(crashText ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
