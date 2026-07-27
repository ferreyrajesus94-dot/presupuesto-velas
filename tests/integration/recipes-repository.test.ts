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
const {
  archiveRecipe,
  createRecipe,
  getRecipe,
  listRecipes,
  restoreRecipe,
  updateRecipe,
  RecipeRepositoryError,
} = recipeRepository;

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

  describe("update", () => {
    const createdUpdateRecipeIds = new Set<string>();
    const createdUpdateMaterialIds = new Set<string>();

    afterEach(async () => {
      const recipeIds = [...createdUpdateRecipeIds];
      if (recipeIds.length > 0) {
        await db.delete(recipeItems).where(inArray(recipeItems.recipeId, recipeIds));
        await db.delete(recipes).where(inArray(recipes.id, recipeIds));
      }
      createdUpdateRecipeIds.clear();
      const materialIds = [...createdUpdateMaterialIds];
      if (materialIds.length > 0) {
        await db.delete(materials).where(inArray(materials.id, materialIds));
      }
      createdUpdateMaterialIds.clear();
    });

    it("replaces name and items atomically with deterministic cost", async () => {
      const waxId = crypto.randomUUID();
      const scentId = crypto.randomUUID();
      await db
        .insert(materials)
        .values([
          materialFixture(ownerId, waxId, `wax-${waxId}`, "10.000000000000000000"),
          materialFixture(ownerId, scentId, `scent-${scentId}`, "20.000000000000000000"),
        ]);
      createdUpdateMaterialIds.add(waxId).add(scentId);

      const created = await createRecipe(ownerId, {
        name: `original-${crypto.randomUUID()}`,
        items: [{ materialId: waxId, quantity: "100", unit: "g" }],
      });
      createdUpdateRecipeIds.add(created.recipe.id);
      expect(created.recipe.unitCost).toBe("1000.000000000000000000");

      const updated = await updateRecipe(ownerId, created.recipe.id, {
        name: `floral-${crypto.randomUUID()}`,
        items: [
          { materialId: scentId, quantity: "50", unit: "g" },
          { materialId: waxId, quantity: "100", unit: "g" },
        ],
      });

      // 50 * 20 + 100 * 10 = 2000; order derives from input, not the prior recipe.
      expect(updated.recipe.name).not.toBe(created.recipe.name);
      expect(updated.recipe.unitCost).toBe("2000.000000000000000000");
      expect(updated.items.map(({ position }) => position)).toEqual([1, 2]);
      expect(updated.items.map(({ materialId }) => materialId)).toEqual([scentId, waxId]);
      expect(updated.items.map(({ quantity }) => quantity)).toEqual(["50", "100"]);

      // Persisted state must reflect the replacement (no stale items remain).
      const got = await getRecipe(ownerId, created.recipe.id);
      expect(got?.recipe.unitCost).toBe("2000.000000000000000000");
      expect(got?.items.map(({ materialId }) => materialId)).toEqual([scentId, waxId]);
    });

    it("rejects NOT_FOUND for archived, cross-owner, and missing recipes", async () => {
      const waxId = crypto.randomUUID();
      await db
        .insert(materials)
        .values(materialFixture(ownerId, waxId, `wax-${waxId}`, "10.000000000000000000"));
      createdUpdateMaterialIds.add(waxId);

      const created = await createRecipe(ownerId, {
        name: `arch-${crypto.randomUUID()}`,
        items: [{ materialId: waxId, quantity: "100", unit: "g" }],
      });
      createdUpdateRecipeIds.add(created.recipe.id);
      // archiveRecipe is deferred to the next child slice; archive the row
      // directly so the archived-recipe contract is still exercised here.
      await db
        .update(recipes)
        .set({ archivedAt: new Date("2026-01-01T00:00:00Z") })
        .where(and(eq(recipes.id, created.recipe.id), eq(recipes.ownerId, ownerId)));

      const draft: Parameters<typeof updateRecipe>[2] = {
        name: `renamed-${crypto.randomUUID()}`,
        items: [{ materialId: waxId, quantity: "100", unit: "g" }],
      };
      const otherOwnerId = crypto.randomUUID();

      // Archived recipe + cross-owner + missing recipe must all reject updates.
      await expect(updateRecipe(ownerId, created.recipe.id, draft)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(updateRecipe(otherOwnerId, created.recipe.id, draft)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(updateRecipe(ownerId, crypto.randomUUID(), draft)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      // The original archived recipe row and items remain intact.
      const stillArchived = await getRecipe(ownerId, created.recipe.id, { includeArchived: true });
      expect(stillArchived?.recipe.archivedAt).toBeInstanceOf(Date);
      expect(stillArchived?.items.map(({ materialId }) => materialId)).toEqual([waxId]);
    });

    it("maps duplicate names to DUPLICATE_NAME without mutating the recipe", async () => {
      const waxId = crypto.randomUUID();
      await db
        .insert(materials)
        .values(materialFixture(ownerId, waxId, `wax-${waxId}`, "10.000000000000000000"));
      createdUpdateMaterialIds.add(waxId);

      const first = await createRecipe(ownerId, {
        name: `first-${crypto.randomUUID()}`,
        items: [{ materialId: waxId, quantity: "100", unit: "g" }],
      });
      const second = await createRecipe(ownerId, {
        name: `second-${crypto.randomUUID()}`,
        items: [{ materialId: waxId, quantity: "50", unit: "g" }],
      });
      createdUpdateRecipeIds.add(first.recipe.id).add(second.recipe.id);

      await expect(
        updateRecipe(ownerId, second.recipe.id, {
          name: first.recipe.name,
          items: [{ materialId: waxId, quantity: "50", unit: "g" }],
        }),
      ).rejects.toMatchObject({ code: "DUPLICATE_NAME" });

      // The rejected rename must leave the recipe name and items untouched.
      const stillSecond = await getRecipe(ownerId, second.recipe.id);
      expect(stillSecond?.recipe.name).toBe(second.recipe.name);
      expect(stillSecond?.recipe.unitCost).toBe("500.000000000000000000");
      expect(stillSecond?.items.map(({ quantity }) => quantity)).toEqual(["50.000000"]);
    });

    it("maps archived and missing materials to MATERIAL_UNAVAILABLE", async () => {
      const waxId = crypto.randomUUID();
      const archivedId = crypto.randomUUID();
      await db.insert(materials).values([
        materialFixture(ownerId, waxId, `wax-${waxId}`, "10.000000000000000000"),
        {
          ...materialFixture(ownerId, archivedId, `arch-${archivedId}`, "10.000000000000000000"),
          archivedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ]);
      createdUpdateMaterialIds.add(waxId).add(archivedId);

      const created = await createRecipe(ownerId, {
        name: `mat-${crypto.randomUUID()}`,
        items: [{ materialId: waxId, quantity: "100", unit: "g" }],
      });
      createdUpdateRecipeIds.add(created.recipe.id);

      // Archived material reference must reject the update.
      await expect(
        updateRecipe(ownerId, created.recipe.id, {
          name: `renamed-${crypto.randomUUID()}`,
          items: [
            { materialId: waxId, quantity: "100", unit: "g" },
            { materialId: archivedId, quantity: "10", unit: "g" },
          ],
        }),
      ).rejects.toMatchObject({ code: "MATERIAL_UNAVAILABLE" });
      // Missing material reference (also cross-owner by FOR SHARE scope) must reject.
      await expect(
        updateRecipe(ownerId, created.recipe.id, {
          name: `renamed-${crypto.randomUUID()}`,
          items: [{ materialId: crypto.randomUUID(), quantity: "10", unit: "g" }],
        }),
      ).rejects.toMatchObject({ code: "MATERIAL_UNAVAILABLE" });

      // The original recipe must still be intact after the rejected updates.
      const stillOriginal = await getRecipe(ownerId, created.recipe.id);
      expect(stillOriginal?.recipe.name).toBe(created.recipe.name);
      expect(stillOriginal?.items.map(({ materialId }) => materialId)).toEqual([waxId]);
    });

    it("serializes updateRecipe behind a held-open price-update lock (recipe waits, reads post-update unitCost, and preserves atomic replacement)", async () => {
      const waxId = crypto.randomUUID();
      await db
        .insert(materials)
        .values(materialFixture(ownerId, waxId, `wax-${waxId}`, "10.000000000000000000"));
      createdUpdateMaterialIds.add(waxId);

      // Seed an active recipe so updateRecipe has a row to lock and replace.
      const seeded = await createRecipe(ownerId, {
        name: `seed-${crypto.randomUUID()}`,
        items: [{ materialId: waxId, quantity: "100", unit: "g" }],
      });
      createdUpdateRecipeIds.add(seeded.recipe.id);
      expect(seeded.recipe.unitCost).toBe("1000.000000000000000000");

      let updateDone = () => {};
      const updateDonePromise = new Promise<void>((resolve) => {
        updateDone = resolve;
      });
      let releaseUpdate = () => {};
      const releaseUpdatePromise = new Promise<void>((resolve) => {
        releaseUpdate = resolve;
      });

      // Held-open transaction: UPDATE acquires the exclusive row lock on the
      // material row and then waits on `releaseUpdatePromise` until the test
      // releases it. Synchronization on `updateDonePromise` is awaited BEFORE
      // launching updateRecipe, so we only release once we know updateRecipe
      // is racing against the held lock.
      const heldTx = db.transaction(async (tx) => {
        await tx
          .update(materials)
          .set({ unitCost: "30.000000000000000000" })
          .where(eq(materials.id, waxId));
        updateDone();
        await releaseUpdatePromise;
      });

      let updated: Awaited<ReturnType<typeof updateRecipe>> | undefined;
      try {
        await updateDonePromise;

        // Start updateRecipe while the held UPDATE still owns the row lock.
        // FOR UPDATE on the recipe row acquires immediately, then the FOR
        // SHARE snapshot of the owner's materials blocks until the held tx
        // commits. After the held tx commits, updateRecipe reads the new
        // unitCost (30) and the renormalized recipe cost is 10 * 30 = 300.
        const updatePromise = updateRecipe(ownerId, seeded.recipe.id, {
          name: `renamed-${crypto.randomUUID()}`,
          items: [{ materialId: waxId, quantity: "10", unit: "g" }],
        });

        releaseUpdate();
        await heldTx;

        updated = await updatePromise;
      } finally {
        // Pool-leak-safe cleanup: even on assertion failure we must release
        // the held transaction so its connection returns to the pool.
        releaseUpdate();
        await heldTx.catch(() => undefined);
      }

      // 10 * 30 = 300 — proves the FOR SHARE snapshot read the post-update
      // unitCost (otherwise the value would have been derived from 10).
      // The returned `quantity` is the parsed numeric "10" (toFixed); the
      // persisted shape (NUMERIC(24,6)) stores "10.000000".
      expect(updated?.recipe.unitCost).toBe("300.000000000000000000");
      expect(updated?.recipe.name).not.toBe(seeded.recipe.name);
      expect(updated?.items.map(({ quantity }) => quantity)).toEqual(["10"]);

      // The replacement must persist atomically: no stale items remain.
      const persisted = await getRecipe(ownerId, seeded.recipe.id);
      expect(persisted?.recipe.unitCost).toBe("300.000000000000000000");
      expect(persisted?.items.map(({ materialId }) => materialId)).toEqual([waxId]);
      expect(persisted?.items.map(({ quantity }) => quantity)).toEqual(["10.000000"]);
    });
  });

  describe("archive and restore", () => {
    const createdArchiveRecipeIds = new Set<string>();
    const createdArchiveMaterialIds = new Set<string>();

    afterEach(async () => {
      const recipeIds = [...createdArchiveRecipeIds];
      if (recipeIds.length > 0) {
        await db.delete(recipeItems).where(inArray(recipeItems.recipeId, recipeIds));
        await db.delete(recipes).where(inArray(recipes.id, recipeIds));
      }
      createdArchiveRecipeIds.clear();
      const materialIds = [...createdArchiveMaterialIds];
      if (materialIds.length > 0) {
        await db.delete(materials).where(inArray(materials.id, materialIds));
      }
      createdArchiveMaterialIds.clear();
    });

    it("archives a recipe (preserves items, hides from active list) and restores it (returns to active list)", async () => {
      const waxId = crypto.randomUUID();
      const scentId = crypto.randomUUID();
      await db
        .insert(materials)
        .values([
          materialFixture(ownerId, waxId, `wax-${waxId}`, "10.000000000000000000"),
          materialFixture(ownerId, scentId, `scent-${scentId}`, "20.000000000000000000"),
        ]);
      createdArchiveMaterialIds.add(waxId).add(scentId);

      const created = await createRecipe(ownerId, {
        name: `floral-${crypto.randomUUID()}`,
        items: [
          { materialId: waxId, quantity: "100", unit: "g" },
          { materialId: scentId, quantity: "50", unit: "g" },
        ],
      });
      createdArchiveRecipeIds.add(created.recipe.id);
      expect(created.recipe.archivedAt).toBeNull();

      // Archive — returns the recipe with archivedAt populated, items unchanged.
      const archived = await archiveRecipe(ownerId, created.recipe.id);
      expect(archived.id).toBe(created.recipe.id);
      expect(archived.archivedAt).toBeInstanceOf(Date);
      expect(archived.unitCost).toBe(created.recipe.unitCost);
      expect(archived.name).toBe(created.recipe.name);

      // Active list hides the archived recipe; all-visibility surfaces it.
      expect((await listRecipes(ownerId)).map(({ recipe: row }) => row.id)).not.toContain(
        created.recipe.id,
      );
      expect(
        (await listRecipes(ownerId, { includeArchived: true })).map(({ recipe: row }) => row.id),
      ).toContain(created.recipe.id);

      // getRecipe mirrors the visibility: hidden by default, included when requested.
      expect(await getRecipe(ownerId, created.recipe.id)).toBeNull();
      const archivedView = await getRecipe(ownerId, created.recipe.id, { includeArchived: true });
      expect(archivedView?.recipe.archivedAt).toBeInstanceOf(Date);
      expect(archivedView?.items.map(({ materialId }) => materialId)).toEqual([waxId, scentId]);
      expect(archivedView?.items.map(({ quantity }) => quantity)).toEqual([
        "100.000000",
        "50.000000",
      ]);

      // Restore — clears archivedAt; items are preserved verbatim.
      const restored = await restoreRecipe(ownerId, created.recipe.id);
      expect(restored.id).toBe(created.recipe.id);
      expect(restored.archivedAt).toBeNull();
      expect(restored.unitCost).toBe(created.recipe.unitCost);

      // Active list contains the restored recipe; all-visibility still surfaces it.
      expect((await listRecipes(ownerId)).map(({ recipe: row }) => row.id)).toContain(
        created.recipe.id,
      );
      const restoredView = await getRecipe(ownerId, created.recipe.id);
      expect(restoredView?.recipe.archivedAt).toBeNull();
      expect(restoredView?.items.map(({ materialId }) => materialId)).toEqual([waxId, scentId]);
      expect(restoredView?.items.map(({ quantity }) => quantity)).toEqual([
        "100.000000",
        "50.000000",
      ]);
    });

    it("rejects archive and restore with NOT_FOUND for cross-owner, wrong-state, and missing recipes", async () => {
      const waxId = crypto.randomUUID();
      await db
        .insert(materials)
        .values(materialFixture(ownerId, waxId, `wax-${waxId}`, "10.000000000000000000"));
      createdArchiveMaterialIds.add(waxId);

      const active = await createRecipe(ownerId, {
        name: `active-${crypto.randomUUID()}`,
        items: [{ materialId: waxId, quantity: "100", unit: "g" }],
      });
      createdArchiveRecipeIds.add(active.recipe.id);

      const archived = await archiveRecipe(ownerId, active.recipe.id);
      expect(archived.archivedAt).toBeInstanceOf(Date);

      const otherOwnerId = crypto.randomUUID();
      const missingId = crypto.randomUUID();

      // archiveRecipe rejects:
      // - cross-owner (recipe exists for another owner)
      // - already archived (wrong state — FOR UPDATE only sees active rows)
      // - missing recipe id
      await expect(archiveRecipe(otherOwnerId, active.recipe.id)).rejects.toBeInstanceOf(
        RecipeRepositoryError,
      );
      await expect(archiveRecipe(otherOwnerId, active.recipe.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(archiveRecipe(ownerId, active.recipe.id)).rejects.toBeInstanceOf(
        RecipeRepositoryError,
      );
      await expect(archiveRecipe(ownerId, active.recipe.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(archiveRecipe(ownerId, missingId)).rejects.toMatchObject({ code: "NOT_FOUND" });

      // restoreRecipe rejects:
      // - cross-owner (recipe exists for another owner)
      // - already active (wrong state — FOR UPDATE only sees archived rows)
      // - missing recipe id
      await expect(restoreRecipe(otherOwnerId, active.recipe.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(restoreRecipe(ownerId, missingId)).rejects.toMatchObject({ code: "NOT_FOUND" });

      // Wrong-state restore on the still-archived recipe: the only currently
      // valid transition is restore → active; re-archive while archived must
      // also reject (already covered above), then restore flips state, then
      // a second restore while now-active must reject with NOT_FOUND.
      const restored = await restoreRecipe(ownerId, active.recipe.id);
      expect(restored.archivedAt).toBeNull();
      await expect(restoreRecipe(ownerId, active.recipe.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      // The original recipe row must still exist with its items intact after
      // every rejected call.
      const finalView = await getRecipe(ownerId, active.recipe.id);
      expect(finalView?.recipe.archivedAt).toBeNull();
      expect(finalView?.items.map(({ materialId }) => materialId)).toEqual([waxId]);
      expect(finalView?.items.map(({ quantity }) => quantity)).toEqual(["100.000000"]);
    });
  });
});
