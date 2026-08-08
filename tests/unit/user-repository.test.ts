import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR2.auth-core — RED-first unit test for the user repository's bootstrap
 * promotion matrix. Mirrors the spec scenarios under REQUIREMENT: ROLE-MODEL
 * (promotion iff `email === BOOTSTRAP_OWNER_EMAIL`; idempotent on re-call;
 * non-matching email defaults to `role='user'`).
 *
 * The test mocks the Drizzle `db` module so it exercises `upsertUser`'s
 * pure logic — promotion rule + idempotent INSERT-vs-UPDATE branch — without
 * a real Postgres connection. Implementation lives in
 * `src/server/repositories/user.ts`.
 */

type UpsertCall = {
  id: string;
  email: string;
  emailVerified: boolean;
  role: "owner" | "user";
  emailVerifiedSet: boolean;
};

const dbCalls: { op: string; payload?: unknown }[] = [];
const upsertCallLog: UpsertCall[] = [];

function makeDbMock(currentRow: { id: string; email: string; role: "owner" | "user" } | null) {
  return {
    insert: vi.fn((_table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: (_config: unknown) => ({
          returning: async () => {
            const row = values as {
              id: string;
              email: string;
              role: "owner" | "user";
              emailVerified?: boolean;
            };
            dbCalls.push({ op: "insert", payload: row });
            upsertCallLog.push({
              id: row.id,
              email: row.email,
              emailVerified: row.emailVerified ?? false,
              role: row.role,
              emailVerifiedSet: row.emailVerified !== undefined,
            });
            return [{ ...row, emailVerified: row.emailVerified ?? false }];
          },
        }),
      }),
    })),
    select: vi.fn(() => ({
      from: (_table: unknown) => ({
        where: (_condition: unknown) => ({
          limit: async (n: number) => {
            dbCalls.push({ op: "select" });
            if (currentRow && n === 1) return [currentRow];
            return [];
          },
        }),
      }),
    })),
  };
}

const mocks = vi.hoisted(() => ({
  dbRef: { current: null as ReturnType<typeof makeDbMock> | null },
  bootstrap: { email: "owner@bootstrap.invalid" } as { email: string },
}));

vi.mock("../../db/client", () => ({
  get db() {
    return mocks.dbRef.current;
  },
}));

vi.mock("../../db/schema", () => ({ appUser: "appUser-table-stub" }));

vi.mock("../../src/server/auth/userEnv", () => ({
  getBootstrapOwnerEmail: () => mocks.bootstrap.email,
}));

import { getUser, getUserByEmail, upsertUser } from "../../src/server/repositories/user";

describe("upsertUser bootstrap promotion + idempotency", () => {
  beforeEach(() => {
    mocks.bootstrap.email = "owner@bootstrap.invalid";
    mocks.dbRef.current = makeDbMock(null);
    dbCalls.length = 0;
    upsertCallLog.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a fresh row with role='owner' when email matches BOOTSTRAP_OWNER_EMAIL AND requestedRole='owner'", async () => {
    const row = await upsertUser({
      id: "neon-id-1",
      email: "owner@bootstrap.invalid",
      emailVerified: true,
      requestedRole: "owner",
    });

    expect(row.id).toBe("neon-id-1");
    expect(row.email).toBe("owner@bootstrap.invalid");
    expect(row.role).toBe("owner");
    expect(row.emailVerified).toBe(true);
    expect(dbCalls.map((c) => c.op)).toEqual(["insert"]);
    expect(upsertCallLog).toEqual([
      {
        id: "neon-id-1",
        email: "owner@bootstrap.invalid",
        emailVerified: true,
        role: "owner",
        emailVerifiedSet: true,
      },
    ]);
  });

  it("inserts a fresh row with role='user' when the email does NOT match BOOTSTRAP_OWNER_EMAIL", async () => {
    const row = await upsertUser({
      id: "neon-id-2",
      email: "user-2@example.com",
      emailVerified: true,
    });

    expect(row.role).toBe("user");
    expect(row.email).toBe("user-2@example.com");
    expect(row.emailVerified).toBe(true);
    expect(upsertCallLog[0]?.role).toBe("user");
  });

  it("inserts with role='user' when the email is unverified (matches or not)", async () => {
    const row = await upsertUser({
      id: "neon-id-3",
      email: "owner@bootstrap.invalid",
      emailVerified: false,
    });

    // Bootstrap promotion requires verified email — an unverified session
    // whose email happens to match BOOTSTRAP_OWNER_EMAIL must NOT be
    // promoted. SPEC: ROLE-MODEL Scenario "Bootstrap promotion + idempotent".
    expect(row.role).toBe("user");
    expect(row.emailVerified).toBe(false);
  });

  it("persists emailVerified=true on every fresh insert", async () => {
    await upsertUser({
      id: "neon-id-4",
      email: "verified@example.com",
      emailVerified: true,
    });
    expect(upsertCallLog[0]?.emailVerified).toBe(true);
    expect(upsertCallLog[0]?.emailVerifiedSet).toBe(true);
  });

  it("ignores the requestedRole hint when the email does not match BOOTSTRAP_OWNER_EMAIL", async () => {
    const row = await upsertUser({
      id: "neon-id-5",
      email: "user-5@example.com",
      emailVerified: true,
      requestedRole: "owner",
    });

    // `requestedRole` is only honored when the email matches the bootstrap
    // env var. A non-bootstrap email must never be promoted via a caller-
    // supplied `requestedRole: "owner"`.
    expect(row.role).toBe("user");
    expect(upsertCallLog[0]?.role).toBe("user");
  });

  it("returns role='user' when BOOTSTRAP_OWNER_EMAIL is unset, even with requestedRole='owner'", async () => {
    mocks.bootstrap.email = "" as unknown as string;
    const row = await upsertUser({
      id: "neon-id-6",
      email: "any@example.com",
      emailVerified: true,
      requestedRole: "owner",
    });

    // ROLE-MODEL scenario "Unset env + reserved guard test": no email can
    // be promoted when the bootstrap env is unset.
    expect(row.role).toBe("user");
  });

  it("matches BOOTSTRAP_OWNER_EMAIL case-insensitively", async () => {
    mocks.bootstrap.email = "Owner@Bootstrap.invalid";
    const row = await upsertUser({
      id: "neon-id-7",
      email: "owner@bootstrap.invalid",
      emailVerified: true,
      requestedRole: "owner",
    });

    expect(row.role).toBe("owner");
  });
});

describe("getUser / getUserByEmail pass-through", () => {
  beforeEach(() => {
    mocks.dbRef.current = makeDbMock({ id: "row-1", email: "x@example.com", role: "user" });
    dbCalls.length = 0;
  });

  it("returns the row from `getUser(id)`", async () => {
    const row = await getUser("row-1");
    expect(row).toEqual({ id: "row-1", email: "x@example.com", role: "user" });
  });

  it("returns null from `getUser(id)` when the row is absent", async () => {
    mocks.dbRef.current = makeDbMock(null);
    const row = await getUser("missing");
    expect(row).toBeNull();
  });

  it("returns the row from `getUserByEmail(email)`", async () => {
    const row = await getUserByEmail("x@example.com");
    expect(row).toEqual({ id: "row-1", email: "x@example.com", role: "user" });
  });
});
