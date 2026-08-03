import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 5 — axe-core accessibility sweep on the public /sign-in surface
 * (the only surface reachable without an authenticated session in the local
 * dev environment).
 *
 * axe-core is loaded from node_modules at runtime (transitive dep of
 * @playwright/test) so we don't add a new prod/dev dependency for a single
 * sweep test. Violations are reported as `expect.soft` failures so the
 * summary still surfaces them without aborting the suite.
 */
const AXE_SOURCE = readFileSync(
  resolve(process.cwd(), "node_modules/axe-core/axe.min.js"),
  "utf8",
);

test("axe-core finds zero critical or serious violations on /sign-in", async ({ page }) => {
  await page.goto("/sign-in");
  await page.waitForLoadState("domcontentloaded");
  await page.addScriptTag({ content: AXE_SOURCE });
  const results = await page.evaluate(async () => {
    // @ts-expect-error axe is injected at runtime
    const result = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return result.violations.map(
      (v: {
        id: string;
        impact?: string;
        help: string;
        nodes: Array<{
          target: unknown;
          failureSummary?: string;
          html?: string;
        }>;
      }) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
          html: n.html,
        })),
      }),
    );
  });

  // Fail on any critical or serious impact.
  const blocking = results.filter(
    (v: { impact?: string }) => v.impact === "critical" || v.impact === "serious",
  );
  expect.soft(blocking, JSON.stringify(results, null, 2)).toHaveLength(0);
});