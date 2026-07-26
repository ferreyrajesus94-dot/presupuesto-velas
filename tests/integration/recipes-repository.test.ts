import { and, eq, inArray } from "drizzle-orm";
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
const { createRecipe, getRecipe, listRecipes, RecipeRepositoryError } = recipeRepository;

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

  describe("create", () => {
    let createOwnerId: string;
    const createOwnerCreated = false;
    const createdCreateRecipeIds = new Set<string>();
    const createdCreateMaterialIds = new Set<string>();

    beforeAll(async () => {
      // Reuse the singleton owner row so all create tests share the same
      // owner scope as the read tests; this lets them exercise the unique
      // name index without provisioning extra app_owner rows.
      createOwnerId = ownerId;
    });

    afterEach(async () => {
      const recipeIds = [...createdCreateRecipeIds];
      if (recipeIds.length > 0) {
        await db.delete(recipeItems).where(inArray(recipeItems.recipeId, recipeIds));
        await db.delete(recipes).where(inArray(recipes.id, recipeIds));
      }
      createdCreateRecipeIds.clear();
      const materialIds = [...createdCreateMaterialIds];
      if (materialIds.length > 0) {
        await db.delete(materials).where(inArray(materials.id, materialIds));
      }
      createdCreateMaterialIds.clear();
    });

    afterAll(async () => {
      if (createOwnerCreated) await db.delete(appOwner).where(eq(appOwner.id, createOwnerId));
    });

    it("creates and reads an owner-scoped recipe with ordered items and deterministic cost", async () => {
      const waxId = crypto.randomUUID();
      const scentId = crypto.randomUUID();
      await db
        .insert(materials)
        .values([
          materialFixture(createOwnerId, waxId, `wax-${waxId}`, "10.000000000000000000"),
          materialFixture(createOwnerId, scentId, `scent-${scentId}`, "20.000000000000000000"),
        ]);
      createdCreateMaterialIds.add(waxId).add(scentId);

      const recipe = await createRecipe(createOwnerId, {
        name: `floral-${crypto.randomUUID()}`,
        items: [
          { materialId: waxId, quantity: "100", unit: "g" },
          { materialId: scentId, quantity: "50", unit: "g" },
        ],
      });
      createdCreateRecipeIds.add(recipe.recipe.id);

      expect(recipe.recipe.unitCost).toBe("2000.000000000000000000");
      expect(recipe.items.map(({ position }) => position)).toEqual([1, 2]);
      expect(recipe.items.map(({ materialId }) => materialId)).toEqual([waxId, scentId]);
      expect(recipe.items.map(({ quantity }) => quantity)).toEqual(["100", "50"]);

      const got = await getRecipe(createOwnerId, recipe.recipe.id);
      expect(got?.recipe.id).toBe(recipe.recipe.id);
      expect(got?.items.map(({ materialId }) => materialId)).toEqual([waxId, scentId]);
    });

    it("maps duplicate names to DUPLICATE_NAME and unavailable material to MATERIAL_UNAVAILABLE", async () => {
      const waxId = crypto.randomUUID();
      const archivedId = crypto.randomUUID();
      await db.insert(materials).values([
        materialFixture(createOwnerId, waxId, `wax-${waxId}`, "10.000000000000000000"),
        {
          ...materialFixture(
            createOwnerId,
            archivedId,
            `arch-${archivedId}`,
            "10.000000000000000000",
          ),
          archivedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ]);
      createdCreateMaterialIds.add(waxId).add(archivedId);

      const sharedName = `floral-${crypto.randomUUID()}`;
      const first = await createRecipe(createOwnerId, {
        name: sharedName,
        items: [{ materialId: waxId, quantity: "100", unit: "g" }],
      });
      createdCreateRecipeIds.add(first.recipe.id);

      // DUPLICATE_NAME — the unique (ownerId, name) index must surface as the repository code.
      await expect(
        createRecipe(createOwnerId, {
          name: sharedName,
          items: [{ materialId: waxId, quantity: "50", unit: "g" }],
        }),
      ).rejects.toBeInstanceOf(RecipeRepositoryError);
      await expect(
        createRecipe(createOwnerId, {
          name: sharedName,
          items: [{ materialId: waxId, quantity: "50", unit: "g" }],
        }),
      ).rejects.toMatchObject({ code: "DUPLICATE_NAME" });

      // MATERIAL_UNAVAILABLE — archived material reference.
      await expect(
        createRecipe(createOwnerId, {
          name: `arch-${crypto.randomUUID()}`,
          items: [{ materialId: archivedId, quantity: "10", unit: "g" }],
        }),
      ).rejects.toBeInstanceOf(RecipeRepositoryError);
      await expect(
        createRecipe(createOwnerId, {
          name: `arch-${crypto.randomUUID()}`,
          items: [{ materialId: archivedId, quantity: "10", unit: "g" }],
        }),
      ).rejects.toMatchObject({ code: "MATERIAL_UNAVAILABLE" });

      // MATERIAL_UNAVAILABLE — missing material id (also covers cross-owner
      // references because the owner-scoped FOR SHARE snapshot only sees
      // this owner's rows).
      await expect(
        createRecipe(createOwnerId, {
          name: `miss-${crypto.randomUUID()}`,
          items: [{ materialId: crypto.randomUUID(), quantity: "10", unit: "g" }],
        }),
      ).rejects.toBeInstanceOf(RecipeRepositoryError);
      await expect(
        createRecipe(createOwnerId, {
          name: `miss-${crypto.randomUUID()}`,
          items: [{ materialId: crypto.randomUUID(), quantity: "10", unit: "g" }],
        }),
      ).rejects.toMatchObject({ code: "MATERIAL_UNAVAILABLE" });
    });

    it("serializes createRecipe behind a held-open archive lock (recipe rejects unavailable material)", async () => {
      const waxId = crypto.randomUUID();
      await db
        .insert(materials)
        .values(materialFixture(createOwnerId, waxId, `wax-${waxId}`, "10.000000000000000000"));
      createdCreateMaterialIds.add(waxId);

      let updateDone = () => {};
      const updateDonePromise = new Promise<void>((resolve) => {
        updateDone = resolve;
      });
      let releaseUpdate = () => {};
      const releaseUpdatePromise = new Promise<void>((resolve) => {
        releaseUpdate = resolve;
      });

      // Held-open transaction: UPDATE acquires the exclusive row lock and
      // then waits on `releaseUpdatePromise` until the test releases it.
      const heldTx = db.transaction(async (tx) => {
        await tx
          .update(materials)
          .set({ archivedAt: new Date("2030-01-01T00:00:00Z") })
          .where(eq(materials.id, waxId));
        updateDone();
        await releaseUpdatePromise;
      });

      let caught: unknown;
      try {
        await updateDonePromise;

        // Start createRecipe while the held UPDATE still owns the row lock.
        // The FOR SHARE snapshot will block until the held tx commits, then
        // observe the now-archived material and reject with MATERIAL_UNAVAILABLE.
        const createPromise = createRecipe(createOwnerId, {
          name: `floral-${crypto.randomUUID()}`,
          items: [{ materialId: waxId, quantity: "100", unit: "g" }],
        });

        releaseUpdate();
        await heldTx;

        caught = await createPromise.catch((error: unknown) => error);
      } finally {
        // Pool-leak-safe cleanup: even on assertion failure we must release
        // the held transaction so its connection returns to the pool.
        releaseUpdate();
        await heldTx.catch(() => undefined);
      }

      expect(caught).toBeInstanceOf(RecipeRepositoryError);
      expect(caught).toMatchObject({ code: "MATERIAL_UNAVAILABLE" });
      expect(await getRecipe(createOwnerId, "00000000-0000-0000-0000-000000000000")).toBeNull();
    });

    it("serializes createRecipe behind a held-open price-update lock (recipe reads post-update unitCost)", async () => {
      const waxId = crypto.randomUUID();
      await db
        .insert(materials)
        .values(materialFixture(createOwnerId, waxId, `wax-${waxId}`, "10.000000000000000000"));
      createdCreateMaterialIds.add(waxId);

      let updateDone = () => {};
      const updateDonePromise = new Promise<void>((resolve) => {
        updateDone = resolve;
      });
      let releaseUpdate = () => {};
      const releaseUpdatePromise = new Promise<void>((resolve) => {
        releaseUpdate = resolve;
      });

      const heldTx = db.transaction(async (tx) => {
        await tx
          .update(materials)
          .set({ unitCost: "30.000000000000000000" })
          .where(eq(materials.id, waxId));
        updateDone();
        await releaseUpdatePromise;
      });

      let recipe: Awaited<ReturnType<typeof createRecipe>> | undefined;
      try {
        await updateDonePromise;

        const createPromise = createRecipe(createOwnerId, {
          name: `floral-${crypto.randomUUID()}`,
          items: [{ materialId: waxId, quantity: "10", unit: "g" }],
        });

        releaseUpdate();
        await heldTx;

        recipe = await createPromise;
        createdCreateRecipeIds.add(recipe.recipe.id);
      } finally {
        releaseUpdate();
        await heldTx.catch(() => undefined);
      }

      // 10 * 30 = 300 — proves the FOR SHARE snapshot read the post-update
      // unitCost (otherwise the value would have been derived from 10).
      expect(recipe?.recipe.unitCost).toBe("300.000000000000000000");
      expect(recipe?.items.map(({ quantity }) => quantity)).toEqual(["10"]);
    });
  });
});
