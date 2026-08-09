import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPIRATION_DAYS,
  DEFAULT_INDIRECT_COST_NAMES,
  DEFAULT_PROFIT_MODE,
  DEFAULT_PROFIT_PERCENT,
  DEFAULT_QUOTE_DEPOSIT_PERCENT,
  DEFAULT_VISIBILITY,
} from "@/domain/quoteDefaults";

describe("quote defaults (PR #4a.math foundation)", () => {
  it("DEFAULT_INDIRECT_COST_NAMES contains the four canonical concepts in Spanish, in order", () => {
    expect(DEFAULT_INDIRECT_COST_NAMES).toEqual([
      "mano de obra",
      "electricidad",
      "transporte",
      "residuos",
    ]);
  });

  it("DEFAULT_VISIBILITY exposes both internalCost: true and profitMargin: true", () => {
    expect(DEFAULT_VISIBILITY).toEqual({ internalCost: true, profitMargin: true });
  });

  it("DEFAULT_QUOTE_DEPOSIT_PERCENT is a non-negative canonical decimal string", () => {
    expect(DEFAULT_QUOTE_DEPOSIT_PERCENT).toBe("0");
  });

  it("DEFAULT_PROFIT_MODE is 'percentage' (the default UX)", () => {
    expect(DEFAULT_PROFIT_MODE).toBe("percentage");
  });

  it("DEFAULT_PROFIT_PERCENT is a non-negative canonical decimal string inside [0, 10000]", () => {
    expect(DEFAULT_PROFIT_PERCENT).toBe("30");
  });

  it("DEFAULT_EXPIRATION_DAYS is a positive integer", () => {
    expect(Number.isInteger(DEFAULT_EXPIRATION_DAYS)).toBe(true);
    expect(DEFAULT_EXPIRATION_DAYS).toBeGreaterThan(0);
  });
});
