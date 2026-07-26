import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { assertSafeNeonTestDatabase } from "./assert-safe-neon-test-database";

assertSafeNeonTestDatabase();

const [{ db }, { appOwner, materials }, { getSingletonOwner }, materialsRepository] =
  await Promise.all([
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
    for (const id of createdMaterialIds) {
      await db.delete(materials).where(and(eq(materials.id, id), eq(materials.ownerId, ownerId)));
    }
    createdMaterialIds.clear();
  });

  afterAll(async () => {
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
});
