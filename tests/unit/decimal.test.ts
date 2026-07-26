import { describe, expect, it } from "vitest";
import {
  DECIMAL_PRECISION,
  decimal,
  divide,
  isPositiveDecimal,
  multiply,
  quantize2,
  ROUNDING_MODE,
  toMoneyString,
} from "../../src/domain/decimal";

describe("decimal domain (PR #3a foundation)", () => {
  it("uses precision 50 and ROUND_HALF_UP so money never drifts", () => {
    expect(DECIMAL_PRECISION).toBe(50);
    expect(ROUNDING_MODE).toBe(4); // Decimal.ROUND_HALF_UP
  });

  it("multiplies exactly: 19.99 * 3 === 59.97 (no float drift)", () => {
    const result = multiply(decimal("19.99"), decimal("3"));
    expect(toMoneyString(result)).toBe("59.97");
  });

  it("divides exactly: 10000 / 1000 === 10 with no remainder", () => {
    const result = divide(decimal("10000"), decimal("1000"));
    expect(toMoneyString(result)).toBe("10.00");
  });

  it("derives cost per base unit for 1 kg of wax at ARS 10,000 → 10 ARS/g", () => {
    // 1 kg of wax costs ARS 10,000, normalized to g (1000) → 10 ARS/g.
    const result = divide(decimal("10000"), decimal("1000"));
    expect(toMoneyString(result)).toBe("10.00");
    expect(isPositiveDecimal(result)).toBe(true);
  });

  it("quantize2 rounds half-up: 10.555 -> 10.56 and 10.554 -> 10.55", () => {
    expect(toMoneyString(quantize2(decimal("10.555")))).toBe("10.56");
    expect(toMoneyString(quantize2(decimal("10.554")))).toBe("10.55");
  });

  it("toMoneyString renders ARS-style two-decimal strings for any precision", () => {
    expect(toMoneyString(decimal("0"))).toBe("0.00");
    expect(toMoneyString(decimal("1234567.5"))).toBe("1234567.50");
    expect(toMoneyString(decimal("0.1"))).toBe("0.10");
  });

  it("rejects division by zero with a typed error", () => {
    expect(() => divide(decimal("100"), decimal("0"))).toThrow(/division by zero/i);
  });

  it("isPositiveDecimal reports positivity without using JS number coercion", () => {
    expect(isPositiveDecimal(decimal("0.01"))).toBe(true);
    expect(isPositiveDecimal(decimal("0"))).toBe(false);
    expect(isPositiveDecimal(decimal("-1"))).toBe(false);
  });
});
