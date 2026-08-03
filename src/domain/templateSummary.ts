import Decimal from "decimal.js";

/**
 * PR4.7 — single source of truth for a template's live summary.
 *
 * The calculator and the plantillas page both derive their numbers from
 * this helper, so the page-level summary and the inline calculator cannot
 * drift. Inputs are plain serializable values so the helper stays usable
 * from both Server and Client Components.
 *
 * `time` is the minutes of labor invested in producing one unit of the
 * template; `hourlyRate` is the cost per hour. Per-template labor cost
 * defaults to 0 when either value is missing.
 *
 * `overhead` is the per-unit overhead (e.g. packaging, labels).
 *
 * `marginPct` is the suggested markup percent applied to `total` to derive
 * `suggestedPrice`. The default 30% matches the `DEFAULT_PROFIT_PERCENT`
 * used elsewhere in the calculator.
 */

export type SummaryMaterial = { unitCost: string; quantity: string };

export type TemplateSummaryInput = {
  materials: readonly SummaryMaterial[];
  time?: number | string | null;
  hourlyRate?: number | string | null;
  overhead?: number | string | null;
  marginPct?: number | string | null;
};

export type TemplateSummary = {
  materialsCost: string;
  laborCost: string;
  overhead: string;
  total: string;
  suggestedPrice: string;
};

const DEFAULT_MARGIN_PCT = 30;
const DEFAULT_HOURLY_RATE = 0;

function safeDecimal(value: string | number | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  try {
    const d = new Decimal(String(value));
    if (d.isNaN()) return new Decimal(0);
    if (d.isNegative()) return new Decimal(0);
    return d;
  } catch {
    return new Decimal(0);
  }
}

export function calcTemplateSummary(input: TemplateSummaryInput): TemplateSummary {
  const materialsCost = input.materials.reduce((acc, mat) => {
    const qty = safeDecimal(mat.quantity);
    const unit = safeDecimal(mat.unitCost);
    return acc.add(qty.mul(unit));
  }, new Decimal(0));

  const time = safeDecimal(input.time ?? null);
  const hourlyRate = safeDecimal(input.hourlyRate ?? DEFAULT_HOURLY_RATE);
  // time is in minutes; divide by 60 to get hours.
  const laborCost = time.greaterThan(0) ? time.div(60).mul(hourlyRate) : new Decimal(0);

  const overhead = safeDecimal(input.overhead ?? null);

  const total = materialsCost.add(laborCost).add(overhead);
  const margin = safeDecimal(input.marginPct ?? DEFAULT_MARGIN_PCT);
  const suggestedPrice = total.mul(new Decimal(1).add(margin.div(100)));

  return {
    materialsCost: materialsCost.toString(),
    laborCost: laborCost.toString(),
    overhead: overhead.toString(),
    total: total.toString(),
    suggestedPrice: suggestedPrice.toString(),
  };
}
