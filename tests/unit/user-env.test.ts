import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * PR2.auth-core — RED-first unit test for `userEnv.ts`. Mirrors the spec
 * scenario under REQUIREMENT: ROLE-MODEL ("unset env + reserved guard test":
 * given `BOOTSTRAP_OWNER_EMAIL` unset, all users receive `role='user'`).
 *
 * `userEnv.ts` is the new home for auth-related env access:
 *   - `getNeonAuthBaseUrl()` is the existing public surface, preserved so
 *     `src/server/auth/session.ts` can import it from `./userEnv` after
 *     PR3 reshuffles. During PR2.1 we keep the legacy `ownerEnv.ts` shim
 *     re-exporting it for SESSION-PRESERVE.
 *   - `getBootstrapOwnerEmail()` is the new helper that surfaces the env-
 *     pinned bootstrap-owner email so `upsertUser` can promote matching
 *     sessions to `role='owner'`. Returns `null` when unset so callers
 *     can opt out of promotion without throwing.
 */

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
}));

vi.mock("../../src/server/auth/userEnv", async () => {
  return await import("../../src/server/auth/userEnv");
});

import { getBootstrapOwnerEmail, getNeonAuthBaseUrl } from "../../src/server/auth/userEnv";

function resetEnv() {
  mocks.env = {};
  for (const key of [
    "BOOTSTRAP_OWNER_EMAIL",
    "NEON_AUTH_BASE_URL",
    "OWNER_USER_ID",
    "OWNER_EMAIL",
    "TEST_OWNER_USER_ID",
    "TEST_OWNER_EMAIL",
  ]) {
    delete process.env[key];
  }
}

describe("getNeonAuthBaseUrl", () => {
  afterEach(() => {
    resetEnv();
    vi.unstubAllEnvs();
  });

  it("returns the configured URL stripped of trailing slashes", () => {
    vi.stubEnv("NEON_AUTH_BASE_URL", "https://auth.example.test/");
    expect(getNeonAuthBaseUrl()).toBe("https://auth.example.test");
  });

  it("throws when the URL is missing", () => {
    expect(() => getNeonAuthBaseUrl()).toThrow("NEON_AUTH_BASE_URL is not set");
  });
});

describe("getBootstrapOwnerEmail", () => {
  afterEach(() => {
    resetEnv();
    vi.unstubAllEnvs();
  });

  it("returns the configured email when BOOTSTRAP_OWNER_EMAIL is set", () => {
    vi.stubEnv("BOOTSTRAP_OWNER_EMAIL", "owner@bootstrap.invalid");
    expect(getBootstrapOwnerEmail()).toBe("owner@bootstrap.invalid");
  });

  it("returns null when BOOTSTRAP_OWNER_EMAIL is unset", () => {
    expect(getBootstrapOwnerEmail()).toBeNull();
  });

  it("returns null when BOOTSTRAP_OWNER_EMAIL is whitespace", () => {
    vi.stubEnv("BOOTSTRAP_OWNER_EMAIL", "   ");
    expect(getBootstrapOwnerEmail()).toBeNull();
  });
});
