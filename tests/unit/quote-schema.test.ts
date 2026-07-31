import { ZodError } from "zod";
import { describe, expect, it } from "vitest";
import {
  parseQuoteDraftInput,
  quoteDraftInputSchema,
  quoteStatusTransitionSchema,
  quoteVersionInputSchema,
} from "@/server/validation/quoteSchema";

const VALID_RECIPE_ID = "11111111-2222-4333-8444-555555555555";
const messagesOf = (
  r: { success: true } | { success: false; error: { issues: { message: string }[] } },
) => (r.success ? [] : r.error.issues.map((i) => i.message));

function validDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    expirationDate: "2026-12-31",
    profit: { mode: "percentage", percent: "30" },
    depositPercent: "50",
    indirectCosts: [
      { name: "labor", amount: "500" },
      { name: "electricity", amount: "300.50" },
    ],
    models: [{ recipeId: VALID_RECIPE_ID, quantity: "10" }],
    visibility: { internalCost: true, profitMargin: true },
    ...overrides,
  };
}

const parseDraft = (override: Record<string, unknown>) =>
  quoteDraftInputSchema.safeParse(validDraft(override));

describe("quote schema (PR #4d — server-side validation)", () => {
  describe("internal scalars", () => {
    it.each(["0", "30", "30.5", "30.55", "100", "9999.99", "10000", "10000.00"])(
      "percentageProfitString accepts %s in [0, 10000] with ≤2 decimals",
      (percent) => {
        expect(parseDraft({ profit: { mode: "percentage", percent } }).success).toBe(true);
      },
    );
    it.each(["-0.01", "10000.01", "30.555", "+30", "30,5", "", "abc", "30e0", "30%"])(
      "percentageProfitString rejects %s (negative, over bound, >2dp, non-canonical)",
      (percent) => {
        expect(parseDraft({ profit: { mode: "percentage", percent } }).success).toBe(false);
      },
    );

    it.each(["0", "100", "2000", "9999.99"])("fixedProfitString accepts %s", (amount) => {
      expect(parseDraft({ profit: { mode: "fixed", amount } }).success).toBe(true);
    });
    it.each(["-0.01", "-1", "+100", "100,5", "", "abc"])(
      "fixedProfitString rejects %s",
      (amount) => {
        expect(parseDraft({ profit: { mode: "fixed", amount } }).success).toBe(false);
      },
    );

    it.each(["0", "50", "50.5", "99.99", "100", "100.00"])(
      "depositPercentString accepts %s in [0, 100] with ≤2 decimals",
      (value) => {
        expect(parseDraft({ depositPercent: value }).success).toBe(true);
      },
    );
    it.each(["-0.01", "100.01", "50.555", "+50", "", "abc"])(
      "depositPercentString rejects %s",
      (value) => {
        expect(parseDraft({ depositPercent: value }).success).toBe(false);
      },
    );

    it.each(["2026-12-31", "2026-01-01", "2027-02-28"])(
      "expirationDateString accepts %s",
      (value) => {
        expect(parseDraft({ expirationDate: value }).success).toBe(true);
      },
    );
    it.each(["31/12/2026", "2026-12-31T00:00:00Z", "", "2026-12", "2026-AB-31", "2026"])(
      "expirationDateString rejects %s",
      (value) => {
        expect(parseDraft({ expirationDate: value }).success).toBe(false);
      },
    );
  });

  describe("indirectCostSchema", () => {
    it("accepts non-empty name + nonnegative amount, including empty list", () => {
      expect(
        parseDraft({
          indirectCosts: [
            { name: "labor", amount: "500" },
            { name: "electricity", amount: "0" },
          ],
        }).success,
      ).toBe(true);
      expect(parseDraft({ indirectCosts: [] }).success).toBe(true);
    });

    it.each([
      ["empty name", { name: "", amount: "100" }],
      ["negative amount", { name: "labor", amount: "-0.01" }],
      ["non-canonical amount", { name: "labor", amount: "abc" }],
    ])("rejects %s", (_label, cost) => {
      expect(parseDraft({ indirectCosts: [cost] }).success).toBe(false);
    });
  });

  describe("profitSchema (discriminated union)", () => {
    it("percentage branch requires `percent` only", () => {
      expect(parseDraft({ profit: { mode: "percentage", percent: "30" } }).success).toBe(true);
      expect(parseDraft({ profit: { mode: "percentage" } }).success).toBe(false);
    });
    it("fixed branch requires `amount` only", () => {
      expect(parseDraft({ profit: { mode: "fixed", amount: "2000" } }).success).toBe(true);
      expect(parseDraft({ profit: { mode: "fixed" } }).success).toBe(false);
    });
    it("rejects unknown mode", () => {
      expect(parseDraft({ profit: { mode: "discount", percent: "10" } }).success).toBe(false);
    });
  });

  describe("quoteDraftInputSchema", () => {
    it("accepts a complete valid draft", () => {
      const result = quoteDraftInputSchema.safeParse(validDraft());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.expirationDate).toBe("2026-12-31");
        expect(result.data.profit).toEqual({ mode: "percentage", percent: "30" });
        expect(result.data.models).toHaveLength(1);
      }
    });

    it.each([
      ["invalid expirationDate", { expirationDate: "not-a-date" }],
      ["invalid profit", { profit: { mode: "percentage", percent: "-5" } }],
      ["invalid depositPercent", { depositPercent: "120" }],
      ["invalid indirect costs", { indirectCosts: [{ name: "", amount: "100" }] }],
      ["zero quantity", { models: [{ recipeId: VALID_RECIPE_ID, quantity: "0" }] }],
      ["negative quantity", { models: [{ recipeId: VALID_RECIPE_ID, quantity: "-1" }] }],
      ["non-UUID recipeId", { models: [{ recipeId: "not-a-uuid", quantity: "10" }] }],
      ["empty models list (orchestrator literal: min(0))", { models: [] }],
    ])("verdict %s", (_label, override) => {
      const expected = _label.includes("empty models") ? true : false;
      expect(parseDraft(override).success).toBe(expected);
    });
  });

  describe("parseQuoteDraftInput", () => {
    it("returns the parsed draft on valid input", () => {
      const parsed = parseQuoteDraftInput(validDraft());
      expect(parsed.expirationDate).toBe("2026-12-31");
    });
    it.each([
      ["invalid date", { ...validDraft(), expirationDate: "not-a-date" }],
      ["null", null],
      ["string", "not a draft"],
    ])("throws ZodError on %s", (_label, raw) => {
      expect(() => parseQuoteDraftInput(raw)).toThrow(ZodError);
    });
  });

  describe("quoteVersionInputSchema", () => {
    it.each([0, 5])("accepts expectedLockVersion %i + draft fields", (lock) => {
      expect(
        quoteVersionInputSchema.safeParse({ expectedLockVersion: lock, ...validDraft() }).success,
      ).toBe(true);
    });
    it.each([
      ["negative", -1],
      ["non-integer", 1.5],
    ])("rejects %s expectedLockVersion", (_label, lock) => {
      expect(
        quoteVersionInputSchema.safeParse({ expectedLockVersion: lock, ...validDraft() }).success,
      ).toBe(false);
    });
  });

  describe("quoteStatusTransitionSchema", () => {
    it.each([
      ["draft", "sent"],
      ["sent", "accepted"],
      ["sent", "rejected"],
    ] as const)("accepts the allowed transition %s → %s", (from, to) => {
      expect(
        quoteStatusTransitionSchema.safeParse({
          fromStatus: from,
          toStatus: to,
          expectedLockVersion: 0,
        }).success,
      ).toBe(true);
    });

    it.each([
      ["draft", "accepted"],
      ["draft", "rejected"],
      ["accepted", "rejected"],
      ["accepted", "draft"],
      ["rejected", "sent"],
      ["sent", "sent"],
    ] as const)("rejects the invalid transition %s → %s", (from, to) => {
      expect(
        quoteStatusTransitionSchema.safeParse({
          fromStatus: from,
          toStatus: to,
          expectedLockVersion: 0,
        }).success,
      ).toBe(false);
    });

    it("rejects the derived `expired` status as fromStatus or toStatus", () => {
      for (const [fromStatus, toStatus] of [
        ["expired", "sent"],
        ["draft", "expired"],
      ] as const) {
        expect(
          quoteStatusTransitionSchema.safeParse({
            fromStatus,
            toStatus,
            expectedLockVersion: 0,
          }).success,
        ).toBe(false);
      }
    });

    it("surfaces a user-facing message naming the rejected transition", () => {
      const result = quoteStatusTransitionSchema.safeParse({
        fromStatus: "draft",
        toStatus: "accepted",
        expectedLockVersion: 0,
      });
      expect(messagesOf(result)).toContain('Status transition "draft" → "accepted" is not allowed');
    });
  });
});
