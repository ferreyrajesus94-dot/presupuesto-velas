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
