import { assertSafeNeonTestDatabase } from "./assert-safe-neon-test-database";

assertSafeNeonTestDatabase();

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/client";
import { appUser } from "../../db/schema";
import { upsertUser } from "../../src/server/repositories/user";

/**
 * PR2.auth-core (Task 2.10) — renamed from `app-owner-singleton.test.ts`
 * (the singleton constraint test deleted in PR1 is gone; this file
 * covers the multi-user bootstrap promotion semantics).
 *
 * The legacy singleton test asserted that exactly one row could exist in
 * `app_owner`. That invariant is gone — many users may exist, and only
 * the bootstrap email is promoted to `role='owner'`. The unit-level
 * promotion matrix lives in `tests/unit/user-repository.test.ts` (mocked
 * `db`); this file exercises the live PG round-trip end-to-end.
 *
 * When run WITHOUT `DATABASE_URL`, the safety check throws and the file
 * reports as a single skipped suite.
 */

const TEST_PREFIX = "app-user-bootstrap-int";
const BOOTSTRAP_EMAIL = "bootstrap-owner@calculadora-flor-test.invalid";

const createdIds = new Set<string>();

async function cleanup() {
  for (const id of createdIds) {
    await db.delete(appUser).where(eq(appUser.id, id));
  }
}

beforeAll(() => {
  // No setup needed; each test inserts and cleans up.
});

afterAll(async () => {
  await cleanup();
});

describe("app user bootstrap promotion (integration, multi-row era)", () => {
  it("admits multiple users in the same table (multi-row era)", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const id = `${TEST_PREFIX}-multi-${i}-${crypto.randomUUID()}`;
      const email = `${id}@calculadora-flor-test.invalid`;
      ids.push(id);
      createdIds.add(id);
      const row = await upsertUser({ id, email, emailVerified: true });
      expect(row.role).toBe("user");
    }
    // All three rows live side-by-side (no singleton constraint).
    const all = await db.select().from(appUser);
    const ours = all.filter((row) => ids.includes(row.id));
    expect(ours).toHaveLength(3);
  });

  it("promotes the bootstrap email to role='owner' idempotently", async () => {
    const previous = process.env.BOOTSTRAP_OWNER_EMAIL;
    process.env.BOOTSTRAP_OWNER_EMAIL = BOOTSTRAP_EMAIL;
    const id = `${TEST_PREFIX}-bs-${crypto.randomUUID()}`;
    createdIds.add(id);

    try {
      // First sign-in: owner row.
      const first = await upsertUser({ id, email: BOOTSTRAP_EMAIL, emailVerified: true });
      expect(first.role).toBe("owner");

      // Re-promotion: stays owner.
      const second = await upsertUser({ id, email: BOOTSTRAP_EMAIL, emailVerified: true });
      expect(second.role).toBe("owner");

      // Third sign-in with the same id is a no-op.
      const third = await upsertUser({ id, email: BOOTSTRAP_EMAIL, emailVerified: true });
      expect(third.role).toBe("owner");
    } finally {
      if (previous === undefined) delete process.env.BOOTSTRAP_OWNER_EMAIL;
      else process.env.BOOTSTRAP_OWNER_EMAIL = previous;
    }
  });

  it("does NOT promote a non-bootstrap email even with emailVerified=true", async () => {
    const previous = process.env.BOOTSTRAP_OWNER_EMAIL;
    process.env.BOOTSTRAP_OWNER_EMAIL = BOOTSTRAP_EMAIL;
    const id = `${TEST_PREFIX}-non-bs-${crypto.randomUUID()}`;
    const email = `${id}@calculadora-flor-test.invalid`;
    createdIds.add(id);

    try {
      const row = await upsertUser({ id, email, emailVerified: true });
      expect(row.role).toBe("user");
    } finally {
      if (previous === undefined) delete process.env.BOOTSTRAP_OWNER_EMAIL;
      else process.env.BOOTSTRAP_OWNER_EMAIL = previous;
    }
  });
});