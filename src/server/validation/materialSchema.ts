import { z } from "zod";
import { decimal, divide, ROUNDING_MODE } from "../../domain/decimal";
import {
  DIMENSIONS,
  UNITS,
  areUnitsCompatible,
  countIntegralSchema,
  getUnitDimension,
  normalizeToBaseUnit,
} from "../../domain/units";

const MAX_PURCHASE_QUANTITY = decimal("999999999999999999.999999");
const MAX_PURCHASE_PRICE = decimal("999999999999999999.99");
const MAX_UNIT_COST = decimal("99999999999999999999.999999999999999999");

const purchaseQuantity = z
  .string()
  .regex(/^\d+(?:\.\d{1,6})?$/, "Enter a quantity with up to 6 decimal places")
  .refine((value) => decimal(value).gt(0), "Purchase quantity must be positive")
  .refine(
    (value) => decimal(value).lte(MAX_PURCHASE_QUANTITY),
    "Purchase quantity exceeds database precision",
  );
const purchasePrice = z
  .string()
  .regex(/^\d+(?:\.\d{1,2})?$/, "Enter a price with up to 2 decimal places")
  .refine((value) => decimal(value).gt(0), "Purchase price must be positive")
  .refine(
    (value) => decimal(value).lte(MAX_PURCHASE_PRICE),
    "Purchase price exceeds database precision",
  );

export const materialInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    dimension: z.enum(DIMENSIONS),
    baseUnit: z.enum(UNITS),
    purchaseUnit: z.enum(UNITS),
    purchaseQuantity,
    purchasePrice,
  })
  .superRefine((value, context) => {
    if (getUnitDimension(value.baseUnit) !== value.dimension) {
      context.addIssue({ code: "custom", path: ["baseUnit"], message: "Unit dimension mismatch" });
    }
    if (getUnitDimension(value.purchaseUnit) !== value.dimension) {
      context.addIssue({
        code: "custom",
        path: ["purchaseUnit"],
        message: "Unit dimension mismatch",
      });
    }
    if (!areUnitsCompatible(value.baseUnit, value.purchaseUnit)) {
      context.addIssue({
        code: "custom",
        path: ["purchaseUnit"],
        message: "Base and purchase units must share a dimension",
      });
    }
    if (value.dimension === "count" && !countIntegralSchema(value.purchaseQuantity)) {
      context.addIssue({
        code: "custom",
        path: ["purchaseQuantity"],
        message: "Count quantities must be positive integers",
      });
    }
  })
  .transform((value, context) => {
    const unitCost = divide(
      decimal(value.purchasePrice),
      normalizeToBaseUnit(value.purchaseQuantity, value.purchaseUnit, value.baseUnit),
    );
    const normalizedUnitCost = unitCost.toDecimalPlaces(18, ROUNDING_MODE);
    if (unitCost.gt(MAX_UNIT_COST) || normalizedUnitCost.isZero()) {
      context.addIssue({
        code: "custom",
        path: ["unitCost"],
        message: "Derived unit cost cannot be represented at database precision",
      });
      return z.NEVER;
    }
    return { ...value, unitCost: normalizedUnitCost.toFixed() };
  });

export type MaterialInput = z.input<typeof materialInputSchema>;
export type ParsedMaterialInput = z.output<typeof materialInputSchema>;
