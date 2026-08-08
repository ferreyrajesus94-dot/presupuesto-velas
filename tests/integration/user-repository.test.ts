import { assertSafeNeonTestDatabase } from "./assert-safe-neon-test-database";

// Guard: integration test requires a real Neon DB with `app_user` already
// migrated by PR1. Without `DATABASE_URL` the test refuses to run.
assertSafeNeonTestDatabase();

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/client";
import { appUser } from "../../db/schema";
import {
  getUser,
  getUserByEmail,
  upsertUser,
} from "../../src/server/repositories/user";

/**
 * PR2.auth-core (Task 2.10) — renamed from `owner-repository.test.ts` (the
 * singleton constraint test deleted in PR1 is gone; this file covers the
 * user-era multi-row semantics instead).
 *
 * The file is intentionally hand-rolled against the live Neon branch —
 * `tests/integration/assert-safe-neon-test-database` blocks accidental
 * local-Neon writes. The unit-level bootstrap promotion matrix lives in
 * `tests/unit/user-repository.test.ts` (mocked `db`). Here we assert the
 * real PG round-trip:
 *   - `upsertUser` is idempotent on `(id)` re-call
 *   - `getUser(id)` / `getUserByEmail(email)` return the same row
 *   - role assignment honors the bootstrap email env
 *   - re-upsert does not flip role for an existing verified owner
 *
 * When run WITHOUT `DATABASE_URL`, the safety check throws and the file
 * reports as a single skipped suite.
 */

const TEST_USER_PREFIX = "user-repo-int";

const createdIds = new Set<string>();
const createdEmails = new Set<string>();

async function cleanup() {
  for (const id of createdIds) {
    await db.delete(appUser).where(eq(appUser.id, id));
  }
}

beforeAll(async () => {
  // No setup needed; each test inserts and cleans up.
});

afterAll(async () => {
  await cleanup();
});

describe("user repository (integration, multi-row era)", () => {
  it("upserts a non-bootstrap user with role='user' and persists emailVerified", async () => {
    const id = `${TEST_USER_PREFIX}-non-bs-${crypto.randomUUID()}`;
    const email = `${id}@calculadora-flor-test.invalid`;
    createdIds.add(id);
    createdEmails.add(email);

    const first = await upsertUser({ id, email, emailVerified: false });
    expect(first.role).toBe("user");
    expect(first.emailVerified).toBe(false);

    // Re-call is idempotent (same id) and does not escalate role.
    const second = await upsertUser({ id, email, emailVerified: true });
    expect(second.role).toBe("user");
    expect(second.emailVerified).toBe(true);
    expect(second.email).toBe(email);

    // getUser / getUserByEmail return the same row.
    const byId = await getUser(id);
    const byEmail = await getUserByEmail(email);
    expect(byId?.id).toBe(id);
    expect(byEmail?.id).toBe(id);
  });

  it("promotes role='owner' when email matches BOOTSTRAP_OWNER_EMAIL on first sign-in", async () => {
    // The branch test runner does NOT export BOOTSTRAP_OWNER_EMAIL; we set
    // it locally before the call to mirror a real env-pinned production
    // branch. The next test resets it.
    const previous = process.env.BOOTSTRAP_OWNER_EMAIL;
    process.env.BOOTSTRAP_OWNER_EMAIL = "bootstrap-owner@calculadora-flor-test.invalid";

    const id = `${TEST_USER_PREFIX}-bs-${crypto.randomUUID()}`;
    const email = "bootstrap-owner@calculadora-flor-test.invalid";
    createdIds.add(id);
    createdEmails.add(email);

    try {
      const first = await upsertUser({ id, email, emailVerified: true });
      expect(first.role).toBe("owner");

      // Re-call is idempotent — stays owner, does not flip to user.
      const second = await upsertUser({ id, email, emailVerified: true });
      expect(second.role).toBe("owner");
    } finally {
      if (previous === undefined) delete process.env.BOOTSTRAP_OWNER_EMAIL;
      else process.env.BOOTSTRAP_OWNER_EMAIL = previous;
    }
  });

  it("does NOT promote when emailVerified=false even if email matches BOOTSTRAP_OWNER_EMAIL", async () => {
    const previous = process.env.BOOTSTRAP_OWNER_EMAIL;
    process.env.BOOTSTRAP_OWNER_EMAIL = "bootstrap-owner@calculadora-flor-test.invalid";

    const id = `${TEST_USER_PREFIX}-bs-unverified-${crypto.randomUUID()}`;
    const email = "bootstrap-owner@calculadora-flor-test.invalid";
    createdIds.add(id);
    createdEmails.add(email);

    try {
      const row = await upsertUser({ id, email, emailVerified: false });
      expect(row.role).toBe("user");
    } finally {
      if (previous === undefined) delete process.env.BOOTSTRAP_OWNER_EMAIL;
      else process.env.BOOTSTRAP_OWNER_EMAIL = previous;
    }
  });

  it("returns null for unknown id and unknown email (multi-row era)", async () => {
    const missingId = `${TEST_USER_PREFIX}-missing-${crypto.randomUUID()}`;
    const missingEmail = `${missingId}@calculadora-flor-test.invalid`;
    expect(await getUser(missingId)).toBeNull();
    expect(await getUserByEmail(missingEmail)).toBeNull();
  });
});