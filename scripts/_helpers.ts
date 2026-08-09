import { type Browser, type BrowserContext } from "playwright";

/**
 * Shared Playwright helper for the qa-* scripts. Every `browser.newContext()`
 * Playwright creates has a fresh `localStorage` partition, so the
 * `pv-tour-disabled = "1"` opt-out a real user persisted during the
 * previous run is missing. The next time the script opens `/`, the
 * `<Tutorial />` component sees the absence of the flag and re-shows
 * the overlay — which is what the user sees in the headed browser
 * window every time a qa-* script runs.
 *
 * `contextWithTourDismissed()` creates a context with an `addInitScript`
 * that pre-seeds the opt-out key before any page script runs. The
 * `<Tutorial />` reads `localStorage` synchronously in its useState
 * lazy initializer, so the init script must run before React boots.
 * addInitScript runs in every new page before any other script, which
 * is exactly what we need.
 *
 * The helper is the only call site for `browser.newContext()` in the
 * qa-* scripts — see the `qa-*` imports below. If you spin up a new
 * test that uses headed Playwright, route it through this helper too
 * so the user behind the browser doesn't see the tour pop up on every
 * script run.
 */
export type TourContextOptions = NonNullable<Parameters<Browser["newContext"]>[0]>;

export async function contextWithTourDismissed(
  browser: Browser,
  options: TourContextOptions = {},
): Promise<BrowserContext> {
  const ctx = await browser.newContext(options);
  await ctx.addInitScript(() => {
    try {
      window.localStorage.setItem("pv-tour-disabled", "1");
    } catch {
      // localStorage may be disabled in the browser context — that's
      // a parse failure mode, not a test failure.
    }
  });
  return ctx;
}
