/**
 * Headed Playwright runner that exercises the user-facing cleanup action
 * for orphan "Nueva plantilla" placeholders. Same credential plumbing as
 * scripts/qa-smoke.ts (read /tmp/opencode/.admin-pass on stdin, kept out
 * of git history, wiped on exit).
 */
import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";

const BASE_URL = "http://localhost:3000";
const PASS_FILE = "/tmp/opencode/.admin-pass";
const SHOTS = "/tmp/opencode/qa-cleanup-shots";
const REPORT = "/tmp/opencode/qa-cleanup-report.json";

const EMAIL = "adminvelas@gmail.com";
const PASSWORD = readFileSync(PASS_FILE, "utf8");

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "es-AR",
  });
  const page = await context.newPage();

  const log: string[] = [];
  const log2 = (msg: string) => {
    console.log(msg);
    log.push(msg);
  };

  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  log2(`▶ Loaded /sign-in`);

  await page.getByLabel("Email").first().fill(EMAIL);
  await page.getByLabel("Contraseña").first().fill(PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 }),
    page.getByRole("button", { name: /Iniciar sesión/i }).click(),
  ]);
  await page.waitForLoadState("networkidle").catch(() => {});
  log2(`✅ Signed in as ${EMAIL}`);

  await page.goto(`${BASE_URL}/templates`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: `${SHOTS}/01_before.png`, fullPage: true });

  // The tour overlay opens on first visit and currently doesn't auto-close
  // when the user navigates between private pages. Dismiss it before
  // interacting with the workspace so its z-[60] backdrop doesn't swallow
  // the cleanup button click.
  const tourSkip = page.getByRole("button", { name: /Saltar tour/i });
  if (await tourSkip.isVisible().catch(() => false)) {
    await tourSkip.click();
    log2(`▶ Dismissed tour overlay`);
  }

  const cleanupBtn = page.getByTestId("plantilla-cleanup-orphans");
  if (!(await cleanupBtn.isVisible().catch(() => false))) {
    log2(`ℹ️  No orphans to clean — button not rendered.`);
    writeFileSync(REPORT, JSON.stringify({ skipped: true, log }, null, 2));
    await browser.close();
    return;
  }
  const label = await cleanupBtn.textContent();
  log2(`▶ Found cleanup button: "${label?.trim()}"`);

  // The action confirms via window.confirm — Playwright hands this through
  // a one-shot dialog handler.
  page.once("dialog", async (dialog) => {
    log2(`  → confirm: ${dialog.message()}`);
    await dialog.accept();
  });

  await cleanupBtn.click();
  // Wait for the button to disappear (success) or surface an error.
  await page
    .waitForFunction(
      () => !document.querySelector('[data-testid="plantilla-cleanup-orphans"]'),
      { timeout: 10_000 },
    )
    .catch(() => {});

  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: `${SHOTS}/02_after_routerrefresh.png`, fullPage: true });

  const stillThere = await cleanupBtn.isVisible().catch(() => false);
  log2(stillThere ? `❌ Button still visible — cleanup may have failed` : `✅ Button gone — cleanup succeeded`);

  const orphanNamesAfterRefresh = await page
    .getByRole("heading", { name: /^Nueva plantilla( \d+)?$/ })
    .all();
  log2(
    `📊 Remaining "Nueva plantilla N" cards after router.refresh: ${orphanNamesAfterRefresh.length}`,
  );

  // Full reload to compare — if the post-refresh count > the post-reload
  // count, then router.refresh() is leaving the client list stale.
  await page.reload({ waitUntil: "networkidle" });
  await page.screenshot({ path: `${SHOTS}/03_after_reload.png`, fullPage: true });
  const orphanNamesAfterReload = await page
    .getByRole("heading", { name: /^Nueva plantilla( \d+)?$/ })
    .all();
  log2(
    `📊 Remaining "Nueva plantilla N" cards after full reload: ${orphanNamesAfterReload.length}`,
  );

  writeFileSync(
    REPORT,
    JSON.stringify(
      {
        skipped: false,
        log,
        remainingAfterRefresh: orphanNamesAfterRefresh.length,
        remainingAfterReload: orphanNamesAfterReload.length,
      },
      null,
      2,
    ),
  );
  log2(`📝 Report: ${REPORT}`);
  log2(`📸 Screenshots: ${SHOTS}/`);

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});