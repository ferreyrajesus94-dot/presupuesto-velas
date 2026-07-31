import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { InvariantError, suggestDepositPercent } from "@/domain/quoteDeposit";

describe("suggestDepositPercent (PR #4a.math foundation)", () => {
  it("returns '0' when materialsTotal is zero (also when M = T = 0)", () => {
    expect(suggestDepositPercent("0", "0")).toBe("0");
    expect(suggestDepositPercent("0", "1000")).toBe("0");
  });

  it("throws InvariantError when total is zero but materialsTotal is positive", () => {
    expect(() => suggestDepositPercent("100", "0")).toThrow(InvariantError);
    expect(() => suggestDepositPercent("100", "0")).toThrow(/invariant/i);
  });

  it("returns min(100, ceil((M/T*100)*100)/100) as a canonical decimal string for the common case", () => {
    // M = 750, T = 1000 -> 75.00
    expect(suggestDepositPercent("750", "1000")).toBe("75");
    // M = T -> 100.00
    expect(suggestDepositPercent("1000", "1000")).toBe("100");
  });

  it("caps the suggestion at 100 when M > T (negative-profit edge case)", () => {
    expect(suggestDepositPercent("2000", "1000")).toBe("100");
  });

  it("rounds UP to the nearest 0.01 so the deposit ARS amount always covers materials", () => {
    // M = 333.3333, T = 1000 -> raw 33.33333 -> ceil to hundredth = 33.34
    expect(suggestDepositPercent("333.3333", "1000")).toBe("33.34");
    // M = 0.01, T = 100 -> raw 0.01 -> 0.01
    expect(suggestDepositPercent("0.01", "100")).toBe("0.01");
  });

  it("accepts Decimal inputs directly without coercing them to number", () => {
    expect(suggestDepositPercent(new Decimal("750"), new Decimal("1000"))).toBe("75");
  });

  it("returns a canonical decimal string (never a JS number)", () => {
    const result = suggestDepositPercent("750", "1000");
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^\d+(\.\d{1,2})?$/);
  });
});
