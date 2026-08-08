/**
 * PR4b.append.intg — integration tests for `appendQuoteVersion` against the
 * `dev-pr2-auth-schema` Neon branch. 6 pinned scenarios:
 * round-trip / atomicity / LOCK_VERSION_MISMATCH / TERMINAL_STATUS /
 * concurrent allocation / row counts. Constraints: dev-branch safety
 * guard; numeric strings; 2-decimal money; FK enforcement; owner scope;
 * concurrent test uses `Promise.allSettled`; stale test reads
 * `quote.lockVersion` first then passes a wrong expectedLockVersion.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildQuoteSnapshot, type QuoteSnapshot } from "../../src/domain/quote";
import { assertSafeNeonTestDatabase } from "./assert-safe-neon-test-database";

assertSafeNeonTestDatabase();

const [
  { db },
  {
    appUser,
    materials,
    quoteStatusEvents,
    quoteVersionIndirectCosts,
    quoteVersionMaterials,
    quoteVersionModels,
    quoteVersions,
    quotes,
    templateItems,
    templates,
  },
  { appendQuoteVersion, createQuoteDraft, QuoteRepositoryError },
] = await Promise.all([
  import("../../db/client"),
  import("../../db/schema"),
  import("../../src/server/repositories/quotes"),
]);

/**
 * PR1.migration dropped the `app_owner.singleton` column. Replicate the
 * singleton lookup against `app_user.role='owner'` so this test stays
 * compatible with the post-PR1 schema. PR2 rewrites these fixtures under
 * the new user repository (see `tasks.md` task 2.10).
 */
async function getOwnerSingleton(): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: appUser.id })
    .from(appUser)
    .where(eq(appUser.role, "owner"))
    .limit(1);
  return rows[0] ?? null;
}

describe("appendQuoteVersion (integration vs dev branch)", () => {
  let userId = "";
  let createdOwner = false;
  const quoteIds = new Set<string>();
  const templateIds = new Set<string>();
  const materialIds = new Set<string>();

  beforeAll(async () => {
    const user = await getOwnerSingleton();
    if (user) {
      userId = user.id;
      return;
    }
    userId = crypto.randomUUID();
    await db.insert(appUser).values({
      id: userId,
      email: `${userId}@calculadora-flor-test.invalid`,
      role: "owner",
      emailVerified: true,
    });
    createdOwner = true;
  });

  async function sweep(): Promise<void> {
    const qIds = [...quoteIds];
    if (qIds.length > 0) {
      // quote_status_events has no FK cascade; quote_versions cascades
      // to all three quote_version_* child tables.
      await db.delete(quoteStatusEvents).where(inArray(quoteStatusEvents.quoteId, qIds));
      await db.delete(quoteVersions).where(inArray(quoteVersions.quoteId, qIds));
      await db.delete(quotes).where(inArray(quotes.id, qIds));
    }
    const tIds = [...templateIds];
    if (tIds.length > 0) {
      await db.delete(templateItems).where(inArray(templateItems.templateId, tIds));
      await db.delete(templates).where(inArray(templates.id, tIds));
    }
    if (materialIds.size > 0)
      await db.delete(materials).where(inArray(materials.id, [...materialIds]));
  }

  afterEach(async () => {
    await sweep();
    quoteIds.clear();
    templateIds.clear();
    materialIds.clear();
  });

  afterAll(async () => {
    // Belt-and-suspenders after the last afterEach plus singleton cleanup.
    await sweep();
    if (createdOwner) await db.delete(appUser).where(eq(appUser.id, userId));
  });

  // Tiny 1-model / 0-indirect / fixed-0-profit snapshot for fast tests.
  function snap(recipeId: string, quantity: string, perUnitCost: string): QuoteSnapshot {
    return buildQuoteSnapshot({
      models: [{ recipeId, quantity, perUnitCostDecimal: perUnitCost }],
      indirectCosts: [],
      profit: { mode: "fixed", amount: "0" },
      depositPercent: "0",
      expirationDate: "2026-12-31",
    });
  }

  async function seedSimpleTemplate(
    materialCost: string,
    templateCost: string,
  ): Promise<{ templateId: string; materialId: string }> {
    const materialId = crypto.randomUUID();
    const templateId = crypto.randomUUID();
    await db.insert(materials).values([
      {
        id: materialId,
        userId,
        name: `m-${materialId}`,
        dimension: "mass" as const,
        baseUnit: "g",
        purchaseUnit: "kg",
        purchaseQuantity: "1",
        purchasePrice: materialCost,
        unitCost: materialCost,
      },
    ]);
    materialIds.add(materialId);
    await db
      .insert(templates)
      .values([{ id: templateId, userId, name: `r-${templateId}`, unitCost: templateCost }]);
    templateIds.add(templateId);
    await db.insert(templateItems).values([
      {
        id: crypto.randomUUID(),
        templateId,
        materialId,
        position: 1,
        quantity: "10",
      },
    ]);
    return { templateId, materialId };
  }

  async function createDraft(): Promise<string> {
    const { quote } = await createQuoteDraft(userId, { expirationDate: "2026-12-31" });
    quoteIds.add(quote.id);
    return quote.id;
  }

  // 1. round-trip --------------------------------------------------------
  it("round-trips: appendQuoteVersion returns the bumped quote and the persisted version row", async () => {
    const { templateId } = await seedSimpleTemplate(
      "10.000000000000000000",
      "100.000000000000000000",
    );
    const quoteId = await createDraft();

    const r1 = await appendQuoteVersion(userId, quoteId, snap(templateId, "2", "100"), 0);
    expect(r1.quote.id).toBe(quoteId);
    expect(r1.quote.userId).toBe(userId);
    expect(r1.quote.currentVersion).toBe(1);
    expect(r1.quote.lockVersion).toBe(1);
    expect(r1.quote.status).toBe("draft");
    expect(r1.version.quoteId).toBe(quoteId);
    expect(r1.version.versionNo).toBe(1);
    expect(r1.version.profitMethod).toBe("fixed");
    expect(r1.version.finalPrice).toBe("200.00");
    expect(r1.version.materialsTotal).toBe("200.00");

    const persisted = await db
      .select()
      .from(quoteVersions)
      .where(and(eq(quoteVersions.quoteId, quoteId), eq(quoteVersions.versionNo, 1)));
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      quoteId,
      versionNo: 1,
      profitMethod: "fixed",
      finalPrice: "200.00",
      materialsTotal: "200.00",
    });
  });

  // 2. atomicity ---------------------------------------------------------
  it("atomicity: currentVersion and lockVersion bump together inside the transaction", async () => {
    const { templateId } = await seedSimpleTemplate(
      "5.000000000000000000",
      "50.000000000000000000",
    );
    const quoteId = await createDraft();
    const r1 = await appendQuoteVersion(userId, quoteId, snap(templateId, "1", "5000"), 0);
    expect(r1.quote.currentVersion).toBe(1);
    expect(r1.quote.lockVersion).toBe(1);
    // The transaction bumped both counters in one UPDATE — the returned
    // quote must reflect them equal. We do not compare updatedAt:
    // Postgres `defaultNow()` runs on the DB server clock; `new Date()`
    // inside the transaction runs on the test runner's clock. They can
    // legitimately differ by seconds across machines.
    expect(r1.quote.currentVersion).toBe(r1.quote.lockVersion);
    const row = (await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1))[0]!;
    expect(row.currentVersion).toBe(1);
    expect(row.lockVersion).toBe(1);
  });

  // 3. LOCK_VERSION_MISMATCH ---------------------------------------------
  it("rejects LOCK_VERSION_MISMATCH for a stale expectedLockVersion (read-then-bump-then-stale-call)", async () => {
    const { templateId } = await seedSimpleTemplate(
      "10.000000000000000000",
      "100.000000000000000000",
    );
    const quoteId = await createDraft();
    const s = snap(templateId, "1", "100");

    await appendQuoteVersion(userId, quoteId, s, 0); // 0 → 1
    const after1 = (await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1))[0]!;
    expect(after1.lockVersion).toBe(1);

    // A parallel call bumps to lockVersion=2; then we attempt V3 with the
    // now-stale expectedLockVersion=1 → LOCK_VERSION_MISMATCH.
    await appendQuoteVersion(userId, quoteId, s, after1.lockVersion);
    await expect(appendQuoteVersion(userId, quoteId, s, 1)).rejects.toBeInstanceOf(
      QuoteRepositoryError,
    );
    await expect(appendQuoteVersion(userId, quoteId, s, 1)).rejects.toMatchObject({
      code: "LOCK_VERSION_MISMATCH",
    });
  });

  // 4. TERMINAL_STATUS ---------------------------------------------------
  it("rejects TERMINAL_STATUS after the quote is manually flipped to accepted", async () => {
    const { templateId } = await seedSimpleTemplate(
      "10.000000000000000000",
      "100.000000000000000000",
    );
    const quoteId = await createDraft();
    const s = snap(templateId, "1", "100");

    await appendQuoteVersion(userId, quoteId, s, 0);
    // Status FSM transaction is deferred to PR4c; mutate the row directly
    // to exercise the terminal-status guard inside appendQuoteVersion.
    await db
      .update(quotes)
      .set({ status: "accepted" })
      .where(and(eq(quotes.id, quoteId), eq(quotes.userId, userId)));
    const fresh = (await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1))[0]!;
    expect(fresh.status).toBe("accepted");
    expect(fresh.lockVersion).toBe(1);

    await expect(appendQuoteVersion(userId, quoteId, s, fresh.lockVersion)).rejects.toBeInstanceOf(
      QuoteRepositoryError,
    );
    await expect(appendQuoteVersion(userId, quoteId, s, fresh.lockVersion)).rejects.toMatchObject({
      code: "TERMINAL_STATUS",
    });

    // Atomicity: no new version rows were written.
    const versions = await db
      .select({ versionNo: quoteVersions.versionNo })
      .from(quoteVersions)
      .where(eq(quoteVersions.quoteId, quoteId));
    expect(versions.map((v) => v.versionNo)).toEqual([1]);
  });

  // 5. concurrent allocation --------------------------------------------
  it("concurrent allocation: two parallel calls produce unique, sequential versionNo's", async () => {
    const { templateId } = await seedSimpleTemplate(
      "10.000000000000000000",
      "100.000000000000000000",
    );
    const quoteId = await createDraft();
    const s = snap(templateId, "1", "100");

    // Two parallel calls with the same expectedLockVersion=0. SELECT FOR
    // UPDATE serializes them; the optimistic concurrency guard rejects
    // exactly one with LOCK_VERSION_MISMATCH (the lockVersion has moved
    // by the time the second sees it).
    const [p1, p2] = await Promise.allSettled([
      appendQuoteVersion(userId, quoteId, s, 0),
      appendQuoteVersion(userId, quoteId, s, 0),
    ]);
    const fulfilled = [p1, p2].filter(
      (v): v is PromiseFulfilledResult<Awaited<ReturnType<typeof appendQuoteVersion>>> =>
        v.status === "fulfilled",
    );
    const rejected = [p1, p2].filter((v): v is PromiseRejectedResult => v.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(QuoteRepositoryError);
    expect(rejected[0]!.reason).toMatchObject({ code: "LOCK_VERSION_MISMATCH" });
    expect(fulfilled[0]!.value.version.versionNo).toBe(1);

    // Refresh lockVersion from the DB and retry the rejected call → V2.
    const fresh = (await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1))[0]!;
    expect(fresh.lockVersion).toBe(1);
    expect(fresh.currentVersion).toBe(1);
    const retried = await appendQuoteVersion(userId, quoteId, s, fresh.lockVersion);
    expect(retried.version.versionNo).toBe(2);
    expect(retried.quote.currentVersion).toBe(2);
    expect(retried.quote.lockVersion).toBe(2);

    const allVersions = await db
      .select({ versionNo: quoteVersions.versionNo })
      .from(quoteVersions)
      .where(eq(quoteVersions.quoteId, quoteId))
      .orderBy(asc(quoteVersions.versionNo));
    expect(allVersions.map((v) => v.versionNo)).toEqual([1, 2]);
  });

  // 6. row counts --------------------------------------------------------
  it("row counts: 2 models × 3 materials + 2 indirects ⇒ exactly 2 / 6 / 2 child rows", async () => {
    const templateA = crypto.randomUUID();
    const templateB = crypto.randomUUID();
    const matA = crypto.randomUUID();
    const matB = crypto.randomUUID();
    const matC = crypto.randomUUID();
    await db.insert(materials).values([
      {
        id: matA,
        userId,
        name: `wax-${matA}`,
        dimension: "mass" as const,
        baseUnit: "g",
        purchaseUnit: "kg",
        purchaseQuantity: "1",
        purchasePrice: "10.000000000000000000",
        unitCost: "10.000000000000000000",
      },
      {
        id: matB,
        userId,
        name: `scent-${matB}`,
        dimension: "mass" as const,
        baseUnit: "g",
        purchaseUnit: "kg",
        purchaseQuantity: "1",
        purchasePrice: "20.000000000000000000",
        unitCost: "20.000000000000000000",
      },
      {
        id: matC,
        userId,
        name: `wick-${matC}`,
        dimension: "mass" as const,
        baseUnit: "g",
        purchaseUnit: "kg",
        purchaseQuantity: "1",
        purchasePrice: "5.000000000000000000",
        unitCost: "5.000000000000000000",
      },
    ]);
    [matA, matB, matC].forEach((x) => materialIds.add(x));

    // Two templates × 3 ordered items each ⇒ 6 template_items total. The
    // snapshot maps model A → template A (3 materials) and model B → template B
    // (3 materials), producing 6 quoteVersionMaterials rows.
    await db.insert(templates).values([
      { id: templateA, userId, name: `r-${templateA}`, unitCost: "300.000000000000000000" },
      { id: templateB, userId, name: `r-${templateB}`, unitCost: "600.000000000000000000" },
    ]);
    templateIds.add(templateA).add(templateB);
    await db.insert(templateItems).values([
      {
        id: crypto.randomUUID(),
        templateId: templateA,
        materialId: matA,
        position: 1,
        quantity: "10",
      },
      {
        id: crypto.randomUUID(),
        templateId: templateA,
        materialId: matB,
        position: 2,
        quantity: "5",
      },
      {
        id: crypto.randomUUID(),
        templateId: templateA,
        materialId: matC,
        position: 3,
        quantity: "3",
      },
      {
        id: crypto.randomUUID(),
        templateId: templateB,
        materialId: matA,
        position: 1,
        quantity: "20",
      },
      {
        id: crypto.randomUUID(),
        templateId: templateB,
        materialId: matB,
        position: 2,
        quantity: "10",
      },
      {
        id: crypto.randomUUID(),
        templateId: templateB,
        materialId: matC,
        position: 3,
        quantity: "6",
      },
    ]);

    const quoteId = await createDraft();
    const s: QuoteSnapshot = buildQuoteSnapshot({
      models: [
        { recipeId: templateA, quantity: "2", perUnitCostDecimal: "300" },
        { recipeId: templateB, quantity: "1", perUnitCostDecimal: "600" },
      ],
      indirectCosts: [
        { name: "labor", amount: "50" },
        { name: "waste", amount: "20" },
      ],
      profit: { mode: "percentage", percent: "30" },
      depositPercent: "50",
      expirationDate: "2026-12-31",
    });

    const r1 = await appendQuoteVersion(userId, quoteId, s, 0);
    expect(r1.version.versionNo).toBe(1);

    const models = await db
      .select()
      .from(quoteVersionModels)
      .where(and(eq(quoteVersionModels.quoteId, quoteId), eq(quoteVersionModels.versionNo, 1)));
    expect(models).toHaveLength(2);
    expect(models.map((m) => m.position)).toEqual([1, 2]);
    expect(models.map((m) => m.templateId)).toEqual([templateA, templateB]);

    const matRows = await db
      .select()
      .from(quoteVersionMaterials)
      .where(
        and(eq(quoteVersionMaterials.quoteId, quoteId), eq(quoteVersionMaterials.versionNo, 1)),
      );
    expect(matRows).toHaveLength(6);

    const indirects = await db
      .select()
      .from(quoteVersionIndirectCosts)
      .where(
        and(
          eq(quoteVersionIndirectCosts.quoteId, quoteId),
          eq(quoteVersionIndirectCosts.versionNo, 1),
        ),
      )
      .orderBy(asc(quoteVersionIndirectCosts.position));
    expect(indirects).toHaveLength(2);
    expect(indirects.map((i) => i.name)).toEqual(["labor", "waste"]);
  });
});
