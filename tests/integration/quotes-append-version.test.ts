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
    appOwner,
    materials,
    quoteStatusEvents,
    quoteVersionIndirectCosts,
    quoteVersionMaterials,
    quoteVersionModels,
    quoteVersions,
    quotes,
    recipeItems,
    recipes,
  },
  { getSingletonOwner },
  { appendQuoteVersion, createQuoteDraft, QuoteRepositoryError },
] = await Promise.all([
  import("../../db/client"),
  import("../../db/schema"),
  import("../../src/server/repositories/owner"),
  import("../../src/server/repositories/quotes"),
]);

describe("appendQuoteVersion (integration vs dev branch)", () => {
  let ownerId = "";
  let createdOwner = false;
  const quoteIds = new Set<string>();
  const recipeIds = new Set<string>();
  const materialIds = new Set<string>();

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

  async function sweep(): Promise<void> {
    const qIds = [...quoteIds];
    if (qIds.length > 0) {
      // quote_status_events has no FK cascade; quote_versions cascades
      // to all three quote_version_* child tables.
      await db.delete(quoteStatusEvents).where(inArray(quoteStatusEvents.quoteId, qIds));
      await db.delete(quoteVersions).where(inArray(quoteVersions.quoteId, qIds));
      await db.delete(quotes).where(inArray(quotes.id, qIds));
    }
    const rIds = [...recipeIds];
    if (rIds.length > 0) {
      await db.delete(recipeItems).where(inArray(recipeItems.recipeId, rIds));
      await db.delete(recipes).where(inArray(recipes.id, rIds));
    }
    if (materialIds.size > 0)
      await db.delete(materials).where(inArray(materials.id, [...materialIds]));
  }

  afterEach(async () => {
    await sweep();
    quoteIds.clear();
    recipeIds.clear();
    materialIds.clear();
  });

  afterAll(async () => {
    // Belt-and-suspenders after the last afterEach plus singleton cleanup.
    await sweep();
    if (createdOwner) await db.delete(appOwner).where(eq(appOwner.id, ownerId));
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

  async function seedSimpleRecipe(
    materialCost: string,
    recipeCost: string,
  ): Promise<{ recipeId: string; materialId: string }> {
    const materialId = crypto.randomUUID();
    const recipeId = crypto.randomUUID();
    await db.insert(materials).values([
      {
        id: materialId,
        ownerId,
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
      .insert(recipes)
      .values([{ id: recipeId, ownerId, name: `r-${recipeId}`, unitCost: recipeCost }]);
    recipeIds.add(recipeId);
    await db.insert(recipeItems).values([
      {
        id: crypto.randomUUID(),
        recipeId,
        materialId,
        position: 1,
        quantity: "10",
      },
    ]);
    return { recipeId, materialId };
  }

  async function createDraft(): Promise<string> {
    const { quote } = await createQuoteDraft(ownerId, { expirationDate: "2026-12-31" });
    quoteIds.add(quote.id);
    return quote.id;
  }

  // 1. round-trip --------------------------------------------------------
  it("round-trips: appendQuoteVersion returns the bumped quote and the persisted version row", async () => {
    const { recipeId } = await seedSimpleRecipe("10.000000000000000000", "100.000000000000000000");
    const quoteId = await createDraft();

    const r1 = await appendQuoteVersion(ownerId, quoteId, snap(recipeId, "2", "100"), 0);
    expect(r1.quote.id).toBe(quoteId);
    expect(r1.quote.ownerId).toBe(ownerId);
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
    const { recipeId } = await seedSimpleRecipe("5.000000000000000000", "50.000000000000000000");
    const quoteId = await createDraft();
    const r1 = await appendQuoteVersion(ownerId, quoteId, snap(recipeId, "1", "5000"), 0);
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
    const { recipeId } = await seedSimpleRecipe("10.000000000000000000", "100.000000000000000000");
    const quoteId = await createDraft();
    const s = snap(recipeId, "1", "100");

    await appendQuoteVersion(ownerId, quoteId, s, 0); // 0 → 1
    const after1 = (await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1))[0]!;
    expect(after1.lockVersion).toBe(1);

    // A parallel call bumps to lockVersion=2; then we attempt V3 with the
    // now-stale expectedLockVersion=1 → LOCK_VERSION_MISMATCH.
    await appendQuoteVersion(ownerId, quoteId, s, after1.lockVersion);
    await expect(appendQuoteVersion(ownerId, quoteId, s, 1)).rejects.toBeInstanceOf(
      QuoteRepositoryError,
    );
    await expect(appendQuoteVersion(ownerId, quoteId, s, 1)).rejects.toMatchObject({
      code: "LOCK_VERSION_MISMATCH",
    });
  });

  // 4. TERMINAL_STATUS ---------------------------------------------------
  it("rejects TERMINAL_STATUS after the quote is manually flipped to accepted", async () => {
    const { recipeId } = await seedSimpleRecipe("10.000000000000000000", "100.000000000000000000");
    const quoteId = await createDraft();
    const s = snap(recipeId, "1", "100");

    await appendQuoteVersion(ownerId, quoteId, s, 0);
    // Status FSM transaction is deferred to PR4c; mutate the row directly
    // to exercise the terminal-status guard inside appendQuoteVersion.
    await db
      .update(quotes)
      .set({ status: "accepted" })
      .where(and(eq(quotes.id, quoteId), eq(quotes.ownerId, ownerId)));
    const fresh = (await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1))[0]!;
    expect(fresh.status).toBe("accepted");
    expect(fresh.lockVersion).toBe(1);

    await expect(appendQuoteVersion(ownerId, quoteId, s, fresh.lockVersion)).rejects.toBeInstanceOf(
      QuoteRepositoryError,
    );
    await expect(appendQuoteVersion(ownerId, quoteId, s, fresh.lockVersion)).rejects.toMatchObject({
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
    const { recipeId } = await seedSimpleRecipe("10.000000000000000000", "100.000000000000000000");
    const quoteId = await createDraft();
    const s = snap(recipeId, "1", "100");

    // Two parallel calls with the same expectedLockVersion=0. SELECT FOR
    // UPDATE serializes them; the optimistic concurrency guard rejects
    // exactly one with LOCK_VERSION_MISMATCH (the lockVersion has moved
    // by the time the second sees it).
    const [p1, p2] = await Promise.allSettled([
      appendQuoteVersion(ownerId, quoteId, s, 0),
      appendQuoteVersion(ownerId, quoteId, s, 0),
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
    const retried = await appendQuoteVersion(ownerId, quoteId, s, fresh.lockVersion);
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
    const recipeA = crypto.randomUUID();
    const recipeB = crypto.randomUUID();
    const matA = crypto.randomUUID();
    const matB = crypto.randomUUID();
    const matC = crypto.randomUUID();
    await db.insert(materials).values([
      {
        id: matA,
        ownerId,
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
        ownerId,
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
        ownerId,
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

    // Two recipes × 3 ordered items each ⇒ 6 recipe_items total. The
    // snapshot maps model A → recipe A (3 materials) and model B → recipe B
    // (3 materials), producing 6 quoteVersionMaterials rows.
    await db.insert(recipes).values([
      { id: recipeA, ownerId, name: `r-${recipeA}`, unitCost: "300.000000000000000000" },
      { id: recipeB, ownerId, name: `r-${recipeB}`, unitCost: "600.000000000000000000" },
    ]);
    recipeIds.add(recipeA).add(recipeB);
    await db.insert(recipeItems).values([
      { id: crypto.randomUUID(), recipeId: recipeA, materialId: matA, position: 1, quantity: "10" },
      { id: crypto.randomUUID(), recipeId: recipeA, materialId: matB, position: 2, quantity: "5" },
      { id: crypto.randomUUID(), recipeId: recipeA, materialId: matC, position: 3, quantity: "3" },
      { id: crypto.randomUUID(), recipeId: recipeB, materialId: matA, position: 1, quantity: "20" },
      { id: crypto.randomUUID(), recipeId: recipeB, materialId: matB, position: 2, quantity: "10" },
      { id: crypto.randomUUID(), recipeId: recipeB, materialId: matC, position: 3, quantity: "6" },
    ]);

    const quoteId = await createDraft();
    const s: QuoteSnapshot = buildQuoteSnapshot({
      models: [
        { recipeId: recipeA, quantity: "2", perUnitCostDecimal: "300" },
        { recipeId: recipeB, quantity: "1", perUnitCostDecimal: "600" },
      ],
      indirectCosts: [
        { name: "labor", amount: "50" },
        { name: "waste", amount: "20" },
      ],
      profit: { mode: "percentage", percent: "30" },
      depositPercent: "50",
      expirationDate: "2026-12-31",
    });

    const r1 = await appendQuoteVersion(ownerId, quoteId, s, 0);
    expect(r1.version.versionNo).toBe(1);

    const models = await db
      .select()
      .from(quoteVersionModels)
      .where(and(eq(quoteVersionModels.quoteId, quoteId), eq(quoteVersionModels.versionNo, 1)));
    expect(models).toHaveLength(2);
    expect(models.map((m) => m.position)).toEqual([1, 2]);
    expect(models.map((m) => m.recipeId)).toEqual([recipeA, recipeB]);

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
