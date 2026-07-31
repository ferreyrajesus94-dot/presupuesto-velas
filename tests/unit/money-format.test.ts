import { describe, expect, it } from "vitest";
import { formatArsFromDecimalString } from "@/lib/moneyFormat";

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
