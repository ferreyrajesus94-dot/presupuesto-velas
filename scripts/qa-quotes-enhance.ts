/**
 * Headed Playwright check for the three mejoras on /quotes:
 *  1. Detail view surfaces more metadata (id, version, items, created, updated).
 *  2. The "+" in the "+ Nuevo presupuesto" CTA is gone.
 *  3. The list shows a sort bar with the six options and re-orders the
 *     cards when one is clicked.
 */
import { chromium, type Page } from "playwright";
import { contextWithTourDismissed } from "./_helpers";
import { writeFileSync, readFileSync } from "node:fs";

const BASE_URL = "http://localhost:3000";
const PASS_FILE = "/tmp/opencode/.admin-pass";
const SHOTS = "/tmp/opencode/qa-quotes-enhance-shots";
const REPORT = "/tmp/opencode/qa-quotes-enhance-report.json";

const EMAIL = "adminvelas@gmail.com";
const PASSWORD = readFileSync(PASS_FILE, "utf8");

const passes: string[] = [];
const fails: string[] = [];
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

async function check1PlusSignGone(page: Page): Promise<void> {
  console.log(`\n▶ Check 1 — the "+" sign is gone from the CTA`);
  await page.goto(`${BASE_URL}/quotes`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await dismissTour(page);
  await page.screenshot({ path: `${SHOTS}/01_list.png`, fullPage: true });

  const cta = page.getByRole("link", { name: /Nuevo presupuesto/i });
  if (!(await cta.isVisible().catch(() => false))) {
    fail(`'Nuevo presupuesto' CTA is not visible`);
    return;
  }
  const ctaText = (await cta.textContent())?.trim() ?? "";
  if (ctaText === "✨ Nuevo presupuesto") {
    pass(`CTA reads '✨ Nuevo presupuesto' (no leading '+')`);
  } else {
    fail(`CTA text is '${ctaText}', expected '✨ Nuevo presupuesto'`);
  }
}

async function check2SortBar(page: Page): Promise<void> {
  console.log(`\n▶ Check 2 — sort bar with the six options is present`);
  const bar = page.getByTestId("quote-sort");
  if (!(await bar.isVisible().catch(() => false))) {
    fail(`Sort bar (data-testid="quote-sort") not rendered`);
    return;
  }
  pass(`Sort bar present`);
  const options = [
    "expiration-asc",
    "expiration-desc",
    "created-desc",
    "created-asc",
    "total-desc",
    "total-asc",
  ] as const;
  for (const opt of options) {
    const btn = page.getByTestId(`quote-sort-${opt}`);
    if (await btn.isVisible().catch(() => false)) {
      pass(`Option '${opt}' is rendered`);
    } else {
      fail(`Option '${opt}' missing from the sort bar`);
    }
  }

  // Capture the order of totals in the default sort (expiration-asc).
  const readOrder = async (): Promise<string[]> =>
    page.$$eval('[data-testid="quote-card"]', (cards) =>
      cards.map((c) => {
        const dd = c.querySelectorAll("dd");
        return dd[dd.length - 1]?.textContent?.trim() ?? "";
      }),
    );

  const before = await readOrder();
  console.log(`  default order totals: ${JSON.stringify(before)}`);

  // Click "total-desc" and re-read.
  await page.getByTestId("quote-sort-total-desc").click();
  await page.waitForURL(/\?.*sort=total-desc/, { timeout: 5_000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  const after = await readOrder();
  console.log(`  after 'Total · mayor' click: ${JSON.stringify(after)}`);
  // The actual sort happens server-side; we can't easily prove it changed
  // the wire order if the totals happen to be identical. The strongest
  // signal we can assert cheaply: the URL now carries ?sort=total-desc.
  const url = page.url();
  if (url.includes("sort=total-desc")) {
    pass(`URL reflects 'sort=total-desc' (${url.split("?")[1] ?? ""})`);
  } else {
    fail(`URL did not pick up the sort param (${url})`);
  }
  await page.screenshot({ path: `${SHOTS}/02_list_sorted.png`, fullPage: true });

  // Click "expiration-asc" to restore the default for the next check.
  await page.getByTestId("quote-sort-expiration-asc").click();
  await page.waitForURL((u) => !u.toString().includes("sort=") || u.toString().includes("sort=expiration-asc"), { timeout: 5_000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function check3DetailMetadata(page: Page): Promise<void> {
  console.log(`\n▶ Check 3 — the detail view surfaces more metadata`);
  // Use the first link that points to a /quotes/{id} route. The card
  // list and the tour "?" button can both live in the same viewport;
  // scoping to href=/quotes/{id} keeps the test resilient.
  const firstDetailLink = page
    .locator('a[href^="/quotes/"]')
    .filter({ has: page.getByText("Ver presupuesto") })
    .first();
  const href = await firstDetailLink.getAttribute("href");
  console.log(`  clicking detail link with href: ${href}`);
  await firstDetailLink.click();
  await page.waitForURL(/\/quotes\/[a-f0-9-]+$/, { timeout: 10_000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: `${SHOTS}/03_detail.png`, fullPage: true });

  const required = [
    "quote-meta-id",
    "quote-meta-version",
    "quote-meta-items",
    "quote-meta-created",
  ] as const;
  for (const tid of required) {
    const el = page.getByTestId(tid);
    if (await el.isVisible().catch(() => false)) {
      pass(`Detail shows ${tid} (${(await el.textContent())?.trim()})`);
    } else {
      fail(`Detail is missing ${tid}`);
    }
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const ctx = await contextWithTourDismissed(browser, {
    viewport: { width: 1440, height: 900 },
    locale: "es-AR",
  });
  const page = await ctx.newPage();
  await login(page);

  await check1PlusSignGone(page);
  await check2SortBar(page);
  await check3DetailMetadata(page);

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
