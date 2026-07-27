import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  assertNonNegative,
  assertPositive,
  formatARS,
  isValidPercentageString,
  parseDecimalString,
  quantizeMoney,
} from "@/domain/money";
import { ensureDecimal, parseStrictDecimal } from "@/domain/decimal";

describe("money domain (PR #4a.math foundation)", () => {
  describe("parseStrictDecimal (decimal.ts additive)", () => {
    it("accepts canonical integer and decimal strings (positive and negative)", () => {
      expect(parseStrictDecimal("0").toString()).toBe("0");
      expect(parseStrictDecimal("42").toString()).toBe("42");
      expect(parseStrictDecimal("-7").toString()).toBe("-7");
      expect(parseStrictDecimal("19.99").toString()).toBe("19.99");
      expect(parseStrictDecimal("-0.01").toString()).toBe("-0.01");
    });

    it("rejects non-canonical strings (whitespace, exponent, leading +, comma, letters, empty, lone dot)", () => {
      for (const bad of [" 1", "1 ", "+1", "1e3", "1,5", "abc", "", "1.", ".5"]) {
        expect(() => parseStrictDecimal(bad)).toThrow();
      }
    });
  });

  describe("ensureDecimal (decimal.ts additive)", () => {
    it("returns the same Decimal instance when given a Decimal", () => {
      const d = new Decimal("42.42");
      expect(ensureDecimal(d)).toBe(d);
    });

    it("parses a canonical decimal string into a Decimal", () => {
      expect(ensureDecimal("19.99").toString()).toBe("19.99");
    });

    it("throws on a non-canonical decimal string", () => {
      expect(() => ensureDecimal("not a number")).toThrow();
      expect(() => ensureDecimal("1e3")).toThrow();
    });
  });

  describe("parseDecimalString (money.ts)", () => {
    it("accepts canonical decimal strings and returns a Decimal", () => {
      const d = parseDecimalString("19.99");
      expect(d).toBeInstanceOf(Decimal);
      expect(d.toString()).toBe("19.99");
    });

    it("rejects non-canonical strings (exponent, comma, leading +, whitespace, empty)", () => {
      for (const bad of ["1e3", "1,5", "+1", " 1", ""]) {
        expect(() => parseDecimalString(bad)).toThrow();
      }
    });
  });

  describe("quantizeMoney (money.ts)", () => {
    it("quantizes to two decimals with ROUND_HALF_UP (10.555 -> 10.56, 10.554 -> 10.55)", () => {
      expect(quantizeMoney(new Decimal("10.555")).toFixed(2)).toBe("10.56");
      expect(quantizeMoney(new Decimal("10.554")).toFixed(2)).toBe("10.55");
    });

    it("preserves already-quantized values (0.10 -> 0.10)", () => {
      expect(quantizeMoney(new Decimal("0.10")).toFixed(2)).toBe("0.10");
    });
  });

  describe("assertNonNegative / assertPositive (money.ts)", () => {
    it("assertNonNegative accepts zero and positive values, rejects negatives", () => {
      expect(() => assertNonNegative(new Decimal("0"))).not.toThrow();
      expect(() => assertNonNegative(new Decimal("0.01"))).not.toThrow();
      expect(() => assertNonNegative(new Decimal("1000"))).not.toThrow();
      expect(() => assertNonNegative(new Decimal("-0.01"))).toThrow(/non-negative/i);
    });

    it("assertPositive accepts strictly positive values, rejects zero and negatives", () => {
      expect(() => assertPositive(new Decimal("0.01"))).not.toThrow();
      expect(() => assertPositive(new Decimal("1"))).not.toThrow();
      expect(() => assertPositive(new Decimal("0"))).toThrow(/positive/i);
      expect(() => assertPositive(new Decimal("-1"))).toThrow(/positive/i);
    });
  });

  describe("isValidPercentageString (money.ts)", () => {
    it("accepts canonical strings inside [0, 10000] with at most two decimals", () => {
      for (const ok of ["0", "30", "30.5", "30.55", "100", "10000", "9999.99"]) {
        expect(isValidPercentageString(ok)).toBe(true);
      }
    });

    it("rejects negative values", () => {
      expect(isValidPercentageString("-0.01")).toBe(false);
      expect(isValidPercentageString("-1")).toBe(false);
    });

    it("rejects values greater than 10000 (the technical abuse-input bound)", () => {
      expect(isValidPercentageString("10000.01")).toBe(false);
      expect(isValidPercentageString("10001")).toBe(false);
    });

    it("rejects more than two decimal places", () => {
      expect(isValidPercentageString("30.555")).toBe(false);
      expect(isValidPercentageString("0.001")).toBe(false);
    });

    it("rejects non-canonical strings", () => {
      for (const bad of ["", "+30", "30%", "30.5e0", "abc"]) {
        expect(isValidPercentageString(bad)).toBe(false);
      }
    });
  });

  describe("formatARS (money.ts)", () => {
    it("formats with the ARS thousands separator and decimal comma (1234567.5 -> ARS 1.234.567,50)", () => {
      expect(formatARS(new Decimal("1234567.5"))).toBe("ARS 1.234.567,50");
    });

    it("formats zero as ARS 0,00", () => {
      expect(formatARS(new Decimal("0"))).toBe("ARS 0,00");
    });

    it("formats small and exact-100 values without a thousands separator", () => {
      expect(formatARS(new Decimal("0.1"))).toBe("ARS 0,10");
      expect(formatARS(new Decimal("59.97"))).toBe("ARS 59,97");
      expect(formatARS(new Decimal("100"))).toBe("ARS 100,00");
    });

    it("quantizes inputs to two decimals before formatting (1.005 -> ARS 1,01)", () => {
      expect(formatARS(new Decimal("1.005"))).toBe("ARS 1,01");
    });

    it("refuses non-Decimal inputs at runtime (numeric coercion rejected)", () => {
      // @ts-expect-error — verifying the runtime guard refuses numbers/strings
      expect(() => formatARS(123)).toThrow(/Decimal required/i);
      // @ts-expect-error — strings must be coerced via parseDecimalString first
      expect(() => formatARS("123.45")).toThrow(/Decimal required/i);
    });
  });
});
