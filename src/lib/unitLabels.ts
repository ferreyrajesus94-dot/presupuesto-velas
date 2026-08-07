import type { Dimension, Unit } from "@/domain/units";

/**
 * User-visible Spanish labels for the canonical dimension identifiers.
 * The keys stay exactly equal to the domain enum values, so callers
 * keep using `dimension`/`baseUnit`/`purchaseUnit` as-is from the
 * repository; only the rendered text is translated.
 */
export const DIMENSION_LABELS: Record<Dimension, string> = {
  mass: "Peso",
  volume: "Volumen",
  length: "Longitud",
  count: "Cantidad",
};

export const UNIT_LABELS: Record<Unit, string> = {
  g: "Gramos",
  kg: "Kilogramos",
  ml: "Mililitros",
  L: "Litros",
  cm: "Centímetros",
  m: "Metros",
  unit: "Unidades",
};

export const UNIT_SINGULAR_LABELS: Record<Unit, string> = {
  g: "gramo",
  kg: "kilogramo",
  ml: "mililitro",
  L: "litro",
  cm: "centímetro",
  m: "metro",
  unit: "unidad",
};

export function dimensionLabel(value: string): string {
  return (DIMENSION_LABELS as Record<string, string>)[value] ?? value;
}

export function unitLabel(value: string): string {
  return (UNIT_LABELS as Record<string, string>)[value] ?? value;
}

export function unitSingularLabel(value: string): string {
  return (UNIT_SINGULAR_LABELS as Record<string, string>)[value] ?? value;
}
