/**
 * Headed Playwright smoke for the new tour opt-out flow. Three
 * scenarios:
 *   1. First visit: tour auto-shows, toggle is ON.
 *   2. User unchecks the toggle and closes → tour does NOT auto-show
 *      on the next sign-in.
 *   3. The manual "?" button still reopens the tour even when the
 *      user has opted out, and the toggle starts ON (optimistic).
 *
 * Same credential plumbing as scripts/qa-smoke.ts and qa-cleanup.ts.
 */
import { chromium, type Page } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";

const BASE_URL = "http://localhost:3000";
const PASS_FILE = "/tmp/opencode/.admin-pass";
const SHOTS = "/tmp/opencode/qa-tour-shots";
const REPORT = "/tmp/opencode/qa-tour-report.json";

const EMAIL = "adminvelas@gmail.com";
const PASSWORD = readFileSync(PASS_FILE, "utf8");

interface ScenarioResult {
  name: string;
  passed: boolean;
  notes: string[];
}

const results: ScenarioResult[] = [];
const fail = (s: string) => process.stdout.write(`  ❌ ${s}\n`);
const pass = (s: string) => process.stdout.write(`  ✅ ${s}\n`);

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  // The fix from the prior QA pass (T1) keeps the tour off /sign-in, so
  // we can fill and submit without dismissing any overlay.
  await page.getByLabel("Email").first().fill(EMAIL);
  await page.getByLabel("Contraseña").first().fill(PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 }),
    page.getByRole("button", { name: /Iniciar sesión/i }).click(),
  ]);
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function signOut(page: Page): Promise<void> {
  // The header has a "Cerrar sesión" link/button in the navbar.
  await page.getByRole("button", { name: /Cerrar sesión/i }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/sign-in"), { timeout: 15_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function clearStorage(page: Page): Promise<void> {
  await page.evaluate(() => window.localStorage.clear());
}

async function scenario1AutoShow(page: Page): Promise<void> {
  const notes: string[] = [];
  let ok = true;
  console.log(`\n▶ Scenario 1 — first visit auto-shows the tour`);

  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await clearStorage(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  // Tour should auto-appear.
  const tourRoot = page.getByTestId("tour-root");
  if (!(await tourRoot.isVisible().catch(() => false))) {
    fail(`Tour did not auto-show on a fresh localStorage`);
    ok = false;
  } else {
    pass(`Tour auto-showed`);
  }
  await page.screenshot({ path: `${SHOTS}/01_auto_show.png`, fullPage: true });

  // Toggle is ON by default.
  const checkbox = page.getByTestId("tour-auto-show");
  if (!(await checkbox.isVisible().catch(() => false))) {
    fail(`Toggle 'Mostrar este tour al iniciar sesión' not rendered`);
    ok = false;
  } else {
    const checked = await checkbox.isChecked();
    if (!checked) {
      fail(`Toggle should default to checked, but is unchecked`);
      ok = false;
    } else {
      pass(`Toggle defaults to ON`);
    }
  }

  // localStorage should be empty (no opt-out yet).
  const lsState = await page.evaluate(() => ({
    disabled: window.localStorage.getItem("pv-tour-disabled"),
    legacy: window.localStorage.getItem("pv-tour-done"),
  }));
  notes.push(`localStorage before close: ${JSON.stringify(lsState)}`);
  if (lsState.disabled !== null) {
    fail(`pv-tour-disabled should be null on first visit, was ${lsState.disabled}`);
    ok = false;
  } else {
    pass(`pv-tour-disabled unset before close`);
  }

  // Close the tour so the next scenario can interact with the page
  // background. Toggle stays ON, so closing should clear any opt-out
  // (it was unset to begin with).
  await page.getByRole("button", { name: /Saltar tour/i }).click();
  await page
    .waitForFunction(() => !document.querySelector('[data-testid="tour-root"]'), {
      timeout: 5_000,
    })
    .catch(() => {});

  results.push({ name: "first visit auto-shows", passed: ok, notes });
}

async function scenario2OptOut(page: Page): Promise<void> {
  const notes: string[] = [];
  let ok = true;
  console.log(`\n▶ Scenario 2 — opt-out persists across sign-out + sign-in`);

  // After Scenario 1 the tour was closed with the toggle ON, so
  // pv-tour-disabled is still absent. Reload the home page and expect
  // the tour to auto-show again — that's the baseline for the opt-out
  // scenario.
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const tourRoot = page.getByTestId("tour-root");
  if (!(await tourRoot.isVisible().catch(() => false))) {
    fail(`Tour did not auto-show on re-visit (toggle was ON)`);
    ok = false;
  } else {
    pass(`Tour auto-showed on re-visit (toggle was ON)`);
  }

  // Uncheck the toggle and skip.
  const checkbox = page.getByTestId("tour-auto-show");
  if (await checkbox.isChecked()) {
    await checkbox.uncheck();
    pass(`Unchecked the toggle`);
  } else {
    fail(`Toggle should start ON when re-opening`);
    ok = false;
  }
  await page.getByRole("button", { name: /Saltar tour/i }).click();
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="tour-root"]'),
    { timeout: 5_000 },
  ).catch(() => {});

  const afterClose = await page.evaluate(() => ({
    disabled: window.localStorage.getItem("pv-tour-disabled"),
    legacy: window.localStorage.getItem("pv-tour-done"),
  }));
  notes.push(`localStorage after close: ${JSON.stringify(afterClose)}`);
  if (afterClose.disabled !== "1") {
    fail(`Expected pv-tour-disabled = "1" after opt-out, got ${afterClose.disabled}`);
    ok = false;
  } else {
    pass(`pv-tour-disabled persisted as "1"`);
  }
  if (afterClose.legacy !== null) {
    fail(`Legacy pv-tour-done should be cleared, got ${afterClose.legacy}`);
    ok = false;
  } else {
    pass(`Legacy key cleared`);
  }

  // Sign out and back in — the tour must NOT auto-show.
  await signOut(page);
  await login(page);
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: `${SHOTS}/02_optout_relogin.png`, fullPage: true });

  const tourVisible = await page
    .getByTestId("tour-root")
    .isVisible()
    .catch(() => false);
  if (tourVisible) {
    fail(`Tour auto-showed after opt-out — opt-out was not respected`);
    ok = false;
  } else {
    pass(`Tour stays hidden after opt-out + re-login`);
  }

  // The manual "?" trigger is still rendered.
  const triggerVisible = await page
    .getByTestId("tour-trigger")
    .isVisible()
    .catch(() => false);
  if (!triggerVisible) {
    fail(`Manual '?' trigger missing after opt-out`);
    ok = false;
  } else {
    pass(`Manual '?' trigger still rendered`);
  }

  results.push({ name: "opt-out persists", passed: ok, notes });
}

async function scenario3ManualAfterOptOut(page: Page): Promise<void> {
  const notes: string[] = [];
  let ok = true;
  console.log(`\n▶ Scenario 3 — manual '?' reopens tour, toggle defaults to ON`);

  // After Scenario 2 the user is logged in with the opt-out set.
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const trigger = page.getByTestId("tour-trigger");
  if (!(await trigger.isVisible().catch(() => false))) {
    fail(`Manual '?' trigger not visible`);
    ok = false;
    results.push({ name: "manual reopen after opt-out", passed: ok, notes });
    return;
  }
  await trigger.click();
  const tourRoot = page.getByTestId("tour-root");
  if (!(await tourRoot.isVisible().catch(() => false))) {
    fail(`Tour did not open after clicking '?'`);
    ok = false;
  } else {
    pass(`Tour opens via the manual '?' trigger`);
  }
  await page.screenshot({ path: `${SHOTS}/03_manual_open.png`, fullPage: true });

  // Toggle should be ON (optimistic default for manual opens).
  const checkbox = page.getByTestId("tour-auto-show");
  if (!(await checkbox.isVisible().catch(() => false))) {
    fail(`Toggle not visible inside the manually-opened tour`);
    ok = false;
  } else {
    const checked = await checkbox.isChecked();
    if (!checked) {
      fail(`Toggle should be ON when the user opens the tour manually`);
      ok = false;
    } else {
      pass(`Toggle defaults to ON on manual open`);
    }
  }

  // Close with Escape (toggle ON) — opt-out should be cleared.
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="tour-root"]'),
    { timeout: 5_000 },
  ).catch(() => {});

  const afterEscape = await page.evaluate(() => ({
    disabled: window.localStorage.getItem("pv-tour-disabled"),
  }));
  notes.push(`localStorage after Escape: ${JSON.stringify(afterEscape)}`);
  if (afterEscape.disabled !== null) {
    fail(`Escape with toggle ON should clear pv-tour-disabled, got ${afterEscape.disabled}`);
    ok = false;
  } else {
    pass(`Escape with toggle ON re-enables the tour`);
  }

  results.push({ name: "manual reopen after opt-out", passed: ok, notes });
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "es-AR",
  });
  const page = await context.newPage();

  await login(page);
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  await scenario1AutoShow(page);
  await scenario2OptOut(page);
  await scenario3ManualAfterOptOut(page);

  await browser.close();

  const allOk = results.every((r) => r.passed);
  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`📋 Scenario results`);
  console.log(`══════════════════════════════════════════════════════════════`);
  for (const r of results) {
    console.log(`${r.passed ? "✅" : "❌"} ${r.name}`);
    for (const note of r.notes) console.log(`   · ${note}`);
  }
  console.log(`\n📝 Report: ${REPORT}`);
  console.log(`📸 Screenshots: ${SHOTS}/`);

  writeFileSync(REPORT, JSON.stringify({ allPassed: allOk, results }, null, 2));
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
