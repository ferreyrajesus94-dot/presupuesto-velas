/**
 * U8 — Real authenticated visual proof at 375px and 1280px.
 *
 * Captures the rosa-crema visual contract for the public auth screen and every
 * authenticated route. Browser proof is read-only: no form submissions beyond
 * auth, no status transitions, no archive/delete, no DB mutations. Fixtures
 * reached via visible links only.
 *
 * Missing env, fixture, detail link, or edit link FAIL with explicit assertion
 * evidence — intrinsic 16 pass / 0 skip contract. Non-pixel, non-brittle
 * assertions: geometry (scrollWidth ≤ clientWidth), semantic landmarks, Spanish
 * copy, focus-visible outline, 44px tap targets, semantic typography scale (h1
 * > body; h2 ≤ h1, h2 ≥ body when present; Geist font), semantic tokens
 * `--pv-canvas`/`--pv-brand` apply to body, header→next spacing rhythm within
 * a bounded relationship window. No exact pixels, no screenshot.
 */
import { expect, test, type Page } from "@playwright/test";

const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? "";
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "";
const INVALID_ALERT = /invalid email or password/i;
const CUSTOMER_FIXTURE = "Prueba visual E2E";
const VIEWPORTS = [
  { name: "mobile-375", width: 375, height: 720 },
  { name: "desktop-1280", width: 1280, height: 800 },
] as const;

async function assertNav(page: Page): Promise<void> {
  const nav = page.getByRole("navigation", { name: /navegación principal/i });
  await expect(nav).toBeVisible();
  for (const label of ["Inicio", "Materiales", "Recetas", "Cotizaciones"]) {
    await expect(nav.getByRole("link", { name: new RegExp(`^${label}$`, "i") })).toBeVisible();
  }
}

async function assertVisualContract(page: Page): Promise<void> {
  const m = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const h2 = document.querySelector("h2");
    const cs = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const fs = (el: Element | null) => (el ? parseFloat(getComputedStyle(el).fontSize) : 0);
    const tok = (n: string) => cs.getPropertyValue(n).trim();
    const header = document.querySelector("header");
    const sibling = header?.nextElementSibling as HTMLElement | null;
    const hr = header?.getBoundingClientRect();
    const sr = sibling?.getBoundingClientRect();
    return {
      hs: fs(h1),
      h2s: fs(h2),
      bs: parseFloat(body.fontSize),
      bf: body.fontFamily,
      h1f: h1 ? getComputedStyle(h1).fontFamily : "",
      cv: tok("--pv-canvas"),
      br: tok("--pv-brand"),
      bb: body.backgroundColor,
      bc: body.color,
      gap: hr && sr ? sr.top - hr.bottom : -1,
      ds: document.documentElement.scrollWidth,
      dc: document.documentElement.clientWidth,
      bsw: document.body.scrollWidth,
    };
  });
  expect(m.ds, `overflow: doc=${m.ds} client=${m.dc}`).toBeLessThanOrEqual(m.dc);
  expect(m.bsw).toBeLessThanOrEqual(m.dc);
  expect(m.hs, "h1 fontSize").toBeGreaterThan(m.bs);
  expect(m.bf.toLowerCase(), "Geist on body").toContain("geist");
  expect(m.h1f.toLowerCase(), "Geist on h1").toContain("geist");
  expect(m.cv, "--pv-canvas").toMatch(/^#fff8f8$/i);
  expect(m.br, "--pv-brand").toMatch(/^#6f3540$/i);
  expect(m.bb, "body bg applied").toBe("rgb(255, 248, 248)");
  expect(m.bc, "body color applied").toBe("rgb(51, 39, 42)");
  if (m.h2s > 0) {
    expect(m.h2s, "h2 ≤ h1").toBeLessThanOrEqual(m.hs);
    expect(m.h2s, "h2 ≥ body").toBeGreaterThanOrEqual(m.bs);
  }
  expect(m.gap, "header→next gap").toBeGreaterThan(0);
  expect(m.gap, "header→next gap").toBeLessThan(64);
}

async function assertTabContract(page: Page): Promise<void> {
  const sel = 'input[name="email"], input[name="password"], button[type="submit"]';
  const email = page.locator('input[name="email"]');
  const sizes = await page.locator(sel).evaluateAll((ns) =>
    ns.map((n) => {
      const r = (n as HTMLElement).getBoundingClientRect();
      return { w: r.width, h: r.height };
    }),
  );
  expect(sizes.length, sel).toBeGreaterThan(0);
  for (const s of sizes) {
    expect(s.w, `${sel} w=${s.w}`).toBeGreaterThanOrEqual(44);
    expect(s.h, `${sel} h=${s.h}`).toBeGreaterThanOrEqual(44);
  }
  await email.focus();
  const o = await email.evaluate((el) => {
    const cs = window.getComputedStyle(el);
    return { s: cs.outlineStyle, w: parseFloat(cs.outlineWidth), c: cs.outlineColor };
  });
  expect(o.s, "outline-style").toBe("solid");
  expect(o.w, "outline-width").toBeGreaterThanOrEqual(2);
  expect(o.c, "outline-color").not.toBe("rgba(0, 0, 0, 0)");
}

async function findFixtureCard(page: Page) {
  await page.goto("/quotes");
  const card = page.locator('[data-testid="quote-card"]', { hasText: CUSTOMER_FIXTURE });
  await expect(card, `fixture card with customer "${CUSTOMER_FIXTURE}"`).toHaveCount(1);
  await expect(
    card.getByText(CUSTOMER_FIXTURE, { exact: true }),
    `visible customer text "${CUSTOMER_FIXTURE}"`,
  ).toBeVisible();
  return card;
}

async function signIn(page: Page): Promise<void> {
  // Retry only the verified transient visible `Invalid email or password.`
  // outcome from `signInAction`; rethrow any other click/navigation failure.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill(OWNER_EMAIL);
    await page.getByLabel(/contrase(?:ñ|&)a/i).fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: /^iniciar sesión$/i }).click();
    try {
      await page.waitForURL((u) => u.pathname === "/", { timeout: 15_000 });
      return;
    } catch (err) {
      if (attempt === 2) throw err;
      const transient = await page.getByRole("alert").filter({ hasText: INVALID_ALERT }).count();
      if (transient === 0) throw err;
      await page.waitForTimeout(2000);
    }
  }
}

for (const vp of VIEWPORTS) {
  test.describe(`Visual system @ ${vp.name} (${vp.width}x${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`public /sign-in meets the visual contract`, async ({ page }) => {
      await page.goto("/sign-in");
      await expect(page.getByRole("heading", { level: 1, name: /iniciar sesión/i })).toBeVisible();
      await expect(page.getByText(/calculadora flor/i)).toBeVisible();
      await assertVisualContract(page);
      await assertTabContract(page);
    });

    test.describe("authenticated routes", () => {
      test.beforeEach(async ({ page }) => {
        expect(OWNER_EMAIL, "E2E_OWNER_EMAIL env").not.toBe("");
        expect(OWNER_PASSWORD, "E2E_OWNER_PASSWORD env").not.toBe("");
        await signIn(page);
      });

      const PAGES = [
        { path: "/", h1: /^inicio$/i },
        { path: "/materials", h1: /^materiales$/i },
        { path: "/templates", h1: /^plantillas$/i },
        { path: "/quotes", h1: /^cotizaciones$/i },
        { path: "/quotes/new", h1: /^nueva cotización$/i },
      ];
      for (const p of PAGES) {
        test(`${p.path} meets the visual contract`, async ({ page }) => {
          await page.goto(p.path);
          await expect(page.getByRole("heading", { level: 1, name: p.h1 })).toBeVisible();
          await assertNav(page);
          await assertVisualContract(page);
        });
      }

      test(`/quotes/:id detail meets the visual contract`, async ({ page }) => {
        const card = await findFixtureCard(page);
        await card.getByRole("link", { name: /ver cotización/i }).click();
        await page.waitForURL(/\/quotes\/[a-z0-9-]+$/);
        await expect(page.getByRole("heading", { level: 1, name: /detalle/i })).toBeVisible();
        await assertNav(page);
        await assertVisualContract(page);
      });

      test(`/quotes/:id/edit meets the visual contract`, async ({ page }) => {
        const card = await findFixtureCard(page);
        await card.getByRole("link", { name: /ver cotización/i }).click();
        await page.waitForURL(/\/quotes\/[a-z0-9-]+$/);
        const editLink = page.getByRole("link", { name: /^editar$/i });
        await expect(editLink, "visible Editar link on draft").toBeVisible();
        await editLink.click();
        await page.waitForURL(/\/quotes\/[a-z0-9-]+\/edit$/);
        await expect(page.getByRole("heading", { level: 1, name: /editar/i })).toBeVisible();
        await assertNav(page);
        await assertVisualContract(page);
      });
    });
  });
}
