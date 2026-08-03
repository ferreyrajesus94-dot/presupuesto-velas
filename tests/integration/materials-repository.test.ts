import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { assertSafeNeonTestDatabase } from "./assert-safe-neon-test-database";

assertSafeNeonTestDatabase();

const [
  { db },
  { appOwner, materials, templateItems, templates },
  { getSingletonOwner },
  materialsRepository,
] = await Promise.all([
  import("../../db/client"),
  import("../../db/schema"),
  import("../../src/server/repositories/owner"),
  import("../../src/server/repositories/materials"),
]);
const {
  MaterialRepositoryError,
  archiveMaterial,
  createMaterial,
  getMaterial,
  listMaterials,
  unarchiveMaterial,
  updateMaterial,
} = materialsRepository;

const input = (name: string, price = "10000") => ({
  name,
  dimension: "mass" as const,
  baseUnit: "g" as const,
  purchaseUnit: "kg" as const,
  purchaseQuantity: "1",
  purchasePrice: price,
});

describe("materials repository (integration vs dev branch)", () => {
  let ownerId: string;
  let createdOwner = false;
  const createdMaterialIds = new Set<string>();
  const createdTemplateIds = new Set<string>();

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
    const templateIds = [...createdTemplateIds];
    if (templateIds.length > 0) {
      await db.delete(templateItems).where(inArray(templateItems.templateId, templateIds));
      await db.delete(templates).where(inArray(templates.id, templateIds));
    }
    for (const id of createdMaterialIds) {
      await db.delete(materials).where(and(eq(materials.id, id), eq(materials.ownerId, ownerId)));
    }
    createdTemplateIds.clear();
    createdMaterialIds.clear();
  });

  afterAll(async () => {
    const templateIds = [...createdTemplateIds];
    if (templateIds.length > 0) {
      await db.delete(templateItems).where(inArray(templateItems.templateId, templateIds));
      await db.delete(templates).where(inArray(templates.id, templateIds));
    }
    for (const id of createdMaterialIds) {
      await db.delete(materials).where(and(eq(materials.id, id), eq(materials.ownerId, ownerId)));
    }
    if (createdOwner) await db.delete(appOwner).where(eq(appOwner.id, ownerId));
  });

  it("creates, lists active/all, updates, and returns a deterministic derived cost", async () => {
    const material = await createMaterial(ownerId, input(`wax-${crypto.randomUUID()}`));
    createdMaterialIds.add(material.id);

    expect(material.unitCost).toBe("10.000000000000000000");
    expect((await listMaterials(ownerId)).map(({ id }) => id)).toContain(material.id);
    const updated = await updateMaterial(ownerId, material.id, input(material.name, "12000"));
    expect(updated.unitCost).toBe("12.000000000000000000");
  });
  it("rejects duplicate names only within the owner scope", async () => {
    const name = `duplicate-${crypto.randomUUID()}`;
    const material = await createMaterial(ownerId, input(name));
    createdMaterialIds.add(material.id);

    await expect(createMaterial(ownerId, input(name))).rejects.toMatchObject({
      code: "DUPLICATE_NAME",
    });
  });
  it("hides archived materials by default and supports unarchive", async () => {
    const material = await createMaterial(ownerId, input(`archived-${crypto.randomUUID()}`));
    createdMaterialIds.add(material.id);
    await archiveMaterial(ownerId, material.id);

    expect(await getMaterial(ownerId, material.id)).toBeNull();
    expect((await listMaterials(ownerId, { includeArchived: true })).map(({ id }) => id)).toContain(
      material.id,
    );
    await unarchiveMaterial(ownerId, material.id);
    expect((await listMaterials(ownerId)).map(({ id }) => id)).toContain(material.id);
  });
  it("rejects updates to archived materials without changing them", async () => {
    const material = await createMaterial(ownerId, input(`read-only-${crypto.randomUUID()}`));
    createdMaterialIds.add(material.id);
    const conflicting = await createMaterial(ownerId, input(`active-${crypto.randomUUID()}`));
    createdMaterialIds.add(conflicting.id);
    await archiveMaterial(ownerId, material.id);

    await expect(
      updateMaterial(ownerId, material.id, input(conflicting.name, "12000")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const archived = await getMaterial(ownerId, material.id, { includeArchived: true });
    expect(archived).toMatchObject({ name: material.name, unitCost: material.unitCost });
  });
  it("rejects renaming one active material to another active material's name with DUPLICATE_NAME", async () => {
    // R3-004: integration coverage for the 23505 mapping after the
    // duplicate preflight was removed. Two active siblings; rename one to
    // the other's name. The DB unique index must surface as DUPLICATE_NAME.
    const firstName = `first-${crypto.randomUUID()}`;
    const secondName = `second-${crypto.randomUUID()}`;
    const first = await createMaterial(ownerId, input(firstName));
    createdMaterialIds.add(first.id);
    const second = await createMaterial(ownerId, input(secondName));
    createdMaterialIds.add(second.id);

    await expect(
      updateMaterial(ownerId, second.id, input(firstName, "12000")),
    ).rejects.toMatchObject({ code: "DUPLICATE_NAME" });
    // Both records remain intact after the rejected rename.
    const stillFirst = await getMaterial(ownerId, first.id);
    const stillSecond = await getMaterial(ownerId, second.id);
    expect(stillFirst?.name).toBe(firstName);
    expect(stillSecond?.name).toBe(secondName);
    expect(stillFirst?.unitCost).toBe("10.000000000000000000");
    expect(stillSecond?.unitCost).toBe("10.000000000000000000");
  });
  it("denies cross-owner and missing mutations without deleting data", async () => {
    const material = await createMaterial(ownerId, input(`owned-${crypto.randomUUID()}`));
    createdMaterialIds.add(material.id);
    const otherOwnerId = crypto.randomUUID();

    expect(await getMaterial(otherOwnerId, material.id)).toBeNull();
    await expect(
      updateMaterial(otherOwnerId, material.id, input(material.name)),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(archiveMaterial(ownerId, crypto.randomUUID())).rejects.toBeInstanceOf(
      MaterialRepositoryError,
    );
    expect((await getMaterial(ownerId, material.id))?.name).toBe(material.name);
  });

  // R3-001 prerequisite guard. Recipe items persist quantities normalized
  // to the material's baseUnit (see recipeSchema), so flipping baseUnit on
  // a referenced material would silently change every persisted quantity's
  // meaning. The guard must reject with BASE_UNIT_REFERENCED for any
  // referenced material — active or archived recipes both count.
  it("R3-001: rejects baseUnit change on a referenced material without mutating the row", async () => {
    const material = await createMaterial(
      ownerId,
      input(`referenced-${crypto.randomUUID()}`, "10000"),
    );
    createdMaterialIds.add(material.id);

    // Seed an active recipe that references the material. quantity is in
    // the material's baseUnit (g); a kg→g flip would silently scale every
    // quantity by 1000, which is exactly the bug we want to prevent.
    const templateId = crypto.randomUUID();
    await db.insert(templates).values({
      id: templateId,
      ownerId,
      name: `template-${templateId}`,
      unitCost: "100.000000000000000000",
    });
    await db.insert(templateItems).values({
      id: crypto.randomUUID(),
      templateId,
      materialId: material.id,
      position: 1,
      quantity: "100",
    });
    createdTemplateIds.add(templateId);

    // The kg→g flip must surface as BASE_UNIT_REFERENCED, never silently
    // succeed. The original row (baseUnit, unitCost) must be untouched.
    await expect(
      updateMaterial(ownerId, material.id, { ...input(material.name, "10000"), baseUnit: "kg" }),
    ).rejects.toBeInstanceOf(MaterialRepositoryError);
    await expect(
      updateMaterial(ownerId, material.id, { ...input(material.name, "10000"), baseUnit: "kg" }),
    ).rejects.toMatchObject({ code: "BASE_UNIT_REFERENCED" });

    const stillMaterial = await getMaterial(ownerId, material.id);
    expect(stillMaterial?.baseUnit).toBe("g");
    expect(stillMaterial?.unitCost).toBe("10.000000000000000000");
  });

  it("R3-001: rejects baseUnit change even when every referencing recipe is archived", async () => {
    // Recipe history must remain semantically stable across the archive
    // boundary; archiving a recipe does not detach its items, so the
    // guard must still reject baseUnit flips on a material whose only
    // references are archived recipes.
    const material = await createMaterial(
      ownerId,
      input(`archived-ref-${crypto.randomUUID()}`, "10000"),
    );
    createdMaterialIds.add(material.id);

    const templateId = crypto.randomUUID();
    await db.insert(templates).values({
      id: templateId,
      ownerId,
      name: `archived-template-${templateId}`,
      unitCost: "100.000000000000000000",
    });
    await db.insert(templateItems).values({
      id: crypto.randomUUID(),
      templateId,
      materialId: material.id,
      position: 1,
      quantity: "100",
    });
    createdTemplateIds.add(templateId);
    await db
      .update(templates)
      .set({ archivedAt: new Date("2026-01-01T00:00:00Z") })
      .where(and(eq(templates.id, templateId), eq(templates.ownerId, ownerId)));

    await expect(
      updateMaterial(ownerId, material.id, { ...input(material.name, "10000"), baseUnit: "kg" }),
    ).rejects.toMatchObject({ code: "BASE_UNIT_REFERENCED" });
  });

  it("R3-001: permits non-baseUnit edits (price, name) on a referenced material", async () => {
    // The guard is scoped to baseUnit only. Price and name changes
    // re-derive unitCost from the same baseUnit, so persisted recipe
    // quantities keep their meaning. The update must succeed and the
    // baseUnit must remain unchanged.
    const material = await createMaterial(
      ownerId,
      input(`price-only-${crypto.randomUUID()}`, "10000"),
    );
    createdMaterialIds.add(material.id);

    const templateId = crypto.randomUUID();
    await db.insert(templates).values({
      id: templateId,
      ownerId,
      name: `price-template-${templateId}`,
      unitCost: "100.000000000000000000",
    });
    await db.insert(templateItems).values({
      id: crypto.randomUUID(),
      templateId,
      materialId: material.id,
      position: 1,
      quantity: "100",
    });
    createdTemplateIds.add(templateId);

    const updated = await updateMaterial(ownerId, material.id, input(material.name, "20000"));
    expect(updated.baseUnit).toBe("g");
    expect(updated.unitCost).toBe("20.000000000000000000");
  });

  it("R3-001: permits baseUnit change on an unreferenced material (kg→g)", async () => {
    // No recipe_items reference this material, so the dimension validation
    // rules alone govern the change. A kg→g flip must succeed and the
    // unitCost must re-derive from the new baseUnit (10000 / 1000 = 10).
    const material = await createMaterial(ownerId, {
      ...input(`free-${crypto.randomUUID()}`, "10000"),
      baseUnit: "kg",
    });
    createdMaterialIds.add(material.id);
    expect(material.baseUnit).toBe("kg");
    expect(material.unitCost).toBe("10000.000000000000000000");

    const updated = await updateMaterial(ownerId, material.id, {
      ...input(material.name, "10000"),
      baseUnit: "g",
    });
    expect(updated.baseUnit).toBe("g");
    expect(updated.unitCost).toBe("10.000000000000000000");
  });
});
