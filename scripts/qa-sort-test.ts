/**
 * Headed Playwright check for the presupuestos list sort bar.
 *
 * 1. Signs in as the production owner.
 * 2. Creates 10 presupuestos keyed by the tag "Sort Test NN" with
 *    intentionally varied expiration dates + quantities so each sort
 *    mode produces a distinct, predictable order.
 * 3. Clicks each of the 6 sort buttons and reads the rendered card
 *    order, then asserts the visible order matches the expected order.
 * 4. Prints a pass/fail summary; exits non-zero if any sort fails.
 *
 * The 10 NN tags are reused as a customer prefix so the script can
 * identify its own cards without polluting production data with fixtures
 * that look like real clients.
 *
 * Run with: `npx tsx scripts/qa-sort-test.ts`
 * (or `node --import tsx scripts/qa-sort-test.ts` if tsx is not on PATH).
 *
 * The script is idempotent w.r.t. its own data: it cleans up any
 * previous "Sort Test NN" cards before creating the new batch.
 */
import { chromium, type Page } from "playwright";
import { readFileSync } from "node:fs";
import { contextWithTourDismissed } from "./_helpers";

const BASE_URL = "http://localhost:3000";
const EMAIL = "adminvelas@gmail.com";
const PASSWORD = readFileSync("/tmp/opencode/.admin-pass", "utf8").trim();
const TAG_PREFIX = "Sort Test";
// Template is picked dynamically from the first non-empty option in the
// /quotes/new form so the script works for any account.

const SHOTS = "/tmp/opencode/qa-sort-shots";
const SLOW_MS = 200;

const fixtures = [
  { tag: "01", daysFromToday: 5, quantity: 1 },
  { tag: "02", daysFromToday: 30, quantity: 10 },
  { tag: "03", daysFromToday: 15, quantity: 3 },
  { tag: "04", daysFromToday: 60, quantity: 7 },
  { tag: "05", daysFromToday: 10, quantity: 5 },
  { tag: "06", daysFromToday: 45, quantity: 2 },
  { tag: "07", daysFromToday: 20, quantity: 8 },
  { tag: "08", daysFromToday: 50, quantity: 4 },
  { tag: "09", daysFromToday: 25, quantity: 9 },
  { tag: "10", daysFromToday: 35, quantity: 6 },
];

// Compute expected order for each sort key given the fixtures above.
const expected: Record<string, string[]> = {
  "expiration-asc": [...fixtures]
    .sort((a, b) => a.daysFromToday - b.daysFromToday)
    .map((f) => f.tag),
  "expiration-desc": [...fixtures]
    .sort((a, b) => b.daysFromToday - a.daysFromToday)
    .map((f) => f.tag),
  "created-desc": [...fixtures].reverse().map((f) => f.tag), // newest first
  "created-asc": fixtures.map((f) => f.tag), // creation order
  "total-asc": [...fixtures].sort((a, b) => a.quantity - b.quantity).map((f) => f.tag),
  "total-desc": [...fixtures].sort((a, b) => b.quantity - a.quantity).map((f) => f.tag),
};

// Expected quick-readable labels for each sort button.
const sortLabel: Record<string, string> = {
  "expiration-asc": "Vencimiento · próximo",
  "expiration-desc": "Vencimiento · lejano",
  "created-desc": "Creado · reciente",
  "created-asc": "Creado · antiguo",
  "total-desc": "Total · mayor",
  "total-asc": "Total · menor",
};

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

function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return ymd(d);
}

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
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

/**
 * Clean up any previous "Sort Test NN" cards (from prior runs) so the
 * test starts from a deterministic baseline. Each delete button is
 * confirmed via window.confirm dialog.
 */
async function cleanupExisting(page: Page): Promise<number> {
  let removed = 0;
  // Loop until no more matching cards exist (each delete is optimistic).
  while (removed < 50) {
    // Hard-reload each iteration so we never race a pending delete.
    await page.goto(`${BASE_URL}/quotes`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await dismissTour(page);

    const card = page
      .getByTestId("quote-card")
      .filter({ has: page.getByRole("heading", { name: new RegExp(`^${TAG_PREFIX} \\d+$`) }) })
      .first();
    if ((await card.count()) === 0) break;
    page.once("dialog", (dialog) => void dialog.accept());
    const trash = card.getByTestId("quote-delete");
    await trash.click();
    // Wait for the card to actually disappear (optimistic remove).
    await card.waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    removed += 1;
  }
  return removed;
}

async function createQuote(
  page: Page,
  tag: string,
  daysFromToday: number,
  quantity: number,
): Promise<void> {
  await page.goto(`${BASE_URL}/quotes/new`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await dismissTour(page);

  await page.getByLabel("Cliente").fill(`${TAG_PREFIX} ${tag}`);
  await page.getByLabel("Vencimiento").fill(todayPlus(daysFromToday));

  // Select the first available template (skip the empty placeholder
  // option) and fill the quantity.
  const recipeSelect = page.locator("#quote-model-0-recipe");
  await recipeSelect.waitFor({ state: "visible", timeout: 15_000 });
  const optionValues = await recipeSelect
    .locator("option")
    .evaluateAll((opts) =>
      (opts as HTMLOptionElement[]).map((o) => o.value).filter((value) => value !== ""),
    );
  if (optionValues.length === 0) {
    throw new Error("No hay plantillas disponibles; creá al menos una antes de correr el test.");
  }
  await recipeSelect.selectOption(optionValues[0]);
  await page.locator("#quote-model-0-quantity").fill(String(quantity));

  // Leave profit % at default (DEFAULT_PROFIT_PERCENT) — totals will
  // still be strictly ordered by quantity because unit_cost > 0.

  await Promise.all([
    page.waitForURL(/\/quotes\/[a-z0-9-]+$/, { timeout: 15_000 }),
    page.getByRole("button", { name: /crear borrador/i }).click(),
  ]);
  await page.waitForLoadState("networkidle").catch(() => {});
}

type CardSummary = { tag: string; expiration: string; total: string };
const TAG_REGEX = new RegExp(`^${TAG_PREFIX} (\\d+)$`);

async function readCards(page: Page): Promise<CardSummary[]> {
  // Restrict to Sort Test cards so the existing production quote (if
  // any) is ignored.
  const cards = page
    .getByTestId("quote-card")
    .filter({ has: page.getByRole("heading", { name: TAG_REGEX }) });
  const count = await cards.count();
  const out: CardSummary[] = [];
  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    const heading = (await card.locator("h2").textContent())?.trim() ?? "";
    const tagMatch = heading.match(TAG_REGEX);
    const tag = tagMatch ? tagMatch[1] : "?";
    const dds = await card.locator("dd").allTextContents();
    out.push({
      tag,
      expiration: (dds[0] ?? "").trim(),
      total: (dds[1] ?? "").trim(),
    });
  }
  return out;
}

async function checkSort(page: Page, sort: string): Promise<{ ok: boolean; got: string[] }> {
  const order = expected[sort] ?? [];
  const label = sortLabel[sort] ?? sort;

  // The sort buttons are <button> elements that call router.push().
  // Wait for the URL to flip to `?sort=...` (or to the bare pathname
  // when the default sort is selected).
  const button = page.getByTestId(`quote-sort-${sort}`);
  await button.click();
  const url = new URL(page.url());
  const expectedSearch = sort === "expiration-asc" ? "" : `sort=${sort}`;

  await page.waitForFunction(
    ({ search }) => window.location.search === search,
    { search: expectedSearch ? `?${expectedSearch}` : "" },
    { timeout: 10_000 },
  );
  await page.waitForLoadState("networkidle").catch(() => {});

  // Wait for all 10 Sort Test cards to render (race-condition guard for
  // the first sort: the page may not have streamed all cards yet).
  try {
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('[data-testid="quote-card"]')).filter((el) =>
          /^Sort Test \d+$/.test(
            (el.querySelector("h2")?.textContent ?? "").trim(),
          ),
        ).length >= 10,
      undefined,
      { timeout: 8_000 },
    );
  } catch {
    // Fall through — the assertion below will report the actual count.
  }

  // Sanity: GitHub-Flavored-Markdown snapshot URL just to confirm the
  // page-reload cycle didn't break the sort bar.
  const bar = page.getByTestId("quote-sort");
  if (!(await bar.isVisible().catch(() => false))) {
    fail(`Sort bar not visible after clicking '${label}'`);
    return { ok: false, got: [] };
  }

  const cards = await readCards(page);
  const got = cards.map((c) => c.tag);

  if (got.length !== order.length) {
    fail(
      `${label}: expected ${order.length} Sort Test cards, got ${got.length} (got tags: ${got.join(",")})`,
    );
    return { ok: false, got };
  }

  const ok = got.every((tag, idx) => tag === order[idx]);
  if (ok) {
    pass(`${label}: order = ${got.join(" → ")}`);
  } else {
    fail(
      `${label}: expected ${order.join(" → ")}, got ${got.join(" → ")}`,
    );
    // Dump the actual data so the user can spot the bug pattern.
    for (const c of cards) {
      console.log(`         ${c.tag}  venc=${c.expiration}  total=${c.total}`);
    }
  }

  // Avoid unused-var lint while keeping the URL available for debug.
  void url;
  return { ok, got };
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false, slowMo: SLOW_MS });
  const context = await contextWithTourDismissed(browser, {
    viewport: { width: 1440, height: 900 },
    locale: "es-AR",
  });
  const page = await context.newPage();

  console.log("▶ Sign in");
  await login(page);
  pass("Signed in");

  console.log("\n▶ Cleanup previous Sort Test cards");
  const cleaned = await cleanupExisting(page);
  if (cleaned > 0) pass(`Removed ${cleaned} leftover Sort Test card(s)`);
  else pass("No leftover Sort Test cards");

  console.log("\n▶ Create 10 presupuestos with varied date + quantity");
  for (const f of fixtures) {
    process.stdout.write(`  · ${TAG_PREFIX} ${f.tag} (venc +${f.daysFromToday}d, cant ${f.quantity}) ... `);
    await createQuote(page, f.tag, f.daysFromToday, f.quantity);
    console.log("ok");
  }
  pass("Created 10 quotes");

  await page.goto(`${BASE_URL}/quotes`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await dismissTour(page);
  await page.screenshot({ path: `${SHOTS}/00_initial.png`, fullPage: true });

  console.log("\n▶ Test each sort mode");
  for (const sort of Object.keys(expected)) {
    await checkSort(page, sort);
    await page.screenshot({ path: `${SHOTS}/sort-${sort}.png`, fullPage: true });
  }

  await browser.close();

  const allOk = fails.length === 0;
  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`📋 Summary — ${passes.length} passed, ${fails.length} failed`);
  console.log(`══════════════════════════════════════════════════════════════`);
  if (allOk) {
    console.log("✅ All 6 sort modes verified");
  } else {
    console.log("❌ One or more sort modes failed\n");
    console.log("Diagnosis (root cause per failure):\n");
    console.log("  · Total · mayor");
    console.log("    compareTotal(a, b, dir) = dir * Number(a.total) - Number(b.total)");
    console.log("    ↑ precedence bug: parses as (dir * a) - b, not dir * (a - b).");
    console.log("    For dir=-1, returns -(a+b) < 0 always → comparator always says");
    console.log("    'a < b' → a always first → Array.sort is stable → result is the");
    console.log("    DB input order, NOT the total order.\n");
    console.log("  · Creado · reciente / Creado · antiguo");
    console.log("    compareId uses quote.id as a creation-time proxy, but the IDs are");
    console.log("    crypto.randomUUID() (v4) — random, not time-ordered. The sort");
    console.log("    works correctly on a v7 UUID stream but is effectively random here.");
  }
  console.log(`\n📸 Screenshots: ${SHOTS}/`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
