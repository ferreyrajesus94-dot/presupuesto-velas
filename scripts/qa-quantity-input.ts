/**
 * One-off visual check: confirm the per-row material quantity input
 * (a) renders without trailing zeros and (b) has its native spinner
 * hidden via the globals.css rule.
 */
import { chromium, type Page } from "playwright";
import { readFileSync } from "node:fs";

const BASE_URL = "http://localhost:3000";
const PASS_FILE = "/tmp/opencode/.admin-pass";
const SHOTS = "/tmp/opencode/qa-qty-shots";
const REPORT = "/tmp/opencode/qa-qty-report.json";

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
    viewport: { width: 1440, height: 900 },
    locale: "es-AR",
  });
  const page = await ctx.newPage();
  await login(page);
  await page.goto(`${BASE_URL}/templates`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const tourSkip = page.getByRole("button", { name: /Saltar tour/i });
  if (await tourSkip.isVisible().catch(() => false)) {
    await tourSkip.click();
    await page
      .waitForFunction(() => !document.querySelector('[data-testid="tour-root"]'))
      .catch(() => {});
  }

  const passes: string[] = [];
  const fails: string[] = [];

  // Snapshot the first material row's quantity input.
  const firstQty = page.locator("input[type='number']").first();
  await firstQty.scrollIntoViewIfNeeded();

  const value = await firstQty.inputValue();
  console.log(`First quantity input value: "${value}"`);
  // Trailing zeros only matter when there's a decimal point: '100.00'
  // is bad, but '100' (no dot) is clean.
  const hasTrailingZeros = /\.\d*0+\b/.test(value);
  if (hasTrailingZeros) {
    fails.push(`Quantity input still shows trailing zeros: '${value}'`);
  } else {
    passes.push(`Quantity input is clean (no trailing zeros): '${value}'`);
  }

  // Computed style: the spinner should be hidden via the global rule.
  const styleInfo = await firstQty.evaluate((el) => {
    const input = el as HTMLInputElement;
    const cs = window.getComputedStyle(input);
    return {
      appearance: cs.getPropertyValue("-webkit-appearance") || cs.appearance,
      width: input.getBoundingClientRect().width,
    };
  });
  console.log(`Style: appearance='${styleInfo.appearance}', width=${styleInfo.width.toFixed(0)}px`);
  if (styleInfo.appearance === "none" || /textfield/i.test(styleInfo.appearance)) {
    passes.push(`Native spinner hidden (appearance='${styleInfo.appearance}')`);
  } else {
    fails.push(`Native spinner still rendered (appearance='${styleInfo.appearance}')`);
  }

  // Visual proof: focused screenshot of the input + a card-level one.
  await firstQty.screenshot({ path: `${SHOTS}/01_input.png` });
  const firstCard = page.getByTestId("template-card").first();
  await firstCard.screenshot({ path: `${SHOTS}/02_card.png` });

  console.log(`\n=== Results ===`);
  for (const p of passes) console.log(`✅ ${p}`);
  for (const f of fails) console.log(`❌ ${f}`);

  const allPassed = fails.length === 0;
  await browser.close();
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
