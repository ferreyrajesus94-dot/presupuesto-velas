import { describe, expect, it } from "vitest";
import { buildMaterialLifecycleCopy } from "../../src/app/materials/materialLifecycle";

describe("buildMaterialLifecycleCopy", () => {
  it("uses the captured archive operation even when the refreshed prop says the material is archived", () => {
    // R3-001: after a server revalidation, the `material.archived` prop
    // becomes true for an archived material. The copy must reflect the
    // operation the user just performed, not the refreshed prop.
    expect(buildMaterialLifecycleCopy({ operation: "archive", materialName: "Coconut wax" })).toBe(
      "Coconut wax archived.",
    );
  });

  it("uses the captured restore operation even when the refreshed prop says the material is active", () => {
    expect(buildMaterialLifecycleCopy({ operation: "restore", materialName: "Soy wax" })).toBe(
      "Soy wax restored.",
    );
  });
});
