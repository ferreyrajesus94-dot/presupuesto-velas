import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/client";

const TEST_ID_A = "00000000-0000-0000-0000-0000000000a1";
const TEST_ID_B = "00000000-0000-0000-0000-0000000000a2";
const TEST_EMAIL_A = "pr2d-singleton-a@calculadora-flor-test.invalid";
const TEST_EMAIL_B = "pr2d-singleton-b@calculadora-flor-test.invalid";

/**
 * PR #2d verification-fix CRITICAL #1:
 * the database must enforce at most one app_owner row at table level,
 * independent of any application-layer logic.
 */
describe("app_owner database singleton (integration vs dev branch)", () => {
  beforeAll(async () => {
    await db.execute(sql`DELETE FROM app_owner`);
  });
  afterEach(async () => {
    // Defensive: ensure no test row survives across parallel integration runs.
    await db.execute(sql`DELETE FROM app_owner`);
  });
  afterAll(async () => {
    await db.execute(sql`DELETE FROM app_owner`);
  });

  it("exposes a unique partial index that pins the singleton row", async () => {
    const result = await db.execute(sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'app_owner'
        AND indexname LIKE '%singleton%'
    `);
    const rows = (result as unknown as { rows: { indexname: string; indexdef: string }[] }).rows;
    const names = rows.map((r) => r.indexname);
    // Drizzle generates the constraint name from the index name.
    expect(names).toEqual(
      expect.arrayContaining([expect.stringMatching(/app_owner_singleton_uidx/i)]),
    );
  });

  it("rejects a second app_owner row at the database level (singleton enforced)", async () => {
    await db.execute(
      sql`INSERT INTO app_owner (id, email, singleton) VALUES (${TEST_ID_A}, ${TEST_EMAIL_A}, true)`,
    );
    let captured: unknown = null;
    try {
      await db.execute(
        sql`INSERT INTO app_owner (id, email, singleton) VALUES (${TEST_ID_B}, ${TEST_EMAIL_B}, true)`,
      );
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    const message = (captured as Error).message.toLowerCase();
    // Postgres reports the index name in the duplicate-key error.
    expect(message).toMatch(/duplicate key|unique constraint|singleton/);
  });
});
