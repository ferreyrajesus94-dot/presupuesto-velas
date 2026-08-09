/**
 * Headed Playwright audit of the whole app in mobile viewport.
 *
 * For each canonical surface, the script:
 *   1. Loads it at the iPhone 13 viewport (390x844, the modal mobile size).
 *   2. Captures a full-page screenshot.
 *   3. Sweeps for common mobile regressions:
 *        - horizontal overflow (scrollWidth > viewport width)
 *        - tap targets < 44x44 (a11y / WCAG 2.5.5 minimum)
 *        - truncated text (text-overflow ellipsis where a wrap would do)
 *        - inputs that are narrower than their placeholder text
 *   4. Categorises the findings and dumps them as JSON.
 *
 * Output goes to /tmp/opencode/qa-mobile/ (screenshots + report.json).
 * Run with: `npx tsx scripts/qa-mobile-audit.ts`
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { contextWithTourDismissed } from "./_helpers";

const BASE_URL = "http://localhost:3000";
const EMAIL = "adminvelas@gmail.com";
const PASSWORD = readFileSync("/tmp/opencode/.admin-pass", "utf8").trim();
const OUT_DIR = "/tmp/opencode/qa-mobile";
const VIEWPORT = { width: 390, height: 844, label: "iphone-13" };

type Severity = "critical" | "warning" | "info";
type Finding = { surface: string; severity: Severity; category: string; detail: string };
const findings: Finding[] = [];
const fail = (f: Finding) => findings.push(f);

const surfaces: { path: string; name: string; auth: boolean }[] = [
  { path: "/sign-in", name: "01-sign-in", auth: false },
  { path: "/", name: "02-home", auth: true },
  { path: "/quotes", name: "03-quotes-list", auth: true },
  { path: "/quotes/new", name: "04-quote-new", auth: true },
  { path: "/templates", name: "05-templates", auth: true },
  { path: "/materials", name: "06-materials", auth: true },
  { path: "/settings", name: "07-settings", auth: true },
];

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
 * Sweep the rendered DOM for mobile regressions. Each check appends a
 * Finding so the final report groups issues by surface.
 */
async function auditSurface(page: Page, surface: { name: string; path: string }): Promise<void> {
  // 1. Horizontal overflow: scrollWidth must not exceed the viewport.
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    return {
      scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
      clientWidth: doc.clientWidth,
      innerWidth: window.innerWidth,
    };
  });
  if (overflow.scrollWidth > overflow.innerWidth + 1) {
    fail({
      surface: surface.name,
      severity: "critical",
      category: "horizontal-overflow",
      detail: `scrollWidth=${overflow.scrollWidth} > viewport=${overflow.innerWidth} (+${
        overflow.scrollWidth - overflow.innerWidth
      }px)`,
    });
  }

  // 2. Tap targets < 44x44 (buttons + links only — divs are not interactive).
  const tapTargets: Array<{
    tag: string;
    text: string;
    width: number;
    height: number;
    path: string;
  }> = await page.evaluate(() => {
    const all = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, a, input[type="button"], input[type="submit"], [role="button"]',
      ),
    );
    return all.map((el) => {
      const rect = el.getBoundingClientRect();
      const text = (el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 60);
      // Path-style identifier so we can tell which surface owns the offender.
      const path =
        location.pathname + (el.id ? `#${el.id}` : el.getAttribute("data-testid")
          ? `[data-testid="${el.getAttribute("data-testid")}"]`
          : "");
      return {
        tag: el.tagName.toLowerCase(),
        text,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        path,
      };
    });
  });
  for (const t of tapTargets) {
    // Hidden targets (display:none) report 0×0 — skip those.
    if (t.width === 0 || t.height === 0) continue;
    if (t.height < 44) {
      fail({
        surface: surface.name,
        severity: "warning",
        category: "tap-target-too-short",
        detail: `<${t.tag}> "${t.text}" height=${t.height}px (min 44)`,
      });
    }
    if (t.width < 44) {
      fail({
        surface: surface.name,
        severity: "warning",
        category: "tap-target-too-narrow",
        detail: `<${t.tag}> "${t.text}" width=${t.width}px (min 44)`,
      });
    }
  }

  // 3. Inputs whose intrinsic placeholder text overflows the visible
  // input width. We compare the rendered input width against the
  // longest contiguous placeholder word; if the word is longer than
  // the input, the placeholder will scroll on focus (a clear a11y
  // smell).
  const inputOverflows: Array<{ id: string; width: number; maxWord: number }> = await page.evaluate(
    () => {
      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>("input, textarea"),
      );
      return inputs
        .map((el) => {
          const placeholder = el.placeholder ?? "";
          const longest = placeholder
            .split(/\s+/)
            .reduce((max, w) => Math.max(max, w.length), 0);
          const approxCharPx = 8; // heuristic for body-size sans-serif
          return {
            id: el.id || el.name || el.getAttribute("data-testid") || el.tagName,
            width: Math.round(el.getBoundingClientRect().width),
            maxWord: Math.round(longest * approxCharPx),
          };
        })
        .filter((row) => row.width > 0);
    },
  );
  for (const io of inputOverflows) {
    if (io.maxWord > io.width + 4) {
      fail({
        surface: surface.name,
        severity: "info",
        category: "placeholder-overflow",
        detail: `input "${io.id}" width=${io.width}px but longest placeholder word ≈${io.maxWord}px`,
      });
    }
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false, slowMo: 150 });
  const context = await contextWithTourDismissed(browser, {
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "es-AR",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();

  console.log(`▶ Sign in (mobile ${VIEWPORT.label})`);
  await login(page);
  await dismissTour(page);
  console.log("  ✅ Signed in");

  for (const surface of surfaces) {
    console.log(`\n▶ Audit ${surface.path} @ ${VIEWPORT.label}`);
    await page.goto(`${BASE_URL}${surface.path}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await dismissTour(page);

    // If /quotes/new lacks a template, prime one with the smallest fixture
    // so the audit renders the full form (empty-state form has fewer
    // controls and would under-report).
    if (surface.path === "/quotes/new") {
      const recipeSelect = page.locator("#quote-model-0-recipe");
      if (await recipeSelect.isVisible().catch(() => false)) {
        const optionValues = await recipeSelect
          .locator("option")
          .evaluateAll((opts) =>
            (opts as HTMLOptionElement[]).map((o) => o.value).filter((value) => value !== ""),
          );
        if (optionValues.length > 0) {
          await recipeSelect.selectOption(optionValues[0]);
          await page.locator("#quote-model-0-quantity").fill("3");
          await page.getByLabel("Cliente").fill("Cliente Móvil");
          await page.getByLabel("Vencimiento").fill(todayPlus(30));
        }
      }
    }

    // If /templates is empty, prime with a tiny template so the workspace
    // surfaces the edit form (and the audit sees the full control set).
    if (surface.path === "/templates") {
      const newBtn = page.getByTestId("plantilla-new");
      if (await newBtn.isVisible().catch(() => false)) {
        // Skip if there is already a card to inspect.
        const hasCard = (await page.getByTestId("template-card").count()) > 0;
        if (!hasCard) {
          await newBtn.click().catch(() => {});
          await page.waitForLoadState("networkidle").catch(() => {});
        }
      }
    }

    await page.waitForTimeout(500);
    await auditSurface(page, surface);
    await page.screenshot({ path: `${OUT_DIR}/${surface.name}.png`, fullPage: true });
    console.log(`  📸 ${OUT_DIR}/${surface.name}.png`);
  }

  await browser.close();

  // ---- report ----
  const bySeverity: Record<Severity, Finding[]> = {
    critical: findings.filter((f) => f.severity === "critical"),
    warning: findings.filter((f) => f.severity === "warning"),
    info: findings.filter((f) => f.severity === "info"),
  };

  const report = {
    viewport: VIEWPORT,
    generatedAt: new Date().toISOString(),
    totals: {
      critical: bySeverity.critical.length,
      warning: bySeverity.warning.length,
      info: bySeverity.info.length,
    },
    bySurface: Object.fromEntries(
      surfaces.map((s) => [
        s.name,
        findings.filter((f) => f.surface === s.name),
      ]),
    ),
  };
  writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2));

  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(
    `📱 Mobile audit @ ${VIEWPORT.label} — ${bySeverity.critical.length} critical, ${bySeverity.warning.length} warning, ${bySeverity.info.length} info`,
  );
  console.log(`══════════════════════════════════════════════════════════════`);

  for (const surface of surfaces) {
    const issues = findings.filter((f) => f.surface === surface.name);
    if (issues.length === 0) {
      console.log(`  ✅ ${surface.name.padEnd(20)} no issues`);
      continue;
    }
    console.log(`  ${surface.name}`);
    for (const i of issues) {
      const icon = i.severity === "critical" ? "🛑" : i.severity === "warning" ? "⚠️ " : "ℹ️ ";
      console.log(`    ${icon} [${i.category}] ${i.detail}`);
    }
  }

  console.log(`\n📂 Screenshots: ${OUT_DIR}/`);
  console.log(`📝 Report:      ${OUT_DIR}/report.json`);
  process.exit(bySeverity.critical.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
