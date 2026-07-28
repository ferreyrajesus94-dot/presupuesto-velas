import Decimal from "decimal.js";
import { parseStrictDecimal } from "./decimal";

/**
 * Pure Decimal.js deposit auto-suggest helper (PR4g.1).
 *
 * Pure: no React, no IO, no `Number()` coercion on money.
 *
 * Given three canonical decimal-string inputs from the quote create form,
 * computes the deposit-base total `T = M + I + P` internally (matching the
 * `total` shape consumed by `buildQuoteSnapshot` in `src/domain/quote.ts`),
 * then applies the material-covering deposit formula from design #998:
 *
 *   - `M = 0`        -> `"0"`            (also when `M = I = P = 0`)
 *   - `T = 0 < M`    -> `""`             (invariant violation — UI displays
 *                                          an error; unreachable for
 *                                          canonical non-negative inputs
 *                                          but kept as a defensive branch)
 *   - otherwise      -> `min(100, ceil((M/T*100)*100)/100)` percent, rendered
 *                        as a canonical decimal string with at most 2 decimals.
 *
 * All three inputs MUST be canonical decimal strings (`/^-?\d+(\.\d+)?$/`);
 * `parseStrictDecimal` throws on whitespace, scientific notation, thousands
 * separators, or leading plus signs, surfacing the error to the caller rather
 * than silently producing `NaN`.
 */

export const DEPOSIT_MIN_PERCENT = 0;
export const DEPOSIT_MAX_PERCENT = 100;
export const DEPOSIT_MAX_DECIMALS = 2;

export function suggestDepositPercent(
  materialsTotalDecimalString: string,
  indirectTotalDecimalString: string,
  profitTotalDecimalString: string,
): string {
  const m = parseStrictDecimal(materialsTotalDecimalString);
  const i = parseStrictDecimal(indirectTotalDecimalString);
  const p = parseStrictDecimal(profitTotalDecimalString);

  if (m.isZero()) return "0";

  // T = M + I + P — the deposit base (matches `total` in `buildQuoteSnapshot`).
  const t = m.add(i).add(p);

  // Defensive branch: for canonical non-negative inputs T ≥ M ≥ 0, so the
  // "T = 0 < M" invariant is unreachable. Kept to match the design contract.
  if (t.isZero()) return "";

  // (M/T*100) rounded UP to the nearest 0.01, capped at 100.
  const ratio = m.div(t).mul(100);
  const scale = new Decimal(10).pow(DEPOSIT_MAX_DECIMALS);
  const scaled = ratio.mul(scale).ceil().div(scale);
  const capped = scaled.gt(DEPOSIT_MAX_PERCENT) ? new Decimal(DEPOSIT_MAX_PERCENT) : scaled;

  return capped.toDecimalPlaces(DEPOSIT_MAX_DECIMALS, Decimal.ROUND_HALF_UP).toString();
}
