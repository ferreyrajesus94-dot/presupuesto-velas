import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/client";
import { appOwner } from "../../db/schema";
import { getOwner, getSingletonOwner, upsertOwner } from "../../src/server/repositories/owner";

const TEST_ID = "00000000-0000-0000-0000-000000000099";
const TEST_EMAIL = "pr2-it-owner@calculadora-flor-test.invalid";

describe("owner repository (integration vs dev branch)", () => {
  beforeAll(async () => {
    await db.delete(appOwner).where(eq(appOwner.id, TEST_ID));
  });
  afterAll(async () => {
    await db.delete(appOwner).where(eq(appOwner.id, TEST_ID));
  });

  it("upserts a singleton owner, reads it back, and is idempotent", async () => {
    const created = await upsertOwner({ id: TEST_ID, email: TEST_EMAIL });
    expect(created.id).toBe(TEST_ID);
    expect(created.email).toBe(TEST_EMAIL);
    expect(created.singleton).toBe(true);

    const byId = await getOwner(TEST_ID);
    expect(byId?.email).toBe(TEST_EMAIL);

    const singleton = await getSingletonOwner();
    expect(singleton?.id).toBe(TEST_ID);

    // second upsert updates email and is still a singleton
    const updated = await upsertOwner({
      id: TEST_ID,
      email: TEST_EMAIL.replace("pr2-it", "pr2-it-2"),
    });
    expect(updated.email).toBe(TEST_EMAIL.replace("pr2-it", "pr2-it-2"));
    const singletonAgain = await getSingletonOwner();
    expect(singletonAgain?.id).toBe(TEST_ID);
  });
});
