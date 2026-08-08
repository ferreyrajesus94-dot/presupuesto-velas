import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR2.auth-core — RED-first unit test for the reserved `requireRole` guard.
 * The guard is unused in v1 (no admin UI ships), but the spec scenario under
 * REQUIREMENT: ROLE-MODEL "Unset env + reserved guard test" requires a
 * passing test asserting the failed-access path without requiring an admin
 * route.
 *
 * Contract:
 *   - given an authenticated user with `role !== required`, throws a typed
 *     `UnauthorizedError` whose `role` and `required` are surfaced.
 *   - given an unauthenticated call, redirects to `/sign-in` (delegates to
 *     `requireUser`'s redirect semantics; no consumer in v1 hits this path).
 */

const mocks = vi.hoisted(() => {
  const redirect = vi.fn((url: string) => {
    const err = new Error(`__redirect:${url}`) as Error & { __redirect?: string };
    err.__redirect = url;
    throw err;
  });
  return {
    redirectMock: redirect,
    cookiesMock: vi.fn(),
    upsertUserMock: vi.fn(),
    fetchMock: vi.fn(),
  };
});

vi.mock("next/headers", () => ({ cookies: mocks.cookiesMock }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirectMock }));

vi.mock("../../src/server/auth/userEnv", () => ({
  getBootstrapOwnerEmail: () => "owner@bootstrap.invalid",
  getNeonAuthBaseUrl: () => "https://auth.example.test",
}));

vi.mock("../../src/server/repositories/user", () => ({
  upsertUser: mocks.upsertUserMock,
}));

import { requireRole, UnauthorizedError } from "../../src/server/auth/requireRole";

function setSession(value: string | undefined, upstreamVariant = "b"): void {
  mocks.cookiesMock.mockResolvedValue({
    get: (name: string) => {
      if (name === "session" && value) return { value };
      if (name === "session-upstream" && upstreamVariant) return { value: upstreamVariant };
      return undefined;
    },
  } as never);
}

function mockGetSessionResponse(body: unknown, status = 200): void {
  mocks.fetchMock.mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", mocks.fetchMock);
}

beforeEach(() => {
  vi.stubEnv("NEON_AUTH_BASE_URL", "https://auth.example.test");
  mocks.redirectMock.mockClear();
  mocks.upsertUserMock.mockReset();
  mocks.fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("requireRole (reserved owner guard)", () => {
  it("throws UnauthorizedError when an authenticated non-owner requests the owner guard", async () => {
    setSession("tok-1");
    mockGetSessionResponse({
      user: { id: "u-1", email: "user-1@example.com", emailVerified: true },
    });
    mocks.upsertUserMock.mockResolvedValue({
      id: "u-1",
      email: "user-1@example.com",
      role: "user",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let captured: unknown;
    try {
      await requireRole("owner");
      throw new Error("requireRole should have thrown");
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(UnauthorizedError);
    const err = captured as UnauthorizedError;
    expect(err.required).toBe("owner");
    expect(err.role).toBe("user");
    expect(err.message).toMatch(/owner/i);
  });

  it("returns the authenticated user when the role matches", async () => {
    setSession("tok-1");
    mockGetSessionResponse({
      user: { id: "u-1", email: "owner@bootstrap.invalid", emailVerified: true },
    });
    mocks.upsertUserMock.mockResolvedValue({
      id: "u-1",
      email: "owner@bootstrap.invalid",
      role: "owner",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await requireRole("owner");
    expect(result.role).toBe("owner");
    expect(result.id).toBe("u-1");
  });

  it("redirects to /sign-in when no session cookie is present (no owner-app access path)", async () => {
    setSession(undefined);

    await expect(requireRole("owner")).rejects.toMatchObject({
      __redirect: expect.stringContaining("/sign-in"),
    });
  });
});
