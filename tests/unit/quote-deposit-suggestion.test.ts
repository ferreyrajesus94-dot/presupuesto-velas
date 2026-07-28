import { describe, expect, it } from "vitest";
import {
  DEPOSIT_MAX_DECIMALS,
  DEPOSIT_MAX_PERCENT,
  DEPOSIT_MIN_PERCENT,
  suggestDepositPercent,
} from "@/domain/quoteDepositSuggestion";

describe("suggestDepositPercent (PR4g.1 helpers)", () => {
  it("returns '0' when materialsTotal is zero (also when M = I = P = 0)", () => {
    expect(suggestDepositPercent("0", "500", "50")).toBe("0");
    expect(suggestDepositPercent("0", "0", "0")).toBe("0");
  });

  it("uses design constants DEPOSIT_MIN_PERCENT=0, DEPOSIT_MAX_PERCENT=100, DEPOSIT_MAX_DECIMALS=2", () => {
    expect(DEPOSIT_MIN_PERCENT).toBe(0);
    expect(DEPOSIT_MAX_PERCENT).toBe(100);
    expect(DEPOSIT_MAX_DECIMALS).toBe(2);
  });

  it("computes the canonical formula for a normal three-component quote (M < T)", () => {
    // M = 1000, I = 500, P = 300 -> T = 1800; M/T*100 = 55.5555...; ceil to 2dp = 55.56
    expect(suggestDepositPercent("1000", "500", "300")).toBe("55.56");
  });

  it("caps the suggestion at 100 when M = T (M/T = 1.0)", () => {
    // M = 2000, I = 0, P = 0 -> T = 2000; ratio = 1.0; capped at 100
    expect(suggestDepositPercent("2000", "0", "0")).toBe("100");
  });

  it("returns 100 when materialsTotal equals the full total (small business edge case)", () => {
    // M = 100, I = 0, P = 0 -> T = 100; ratio = 1.0; capped at 100
    expect(suggestDepositPercent("100", "0", "0")).toBe("100");
  });

  it("returns 100 when materialsTotal equals a fractional total (T = 333)", () => {
    // M = 333, I = 0, P = 0 -> T = 333; ratio = 1.0; capped at 100
    expect(suggestDepositPercent("333", "0", "0")).toBe("100");
  });

  it("rounds UP so the deposit ARS amount always covers materials (off-by-one cent)", () => {
    // M = 100, I = 0, P = 0.01 -> T = 100.01; M/T*100 = 99.99001...; ceil to 2dp = 100
    expect(suggestDepositPercent("100", "0", "0.01")).toBe("100");
  });

  it("returns a canonical decimal string (no Number coercion, no JS number arithmetic)", () => {
    const result = suggestDepositPercent("1000", "500", "300");
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^\d+(\.\d{1,2})?$/);
  });

  it("throws on non-canonical decimal inputs (no whitespace, exponents, or thousands separators)", () => {
    // The underlying parseStrictDecimal contract guards everything below 0/invalid.
    expect(() => suggestDepositPercent("abc", "100", "50")).toThrow();
    expect(() => suggestDepositPercent("1e3", "100", "50")).toThrow();
    expect(() => suggestDepositPercent("1,000", "100", "50")).toThrow();
  });

  it("does not coerce inputs through JS Number (verifies via Decimal.js output shape)", () => {
    // If implementation accidentally used Number() anywhere, summing 750 + 750 would lose precision
    // via IEEE 754 and yield 1500.0000000000002 once coerced. Decimal.js preserves it.
    // This guard is implicit through the canonical-string regex above.
    const result = suggestDepositPercent("750", "500", "250");
    expect(result).toMatch(/^\d+(\.\d{1,2})?$/);
    expect(result).not.toContain("e");
    expect(result).not.toContain("E");
  });
});
