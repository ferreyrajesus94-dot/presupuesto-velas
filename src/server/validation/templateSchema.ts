import { z } from "zod";
import { decimal, multiply, ROUNDING_MODE } from "../../domain/decimal";
import { UNITS, areUnitsCompatible, normalizeToBaseUnit } from "../../domain/units";

const MAX_QUANTITY = decimal("999999999999999999.999999");
const MAX_UNIT_COST = decimal("99999999999999999999.999999999999999999");
const MAX_META = decimal("9999999999999999.999999");

function safeDecimal(value: string) {
  try {
    return decimal(value);
  } catch {
    return null;
  }
}

// Empty strings are accepted (the workspace leaves time/overhead empty by
// default). Non-empty values must parse as positive decimals within the
// numeric(20,6) column shape.
const positiveDecimalString = z.string().refine(
  (raw) => {
    const trimmed = raw.trim();
    if (trimmed === "") return true;
    const v = safeDecimal(trimmed);
    if (!v) return false;
    if (v.isNaN() || !v.isFinite()) return false;
    if (v.isNeg() || v.isZero()) return false;
    return v.lte(MAX_META);
  },
  { message: "Ingresá un número positivo" },
);

// Margin accepts 0 as a valid value (free templates, give-aways). Empty stays
// neutral at the calculator layer.
const marginDecimalString = z.string().refine(
  (raw) => {
    const trimmed = raw.trim();
    if (trimmed === "") return true;
    const v = safeDecimal(trimmed);
    if (!v) return false;
    if (v.isNaN() || !v.isFinite()) return false;
    if (v.isNeg()) return false;
    return v.lte(MAX_META);
  },
  { message: "Ingresá un porcentaje válido" },
);

// .optional() so the parseInput() bridge does not require these fields on
// createTemplate for legacy callers that still send only name + items.
const metaShape = {
  time: positiveDecimalString.optional(),
  hourlyRate: positiveDecimalString.optional(),
  overhead: positiveDecimalString.optional(),
  marginPct: marginDecimalString.optional(),
};

const quantitySchema = z
  .string()
  .regex(/^\d+(?:\.\d{1,6})?$/, "Enter a quantity with up to 6 decimal places")
  .refine((value) => safeDecimal(value)?.gt(0) ?? false, "Item quantity must be positive")
  .refine(
    (value) => safeDecimal(value)?.lte(MAX_QUANTITY) ?? false,
    "Item quantity exceeds database precision",
  );

export const templateInputSchema = z.strictObject({
  name: z.string().trim().min(1, "Name is required").max(120),
  items: z
    .array(
      z.strictObject({
        materialId: z.string().trim().min(1, "Material is required"),
        quantity: quantitySchema,
        unit: z.enum(UNITS),
      }),
    )
    .min(1, "Add at least one template item"),
  ...metaShape,
});

export type TemplateInput = z.input<typeof templateInputSchema>;

export type TemplateMaterialReference = {
  id: string;
  ownerId: string;
  baseUnit: string;
  unitCost: string;
  archivedAt: Date | null;
};

export type ParsedTemplateInput = {
  name: string;
  unitCost: string;
  items: Array<{ position: number; materialId: string; quantity: string }>;
  time: string;
  hourlyRate: string;
  overhead: string;
  marginPct: string;
};

// Trimmed, post-validation projection of the calculator meta fields. Empty
// values stay as empty strings so the page-level default (marginPct "30",
// time/hourlyRate/overhead "" → calculator reads 0) survives a round-trip
// untouched, and non-empty values round-trip as the trimmed literal so we
// never persist un-trimmed whitespace.
export function parseTemplateMeta(raw: {
  time?: string | null;
  hourlyRate?: string | null;
  overhead?: string | null;
  marginPct?: string | null;
}): { time: string; hourlyRate: string; overhead: string; marginPct: string } {
  return {
    time: (raw.time ?? "").trim(),
    hourlyRate: (raw.hourlyRate ?? "").trim(),
    overhead: (raw.overhead ?? "").trim(),
    marginPct: (raw.marginPct ?? "").trim(),
  };
}

export function createTemplateInputSchema(
  ownerId: string,
  materials: readonly TemplateMaterialReference[],
) {
  const ownerMaterials = new Map(
    materials
      .filter((material) => material.ownerId === ownerId)
      .map((material) => [material.id, material]),
  );

  return templateInputSchema.transform((input, context): ParsedTemplateInput => {
    let invalid = false;
    let unitCost = decimal("0");
    const items: ParsedTemplateInput["items"] = [];
    const issue = (path: PropertyKey[], message: string) => {
      invalid = true;
      context.addIssue({ code: "custom", path, message });
    };

    input.items.forEach((item, index) => {
      const material = ownerMaterials.get(item.materialId);
      if (!material) {
        issue(["items", index, "materialId"], "Material is unavailable");
        return;
      }
      if (material.archivedAt) {
        issue(["items", index, "materialId"], "Archived materials cannot be added to templates");
        return;
      }
      if (!areUnitsCompatible(item.unit, material.baseUnit)) {
        issue(["items", index, "unit"], "Item unit must match the material dimension");
        return;
      }

      const quantity = normalizeToBaseUnit(item.quantity, item.unit, material.baseUnit);
      if (material.baseUnit === "unit" && !quantity.isInteger()) {
        issue(["items", index, "quantity"], "Count quantities must normalize to whole units");
        return;
      }
      if (quantity.decimalPlaces() > 6 || quantity.gt(MAX_QUANTITY)) {
        issue(
          ["items", index, "quantity"],
          "Normalized quantity cannot be represented at database precision",
        );
        return;
      }

      unitCost = unitCost.add(multiply(quantity, decimal(material.unitCost)));
      items.push({
        position: index + 1,
        materialId: material.id,
        quantity: quantity.toFixed(),
      });
    });

    if (invalid) return z.NEVER;
    const persistedCost = unitCost.toDecimalPlaces(18, ROUNDING_MODE);
    if (persistedCost.isZero() || persistedCost.gt(MAX_UNIT_COST)) {
      issue(["unitCost"], "Template cost cannot be represented at database precision");
      return z.NEVER;
    }

    return {
      name: input.name,
      unitCost: persistedCost.toFixed(),
      items,
      time: (input.time ?? "").trim(),
      hourlyRate: (input.hourlyRate ?? "").trim(),
      overhead: (input.overhead ?? "").trim(),
      marginPct: (input.marginPct ?? "").trim(),
    };
  });
}
