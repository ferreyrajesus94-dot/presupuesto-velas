import { describe, expect, it } from "vitest";
import { buildTemplateLifecycleCopy } from "../../src/app/templates/templateLifecycle";

describe("buildTemplateLifecycleCopy", () => {
  it("uses the captured archive operation even when the refreshed prop says the template is archived", () => {
    // After a server revalidation, the `template.archivedAt` prop becomes
    // non-null for an archived template. The copy must reflect the operation the
    // user just performed, not the refreshed prop — same R3-001 mirror as
    // the materials lifecycle helper.
    expect(buildTemplateLifecycleCopy({ operation: "archive", templateName: "Vanilla candle" })).toBe(
      "Vanilla candle archivada.",
    );
  });

  it("uses the captured restore operation even when the refreshed prop says the template is active", () => {
    expect(buildTemplateLifecycleCopy({ operation: "restore", templateName: "Citrus candle" })).toBe(
      "Citrus candle restaurada.",
    );
  });
});
