import { describe, expect, it } from "vitest";
import { materialInputSchema } from "../../src/server/validation/materialSchema";

const validMaterial = {
  name: "Soy wax",
  dimension: "mass",
  baseUnit: "g",
  purchaseUnit: "kg",
  purchaseQuantity: "1",
  purchasePrice: "10000",
} as const;

describe("material input schema", () => {
  it.each([
    [validMaterial, "10"],
    [
      {
        ...validMaterial,
        dimension: "volume",
        baseUnit: "ml",
        purchaseUnit: "L",
        purchaseQuantity: "2",
        purchasePrice: "5",
      },
      "0.0025",
    ],
  ])("derives the exact base-unit cost for a compatible purchase unit", (input, unitCost) => {
    const result = materialInputSchema.parse(input);

    expect(result.unitCost).toBe(unitCost);
    expect(result.name).toBe("Soy wax");
  });
  it("rejects a blank material name", () => {
    expect(materialInputSchema.safeParse({ ...validMaterial, name: " " }).success).toBe(false);
  });
  it.each([
    ["purchase quantity", "purchaseQuantity", "0"],
    ["purchase quantity", "purchaseQuantity", "-1"],
    ["purchase price", "purchasePrice", "0"],
    ["purchase price", "purchasePrice", "-1"],
  ])("rejects non-positive %s", (_label, field, value) => {
    const result = materialInputSchema.safeParse({ ...validMaterial, [field]: value });

    expect(result.success).toBe(false);
  });

  it.each([
    ["g", "L"],
    ["unit", "kg"],
  ])("rejects incompatible units %s and %s", (baseUnit, purchaseUnit) => {
    const result = materialInputSchema.safeParse({
      ...validMaterial,
      dimension: "mass",
      baseUnit,
      purchaseUnit,
    });

    expect(result.success).toBe(false);
  });

  it("rejects fractional count quantities and accepts an integer count", () => {
    const fractional = materialInputSchema.safeParse({
      ...validMaterial,
      dimension: "count",
      baseUnit: "unit",
      purchaseUnit: "unit",
      purchaseQuantity: "1.5",
    });
    const integer = materialInputSchema.safeParse({
      ...validMaterial,
      dimension: "count",
      baseUnit: "unit",
      purchaseUnit: "unit",
      purchaseQuantity: "2",
    });

    expect(fractional.success).toBe(false);
    expect(integer.success).toBe(true);
  });

  it.each([
    ["purchase price", "purchasePrice", "999999999999999999.99"],
    ["purchase quantity", "purchaseQuantity", "999999999999999999.999999"],
  ])("accepts the maximum database value for %s", (_label, field, value) => {
    const result = materialInputSchema.safeParse({
      ...validMaterial,
      baseUnit: "kg",
      purchaseUnit: field === "purchaseQuantity" ? "g" : "kg",
      purchasePrice: field === "purchasePrice" ? value : "1",
      purchaseQuantity: field === "purchaseQuantity" ? value : "1",
    });

    expect(result.success).toBe(true);
  });

  it.each([
    ["purchase price", "purchasePrice", "1000000000000000000.00"],
    ["purchase quantity", "purchaseQuantity", "1000000000000000000.000000"],
  ])("rejects one-step database overflow for %s", (_label, field, value) => {
    expect(materialInputSchema.safeParse({ ...validMaterial, [field]: value }).success).toBe(false);
  });

  it("rejects a derived unit cost above NUMERIC(38,18)", () => {
    const result = materialInputSchema.safeParse({
      ...validMaterial,
      baseUnit: "kg",
      purchaseUnit: "kg",
      purchaseQuantity: "0.000001",
      purchasePrice: "999999999999999999.99",
    });

    expect(result.success).toBe(false);
  });

  it("normalizes derived unit cost to the database scale before persistence", () => {
    const result = materialInputSchema.parse({
      ...validMaterial,
      baseUnit: "kg",
      purchaseUnit: "kg",
      purchaseQuantity: "3",
      purchasePrice: "1",
    });

    expect(result.unitCost).toBe("0.333333333333333333");
  });

  it("rejects a positive derived unit cost that normalizes to zero", () => {
    const result = materialInputSchema.safeParse({
      ...validMaterial,
      baseUnit: "kg",
      purchaseUnit: "kg",
      purchaseQuantity: "999999999999999999.999999",
      purchasePrice: "0.01",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["unitCost"],
            message: "Derived unit cost cannot be represented at database precision",
          }),
        ]),
      );
    }
  });

  it("rounds a derived unit cost with a 19th-decimal tie half up", () => {
    const result = materialInputSchema.parse({
      ...validMaterial,
      baseUnit: "kg",
      purchaseUnit: "kg",
      purchaseQuantity: "524288",
      purchasePrice: "1",
    });

    expect(result.unitCost).toBe("0.000001907348632813");
  });
});
