import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We mock the drizzle db chain so we can inspect the SET clause passed
// to onConflictDoUpdate. This is a unit test of the upsertUser SQL
// construction, not a live DB round-trip (integration coverage lives in
// tests/integration/ and is DATABASE_URL-gated).

const mocks = vi.hoisted(() => ({
  insertValues: vi.fn(),
  insertOnConflict: vi.fn(),
  insertReturning: vi.fn(),
  capturedSetObjects: [] as Array<Record<string, unknown>>,
  capturedTargets: [] as Array<unknown>,
  bootstrap: { email: "owner@bootstrap.invalid" } as { email: string | null },
}));

vi.mock("../../db/client", () => ({
  get db() {
    return {
      insert: () => ({
        values: (vals: unknown) => {
          mocks.insertValues(vals);
          return {
            onConflictDoUpdate: (cfg: { target: unknown; set: Record<string, unknown> }) => {
              mocks.insertOnConflict(cfg);
              mocks.capturedSetObjects.push(cfg.set);
              mocks.capturedTargets.push(cfg.target);
              return {
                returning: () => mocks.insertReturning(),
              };
            },
          };
        },
      }),
    };
  },
}));

vi.mock("../../db/schema", () => ({ appUser: "appUser-table-stub" }));

vi.mock("../../src/server/auth/userEnv", () => ({
  getBootstrapOwnerEmail: () => mocks.bootstrap.email,
}));

import { upsertUser } from "../../src/server/repositories/user";

describe("upsertUser — bootstrap promotion on conflict (v0.4.5 fix)", () => {
  beforeEach(() => {
    mocks.insertValues.mockReset();
    mocks.insertOnConflict.mockReset();
    mocks.insertReturning.mockReset().mockResolvedValue([
      {
        id: "u-1",
        email: "owner@bootstrap.invalid",
        role: "owner",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    mocks.capturedSetObjects.length = 0;
    mocks.capturedTargets.length = 0;
    mocks.bootstrap.email = "owner@bootstrap.invalid";
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes `role: 'owner'` in the SET clause when the bootstrap email is verified (was missing before)", async () => {
    await upsertUser({
      id: "u-1",
      email: "owner@bootstrap.invalid",
      emailVerified: true,
      requestedRole: "owner",
    });
    expect(mocks.capturedSetObjects).toHaveLength(1);
    const setObj = mocks.capturedSetObjects[0]!;
    expect(setObj).toHaveProperty("role", "owner");
  });

  it("does NOT include `role` in the SET clause when resolveRole returns 'user' (preserves any prior owner)", async () => {
    await upsertUser({
      id: "u-1",
      email: "owner@bootstrap.invalid",
      emailVerified: true,
    });
    const setObj = mocks.capturedSetObjects[0]!;
    expect(setObj).not.toHaveProperty("role");
  });

  it("does NOT include `role` when emailVerified is false (unverified sign-in can't promote)", async () => {
    await upsertUser({
      id: "u-1",
      email: "owner@bootstrap.invalid",
      emailVerified: false,
      requestedRole: "owner",
    });
    const setObj = mocks.capturedSetObjects[0]!;
    expect(setObj).not.toHaveProperty("role");
  });

  it("does NOT include `role` when email does not match BOOTSTRAP_OWNER_EMAIL", async () => {
    await upsertUser({
      id: "u-1",
      email: "other@example.com",
      emailVerified: true,
      requestedRole: "owner",
    });
    const setObj = mocks.capturedSetObjects[0]!;
    expect(setObj).not.toHaveProperty("role");
  });

  it("does NOT include `role` when BOOTSTRAP_OWNER_EMAIL is unset", async () => {
    mocks.bootstrap.email = null;
    await upsertUser({
      id: "u-1",
      email: "owner@bootstrap.invalid",
      emailVerified: true,
      requestedRole: "owner",
    });
    const setObj = mocks.capturedSetObjects[0]!;
    expect(setObj).not.toHaveProperty("role");
  });

  it("email comparison is case-insensitive", async () => {
    await upsertUser({
      id: "u-1",
      email: "OWNER@BOOTSTRAP.INVALID",
      emailVerified: true,
      requestedRole: "owner",
    });
    const setObj = mocks.capturedSetObjects[0]!;
    expect(setObj).toHaveProperty("role", "owner");
  });

  it("always includes email + emailVerified in the SET clause", async () => {
    await upsertUser({
      id: "u-1",
      email: "owner@bootstrap.invalid",
      emailVerified: true,
      requestedRole: "owner",
    });
    const setObj = mocks.capturedSetObjects[0]!;
    expect(setObj).toHaveProperty("email", "owner@bootstrap.invalid");
    expect(setObj).toHaveProperty("emailVerified", true);
  });
});