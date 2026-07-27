import Decimal from "decimal.js";
import { assertNonNegative, assertPositive, isValidPercentageString } from "./money";
import { parseStrictDecimal, quantize2 } from "./decimal";
import { DEFAULT_VISIBILITY } from "./quoteDefaults";

/**
 * Pure quote-domain builder (PR #4a.calc, design #998).
 *
 * `buildQuoteSnapshot()` constructs a deeply-frozen, immutable quote snapshot
 * from canonical decimal-string inputs. Every money arithmetic uses Decimal.js
 * (precision 50 + ROUND_HALF_UP) and is quantized to 2 decimals ONCE here,
 * before freezing. The returned object is the single source of truth for
 * PDF rendering, WhatsApp sharing, expired-status derivation, and lifecycle
 * audit history.
 *
 * Pure: no I/O, no clock (caller injects `currentDate` for determinism).
 */

// ---------- Input shapes ----------

export interface QuoteSnapshotModelInput {
  recipeId: string;
  /** Canonical decimal string. Strictly positive. */
  quantity: string;
  /** Canonical decimal string. Non-negative (free candles allowed). */
  perUnitCostDecimal: string;
}

export interface QuoteSnapshotIndirectCostInput {
  name: string;
  /** Canonical decimal string. ≥ 0. */
  amount: string;
}

export type QuoteSnapshotProfitInput =
  { mode: "percentage"; percent: string } | { mode: "fixed"; amount: string };

export interface QuoteSnapshotVisibility {
  internalCost: boolean;
  profitMargin: boolean;
}

export interface BuildQuoteSnapshotInput {
  models: ReadonlyArray<QuoteSnapshotModelInput>;
  indirectCosts: ReadonlyArray<QuoteSnapshotIndirectCostInput>;
  profit: QuoteSnapshotProfitInput;
  /** Canonical decimal string in [0, 100] with ≤ 2 decimals. */
  depositPercent: string;
  /** ISO `YYYY-MM-DD` calendar date. */
  expirationDate: string;
  /** Defaults to `DEFAULT_VISIBILITY`. */
  visibility?: QuoteSnapshotVisibility;
  /** Defaults to `new Date()`. Inject for deterministic tests. */
  currentDate?: Date;
}

// ---------- Output shapes ----------

export interface QuoteSnapshotModel {
  recipeId: string;
  /** Canonical decimal string — preserved from input (full precision). */
  quantity: string;
  /** Canonical decimal string — preserved from input (full precision). */
  perUnitCost: string;
  /** Quantized 2-decimal money string — `quantity × perUnitCost`. */
  lineTotal: string;
}

export interface QuoteSnapshotIndirectCost {
  name: string;
  /** Quantized 2-decimal money string. */
  amount: string;
}

export interface QuoteSnapshot {
  /** UUID — snapshot identity marker. */
  id: string;
  models: ReadonlyArray<QuoteSnapshotModel>;
  indirectCosts: ReadonlyArray<QuoteSnapshotIndirectCost>;
  materialsTotal: string;
  indirectTotal: string;
  profitValue: string;
  total: string;
  depositAmount: string;
  depositPercent: string;
  expirationDate: string;
  visibility: { readonly internalCost: boolean; readonly profitMargin: boolean };
  computedAt: Date;
  profitMethod: "percentage" | "fixed";
}

// ---------- Constants ----------

const DEPOSIT_PERCENT_MAX = 100;
const EXPIRATION_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Recursive `Object.freeze`. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function validateExpirationDate(value: string): void {
  if (!EXPIRATION_DATE_REGEX.test(value)) {
    throw new Error(`quote: expirationDate must be YYYY-MM-DD (got "${value}")`);
  }
  // Calendar validity (reject e.g. "2026-02-31"). UTC midnight avoids local-tz drift.
  const parsed = new Date(`${value}T00:00:00.000Z`);
  const roundTrip = parsed.toISOString().slice(0, 10);
  if (Number.isNaN(parsed.getTime()) || roundTrip !== value) {
    throw new Error(`quote: expirationDate is not a valid calendar date (got "${value}")`);
  }
}

// ---------- Builder ----------

export function buildQuoteSnapshot(input: BuildQuoteSnapshotInput): QuoteSnapshot {
  validateExpirationDate(input.expirationDate);

  // 1. Models — validate, compute per-model lineTotal at FULL precision.
  const models = input.models.map((m, idx) => {
    if (typeof m.recipeId !== "string" || m.recipeId.length === 0) {
      throw new Error(`quote: models[${idx}].recipeId must be a non-empty string`);
    }
    const quantity = parseStrictDecimal(m.quantity);
    const perUnitCost = parseStrictDecimal(m.perUnitCostDecimal);
    assertPositive(quantity, `models[${idx}].quantity`);
    assertNonNegative(perUnitCost, `models[${idx}].perUnitCostDecimal`);
    return {
      recipeId: m.recipeId,
      quantity: quantity.toString(),
      perUnitCost: perUnitCost.toString(),
      lineTotal: quantity.mul(perUnitCost), // full precision
    };
  });

  // 2. Indirect costs — validate at FULL precision.
  const indirectCosts = input.indirectCosts.map((ic, idx) => {
    if (typeof ic.name !== "string" || ic.name.trim() === "") {
      throw new Error(`quote: indirectCosts[${idx}].name must be a non-empty string`);
    }
    const amount = parseStrictDecimal(ic.amount);
    assertNonNegative(amount, `indirectCosts[${idx}].amount`);
    return { name: ic.name, amount };
  });

  // 3. Totals at full precision.
  const materialsTotal = models.reduce((acc, m) => acc.add(m.lineTotal), new Decimal(0));
  const indirectTotal = indirectCosts.reduce((acc, ic) => acc.add(ic.amount), new Decimal(0));

  // 4. Profit at full precision.
  let profitValue: Decimal;
  let profitMethod: "percentage" | "fixed";
  if (input.profit.mode === "percentage") {
    if (!isValidPercentageString(input.profit.percent)) {
      throw new Error(
        `quote: profit.percent must be canonical decimal in [0, 10000] with ≤ 2 decimals (got "${input.profit.percent}")`,
      );
    }
    profitValue = materialsTotal.add(indirectTotal).mul(new Decimal(input.profit.percent)).div(100);
    profitMethod = "percentage";
  } else {
    const fixedAmount = parseStrictDecimal(input.profit.amount);
    assertNonNegative(fixedAmount, "profit.amount");
    profitValue = fixedAmount;
    profitMethod = "fixed";
  }

  // 5. Total + deposit at full precision.
  const total = materialsTotal.add(indirectTotal).add(profitValue);
  if (!isValidPercentageString(input.depositPercent)) {
    throw new Error(
      `quote: depositPercent must be canonical decimal in [0, 100] with ≤ 2 decimals (got "${input.depositPercent}")`,
    );
  }
  const depositPercent = new Decimal(input.depositPercent);
  if (depositPercent.gt(DEPOSIT_PERCENT_MAX)) {
    throw new Error(
      `quote: depositPercent must be ≤ ${DEPOSIT_PERCENT_MAX} (got "${input.depositPercent}")`,
    );
  }
  const depositAmount = total.mul(depositPercent).div(100);

  // 6. Quantize snapshot money ONCE here, build the snapshot object, then freeze.
  const snap: QuoteSnapshot = {
    id: crypto.randomUUID(),
    models: Object.freeze(
      models.map((m) =>
        Object.freeze({
          recipeId: m.recipeId,
          quantity: m.quantity,
          perUnitCost: m.perUnitCost,
          lineTotal: quantize2(m.lineTotal).toFixed(2),
        }),
      ),
    ),
    indirectCosts: Object.freeze(
      indirectCosts.map((ic) =>
        Object.freeze({ name: ic.name, amount: quantize2(ic.amount).toFixed(2) }),
      ),
    ),
    materialsTotal: quantize2(materialsTotal).toFixed(2),
    indirectTotal: quantize2(indirectTotal).toFixed(2),
    profitValue: quantize2(profitValue).toFixed(2),
    total: quantize2(total).toFixed(2),
    depositAmount: quantize2(depositAmount).toFixed(2),
    depositPercent: depositPercent.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString(),
    expirationDate: input.expirationDate,
    visibility: Object.freeze({ ...(input.visibility ?? DEFAULT_VISIBILITY) }),
    computedAt: input.currentDate ?? new Date(),
    profitMethod,
  };
  return deepFreeze(snap);
}
