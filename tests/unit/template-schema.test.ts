import { describe, expect, it } from "vitest";
import { createTemplateInputSchema } from "../../src/server/validation/templateSchema";

const USER_ID = "user-1";
const materials = [
  {
    id: "wax",
    userId: USER_ID,
    baseUnit: "g",
    unitCost: "10.000000000000000000",
    archivedAt: null,
  },
  {
    id: "wick",
    userId: USER_ID,
    baseUnit: "unit",
    unitCost: "50.000000000000000000",
    archivedAt: null,
  },
  {
    id: "archived-dye",
    userId: USER_ID,
    baseUnit: "g",
    unitCost: "2.000000000000000000",
    archivedAt: new Date("2026-01-01T00:00:00Z"),
  },
  {
    id: "foreign-wax",
    userId: "user-2",
    baseUnit: "g",
    unitCost: "99.000000000000000000",
    archivedAt: null,
  },
] as const;

const schema = createTemplateInputSchema(USER_ID, materials);
const validTemplate = {
  name: "Floral candle",
  items: [{ materialId: "wax", quantity: "110", unit: "g" }],
};

function messages(result: ReturnType<typeof schema.safeParse>): string[] {
  return result.success
    ? []
    : result.error.issues.map(({ message }: { message: string }) => message);
}

describe("template input schema", () => {
  it("trims the name, normalizes ordered items, and projects exact Decimal cost", () => {
    const result = schema.parse({
      name: "  Floral candle  ",
      items: [
        { materialId: "wax", quantity: "0.1", unit: "kg" },
        { materialId: "wick", quantity: "2", unit: "unit" },
      ],
    });

    expect(result).toEqual({
      name: "Floral candle",
      unitCost: "1100",
      items: [
        { position: 1, materialId: "wax", quantity: "100" },
        { position: 2, materialId: "wick", quantity: "2" },
      ],
      time: "",
      hourlyRate: "",
      overhead: "",
      marginPct: "",
    });
  });

  it.each([
    ["blank name", { ...validTemplate, name: " " }, "Name is required"],
    ["empty item list", { ...validTemplate, items: [] }, "Add at least one template item"],
    [
      "zero quantity",
      { ...validTemplate, items: [{ ...validTemplate.items[0], quantity: "0" }] },
      "Item quantity must be positive",
    ],
    [
      "negative quantity",
      { ...validTemplate, items: [{ ...validTemplate.items[0], quantity: "-1" }] },
      "Enter a quantity with up to 6 decimal places",
    ],
  ])("rejects %s", (_case, input, message) => {
    expect(messages(schema.safeParse(input))).toContain(message);
  });

  it.each(["missing", "foreign-wax"])(
    "rejects unavailable user-scoped material reference %s without distinguishing it",
    (materialId) => {
      const result = schema.safeParse({
        ...validTemplate,
        items: [{ ...validTemplate.items[0], materialId }],
      });

      expect(messages(result)).toContain("Material is unavailable");
    },
  );

  it("rejects archived material references on template writes", () => {
    const result = schema.safeParse({
      ...validTemplate,
      items: [{ ...validTemplate.items[0], materialId: "archived-dye" }],
    });

    expect(messages(result)).toContain("Archived materials cannot be added to templates");
  });

  it("rejects a line unit from a different material dimension", () => {
    const result = schema.safeParse({
      ...validTemplate,
      items: [{ ...validTemplate.items[0], unit: "L" }],
    });

    expect(messages(result)).toContain("Item unit must match the material dimension");
  });

  it("rejects fractional count consumption after normalization", () => {
    const result = schema.safeParse({
      ...validTemplate,
      items: [{ materialId: "wick", quantity: "1.5", unit: "unit" }],
    });

    expect(messages(result)).toContain("Count quantities must normalize to whole units");
  });

  it("derives positions from array order instead of accepting caller positions", () => {
    const result = schema.safeParse({
      ...validTemplate,
      items: [{ ...validTemplate.items[0], position: 7 }],
    });

    expect(result.success).toBe(false);
  });

  it("allows duplicate materials at distinct derived positions and sums both lines", () => {
    const result = schema.parse({
      ...validTemplate,
      items: [
        { materialId: "wax", quantity: "10", unit: "g" },
        { materialId: "wax", quantity: "0.02", unit: "kg" },
      ],
    });

    expect(result.items.map(({ position }: { position: number }) => position)).toEqual([1, 2]);
    expect(result.items.map(({ quantity }: { quantity: string }) => quantity)).toEqual([
      "10",
      "20",
    ]);
    expect(result.unitCost).toBe("300");
  });

  it("rejects a normalized quantity that exceeds template-item database scale", () => {
    const kgSchema = createTemplateInputSchema(USER_ID, [
      { ...materials[0], id: "bulk-wax", baseUnit: "kg" },
    ]);
    const result = kgSchema.safeParse({
      ...validTemplate,
      items: [{ materialId: "bulk-wax", quantity: "0.000001", unit: "g" }],
    });

    expect(messages(result)).toContain(
      "Normalized quantity cannot be represented at database precision",
    );
  });

  it.each([
    ["overflow", "99999999999999999999.999999999999999999", "2"],
    ["round to zero", "0.000000000000000001", "0.000001"],
  ])("rejects a projected template cost that would %s", (_case, unitCost, quantity) => {
    const boundedSchema = createTemplateInputSchema(USER_ID, [
      { ...materials[0], id: "bounded-wax", unitCost },
    ]);
    const result = boundedSchema.safeParse({
      ...validTemplate,
      items: [{ materialId: "bounded-wax", quantity, unit: "g" }],
    });

    expect(messages(result)).toContain("Template cost cannot be represented at database precision");
  });
});
