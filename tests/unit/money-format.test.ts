import { describe, expect, it } from "vitest";
import {
  formatArsCompact,
  formatArsDecimalDisplay,
  formatArsFromDecimalString,
  formatDecimalDisplay,
  formatDecimalInput,
} from "@/lib/moneyFormat";

describe("formatArsFromDecimalString (PR4g.1 helpers)", () => {
  it("formats a six-digit ARS amount with thousands separator and two decimals", () => {
    expect(formatArsFromDecimalString("1234567.50")).toBe("ARS 1.234.567,50");
  });

  it("formats zero as ARS 0,00", () => {
    expect(formatArsFromDecimalString("0")).toBe("ARS 0,00");
  });

  it("formats a three-digit integer with two decimals and no thousands separator", () => {
    expect(formatArsFromDecimalString("100")).toBe("ARS 100,00");
  });

  it("formats 59.97 without floating-point drift (exact decimal arithmetic)", () => {
    expect(formatArsFromDecimalString("59.97")).toBe("ARS 59,97");
  });

  it("returns ARS 0,00 for an empty string instead of crashing", () => {
    expect(formatArsFromDecimalString("")).toBe("ARS 0,00");
  });

  it("returns ARS 0,00 for a non-numeric string (Decimal('garbage').toFixed(2) yields 'NaN')", () => {
    expect(formatArsFromDecimalString("garbage")).toBe("ARS 0,00");
  });

  it("throws a typed error for null", () => {
    expect(() => formatArsFromDecimalString(null as unknown as string)).toThrow(
      "formatArsFromDecimalString: invalid decimal",
    );
  });

  it("throws a typed error for undefined", () => {
    expect(() => formatArsFromDecimalString(undefined as unknown as string)).toThrow(
      "formatArsFromDecimalString: invalid decimal",
    );
  });

  it("throws a typed error for a number (refuses numeric coercion)", () => {
    expect(() => formatArsFromDecimalString(59.97 as unknown as string)).toThrow(
      "formatArsFromDecimalString: invalid decimal",
    );
  });
});

describe("decimal presentation", () => {
  it("trims insignificant zeros without changing precision", () => {
    expect(formatDecimalDisplay("10.000000")).toBe("10");
    expect(formatDecimalDisplay("0.500000")).toBe("0,5");
    expect(formatArsDecimalDisplay("10000.000000000000000000")).toBe("ARS 10.000");
  });

  it("uses thousands separator and decimal comma for canonical number input values", () => {
    expect(formatDecimalInput("10.000000")).toBe("10");
    expect(formatDecimalInput("0.500000")).toBe("0.5");
    expect(formatDecimalInput("10000.000000000000000000")).toBe("10000");
  });
});

describe("formatDecimalInput (canonical dot-decimal, never throws)", () => {
  it("returns empty for an empty string so RHF required validation can fire", () => {
    expect(formatDecimalInput("")).toBe("");
  });

  it("returns empty for whitespace-only input", () => {
    expect(formatDecimalInput("   ")).toBe("");
  });

  it("returns the input unchanged for transient invalid input so Zod can reject it", () => {
    expect(formatDecimalInput("abc")).toBe("abc");
    expect(formatDecimalInput("1.2.3")).toBe("1.2.3");
  });

  it("trims only insignificant trailing zeros without rounding meaningful precision", () => {
    expect(formatDecimalInput("5.100")).toBe("5.1");
    expect(formatDecimalInput("5.000")).toBe("5");
    expect(formatDecimalInput("0.0050")).toBe("0.005");
  });

  it("preserves a leading minus sign on negative values", () => {
    expect(formatDecimalInput("-3.50")).toBe("-3.5");
    expect(formatDecimalInput("-10000.000000")).toBe("-10000");
  });

  it("tolerates surrounding whitespace from the number input", () => {
    expect(formatDecimalInput("  10.50  ")).toBe("10.5");
  });
});

describe("formatDecimalDisplay (Argentine thousands + decimal comma)", () => {
  it("adds the thousands dot separator to large integers", () => {
    expect(formatDecimalDisplay("10000")).toBe("10.000");
    expect(formatDecimalDisplay("1234567")).toBe("1.234.567");
  });

  it("replaces the canonical dot with the Argentine decimal comma", () => {
    expect(formatDecimalDisplay("0.5")).toBe("0,5");
    expect(formatDecimalDisplay("59.97")).toBe("59,97");
  });

  it("combines thousands separator and decimal comma on large fractional values", () => {
    expect(formatDecimalDisplay("10000.5")).toBe("10.000,5");
    expect(formatDecimalDisplay("1234567.89")).toBe("1.234.567,89");
  });

  it("quantizes long fractional inputs to two decimals with ROUND_HALF_UP", () => {
    expect(formatDecimalDisplay("10000.000123456789")).toBe("10.000");
  });

  it("keeps the minus sign for negative values", () => {
    expect(formatDecimalDisplay("-1234.5")).toBe("-1.234,5");
  });
});

describe("formatArsDecimalDisplay (prefixed display helper)", () => {
  it("prefixes the Argentine display output with ARS", () => {
    expect(formatArsDecimalDisplay("10000")).toBe("ARS 10.000");
    expect(formatArsDecimalDisplay("0.5")).toBe("ARS 0,5");
    expect(formatArsDecimalDisplay("1234567.89")).toBe("ARS 1.234.567,89");
  });
});

describe("formatDecimalDisplay (two-decimal quantization trims long fractionals)", () => {
  it("rounds 416.666666666666666667 to 416,67 with ROUND_HALF_UP", () => {
    expect(formatDecimalDisplay("416.666666666666666667")).toBe("416,67");
  });

  it("renders 10000.000000000000000000 as 10.000 (zeros after quantize are trimmed)", () => {
    expect(formatDecimalDisplay("10000.000000000000000000")).toBe("10.000");
  });

  it("renders 1.5 with a single decimal after stripping the trailing zero", () => {
    expect(formatDecimalDisplay("1.5")).toBe("1,5");
  });

  it("renders 200 as an integer (no decimal tail)", () => {
    expect(formatDecimalDisplay("200")).toBe("200");
  });

  it("renders 0 as a single digit", () => {
    expect(formatDecimalDisplay("0")).toBe("0");
  });

  it("produces matching ARS-prefixed outputs for the same inputs", () => {
    expect(formatArsDecimalDisplay("416.666666666666666667")).toBe("ARS 416,67");
    expect(formatArsDecimalDisplay("10000.000000000000000000")).toBe("ARS 10.000");
    expect(formatArsDecimalDisplay("1.5")).toBe("ARS 1,5");
    expect(formatArsDecimalDisplay("200")).toBe("ARS 200");
    expect(formatArsDecimalDisplay("0")).toBe("ARS 0");
  });
});

describe("formatArsCompact (card-preview helper, K/M notation)", () => {
  it("keeps the exact format for amounts below ten thousand", () => {
    expect(formatArsCompact("0")).toBe("ARS 0,00");
    expect(formatArsCompact("500")).toBe("ARS 500,00");
    expect(formatArsCompact("1234.5")).toBe("ARS 1.234,50");
    expect(formatArsCompact("9999.99")).toBe("ARS 9.999,99");
  });

  it("collapses thousands into a K suffix once the integer part crosses 10.000", () => {
    expect(formatArsCompact("10000")).toBe("ARS 10K");
    expect(formatArsCompact("12345")).toBe("ARS 12K");
    expect(formatArsCompact("25000")).toBe("ARS 25K");
    expect(formatArsCompact("123456")).toBe("ARS 123K");
    expect(formatArsCompact("999999")).toBe("ARS 1.000K");
  });

  it("collapses millions into an M suffix with one decimal of leading precision", () => {
    expect(formatArsCompact("1000000")).toBe("ARS 1,0M");
    expect(formatArsCompact("1500000")).toBe("ARS 1,5M");
    expect(formatArsCompact("6500000")).toBe("ARS 6,5M");
    expect(formatArsCompact("65000000")).toBe("ARS 65,0M");
  });

  it("collapses trillions into a B suffix so 10 trillion doesn't render as 10.000.000M", () => {
    expect(formatArsCompact("1000000000")).toBe("ARS 1,0B");
    expect(formatArsCompact("6500000000")).toBe("ARS 6,5B");
    expect(formatArsCompact("9999999999999")).toBe("ARS 10.000,0B");
  });

  it("preserves the sign on negative values", () => {
    expect(formatArsCompact("-25000")).toBe("ARS -25K");
    expect(formatArsCompact("-1500000")).toBe("ARS -1,5M");
    expect(formatArsCompact("-6500000000")).toBe("ARS -6,5B");
  });

  it("falls back to the precise format for empty or invalid input", () => {
    expect(formatArsCompact("")).toBe("ARS 0,00");
    expect(formatArsCompact("garbage")).toBe("ARS 0,00");
  });
});
