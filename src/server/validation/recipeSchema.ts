import { z } from "zod";
import { decimal, multiply, ROUNDING_MODE } from "../../domain/decimal";
import { UNITS, areUnitsCompatible, normalizeToBaseUnit } from "../../domain/units";

const MAX_QUANTITY = decimal("999999999999999999.999999");
const MAX_UNIT_COST = decimal("99999999999999999999.999999999999999999");

function safeDecimal(value: string) {
  try {
    return decimal(value);
  } catch {
    return null;
  }
}

const quantitySchema = z
  .string()
  .regex(/^\d+(?:\.\d{1,6})?$/, "Enter a quantity with up to 6 decimal places")
  .refine((value) => safeDecimal(value)?.gt(0) ?? false, "Item quantity must be positive")
  .refine(
    (value) => safeDecimal(value)?.lte(MAX_QUANTITY) ?? false,
    "Item quantity exceeds database precision",
  );

const recipeInputSchema = z.strictObject({
  name: z.string().trim().min(1, "Name is required").max(120),
  items: z
    .array(
      z.strictObject({
        materialId: z.string().trim().min(1, "Material is required"),
        quantity: quantitySchema,
        unit: z.enum(UNITS),
      }),
    )
    .min(1, "Add at least one recipe item"),
});

export type RecipeInput = z.input<typeof recipeInputSchema>;

export type RecipeMaterialReference = {
  id: string;
  ownerId: string;
  baseUnit: string;
  unitCost: string;
  archivedAt: Date | null;
};

export type ParsedRecipeInput = {
  name: string;
  unitCost: string;
  items: Array<{ position: number; materialId: string; quantity: string }>;
};

export function createRecipeInputSchema(
  ownerId: string,
  materials: readonly RecipeMaterialReference[],
) {
  const ownerMaterials = new Map(
    materials
      .filter((material) => material.ownerId === ownerId)
      .map((material) => [material.id, material]),
  );

  return recipeInputSchema.transform((input, context): ParsedRecipeInput => {
    let invalid = false;
    let unitCost = decimal("0");
    const items: ParsedRecipeInput["items"] = [];
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
        issue(["items", index, "materialId"], "Archived materials cannot be added to recipes");
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
      issue(["unitCost"], "Recipe cost cannot be represented at database precision");
      return z.NEVER;
    }

    return { name: input.name, unitCost: persistedCost.toFixed(), items };
  });
}
