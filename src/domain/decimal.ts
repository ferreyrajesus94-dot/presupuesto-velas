import Decimal from "decimal.js";

/**
 * Decimal.js configuration — central so every domain module agrees on
 * precision, rounding, and error handling. Money and quantities MUST go
 * through this module; JS `number` arithmetic is prohibited.
 */
Decimal.set({
  precision: 50,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -50,
  toExpPos: 50,
});

export const DECIMAL_PRECISION = 50;
export const ROUNDING_MODE = Decimal.ROUND_HALF_UP;

/** Coerce a raw value to a Decimal without losing precision. */
export function decimal(value: string | number | Decimal): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "string") {
    if (value.trim() === "") {
      throw new Error("decimal: empty string is not a valid decimal");
    }
    return new Decimal(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("decimal: non-finite number is not a valid decimal");
    }
    return new Decimal(value);
  }
  throw new Error("decimal: unsupported value type");
}

/** Multiply two decimals at the configured precision. */
export function multiply(a: Decimal, b: Decimal): Decimal {
  return a.mul(b);
}

/**
 * Divide two decimals at the configured precision. Throws on zero divisor
 * to surface the error rather than silently producing Infinity/NaN.
 */
export function divide(a: Decimal, b: Decimal): Decimal {
  if (b.isZero()) {
    throw new Error("decimal: division by zero");
  }
  return a.div(b);
}

/** Quantize to two decimals using ROUND_HALF_UP. */
export function quantize2(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Render a Decimal as a two-decimal string for snapshot money columns. */
export function toMoneyString(value: Decimal): string {
  return quantize2(value).toFixed(2);
}

/** True when the decimal is strictly positive. */
export function isPositiveDecimal(value: Decimal): boolean {
  return value.isPositive() && !value.isZero();
}
