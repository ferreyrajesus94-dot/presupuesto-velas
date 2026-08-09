import Decimal from "decimal.js";

function formatThousands(integer: string): string {
  const sign = integer.startsWith("-") ? "-" : "";
  const digits = sign ? integer.slice(1) : integer;
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

export function formatDecimalDisplay(decimalString: string): string {
  const fixed = new Decimal(decimalString).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed();
  const lastDot = fixed.lastIndexOf(".");
  if (lastDot === -1) {
    return formatThousands(fixed);
  }
  const intPart = fixed.slice(0, lastDot);
  const decPart = fixed.slice(lastDot + 1).replace(/0+$/, "");
  const comma = decPart ? `,${decPart}` : "";
  return `${formatThousands(intPart)}${comma}`;
}

export function formatDecimalInput(decimalString: string): string {
  if (typeof decimalString !== "string" || decimalString.trim() === "") {
    return "";
  }
  try {
    return new Decimal(decimalString.trim()).toFixed().replace(/\.0+$/, "");
  } catch {
    return decimalString;
  }
}

export function formatArsFromDecimalString(decimalString: string): string {
  if (typeof decimalString !== "string") {
    throw new Error("formatArsFromDecimalString: invalid decimal");
  }

  const trimmed = decimalString.trim();
  if (trimmed === "") return "ARS 0,00";

  try {
    const fixed = new Decimal(trimmed).toFixed(2, Decimal.ROUND_HALF_UP);
    const [intPart, decPart = "00"] = fixed.split(".");
    return `ARS ${formatThousands(intPart)},${decPart}`;
  } catch {
    return "ARS 0,00";
  }
}

export function formatArsDecimalDisplay(decimalString: string): string {
  return `ARS ${formatDecimalDisplay(decimalString)}`;
}

/**
 * Compact ARS rendering for list previews and dashboard cards where the
 * full `formatArsFromDecimalString` output would dwarf the rest of the
 * layout. Switches to "K" for thousands, "M" for millions, and "B" for
 * billions once the absolute integer part crosses 10.000, with one
 * decimal of precision for the leading digit. Anything smaller keeps
 * the precise format so the user can still read the exact number.
 *
 * Examples:
 *   "500"           -> "ARS 500,00"
 *   "6500"          -> "ARS 6.500,00"
 *   "25000"         -> "ARS 25K"
 *   "123456"        -> "ARS 123K"
 *   "1500000"       -> "ARS 1,5M"
 *   "6500000"       -> "ARS 6,5M"
 *   "9999999999999"  -> "ARS 10B"   (10 trillion pesos = 10 billion)
 *
 * The full exact number stays available on the detail view, which
 * always uses `formatArsFromDecimalString`.
 */
export function formatArsCompact(decimalString: string): string {
  if (typeof decimalString !== "string" || decimalString.trim() === "") {
    return "ARS 0,00";
  }
  let abs: Decimal;
  try {
    abs = new Decimal(decimalString.trim()).abs();
  } catch {
    return formatArsFromDecimalString(decimalString);
  }
  if (abs.gte(1_000_000_000)) {
    const billions = abs.div(1_000_000_000).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed();
    const intPart = formatThousands(billions.split(".")[0]);
    const decPart = billions.split(".")[1] ?? "0";
    const sign = new Decimal(decimalString).isNegative() ? "-" : "";
    return `ARS ${sign}${intPart},${decPart}B`;
  }
  if (abs.gte(1_000_000)) {
    const millions = abs.div(1_000_000).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed();
    const intPart = formatThousands(millions.split(".")[0]);
    const decPart = millions.split(".")[1] ?? "0";
    const sign = new Decimal(decimalString).isNegative() ? "-" : "";
    return `ARS ${sign}${intPart},${decPart}M`;
  }
  if (abs.gte(10_000)) {
    const thousands = abs.div(1_000).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed();
    const formatted = formatThousands(thousands);
    const sign = new Decimal(decimalString).isNegative() ? "-" : "";
    return `ARS ${sign}${formatted}K`;
  }
  return formatArsFromDecimalString(decimalString);
}
