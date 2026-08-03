import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { assertSafeNeonTestDatabase } from "./assert-safe-neon-test-database";

assertSafeNeonTestDatabase();

const [
  { db },
  { appOwner, materials, templateItems, templates },
  { getSingletonOwner },
  templateRepository,
] = await Promise.all([
  import("../../db/client"),
  import("../../db/schema"),
  import("../../src/server/repositories/owner"),
  import("../../src/server/repositories/templates"),
]);
const {
  archiveTemplate,
  countArchivedTemplates,
  createTemplate,
  getTemplate,
  listTemplates,
  restoreTemplate,
  updateTemplate,
  TemplateRepositoryError,
} = templateRepository;

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

async function insertTemplateFixture(args: {
  ownerId: string;
  materialId: string;
  templateId: string;
  templateName: string;
  unitCost: string;
  quantity: string;
  position: number;
}): Promise<void> {
  await db.insert(templates).values({
    id: args.templateId,
    ownerId: args.ownerId,
    name: args.templateName,
    unitCost: args.unitCost,
  });
  await db.insert(templateItems).values({
    id: crypto.randomUUID(),
    templateId: args.templateId,
    materialId: args.materialId,
    position: args.position,
    quantity: args.quantity,
  });
}

describe("templates repository (integration vs dev branch)", () => {
  let ownerId = "";
  let createdOwner = false;
  const createdTemplateIds = new Set<string>();
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
    const templateIds = [...createdTemplateIds];
    if (templateIds.length > 0) {
      await db.delete(templateItems).where(inArray(templateItems.templateId, templateIds));
      await db.delete(templates).where(inArray(templates.id, templateIds));
    }
    createdTemplateIds.clear();
    const materialIds = [...createdMaterialIds];
    if (materialIds.length > 0) {
      await db.delete(materials).where(inArray(materials.id, materialIds));
    }
    createdMaterialIds.clear();
  });

  afterAll(async () => {
    if (createdOwner) await db.delete(appOwner).where(eq(appOwner.id, ownerId));
  });

  it("returns owner-scoped templates with position-ordered items and supports cross-owner / missing reads", async () => {
    const waxId = crypto.randomUUID();
    const wickId = crypto.randomUUID();
    await db
      .insert(materials)
      .values([
        materialFixture(ownerId, waxId, `wax-${waxId}`, "10.000000000000000000"),
        materialFixture(ownerId, wickId, `wick-${wickId}`, "50.000000000000000000"),
      ]);
    createdMaterialIds.add(waxId).add(wickId);

    const templateId = crypto.randomUUID();
    await insertTemplateFixture({
      ownerId,
      materialId: waxId,
      templateId,
      templateName: `floral-${templateId}`,
      unitCost: "1100.000000000000000000",
      quantity: "100",
      position: 1,
    });
    await db.insert(templateItems).values({
      id: crypto.randomUUID(),
      templateId,
      materialId: wickId,
      position: 2,
      quantity: "2",
    });
    createdTemplateIds.add(templateId);

    const got = await getTemplate(ownerId, templateId);
    expect(got?.items.map(({ position }) => position)).toEqual([1, 2]);
    expect(got?.items.map(({ materialId }) => materialId)).toEqual([waxId, wickId]);
    expect(got?.template.unitCost).toBe("1100.000000000000000000");

    expect((await listTemplates(ownerId)).map(({ template: row }) => row.id)).toContain(templateId);
    expect(await getTemplate(crypto.randomUUID(), templateId)).toBeNull();
    expect(await getTemplate(ownerId, crypto.randomUUID())).toBeNull();
  });

  it("hides archived templates by default and returns them only in all visibility", async () => {
    const materialId = crypto.randomUUID();
    await db
      .insert(materials)
      .values(materialFixture(ownerId, materialId, `wax-${materialId}`, "10.000000000000000000"));
    createdMaterialIds.add(materialId);

    const templateId = crypto.randomUUID();
    await insertTemplateFixture({
      ownerId,
      materialId,
      templateId,
      templateName: `archived-${templateId}`,
      unitCost: "100.000000000000000000",
      quantity: "10",
      position: 1,
    });
    createdTemplateIds.add(templateId);
    await db
      .update(templates)
      .set({ archivedAt: new Date("2026-01-01T00:00:00Z") })
      .where(and(eq(templates.id, templateId), eq(templates.ownerId, ownerId)));

    expect(await getTemplate(ownerId, templateId)).toBeNull();
    expect(
      (await listTemplates(ownerId, { includeArchived: true })).map(
        ({ template: row }) => row.id,
      ),
    ).toContain(templateId);
  });

  it("counts archived templates per owner without surfacing other owners' archived rows", async () => {
    const materialId = crypto.randomUUID();
    await db
      .insert(materials)
      .values(materialFixture(ownerId, materialId, `wax-${materialId}`, "10.000000000000000000"));
    createdMaterialIds.add(materialId);

    const archivedAId = crypto.randomUUID();
    const archivedBId = crypto.randomUUID();
    const activeId = crypto.randomUUID();
    for (const templateId of [archivedAId, archivedBId, activeId]) {
      await insertTemplateFixture({
        ownerId,
        materialId,
        templateId,
        templateName: `count-${templateId}`,
        unitCost: "100.000000000000000000",
        quantity: "10",
        position: 1,
      });
      createdTemplateIds.add(templateId);
    }
    await db
      .update(templates)
      .set({ archivedAt: new Date("2026-01-01T00:00:00Z") })
      .where(
        and(inArray(templates.id, [archivedAId, archivedBId]), eq(templates.ownerId, ownerId)),
      );

    // Two archived rows for the owner: count must be exactly 2.
    expect(await countArchivedTemplates(ownerId)).toBe(2);

    // A foreign owner with no rows must see 0 — and the prior owner count
    // stays 2 (the function must not double-count or include other scopes).
    expect(await countArchivedTemplates(crypto.randomUUID())).toBe(0);
  });

  describe("create", () => {
    let createOwnerId: string;
    const createOwnerCreated = false;
    const createdCreateTemplateIds = new Set<string>();
    const createdCreateMaterialIds = new Set<string>();

    beforeAll(async () => {
      // Reuse the singleton owner row so all create tests share the same
      // owner scope as the read tests; this lets them exercise the unique
      // name index without provisioning extra app_owner rows.
      createOwnerId = ownerId;
    });

    afterEach(async () => {
      const templateIds = [...createdCreateTemplateIds];
      if (templateIds.length > 0) {
        await db.delete(templateItems).where(inArray(templateItems.templateId, templateIds));
        await db.delete(templates).where(inArray(templates.id, templateIds));
      }
      createdCreateTemplateIds.clear();
      const materialIds = [...createdCreateMaterialIds];
      if (materialIds.length > 0) {
        await db.delete(materials).where(inArray(materials.id, materialIds));
      }
      createdCreateMaterialIds.clear();
    });

    afterAll(async () => {
      if (createOwnerCreated) await db.delete(appOwner).where(eq(appOwner.id, createOwnerId));
    });

    it("creates and reads an owner-scoped template with ordered items and deterministic cost", async () => {
      const waxId = crypto.randomUUID();
      const scentId = crypto.randomUUID();
      await db
        .insert(materials)
        .values([
          materialFixture(createOwnerId, waxId, `wax-${waxId}`, "10.000000000000000000"),
          materialFixture(createOwnerId, scentId, `scent-${scentId}`, "20.000000000000000000"),
        ]);
      createdCreateMaterialIds.add(waxId).add(scentId);

      const template = await createTemplate(createOwnerId, {
        name: `floral-${crypto.randomUUID()}`,
        items: [
          { materialId: waxId, quantity: "100", unit: "g" },
          { materialId: scentId, quantity: "50", unit: "g" },
        ],
      });
      createdCreateTemplateIds.add(template.template.id);

      expect(template.template.unitCost).toBe("2000.000000000000000000");
      expect(template.items.map(({ position }) => position)).toEqual([1, 2]);
      expect(template.items.map(({ materialId }) => materialId)).toEqual([waxId, scentId]);
      expect(template.items.map(({ quantity }) => quantity)).toEqual(["100", "50"]);

      const got = await getTemplate(createOwnerId, template.template.id);
      expect(got?.template.id).toBe(template.template.id);
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
      const first = await createTemplate(createOwnerId, {
        name: sharedName,
        items: [{ materialId: waxId, quantity: "100", unit: "g" }],
      });
      createdCreateTemplateIds.add(first.template.id);

      // DUPLICATE_NAME — the unique (ownerId, name) index must surface as the repository code.
      await expect(
        createTemplate(createOwnerId, {
          name: sharedName,
          items: [{ materialId: waxId, quantity: "50", unit: "g" }],
        }),
      ).rejects.toBeInstanceOf(TemplateRepositoryError);
      await expect(
        createTemplate(createOwnerId, {
          name: sharedName,
          items: [{ materialId: waxId, quantity: "50", unit: "g" }],
        }),
      ).rejects.toMatchObject({ code: "DUPLICATE_NAME" });

      // MATERIAL_UNAVAILABLE — archived material reference.
      await expect(
        createTemplate(createOwnerId, {
          name: `arch-${crypto.randomUUID()}`,
          items: [{ materialId: archivedId, quantity: "10", unit: "g" }],
        }),
      ).rejects.toBeInstanceOf(TemplateRepositoryError);
      await expect(
        createTemplate(createOwnerId, {
          name: `arch-${crypto.randomUUID()}`,
          items: [{ materialId: archivedId, quantity: "10", unit: "g" }],
        }),
      ).rejects.toMatchObject({ code: "MATERIAL_UNAVAILABLE" });

      // MATERIAL_UNAVAILABLE — missing material id (also covers cross-owner
      // references because the owner-scoped FOR SHARE snapshot only sees
      // this owner's rows).
      await expect(
        createTemplate(createOwnerId, {
          name: `miss-${crypto.randomUUID()}`,
          items: [{ materialId: crypto.randomUUID(), quantity: "10", unit: "g" }],
        }),
      ).rejects.toBeInstanceOf(TemplateRepositoryError);
      await expect(
        createTemplate(createOwnerId, {
          name: `miss-${crypto.randomUUID()}`,
          items: [{ materialId: crypto.randomUUID(), quantity: "10", unit: "g" }],
        }),
      ).rejects.toMatchObject({ code: "MATERIAL_UNAVAILABLE" });
    });

    it("serializes createTemplate behind a held-open archive lock (template rejects unavailable material)", async () => {
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

        // Start createTemplate while the held UPDATE still owns the row lock.
        // The FOR SHARE snapshot will block until the held tx commits, then
        // observe the now-archived material and reject with MATERIAL_UNAVAILABLE.
        const createPromise = createTemplate(createOwnerId, {
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

      expect(caught).toBeInstanceOf(TemplateRepositoryError);
      expect(caught).toMatchObject({ code: "MATERIAL_UNAVAILABLE" });
      expect(await getTemplate(createOwnerId, "00000000-0000-0000-0000-000000000000")).toBeNull();
    });

    it("serializes createTemplate behind a held-open price-update lock (template reads post-update unitCost)", async () => {
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

      let template: Awaited<ReturnType<typeof createTemplate>> | undefined;
      try {
        await updateDonePromise;

        const createPromise = createTemplate(createOwnerId, {
          name: `floral-${crypto.randomUUID()}`,
          items: [{ materialId: waxId, quantity: "10", unit: "g" }],
        });

        releaseUpdate();
        await heldTx;

        template = await createPromise;
        createdCreateTemplateIds.add(template.template.id);
      } finally {
        releaseUpdate();
        await heldTx.catch(() => undefined);
      }

      // 10 * 30 = 300 — proves the FOR SHARE snapshot read the post-update
      // unitCost (otherwise the value would have been derived from 10).
      expect(template?.template.unitCost).toBe("300.000000000000000000");
      expect(template?.items.map(({ quantity }) => quantity)).toEqual(["10"]);
    });
  });

  describe("update", () => {
    const createdUpdateTemplateIds = new Set<string>();
    const createdUpdateMaterialIds = new Set<string>();

    afterEach(async () => {
      const templateIds = [...createdUpdateTemplateIds];
      if (templateIds.length > 0) {
        await db.delete(templateItems).where(inArray(templateItems.templateId, templateIds));
        await db.delete(templates).where(inArray(templates.id, templateIds));
      }
      createdUpdateTemplateIds.clear();
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

      const created = await createTemplate(ownerId, {
        name: `original-${crypto.randomUUID()}`,
        items: [{ materialId: waxId, quantity: "100", unit: "g" }],
      });
      createdUpdateTemplateIds.add(created.template.id);
      expect(created.template.unitCost).toBe("1000.000000000000000000");

      const updated = await updateTemplate(ownerId, created.template.id, {
        name: `floral-${crypto.randomUUID()}`,
        items: [
          { materialId: scentId, quantity: "50", unit: "g" },
          { materialId: waxId, quantity: "100", unit: "g" },
        ],
      });

      // 50 * 20 + 100 * 10 = 2000; order derives from input, not the prior template.
      expect(updated.template.name).not.toBe(created.template.name);
      expect(updated.template.unitCost).toBe("2000.000000000000000000");
      expect(updated.items.map(({ position }) => position)).toEqual([1, 2]);
      expect(updated.items.map(({ materialId }) => materialId)).toEqual([scentId, waxId]);
      expect(updated.items.map(({ quantity }) => quantity)).toEqual(["50", "100"]);

      // Persisted state must reflect the replacement (no stale items remain).
      const got = await getTemplate(ownerId, created.template.id);
      expect(got?.template.unitCost).toBe("2000.000000000000000000");
      expect(got?.items.map(({ materialId }) => materialId)).toEqual([scentId, waxId]);
    });

    it("rejects NOT_FOUND for archived, cross-owner, and missing templates", async () => {
      const waxId = crypto.randomUUID();
      await db
        .insert(materials)
        .values(materialFixture(ownerId, waxId, `wax-${waxId}`, "10.000000000000000000"));
      createdUpdateMaterialIds.add(waxId);

      const created = await createTemplate(ownerId, {
        name: `arch-${crypto.randomUUID()}`,
        items: [{ materialId: waxId, quantity: "100", unit: "g" }],
      });
      createdUpdateTemplateIds.add(created.template.id);
      // archiveTemplate is deferred to the next child slice; archive the row
      // directly so the archived-template contract is still exercised here.
      await db
        .update(templates)
        .set({ archivedAt: new Date("2026-01-01T00:00:00Z") })
        .where(and(eq(templates.id, created.template.id), eq(templates.ownerId, ownerId)));

      const draft: Parameters<typeof updateTemplate>[2] = {
        name: `renamed-${crypto.randomUUID()}`,
        items: [{ materialId: waxId, quantity: "100", unit: "g" }],
      };
      const otherOwnerId = crypto.randomUUID();

      // Archived template + cross-owner + missing template must all reject updates.
      await expect(updateTemplate(ownerId, created.template.id, draft)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(updateTemplate(otherOwnerId, created.template.id, draft)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(updateTemplate(ownerId, crypto.randomUUID(), draft)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      // The original archived template row and items remain intact.
      const stillArchived = await getTemplate(ownerId, created.template.id, {
        includeArchived: true,
      });
      expect(stillArchived?.template.archivedAt).toBeInstanceOf(Date);
      expect(stillArchived?.items.map(({ materialId }) => materialId)).toEqual([waxId]);
    });

    it("maps duplicate names to DUPLICATE_NAME without mutating the template", async () => {
      const waxId = crypto.randomUUID();
      await db
        .insert(materials)
        .values(materialFixture(ownerId, waxId, `wax-${waxId}`, "10.000000000000000000"));
      createdUpdateMaterialIds.add(waxId);

      const first = await createTemplate(ownerId, {
        name: `first-${crypto.randomUUID()}`,
        items: [{ materialId: waxId, quantity: "100", unit: "g" }],
      });
      const second = await createTemplate(ownerId, {
        name: `second-${crypto.randomUUID()}`,
        items: [{ materialId: waxId, quantity: "50", unit: "g" }],
      });
      createdUpdateTemplateIds.add(first.template.id).add(second.template.id);

      await expect(
        updateTemplate(ownerId, second.template.id, {
          name: first.template.name,
          items: [{ materialId: waxId, quantity: "50", unit: "g" }],
        }),
      ).rejects.toMatchObject({ code: "DUPLICATE_NAME" });

      // The rejected rename must leave the template name and items untouched.
      const stillSecond = await getTemplate(ownerId, second.template.id);
      expect(stillSecond?.template.name).toBe(second.template.name);
      expect(stillSecond?.template.unitCost).toBe("500.000000000000000000");
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

      const created = await createTemplate(ownerId, {
        name: `mat-${crypto.randomUUID()}`,
        items: [{ materialId: waxId, quantity: "100", unit: "g" }],
      });
      createdUpdateTemplateIds.add(created.template.id);

      // Archived material reference must reject the update.
      await expect(
        updateTemplate(ownerId, created.template.id, {
          name: `renamed-${crypto.randomUUID()}`,
          items: [
            { materialId: waxId, quantity: "100", unit: "g" },
            { materialId: archivedId, quantity: "10", unit: "g" },
          ],
        }),
      ).rejects.toMatchObject({ code: "MATERIAL_UNAVAILABLE" });
      // Missing material reference (also cross-owner by FOR SHARE scope) must reject.
      await expect(
        updateTemplate(ownerId, created.template.id, {
          name: `renamed-${crypto.randomUUID()}`,
          items: [{ materialId: crypto.randomUUID(), quantity: "10", unit: "g" }],
        }),
      ).rejects.toMatchObject({ code: "MATERIAL_UNAVAILABLE" });

      // The original template must still be intact after the rejected updates.
      const stillOriginal = await getTemplate(ownerId, created.template.id);
      expect(stillOriginal?.template.name).toBe(created.template.name);
      expect(stillOriginal?.items.map(({ materialId }) => materialId)).toEqual([waxId]);
    });

    it("serializes updateTemplate behind a held-open price-update lock (template waits, reads post-update unitCost, and preserves atomic replacement)", async () => {
      const waxId = crypto.randomUUID();
      await db
        .insert(materials)
        .values(materialFixture(ownerId, waxId, `wax-${waxId}`, "10.000000000000000000"));
      createdUpdateMaterialIds.add(waxId);

      // Seed an active template so updateTemplate has a row to lock and replace.
      const seeded = await createTemplate(ownerId, {
        name: `seed-${crypto.randomUUID()}`,
        items: [{ materialId: waxId, quantity: "100", unit: "g" }],
      });
      createdUpdateTemplateIds.add(seeded.template.id);
      expect(seeded.template.unitCost).toBe("1000.000000000000000000");

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
      // launching updateTemplate, so we only release once we know updateTemplate
      // is racing against the held lock.
      const heldTx = db.transaction(async (tx) => {
        await tx
          .update(materials)
          .set({ unitCost: "30.000000000000000000" })
          .where(eq(materials.id, waxId));
        updateDone();
        await releaseUpdatePromise;
      });

      let updated: Awaited<ReturnType<typeof updateTemplate>> | undefined;
      try {
        await updateDonePromise;

        // Start updateTemplate while the held UPDATE still owns the row lock.
        // FOR UPDATE on the template row acquires immediately, then the FOR
        // SHARE snapshot of the owner's materials blocks until the held tx
        // commits. After the held tx commits, updateTemplate reads the new
        // unitCost (30) and the renormalized template cost is 10 * 30 = 300.
        const updatePromise = updateTemplate(ownerId, seeded.template.id, {
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
      expect(updated?.template.unitCost).toBe("300.000000000000000000");
      expect(updated?.template.name).not.toBe(seeded.template.name);
      expect(updated?.items.map(({ quantity }) => quantity)).toEqual(["10"]);

      // The replacement must persist atomically: no stale items remain.
      const persisted = await getTemplate(ownerId, seeded.template.id);
      expect(persisted?.template.unitCost).toBe("300.000000000000000000");
      expect(persisted?.items.map(({ materialId }) => materialId)).toEqual([waxId]);
      expect(persisted?.items.map(({ quantity }) => quantity)).toEqual(["10.000000"]);
    });
  });

  describe("archive and restore", () => {
    const createdArchiveTemplateIds = new Set<string>();
    const createdArchiveMaterialIds = new Set<string>();

    afterEach(async () => {
      const templateIds = [...createdArchiveTemplateIds];
      if (templateIds.length > 0) {
        await db.delete(templateItems).where(inArray(templateItems.templateId, templateIds));
        await db.delete(templates).where(inArray(templates.id, templateIds));
      }
      createdArchiveTemplateIds.clear();
      const materialIds = [...createdArchiveMaterialIds];
      if (materialIds.length > 0) {
        await db.delete(materials).where(inArray(materials.id, materialIds));
      }
      createdArchiveMaterialIds.clear();
    });

    it("archives a template (preserves items, hides from active list) and restores it (returns to active list)", async () => {
      const waxId = crypto.randomUUID();
      const scentId = crypto.randomUUID();
      await db
        .insert(materials)
        .values([
          materialFixture(ownerId, waxId, `wax-${waxId}`, "10.000000000000000000"),
          materialFixture(ownerId, scentId, `scent-${scentId}`, "20.000000000000000000"),
        ]);
      createdArchiveMaterialIds.add(waxId).add(scentId);

      const created = await createTemplate(ownerId, {
        name: `floral-${crypto.randomUUID()}`,
        items: [
          { materialId: waxId, quantity: "100", unit: "g" },
          { materialId: scentId, quantity: "50", unit: "g" },
        ],
      });
      createdArchiveTemplateIds.add(created.template.id);
      expect(created.template.archivedAt).toBeNull();

      // Archive — returns the template with archivedAt populated, items unchanged.
      const archived = await archiveTemplate(ownerId, created.template.id);
      expect(archived.id).toBe(created.template.id);
      expect(archived.archivedAt).toBeInstanceOf(Date);
      expect(archived.unitCost).toBe(created.template.unitCost);
      expect(archived.name).toBe(created.template.name);

      // Active list hides the archived template; all-visibility surfaces it.
      expect((await listTemplates(ownerId)).map(({ template: row }) => row.id)).not.toContain(
        created.template.id,
      );
      expect(
        (await listTemplates(ownerId, { includeArchived: true })).map(
          ({ template: row }) => row.id,
        ),
      ).toContain(created.template.id);

      // getTemplate mirrors the visibility: hidden by default, included when requested.
      expect(await getTemplate(ownerId, created.template.id)).toBeNull();
      const archivedView = await getTemplate(ownerId, created.template.id, {
        includeArchived: true,
      });
      expect(archivedView?.template.archivedAt).toBeInstanceOf(Date);
      expect(archivedView?.items.map(({ materialId }) => materialId)).toEqual([waxId, scentId]);
      expect(archivedView?.items.map(({ quantity }) => quantity)).toEqual([
        "100.000000",
        "50.000000",
      ]);

      // Restore — clears archivedAt; items are preserved verbatim.
      const restored = await restoreTemplate(ownerId, created.template.id);
      expect(restored.id).toBe(created.template.id);
      expect(restored.archivedAt).toBeNull();
      expect(restored.unitCost).toBe(created.template.unitCost);

      // Active list contains the restored template; all-visibility still surfaces it.
      expect((await listTemplates(ownerId)).map(({ template: row }) => row.id)).toContain(
        created.template.id,
      );
      const restoredView = await getTemplate(ownerId, created.template.id);
      expect(restoredView?.template.archivedAt).toBeNull();
      expect(restoredView?.items.map(({ materialId }) => materialId)).toEqual([waxId, scentId]);
      expect(restoredView?.items.map(({ quantity }) => quantity)).toEqual([
        "100.000000",
        "50.000000",
      ]);
    });

    it("rejects archive and restore with NOT_FOUND for cross-owner, wrong-state, and missing templates", async () => {
      const waxId = crypto.randomUUID();
      await db
        .insert(materials)
        .values(materialFixture(ownerId, waxId, `wax-${waxId}`, "10.000000000000000000"));
      createdArchiveMaterialIds.add(waxId);

      const active = await createTemplate(ownerId, {
        name: `active-${crypto.randomUUID()}`,
        items: [{ materialId: waxId, quantity: "100", unit: "g" }],
      });
      createdArchiveTemplateIds.add(active.template.id);

      const archived = await archiveTemplate(ownerId, active.template.id);
      expect(archived.archivedAt).toBeInstanceOf(Date);

      const otherOwnerId = crypto.randomUUID();
      const missingId = crypto.randomUUID();

      // archiveTemplate rejects:
      // - cross-owner (template exists for another owner)
      // - already archived (wrong state — FOR UPDATE only sees active rows)
      // - missing template id
      await expect(archiveTemplate(otherOwnerId, active.template.id)).rejects.toBeInstanceOf(
        TemplateRepositoryError,
      );
      await expect(archiveTemplate(otherOwnerId, active.template.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(archiveTemplate(ownerId, active.template.id)).rejects.toBeInstanceOf(
        TemplateRepositoryError,
      );
      await expect(archiveTemplate(ownerId, active.template.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(archiveTemplate(ownerId, missingId)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      // restoreTemplate rejects:
      // - cross-owner (template exists for another owner)
      // - already active (wrong state — FOR UPDATE only sees archived rows)
      // - missing template id
      await expect(restoreTemplate(otherOwnerId, active.template.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(restoreTemplate(ownerId, missingId)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      // Wrong-state restore on the still-archived template: the only currently
      // valid transition is restore → active; re-archive while archived must
      // also reject (already covered above), then restore flips state, then
      // a second restore while now-active must reject with NOT_FOUND.
      const restored = await restoreTemplate(ownerId, active.template.id);
      expect(restored.archivedAt).toBeNull();
      await expect(restoreTemplate(ownerId, active.template.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      // The original template row must still exist with its items intact after
      // every rejected call.
      const finalView = await getTemplate(ownerId, active.template.id);
      expect(finalView?.template.archivedAt).toBeNull();
      expect(finalView?.items.map(({ materialId }) => materialId)).toEqual([waxId]);
      expect(finalView?.items.map(({ quantity }) => quantity)).toEqual(["100.000000"]);
    });
  });
});
