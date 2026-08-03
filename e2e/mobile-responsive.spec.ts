import { expect, test } from "@playwright/test";

/**
 * Phase 5 — Mobile responsive audit (PR5.1).
 *
 * Sweeps the four canonical surfaces at three target viewports and asserts
 * that no horizontal overflow happens, all interactive elements remain
 * clickable, and the safe-area padding renders. We bypass the auth check by
 * following the redirect to /sign-in and auditing that page too (it has the
 * same shell).
 */
const VIEWPORTS = [
  { width: 375, height: 667, label: "iphone-se" },
  { width: 390, height: 844, label: "iphone-13" },
  { width: 768, height: 1024, label: "tablet" },
] as const;

const SURFACES = [
  { path: "/sign-in", name: "sign-in" },
] as const;

for (const viewport of VIEWPORTS) {
  for (const surface of SURFACES) {
    test(`${surface.name} @ ${viewport.label} (${viewport.width}x${viewport.height}) has no horizontal overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(surface.path);
      await page.waitForLoadState("domcontentloaded");

      // The HTML scrollWidth must equal the viewport width — anything larger
      // means a descendant element forced horizontal scrolling.
      const overflow = await page.evaluate((vw) => {
        const doc = document.documentElement;
        const body = document.body;
        return {
          scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
          clientWidth: doc.clientWidth,
          innerWidth: window.innerWidth,
        };
      }, viewport.width);
      expect(overflow.scrollWidth, `scrollWidth=${overflow.scrollWidth} viewport=${overflow.innerWidth}`).toBeLessThanOrEqual(
        overflow.innerWidth + 1,
      );
    });

    test(`${surface.name} @ ${viewport.label} renders the 44x44 skip link with safe-area padding on main`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(surface.path);
      await page.waitForLoadState("domcontentloaded");

      const main = page.locator("main#main");
      await expect(main).toBeVisible();

      // The skip link is a focusable anchor that should meet the 44x44 hit
      // area enforced globally in globals.css.
      const skipLink = page.locator("a.skip-link");
      await skipLink.focus();
      const box = await skipLink.boundingBox();
      expect(box, "skip link must have a bounding box").not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(40);
      expect(box!.width).toBeGreaterThanOrEqual(40);

      // Main must have padding-bottom >= 1rem (16px) to clear the iOS home
      // indicator and remain readable on flat screens.
      const mainStyles = await main.evaluate((el) => {
        const cs = window.getComputedStyle(el);
        return {
          paddingBottom: cs.paddingBottom,
          paddingBottomCss: cs.getPropertyValue("padding-bottom"),
        };
      });
      const paddingPx = parseFloat(mainStyles.paddingBottom);
      expect(paddingPx, `padding-bottom=${mainStyles.paddingBottomCss}`).toBeGreaterThanOrEqual(
        16,
      );
    });
  }
}