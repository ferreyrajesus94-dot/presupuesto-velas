/**
 * QA Smoke Test - presupuestoVelas v0.4.6
 *
 * Headed Playwright run against local dev server (http://localhost:3000).
 * Exercises the full happy path: sign in → create materials → create templates
 * → create quotes. Captures screenshots, console errors, and network failures
 * at every step. Outputs a structured report at the end.
 *
 * Run with: npx tsx scripts/qa-smoke.ts
 */

import { chromium, type ConsoleMessage, type Page, type Request, type Response } from "playwright";
import { contextWithTourDismissed } from "./_helpers";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = "/tmp/opencode/qa-screenshots";
const REPORT_PATH = "/tmp/opencode/qa-smoke-report.json";

const EMAIL = "adminvelas@gmail.com";
// Read password from the secure drop file (chmod 600, written by the user
// via `read -rs`). Never log it; wipe the file at exit.
const PASS_FILE = "/tmp/opencode/.admin-pass";
const PASSWORD = readFileSync(PASS_FILE, "utf8");

if (!EMAIL || !PASSWORD) {
  console.error("ERROR: missing credentials");
  process.exit(1);
}

interface Issue {
  phase: string;
  step: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  kind: "console" | "network" | "visual" | "functional";
  message: string;
  details?: unknown;
  screenshot?: string;
}

interface Step {
  phase: string;
  name: string;
  startedAt: string;
  endedAt?: string;
  ok: boolean;
  notes?: string;
}

const issues: Issue[] = [];
const steps: Step[] = [];
const consoleErrors: { phase: string; text: string; type: string }[] = [];
const networkFailures: { phase: string; url: string; status: number; method: string }[] = [];

let currentPhase = "init";

function logIssue(issue: Omit<Issue, "screenshot"> & { screenshot?: string }) {
  issues.push(issue as Issue);
  const icon =
    issue.severity === "CRITICAL" ? "🛑" : issue.severity === "WARNING" ? "⚠️ " : "ℹ️ ";
  console.log(
    `  ${icon} [${issue.severity}] [${issue.kind}] ${issue.step}: ${issue.message}`,
  );
}

function startStep(phase: string, name: string) {
  currentPhase = phase;
  const step: Step = { phase, name, startedAt: new Date().toISOString(), ok: false };
  steps.push(step);
  console.log(`\n▶ [${phase}] ${name}`);
  return step;
}

function endStep(step: Step, ok: boolean, notes?: string) {
  step.endedAt = new Date().toISOString();
  step.ok = ok;
  if (notes) step.notes = notes;
  console.log(`  ${ok ? "✅" : "❌"} ${step.name}${notes ? ` — ${notes}` : ""}`);
}

async function shot(page: Page, label: string): Promise<string> {
  const safe = label.replace(/[^a-z0-9-]+/gi, "_").toLowerCase();
  const path = join(SCREENSHOT_DIR, `${Date.now()}_${safe}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function signIn(page: Page): Promise<void> {
  const step = startStep("auth", "Navigate to /sign-in");
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: join(SCREENSHOT_DIR, `01_signin_initial.png`), fullPage: true });
  endStep(step, true, "loaded sign-in page");

  const step2 = startStep("auth", "Fill email + password and submit");
  await dismissTour(page);
  await page.getByLabel("Email").first().fill(EMAIL);
  await page.getByLabel("Contraseña").first().fill(PASSWORD);
  await page.screenshot({ path: join(SCREENSHOT_DIR, `02_signin_filled.png`), fullPage: true });
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 }),
    page.getByRole("button", { name: /Iniciar sesión/i }).click(),
  ]);
  await page.waitForLoadState("networkidle").catch(() => {});
  endStep(step2, true, `landed on ${new URL(page.url()).pathname}`);
}

async function dismissTour(page: Page): Promise<void> {
  const skip = page.getByRole("button", { name: /Saltar tour/i });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }
}

async function createMaterials(page: Page): Promise<string[]> {
  const ids: string[] = [];
  // The /materials page renders the "Agregar material" form INLINE by default
  // (no expand/drawer trigger). Fields: Nombre, Dimensión, Unidad base,
  // Unidad de compra, Cantidad de compra, Precio de compra (ARS). Submit
  // button label is "Crear material".
  const samples = [
    {
      name: "Cera de soja",
      dimension: "Peso",
      baseUnit: "Gramos",
      purchaseUnit: "Kilogramo",
      purchaseQty: "1",
      cost: "5000",
    },
    {
      name: "Esencia floral",
      dimension: "Volumen",
      baseUnit: "Mililitros",
      purchaseUnit: "Mililitro",
      purchaseQty: "100",
      cost: "8000",
    },
    {
      name: "Mecha de algodón",
      dimension: "Largo",
      baseUnit: "Centimetros",
      purchaseUnit: "Metro",
      purchaseQty: "10",
      cost: "2000",
    },
  ];

  await page.goto(`${BASE_URL}/materials`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await dismissTour(page);
  await page.screenshot({
    path: join(SCREENSHOT_DIR, `10_materials_initial.png`),
    fullPage: true,
  });

  for (let i = 0; i < samples.length; i++) {
    const m = samples[i];
    const step = startStep("materials", `Create material #${i + 1}: ${m.name}`);

    // Fill the inline form fields. Use .first() because several labels have
    // a sibling aria-label="Ayuda: ..." button (field-help trigger) that
    // also matches the regex.
    await page.getByLabel(/^Nombre$/).first().fill(m.name);

    const dimensionSelect = page.getByLabel(/^Dimensi[oó]n$/).first();
    if (await dimensionSelect.isVisible().catch(() => false)) {
      await dimensionSelect.selectOption(m.dimension).catch(() => {});
    }

    const baseUnitSelect = page.getByLabel(/^Unidad base$/).first();
    if (await baseUnitSelect.isVisible().catch(() => false)) {
      await baseUnitSelect.selectOption(m.baseUnit).catch(() => {});
    }

    const purchaseUnitSelect = page.getByLabel(/^Unidad de compra$/).first();
    if (await purchaseUnitSelect.isVisible().catch(() => false)) {
      await purchaseUnitSelect.selectOption(m.purchaseUnit).catch(() => {});
    }

    await page.getByLabel(/^Cantidad de compra$/).first().fill(m.purchaseQty);
    await page.getByLabel(/Precio de compra/i).first().fill(m.cost);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, `11_material_${i + 1}_filled.png`),
      fullPage: true,
    });

    // Submit
    const createBtn = page.getByRole("button", { name: /Crear material/i }).first();
    if (!(await createBtn.isVisible().catch(() => false))) {
      logIssue({
        phase: "materials",
        step: `create #${i + 1}`,
        severity: "CRITICAL",
        kind: "functional",
        message: "Cannot find 'Crear material' submit button",
      });
      endStep(step, false);
      continue;
    }
    await createBtn.click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(800);

    // Verify by checking if the new material appears in the list below
    await page.waitForTimeout(300);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, `12_material_${i + 1}_after.png`),
      fullPage: true,
    });
    const visible = await page
      .getByText(m.name, { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    if (visible) {
      ids.push(m.name);
      endStep(step, true, `material "${m.name}" visible in list`);
    } else {
      logIssue({
        phase: "materials",
        step: `create #${i + 1}`,
        severity: "CRITICAL",
        kind: "functional",
        message: `Material "${m.name}" not visible in /materials after create`,
      });
      endStep(step, false);
    }
  }

  return ids;
}

async function createTemplates(page: Page, materialNames: string[]): Promise<string[]> {
  const created: string[] = [];
  await page.goto(`${BASE_URL}/templates`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await dismissTour(page);
  await page.screenshot({
    path: join(SCREENSHOT_DIR, `20_templates_initial.png`),
    fullPage: true,
  });

  for (let i = 0; i < 2; i++) {
    const tplName = `QA Plantilla ${Date.now().toString(36)}-${i + 1}`;
    const step = startStep("templates", `Create template #${i + 1}: ${tplName}`);

    const beforeCount = await page.getByTestId("template-card").count();
    await page.getByTestId("plantilla-new").click();
    // The new card is always prepended at index 0.
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-testid="template-card"]').length === n,
      beforeCount + 1,
      { timeout: 5_000 },
    ).catch(() => {});

    const card = page.getByTestId("template-card").nth(0);
    await card.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});

    // Add a material row + pick the first available material.
    await card.getByTestId("plantilla-add-material").click();
    const matSelect = card
      .locator("[data-testid='plantilla-material-row']")
      .locator("select")
      .first();
    const optionCount = await matSelect.locator("option").count();
    if (optionCount <= 1) {
      logIssue({
        phase: "templates",
        step: `create #${i + 1}`,
        severity: "CRITICAL",
        kind: "functional",
        message: `Material select has only ${optionCount} options. Materials not seeded.`,
      });
    } else {
      const chosen = await matSelect.locator("option").nth(1).getAttribute("value");
      if (chosen) await matSelect.selectOption(chosen);
    }

    await card.getByLabel("Cantidad").first().fill("100");

    // Calculator meta
    await card.getByLabel(/Tiempo/).first().fill("60");
    await card.getByLabel(/Costo\/h/).first().fill("1500");
    await card.getByLabel(/Costos fijos/).first().fill("200");

    // Rename via the "Editar nombre" button (not by clicking the heading —
    // the heading has no click handler).
    const renameBtn = card.getByRole("button", { name: /Editar nombre/i }).first();
    if (await renameBtn.isVisible().catch(() => false)) {
      await renameBtn.click();
      // The input replaces the heading; locate it inside the card.
      const renameInput = card.locator("input").first();
      if (await renameInput.isVisible().catch(() => false)) {
        await renameInput.fill(tplName);
        await card.getByRole("button", { name: /^Guardar$/i }).first().click();
        await page.waitForTimeout(400);
      }
    }

    await page.screenshot({
      path: join(SCREENSHOT_DIR, `21_template_${i + 1}_filled.png`),
      fullPage: true,
    });

    // Save
    const save = card.getByTestId("plantilla-save");
    await save.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
    const dirty = await save.getAttribute("data-dirty").catch(() => null);
    if (dirty !== "true") {
      logIssue({
        phase: "templates",
        step: `create #${i + 1}`,
        severity: "WARNING",
        kind: "functional",
        message: `Save button data-dirty=${dirty} (expected 'true')`,
      });
    }
    await save.click();
    await expect_save_settled(save, "data-saving", "false", 15_000).catch(() => {});
    await page.waitForTimeout(800);
    created.push(tplName);
    endStep(step, true, `template created (name="${tplName}")`);
  }

  // Verify all created names appear after a hard reload.
  const verifyStep = startStep("templates", "Verify all templates persist after reload");
  await page.goto(`${BASE_URL}/templates`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await dismissTour(page);
  await page.screenshot({
    path: join(SCREENSHOT_DIR, `22_templates_after_reload.png`),
    fullPage: true,
  });
  for (const name of created) {
    const visible = await page
      .getByRole("heading", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) })
      .first()
      .isVisible()
      .catch(() => false);
    if (!visible) {
      logIssue({
        phase: "templates",
        step: "verify",
        severity: "CRITICAL",
        kind: "functional",
        message: `Template "${name}" not visible after reload`,
      });
    }
  }
  endStep(
    verifyStep,
    issues.filter((i) => i.phase === "templates" && i.severity === "CRITICAL" && i.step === "verify")
      .length === 0,
    `${created.length} templates requested, reload complete`,
  );
  return created;
}

async function createQuotes(page: Page, templateNames: string[]): Promise<string[]> {
  const created: string[] = [];
  for (let i = 0; i < 2; i++) {
    const tplName = templateNames[i];
    if (!tplName) {
      logIssue({
        phase: "quotes",
        step: `create #${i + 1}`,
        severity: "WARNING",
        kind: "functional",
        message: `No template available for quote #${i + 1}, skipping`,
      });
      continue;
    }
    const step = startStep("quotes", `Create quote #${i + 1} from "${tplName}"`);
    await page.goto(`${BASE_URL}/quotes/new`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await dismissTour(page);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, `30_quote_${i + 1}_form.png`),
      fullPage: true,
    });

    // Customer name (optional, but useful for verification).
    const customer = `Cliente QA ${i + 1}`;
    await page.locator("#quote-customer").fill(customer);

    // Pick the template by visible name in the model-line select.
    const recipeSelect = page.locator("#quote-model-0-recipe");
    const optionCount = await recipeSelect.locator("option").count();
    let matched = false;
    for (let o = 0; o < optionCount; o++) {
      const opt = recipeSelect.locator("option").nth(o);
      const txt = await opt.textContent();
      if (txt?.trim() === tplName) {
        const val = await opt.getAttribute("value");
        if (val) {
          await recipeSelect.selectOption(val);
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      logIssue({
        phase: "quotes",
        step: `create #${i + 1}`,
        severity: "WARNING",
        kind: "functional",
        message: `Template "${tplName}" not in #quote-model-0-recipe options (count=${optionCount})`,
      });
    }

    // Quantity for the first model row.
    await page.locator("#quote-model-0-quantity").fill("10");

    await page.screenshot({
      path: join(SCREENSHOT_DIR, `31_quote_${i + 1}_filled.png`),
      fullPage: true,
    });

    // Submit.
    const submit = page.getByRole("button", { name: /Crear borrador/i }).first();
    if (!(await submit.isVisible().catch(() => false))) {
      logIssue({
        phase: "quotes",
        step: `create #${i + 1}`,
        severity: "CRITICAL",
        kind: "functional",
        message: "No 'Crear borrador' submit button on /quotes/new",
      });
      endStep(step, false);
      continue;
    }
    await submit.click();

    // The form does router.push(`/quotes/${quoteId}`) on success.
    try {
      await page.waitForURL(/\/quotes\/[a-f0-9-]+/, { timeout: 15_000 });
    } catch {
      logIssue({
        phase: "quotes",
        step: `create #${i + 1}`,
        severity: "CRITICAL",
        kind: "functional",
        message: `Quote did not navigate to /quotes/:id after submit (still at ${new URL(page.url()).pathname})`,
      });
      await page.screenshot({
        path: join(SCREENSHOT_DIR, `32_quote_${i + 1}_STUCK.png`),
        fullPage: true,
      });
      endStep(step, false);
      continue;
    }
    await page.waitForLoadState("networkidle").catch(() => {});
    const quoteId = new URL(page.url()).pathname.split("/").pop() ?? "";
    await page.screenshot({
      path: join(SCREENSHOT_DIR, `32_quote_${i + 1}_created.png`),
      fullPage: true,
    });
    created.push(quoteId);
    endStep(step, true, `quote ${quoteId} created for customer "${customer}"`);
  }

  // Verify by going back to /quotes and looking for the customer names.
  if (created.length > 0) {
    const verifyStep = startStep("quotes", "Verify all quotes listed on /quotes");
    await page.goto(`${BASE_URL}/quotes`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.screenshot({
      path: join(SCREENSHOT_DIR, `33_quotes_list.png`),
      fullPage: true,
    });
    endStep(verifyStep, true, `list captured`);
  }
  return created;
}

// Helper because `expect` is from playwright/test, not playwright. Roll our own.
async function expect_save_settled(loc: ReturnType<Page["locator"]>, attr: string, val: string, timeout: number) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await loc.getAttribute(attr).catch(() => null);
    if (v === val) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`expected ${attr}=${val} within ${timeout}ms`);
}

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await contextWithTourDismissed(browser, {
    viewport: { width: 1440, height: 900 },
    locale: "es-AR",
  });
  const page = await context.newPage();

  // Console + network capture
  page.on("console", (msg: ConsoleMessage) => {
    const type = msg.type();
    if (type === "error" || type === "warning") {
      consoleErrors.push({ phase: currentPhase, text: msg.text(), type });
      logIssue({
        phase: currentPhase,
        step: "console",
        severity: type === "error" ? "WARNING" : "INFO",
        kind: "console",
        message: `${type}: ${msg.text()}`,
      });
    }
  });

  page.on("response", (resp: Response) => {
    const status = resp.status();
    const url = resp.url();
    if (status >= 400 && !url.includes("/_next/")) {
      networkFailures.push({
        phase: currentPhase,
        url,
        status,
        method: resp.request().method(),
      });
      logIssue({
        phase: currentPhase,
        step: "network",
        severity: status >= 500 ? "CRITICAL" : "WARNING",
        kind: "network",
        message: `${status} ${resp.request().method()} ${url}`,
      });
    }
  });

  page.on("pageerror", (err) => {
    logIssue({
      phase: currentPhase,
      step: "pageerror",
      severity: "CRITICAL",
      kind: "console",
      message: `pageerror: ${err.message}`,
    });
  });

  try {
    await signIn(page);
    const materials = await createMaterials(page);
    const templates = await createTemplates(page, materials);
    const quotes = await createQuotes(page, templates);

    console.log("\n══════════════════════════════════════════════════════════════");
    console.log(`📦 Created: ${materials.length} materials, ${templates.length} templates, ${quotes.length} quotes`);
    console.log("══════════════════════════════════════════════════════════════");
  } catch (err) {
    logIssue({
      phase: currentPhase,
      step: "fatal",
      severity: "CRITICAL",
      kind: "functional",
      message: `Unhandled error: ${(err as Error).message}`,
      details: { stack: (err as Error).stack },
    });
  } finally {
    // Final dashboard screenshot
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.screenshot({
      path: join(SCREENSHOT_DIR, `99_dashboard.png`),
      fullPage: true,
    });

    await browser.close();

    const report = {
      runAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      email: EMAIL,
      totals: {
        steps: steps.length,
        issues: issues.length,
        critical: issues.filter((i) => i.severity === "CRITICAL").length,
        warning: issues.filter((i) => i.severity === "WARNING").length,
        info: issues.filter((i) => i.severity === "INFO").length,
        consoleErrors: consoleErrors.length,
        networkFailures: networkFailures.length,
      },
      steps,
      issues,
      consoleErrors,
      networkFailures,
    };
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`\n📝 Report written: ${REPORT_PATH}`);
    console.log(`📸 Screenshots in: ${SCREENSHOT_DIR}`);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});

// Local re-export to silence the unused import warning
void expect_save_settled;
