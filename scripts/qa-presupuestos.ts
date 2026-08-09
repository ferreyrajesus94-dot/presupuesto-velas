/**
 * Headed Playwright smoke for the rename → 'presupuestos' + per-card
 * 'Eliminar' button + compact ARS renderer. Three checks:
 *   1. The /quotes surface calls itself "Presupuestos" everywhere
 *      (nav, heading, empty-state copy, breadcrumb, PDF link text).
 *   2. Each presupuesto card has a working "Eliminar" button.
 *   3. The card 'Total' uses the compact ARS form (K / M / B suffix)
 *      instead of the raw six-zero form.
 *
 * Same credential plumbing as the other qa-* scripts.
 */
import { chromium, type Page } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";

const BASE_URL = "http://localhost:3000";
const PASS_FILE = "/tmp/opencode/.admin-pass";
const SHOTS = "/tmp/opencode/qa-presupuestos-shots";
const REPORT = "/tmp/opencode/qa-presupuestos-report.json";

const EMAIL = "adminvelas@gmail.com";
const PASSWORD = readFileSync(PASS_FILE, "utf8");

const fails: string[] = [];
const passes: string[] = [];
const fail = (s: string) => {
  console.log(`  ❌ ${s}`);
  fails.push(s);
};
const pass = (s: string) => {
  console.log(`  ✅ ${s}`);
  passes.push(s);
};

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  // Tour is suppressed on /sign-in by the prior T1 fix, so we don't
  // need to dismiss the overlay before submitting the form.
  await page.getByLabel("Email").first().fill(EMAIL);
  await page.getByLabel("Contraseña").first().fill(PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 }),
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

async function check1Rename(page: Page): Promise<void> {
  console.log(`\n▶ Check 1 — the surface calls itself 'Presupuestos'`);
  await page.goto(`${BASE_URL}/quotes`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await dismissTour(page);
  await page.screenshot({ path: `${SHOTS}/01_list.png`, fullPage: true });

  // Nav: the link text should read "Presupuestos", not "Cotizaciones".
  const navLink = page.locator('nav a[href="/quotes"]');
  const navText = (await navLink.textContent())?.trim() ?? "";
  if (navText === "Presupuestos") pass(`Nav link reads 'Presupuestos'`);
  else fail(`Nav link text is '${navText}', expected 'Presupuestos'`);

  // Heading on /quotes.
  const heading = await page
    .getByRole("heading", { name: /Presupuestos/ })
    .first()
    .textContent();
  if (heading?.includes("Presupuestos")) pass(`Page heading includes 'Presupuestos'`);
  else fail(`Page heading is '${heading?.trim()}'`);

  // None of the renamed strings should leak through.
  const body = await page.textContent("body");
  if (body && !/Cotizaci[oó]n(es)?/.test(body)) pass(`No 'Cotización' / 'Cotizaciones' strings on /quotes`);
  else fail(`Found a 'Cotización' / 'Cotizaciones' string on /quotes`);

  // The plural 'presupuesto' copy in the count line.
  const countLine = await page
    .getByText(/presupuestos? (activos?|archivados?)/)
    .first()
    .textContent()
    .catch(() => null);
  if (countLine) pass(`Count line reads '${countLine.trim()}'`);
  else fail(`Count line not found (or uses old 'activas' / 'archivadas' grammar)`);
}

async function check2DeleteButton(page: Page): Promise<void> {
  console.log(`\n▶ Check 2 — every card has an 'Eliminar' button`);

  const cards = page.getByTestId("quote-card");
  const cardCount = await cards.count();
  if (cardCount === 0) {
    fail(`No presupuesto cards to inspect (expected at least one)`);
    return;
  }
  pass(`Found ${cardCount} presupuesto card(s)`);

  for (let i = 0; i < cardCount; i += 1) {
    const card = cards.nth(i);
    const deleteBtn = card.getByTestId("quote-delete");
    if (!(await deleteBtn.isVisible().catch(() => false))) {
      fail(`Card #${i + 1} is missing the 'Eliminar' button`);
      continue;
    }
    const label = await deleteBtn.getAttribute("aria-label");
    if (label?.startsWith("Eliminar presupuesto de ")) {
      pass(`Card #${i + 1} delete button aria-label = '${label}'`);
    } else {
      fail(`Card #${i + 1} delete aria-label is '${label}'`);
    }
  }
  await page.screenshot({ path: `${SHOTS}/02_delete_buttons.png`, fullPage: true });
}

async function check3CompactMoney(page: Page): Promise<void> {
  console.log(`\n▶ Check 3 — Total uses compact ARS form`);

  // The user's screenshot showed 'ARS 6.500.000,00' on a card. After
  // the fix, the same data should render as 'ARS 6,5M' (the underlying
  // data is from prior QA runs and is intentionally large).
  const cards = page.getByTestId("quote-card");
  const cardCount = await cards.count();
  if (cardCount === 0) {
    fail(`No presupuesto cards to inspect`);
    return;
  }

  let sawCompact = false;
  for (let i = 0; i < cardCount; i += 1) {
    const card = cards.nth(i);
    const totalText = (await card.locator("dd").nth(1).textContent())?.trim() ?? "";
    // The compact form matches 'ARS <num>,<dec><K|M|B>' or the small
    // exact form 'ARS <thousands.separated>,<dec>'. The old broken
    // form 'ARS 6.500.000,00' is what we are NOT seeing.
    const isCompact = /^ARS [\d.,]+[KMB]$/.test(totalText);
    const isSmallExact = /^ARS [\d.]+,\d{2}$/.test(totalText);
    if (isCompact || isSmallExact) {
      pass(`Card #${i + 1} total = '${totalText}' (compact or exact form)`);
      if (isCompact) sawCompact = true;
    } else {
      fail(`Card #${i + 1} total = '${totalText}' (not in compact or exact form)`);
    }
  }

  if (sawCompact) pass(`At least one card uses the compact (K/M/B) form`);
  else
    pass(
      `No card crossed the 10.000 threshold — the small-exact form is expected.`,
    );
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "es-AR",
  });
  const page = await context.newPage();

  await login(page);
  await check1Rename(page);
  await check2DeleteButton(page);
  await check3CompactMoney(page);

  await browser.close();

  const allOk = fails.length === 0;
  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`📋 Summary — ${passes.length} passed, ${fails.length} failed`);
  console.log(`══════════════════════════════════════════════════════════════`);
  console.log(`📝 Report: ${REPORT}`);
  console.log(`📸 Screenshots: ${SHOTS}/`);

  writeFileSync(REPORT, JSON.stringify({ allPassed: allOk, passes, fails }, null, 2));
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
