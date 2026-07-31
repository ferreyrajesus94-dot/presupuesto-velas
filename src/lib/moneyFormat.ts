import Decimal from "decimal.js";

/**
 * Pure ARS Decimal.js string formatter (PR4g.1).
 *
 * Pure: no React, no JS `Number` coercion on money, no I/O.
 * Decimal.js uses precision 50 + ROUND_HALF_UP per `src/domain/decimal.ts`
 * (design #998).
 *
 * Output shape: `ARS 1.234.567,50`
 *   - thousands separator `.`
 *   - decimal separator `,`
 *   - exactly two decimals (half-up rounding)
 *
 * Behaviour:
 *   - Empty / whitespace string  -> `ARS 0,00` (graceful)
 *   - Unparseable string         -> `ARS 0,00` (graceful)
 *   - Non-string input (null, undefined, number) -> throws
 *       `Error('formatArsFromDecimalString: invalid decimal')`
 */

export function formatArsFromDecimalString(decimalString: string): string {
  if (typeof decimalString !== "string") {
    throw new Error("formatArsFromDecimalString: invalid decimal");
  }

  const trimmed = decimalString.trim();
  if (trimmed === "") {
    return "ARS 0,00";
  }

  try {
    const fixed = new Decimal(trimmed).toFixed(2, Decimal.ROUND_HALF_UP);
    const [intPart, decPart = "00"] = fixed.split(".");
    const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `ARS ${withThousands},${decPart}`;
  } catch {
    return "ARS 0,00";
  }
}
