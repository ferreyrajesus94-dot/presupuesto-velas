import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeNeonTestDatabase } from "./assert-safe-neon-test-database";

/**
 * PR4.per-user-isolation (Task 4.1) — RED-first integration test for
 * per-user data isolation across the three catalogs the spec names:
 * `materials`, `templates`, `quotes`. Runs against `dev-pr2-auth-schema`
 * only; when `DATABASE_URL` is not set the suite skips with a documented
 * reason so the build stays green on workstations without DB access.
 *
 * Spec coverage (auth-public-signup/spec §4 ISOLATION):
 *   - User A creates a material → User B's list returns zero rows
 *   - User A creates a template → User B's detail returns NOT_FOUND
 *   - User A creates a quote    → User B's delete returns not-found
 *   - User A's list returns only User A's rows
 *
 * Repository contract verified here: cross-user detail reads return
 * `null`, cross-user writes throw a typed NOT_FOUND error. No 401/403
 * variant — that would let an attacker enumerate ids.
 */

const HAS_DATABASE = Boolean(process.env.DATABASE_URL?.trim());
const itDb = HAS_DATABASE ? it : it.skip;

if (!HAS_DATABASE) {
  console.warn(
    "[data-isolation] DATABASE_URL not set — skipping integration suite " +
      "(PR4.1 spec coverage requires dev-pr2-auth-schema).",
  );
} else {
  assertSafeNeonTestDatabase();
}

type SuiteContext = Awaited<typeof import("./data-isolation-context")>;

const suiteCtx: Promise<SuiteContext | null> = HAS_DATABASE
  ? import("./data-isolation-context")
  : Promise.resolve(null);

describe("PR4.1 — per-user data isolation (materials / templates / quotes)", () => {
  let userA = "";
  let userB = "";
  const materialIds = new Set<string>();
  const templateIds = new Set<string>();
  const quoteIds = new Set<string>();
  const createdUserIds = new Set<string>();
  let ctx: SuiteContext | null = null;

  beforeAll(async () => {
    const resolved = await suiteCtx;
    if (!resolved) {
      throw new Error(
        "suite context failed to load — DATABASE_URL is set but context import failed",
      );
    }
    ctx = resolved;
    userA = await ctx.createTestUser("user-a");
    userB = await ctx.createTestUser("user-b");
    createdUserIds.add(userA);
    createdUserIds.add(userB);
  });

  afterAll(async () => {
    if (!ctx) return;
    await ctx.cleanup({ userA, materialIds, templateIds, quoteIds, createdUserIds });
  });

  function getCtx(): SuiteContext {
    if (!ctx) throw new Error("ctx unavailable — test should be skipped");
    return ctx;
  }

  itDb("User A creates a material → User B's list returns zero rows", async () => {
    const c = getCtx();
    const material = await c.materials.createMaterial(userA, {
      name: `wax-${c.uniqueId()}`,
      dimension: "mass",
      baseUnit: "g",
      purchaseUnit: "kg",
      purchaseQuantity: "1",
      purchasePrice: "10000",
    });
    materialIds.add(material.id);
    const userBList = await c.materials.listMaterials(userB);
    expect(userBList.find((m) => m.id === material.id)).toBeUndefined();
    expect(userBList).toHaveLength(0);
  });

  itDb("User A creates a template → User B's detail returns null", async () => {
    const c = getCtx();
    const template = await c.templates.createBlankTemplate(userA, `tpl-${c.uniqueId()}`);
    templateIds.add(template.id);
    expect(await c.templates.getTemplate(userB, template.id)).toBeNull();
  });

  itDb("User A creates a quote → User B's delete returns NOT_FOUND", async () => {
    const c = getCtx();
    const record = await c.quotes.createQuoteDraft(userA, { expirationDate: "2099-12-31" });
    quoteIds.add(record.quote.id);
    const userBDelete = await c.quotes.deleteQuoteDraft(userB, record.quote.id);
    expect(userBDelete.ok).toBe(false);
    if (userBDelete.ok) return;
    expect(userBDelete.error.code).toBe("NOT_FOUND");
    // Quote still exists for User A — cross-user delete touched nothing.
    expect(await c.quotes.getQuote(userA, record.quote.id)).not.toBeNull();
  });

  itDb("User A's list contains only User A's rows after a cross-user create", async () => {
    const c = getCtx();
    const materialA = await c.materials.createMaterial(userA, {
      name: `wax-iso-${c.uniqueId()}`,
      dimension: "mass",
      baseUnit: "g",
      purchaseUnit: "kg",
      purchaseQuantity: "1",
      purchasePrice: "10000",
    });
    materialIds.add(materialA.id);
    const userAList = await c.materials.listMaterials(userA);
    expect(userAList.some((m) => m.id === materialA.id)).toBe(true);
    expect(userAList.every((m) => m.userId === userA)).toBe(true);
  });

  itDb("Cross-user detail reads return null — no id enumeration via 401/403", async () => {
    const c = getCtx();
    const materialA = await c.materials.createMaterial(userA, {
      name: `wax-detail-${c.uniqueId()}`,
      dimension: "mass",
      baseUnit: "g",
      purchaseUnit: "kg",
      purchaseQuantity: "1",
      purchasePrice: "10000",
    });
    materialIds.add(materialA.id);
    expect(await c.materials.getMaterial(userB, materialA.id)).toBeNull();
  });

  itDb("Cross-user writes throw typed NOT_FOUND (no UNAUTHORIZED variant)", async () => {
    const c = getCtx();
    const materialA = await c.materials.createMaterial(userA, {
      name: `wax-archive-${c.uniqueId()}`,
      dimension: "mass",
      baseUnit: "g",
      purchaseUnit: "kg",
      purchaseQuantity: "1",
      purchasePrice: "10000",
    });
    materialIds.add(materialA.id);
    let captured: unknown;
    try {
      await c.materials.archiveMaterial(userB, materialA.id);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(c.materials.MaterialRepositoryError);
    const err = captured as InstanceType<typeof c.materials.MaterialRepositoryError>;
    expect(err.code).toBe("NOT_FOUND");
  });

  itDb("Cross-user template delete throws typed NOT_FOUND", async () => {
    const c = getCtx();
    const template = await c.templates.createBlankTemplate(userA, `tpl-del-${c.uniqueId()}`);
    templateIds.add(template.id);
    let captured: unknown;
    try {
      await c.templates.deleteTemplateRow(userB, template.id);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(c.templates.TemplateRepositoryError);
    const err = captured as InstanceType<typeof c.templates.TemplateRepositoryError>;
    expect(err.code).toBe("NOT_FOUND");
  });
});
