import { Decimal } from "decimal.js";
import { decimal } from "./decimal";

/**
 * Domain units used by materials, recipes, and quotes. Every unit belongs to
 * exactly one dimension. Cross-dimension arithmetic is rejected loudly so the
 * UI and Server Actions fail with a clear validation error instead of silently
 * producing a wrong number.
 */
export const DIMENSIONS = ["mass", "volume", "length", "count"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const UNITS = ["g", "kg", "ml", "L", "cm", "m", "unit"] as const;
export type Unit = (typeof UNITS)[number];

export const UNITS_BY_DIMENSION: Record<Dimension, readonly Unit[]> = {
  mass: ["g", "kg"],
  volume: ["ml", "L"],
  length: ["cm", "m"],
  count: ["unit"],
};

const UNIT_TO_DIMENSION: Record<Unit, Dimension> = {
  g: "mass",
  kg: "mass",
  ml: "volume",
  L: "volume",
  cm: "length",
  m: "length",
  unit: "count",
};

export function getUnitDimension(unit: string): Dimension {
  if (!Object.hasOwn(UNIT_TO_DIMENSION, unit)) {
    throw new Error(`units: unknown unit "${unit}"`);
  }
  return UNIT_TO_DIMENSION[unit as Unit];
}

export function isUnit(value: string): value is Unit {
  return Object.hasOwn(UNIT_TO_DIMENSION, value);
}

/**
 * True when both units belong to the same dimension. The materials schema
 * relies on this check before the database CHECK constraint fires; recipes
 * rely on it to reject lines that reference a material in the wrong unit.
 */
export function areUnitsCompatible(a: string, b: string): boolean {
  if (!Object.hasOwn(UNIT_TO_DIMENSION, a) || !Object.hasOwn(UNIT_TO_DIMENSION, b)) {
    return false;
  }
  return UNIT_TO_DIMENSION[a as Unit] === UNIT_TO_DIMENSION[b as Unit];
}

/**
 * Conversion factors expressed as Decimal strings so we never round through
 * JS `number`. The matrix is `fromUnit -> toUnit`: how many `toUnit` does
 * one `fromUnit` equal? (E.g. 1 kg = 1000 g, 1 g = 0.001 kg.)
 */
const CONVERSION_FACTORS: Record<Unit, Partial<Record<Unit, string>>> = {
  // mass: g ↔ kg (1000)
  g: { g: "1", kg: "0.001" },
  kg: { g: "1000", kg: "1" },
  // volume: ml ↔ L (1000)
  ml: { ml: "1", L: "0.001" },
  L: { ml: "1000", L: "1" },
  // length: cm ↔ m (100)
  cm: { cm: "1", m: "0.01" },
  m: { cm: "100", m: "1" },
  // count: unit ↔ unit (1)
  unit: { unit: "1" },
};

/**
 * Normalize a quantity expressed in `fromUnit` to the equivalent quantity
 * expressed in `toUnit` (which becomes the material's base unit). Throws
 * if the units are incompatible.
 */
export function normalizeToBaseUnit(
  quantity: Decimal | string,
  fromUnit: string,
  toUnit: string,
): Decimal {
  if (!areUnitsCompatible(fromUnit, toUnit)) {
    throw new Error(
      `units: incompatible units "${fromUnit}" -> "${toUnit}" (different dimensions)`,
    );
  }
  if (!isUnit(fromUnit) || !isUnit(toUnit)) {
    throw new Error(`units: unknown unit in normalizeToBaseUnit`);
  }
  const factor = CONVERSION_FACTORS[fromUnit][toUnit];
  if (!factor) {
    throw new Error(`units: no conversion factor for "${fromUnit}" -> "${toUnit}"`);
  }
  return decimal(quantity).mul(decimal(factor));
}

/**
 * Assert a quantity is an integer when the dimension is `count`. Used by the
 * material schema to surface the same constraint the database CHECK enforces,
 * before the round-trip.
 */
export function assertCountIntegral(quantity: Decimal | string): void {
  const q = decimal(quantity);
  if (!q.isInteger()) {
    throw new Error("units: count dimension requires an integer quantity");
  }
}

/**
 * Zod-friendly variant: returns false for non-integers, true for integers.
 * Strings are accepted because form data is text and may be empty.
 */
export function countIntegralSchema(raw: string | number): boolean {
  if (raw === "" || raw === null || raw === undefined) return false;
  try {
    const q = decimal(String(raw));
    return q.isInteger() && !q.isZero() && !q.isNeg();
  } catch {
    return false;
  }
}
