import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { assertSafeNeonTestDatabase } from "./assert-safe-neon-test-database";

assertSafeNeonTestDatabase();

const [
  { db },
  { appOwner, materials, recipeItems, recipes },
  { getSingletonOwner },
  recipeRepository,
] = await Promise.all([
  import("../../db/client"),
  import("../../db/schema"),
  import("../../src/server/repositories/owner"),
  import("../../src/server/repositories/recipes"),
]);
const { getRecipe, listRecipes } = recipeRepository;

const materialFixture = (ownerId: string, id: string, name: string, unitCost: string) => ({
  id,
  ownerId,
  name,
  dimension: "mass" as const,
  baseUnit: "g",
  purchaseUnit: "kg",
  purchaseQuantity: "1",
  purchasePrice: unitCost,
  unitCost,
});

async function insertRecipeFixture(args: {
  ownerId: string;
  materialId: string;
  recipeId: string;
  recipeName: string;
  unitCost: string;
  quantity: string;
  position: number;
}): Promise<void> {
  await db.insert(recipes).values({
    id: args.recipeId,
    ownerId: args.ownerId,
    name: args.recipeName,
    unitCost: args.unitCost,
  });
  await db.insert(recipeItems).values({
    id: crypto.randomUUID(),
    recipeId: args.recipeId,
    materialId: args.materialId,
    position: args.position,
    quantity: args.quantity,
  });
}

describe("recipes repository (integration vs dev branch) — read", () => {
  let ownerId: string;
  let createdOwner = false;
  const createdRecipeIds = new Set<string>();
  const createdMaterialIds = new Set<string>();

  beforeAll(async () => {
    const owner = await getSingletonOwner();
    if (owner) {
      ownerId = owner.id;
      return;
    }
    ownerId = crypto.randomUUID();
    await db.insert(appOwner).values({
      id: ownerId,
      email: `${ownerId}@calculadora-flor-test.invalid`,
      singleton: true,
    });
    createdOwner = true;
  });

  afterEach(async () => {
    for (const recipeId of createdRecipeIds) {
      await db.delete(recipeItems).where(eq(recipeItems.recipeId, recipeId));
      await db.delete(recipes).where(and(eq(recipes.id, recipeId), eq(recipes.ownerId, ownerId)));
    }
    for (const materialId of createdMaterialIds) {
      await db
        .delete(materials)
        .where(and(eq(materials.id, materialId), eq(materials.ownerId, ownerId)));
    }
    createdRecipeIds.clear();
    createdMaterialIds.clear();
  });

  afterAll(async () => {
    if (createdOwner) await db.delete(appOwner).where(eq(appOwner.id, ownerId));
  });

  it("returns owner-scoped recipes with position-ordered items and supports cross-owner / missing reads", async () => {
    const waxId = crypto.randomUUID();
    const wickId = crypto.randomUUID();
    await db
      .insert(materials)
      .values([
        materialFixture(ownerId, waxId, `wax-${waxId}`, "10.000000000000000000"),
        materialFixture(ownerId, wickId, `wick-${wickId}`, "50.000000000000000000"),
      ]);
    createdMaterialIds.add(waxId).add(wickId);

    const recipeId = crypto.randomUUID();
    await insertRecipeFixture({
      ownerId,
      materialId: waxId,
      recipeId,
      recipeName: `floral-${recipeId}`,
      unitCost: "1100.000000000000000000",
      quantity: "100",
      position: 1,
    });
    await db.insert(recipeItems).values({
      id: crypto.randomUUID(),
      recipeId,
      materialId: wickId,
      position: 2,
      quantity: "2",
    });
    createdRecipeIds.add(recipeId);

    const got = await getRecipe(ownerId, recipeId);
    expect(got?.items.map(({ position }) => position)).toEqual([1, 2]);
    expect(got?.items.map(({ materialId }) => materialId)).toEqual([waxId, wickId]);
    expect(got?.recipe.unitCost).toBe("1100.000000000000000000");

    expect((await listRecipes(ownerId)).map(({ recipe: row }) => row.id)).toContain(recipeId);
    expect(await getRecipe(crypto.randomUUID(), recipeId)).toBeNull();
    expect(await getRecipe(ownerId, crypto.randomUUID())).toBeNull();
  });

  it("hides archived recipes by default and returns them only in all visibility", async () => {
    const materialId = crypto.randomUUID();
    await db
      .insert(materials)
      .values(materialFixture(ownerId, materialId, `wax-${materialId}`, "10.000000000000000000"));
    createdMaterialIds.add(materialId);

    const recipeId = crypto.randomUUID();
    await insertRecipeFixture({
      ownerId,
      materialId,
      recipeId,
      recipeName: `archived-${recipeId}`,
      unitCost: "100.000000000000000000",
      quantity: "10",
      position: 1,
    });
    createdRecipeIds.add(recipeId);
    await db
      .update(recipes)
      .set({ archivedAt: new Date("2026-01-01T00:00:00Z") })
      .where(and(eq(recipes.id, recipeId), eq(recipes.ownerId, ownerId)));

    expect(await getRecipe(ownerId, recipeId)).toBeNull();
    expect(
      (await listRecipes(ownerId, { includeArchived: true })).map(({ recipe: row }) => row.id),
    ).toContain(recipeId);
  });
});
