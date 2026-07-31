import Decimal from "decimal.js";
import { ensureDecimal } from "./decimal";

/**
 * Material-covering deposit suggestion (design #998):
 *   - M = 0  -> "0"  (also handles M = T = 0)
 *   - T = 0 < M  -> invariant violation (caller must not call with zero total)
 *   - otherwise -> min(100, ceil((M/T*100)*100)/100)
 *
 * Returns a canonical 2-decimal string ("33.34"), never a JS number.
 * Pure: no I/O, no clock, no random.
 */

export const DEPOSIT_PERCENT_CAP = 100;
export const DEPOSIT_PERCENT_SCALE = 2; // hundredths — at most 2 decimals

/** Custom error so the deposit caller can distinguish an invariant violation. */
export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvariantError";
  }
}

export function suggestDepositPercent(
  materialsTotal: Decimal | string,
  total: Decimal | string,
): string {
  const m = ensureDecimal(materialsTotal);
  const t = ensureDecimal(total);

  if (m.isZero()) return "0";
  if (t.isZero()) {
    throw new InvariantError(
      "suggestDepositPercent invariant violation: total must be > 0 when materialsTotal > 0",
    );
  }

  // (M/T*100) rounded UP to the nearest 0.01, capped at 100.
  const ratio = m.div(t).mul(100);
  const scale = new Decimal(10).pow(DEPOSIT_PERCENT_SCALE);
  const scaled = ratio.mul(scale).ceil().div(scale);
  const capped = scaled.gt(DEPOSIT_PERCENT_CAP) ? new Decimal(DEPOSIT_PERCENT_CAP) : scaled;

  // Canonical decimal string with up to 2 decimals (strip trailing zeros).
  return capped.toDecimalPlaces(DEPOSIT_PERCENT_SCALE, Decimal.ROUND_HALF_UP).toString();
}
