import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeNeonTestDatabase } from "./assert-safe-neon-test-database";

assertSafeNeonTestDatabase();

const { db } = await import("../../db/client");

const TEST_OWNER_ID = "00000000-0000-0000-0000-0000000000b1";

/**
 * PR #2d verification-fix CRITICAL #3:
 * compatible-units and count-integrality CHECKs must reject bad inputs.
 * The unit/count test is intentionally DB-level (no application code path
 * exists yet) so that the schema invariant is independently enforceable.
 */
describe("materials schema CHECKs (integration vs dev branch)", () => {
  beforeAll(async () => {
    await db.execute(sql`DELETE FROM materials WHERE owner_id = ${TEST_OWNER_ID}`);
    // Seed a singleton owner only if none exists (singleton constraint).
    await db.execute(
      sql`INSERT INTO app_owner (id, email, singleton) VALUES (${TEST_OWNER_ID}, 'pr2d-mat@calculadora-flor-test.invalid', true) ON CONFLICT ((TRUE)) WHERE singleton = TRUE DO NOTHING`,
    );
  });
  afterAll(async () => {
    await db.execute(sql`DELETE FROM materials WHERE owner_id = ${TEST_OWNER_ID}`);
    await db.execute(sql`DELETE FROM app_owner WHERE id = ${TEST_OWNER_ID}`);
  });

  it("rejects a material with incompatible base/purchase unit dimensions", async () => {
    let captured: unknown = null;
    try {
      await db.execute(
        sql`INSERT INTO materials
            (id, owner_id, name, dimension, base_unit, purchase_unit, purchase_quantity, purchase_price, unit_cost)
            VALUES ('mat-bad-1', ${TEST_OWNER_ID}, 'bad-units',
                    'mass', 'g', 'L', 1, 10, 10)`,
      );
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    // Drizzle wraps the Postgres error; the constraint name surfaces in the cause chain.
    const chain: string[] = [];
    let e: unknown = captured;
    while (e && typeof e === "object" && "message" in e) {
      chain.push(String((e as { message: unknown }).message));
      e = (e as { cause?: unknown }).cause;
      if (chain.length > 5) break;
    }
    const haystack = chain.join(" | ").toLowerCase();
    expect(haystack).toMatch(/materials_units_compatible|check constraint/);
  });

  it("rejects a material with fractional purchase quantity on the count dimension", async () => {
    let captured: unknown = null;
    try {
      await db.execute(
        sql`INSERT INTO materials
            (id, owner_id, name, dimension, base_unit, purchase_unit, purchase_quantity, purchase_price, unit_cost)
            VALUES ('mat-bad-2', ${TEST_OWNER_ID}, 'bad-count',
                    'count', 'unit', 'unit', 1.5, 10, 6.666666666666666667)`,
      );
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    const chain: string[] = [];
    let e: unknown = captured;
    while (e && typeof e === "object" && "message" in e) {
      chain.push(String((e as { message: unknown }).message));
      e = (e as { cause?: unknown }).cause;
      if (chain.length > 5) break;
    }
    const haystack = chain.join(" | ").toLowerCase();
    expect(haystack).toMatch(/materials_count_integral|check constraint/);
  });

  it("accepts a material with a compatible count dimension (sanity)", async () => {
    await db.execute(
      sql`INSERT INTO materials
          (id, owner_id, name, dimension, base_unit, purchase_unit, purchase_quantity, purchase_price, unit_cost)
          VALUES ('mat-ok-1', ${TEST_OWNER_ID}, 'ok-count',
                  'count', 'unit', 'unit', 2, 10, 5)`,
    );
    const result = (await db.execute(
      sql`SELECT name FROM materials WHERE id = 'mat-ok-1'`,
    )) as unknown as { rows: { name: string }[] };
    expect(result.rows[0]?.name).toBe("ok-count");
  });
});
