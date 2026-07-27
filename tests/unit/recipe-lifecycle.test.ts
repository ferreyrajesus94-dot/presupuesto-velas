import { describe, expect, it } from "vitest";
import { buildRecipeLifecycleCopy } from "../../src/app/recipes/recipeLifecycle";

describe("buildRecipeLifecycleCopy", () => {
  it("uses the captured archive operation even when the refreshed prop says the recipe is archived", () => {
    // After a server revalidation, the `recipe.archivedAt` prop becomes
    // non-null for an archived recipe. The copy must reflect the operation the
    // user just performed, not the refreshed prop — same R3-001 mirror as
    // the materials lifecycle helper.
    expect(buildRecipeLifecycleCopy({ operation: "archive", recipeName: "Vanilla candle" })).toBe(
      "Vanilla candle archived.",
    );
  });

  it("uses the captured restore operation even when the refreshed prop says the recipe is active", () => {
    expect(buildRecipeLifecycleCopy({ operation: "restore", recipeName: "Citrus candle" })).toBe(
      "Citrus candle restored.",
    );
  });
});
