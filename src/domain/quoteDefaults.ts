/**
 * Single source of truth for new-quote defaults. Pure module — no I/O, no
 * clock. UI forms, Server Actions, and snapshot builders MUST import from
 * here instead of redefining literals.
 */

export const DEFAULT_INDIRECT_COST_NAMES = [
  "mano de obra",
  "electricidad",
  "transporte",
  "residuos",
] as const;

export const DEFAULT_QUOTE_DEPOSIT_PERCENT = "0";

export const DEFAULT_PROFIT_MODE = "percentage" as const;

export const DEFAULT_PROFIT_PERCENT = "30";

export const DEFAULT_VISIBILITY = {
  internalCost: true,
  profitMargin: true,
} as const;

export const DEFAULT_EXPIRATION_DAYS = 14;
