import Decimal from "decimal.js";
import { CANONICAL_DECIMAL_REGEX, parseStrictDecimal, quantize2 } from "./decimal";

// Money and percentage helpers for the quote domain. Pure: no I/O, no clock.
// Every arithmetic path uses Decimal.js precision 50 + ROUND_HALF_UP; JS
// `number` / `parseFloat` / arithmetic operators on money values are
// prohibited by design review (#998).

export const PERCENT_MAX = 10000;

/** Alias for parseStrictDecimal so call sites read as money parsing. */
export function parseDecimalString(value: string): Decimal {
  return parseStrictDecimal(value);
}

/** Quantize to two decimals using the configured ROUND_HALF_UP. */
export function quantizeMoney(value: Decimal): Decimal {
  return quantize2(value);
}

/** Throw a typed error when the value is negative (zero is allowed). */
export function assertNonNegative(value: Decimal, label = "value"): void {
  if (value.isNegative()) {
    throw new Error(`money: ${label} must be non-negative (got ${value.toString()})`);
  }
}

/** Throw a typed error when the value is not strictly positive. */
export function assertPositive(value: Decimal, label = "value"): void {
  if (!value.isPositive() || value.isZero()) {
    throw new Error(`money: ${label} must be positive (got ${value.toString()})`);
  }
}

/**
 * Validate a canonical decimal-string percentage in `[0, 10000]` with at
 * most two decimals. 10000 is a technical abuse-input bound (design #998),
 * not a recommended margin; tighter callers must add their own range check.
 */
export function isValidPercentageString(value: string): boolean {
  if (typeof value !== "string" || !CANONICAL_DECIMAL_REGEX.test(value)) return false;
  const decimal = new Decimal(value);
  if (decimal.isNegative() || decimal.gt(PERCENT_MAX)) return false;
  const fractional = value.includes(".") ? value.split(".")[1] : "";
  return fractional.length <= 2;
}

/**
 * Format an ARS Decimal as `ARS 1.234.567,50`. Accepts a `Decimal` ONLY —
 * refuses numeric coercion at runtime so a stray `number` cannot sneak past
 * Zod into the formatter.
 */
export function formatARS(value: Decimal): string {
  if (!(value instanceof Decimal)) {
    throw new Error("formatARS: Decimal required (refusing numeric coercion)");
  }
  const [intPart, decPart = "00"] = quantizeMoney(value).toFixed(2).split(".");
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `ARS ${withThousands},${decPart}`;
}
