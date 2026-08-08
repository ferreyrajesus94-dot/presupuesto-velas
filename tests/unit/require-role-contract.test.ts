import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR4.per-user-isolation (Task 4.2) — `requireRole('owner')` route-guard
 * contract test. The guard itself is covered by
 * `tests/unit/require-role.test.ts`; this suite asserts the contract a
 * hypothetical admin route handler relies on when it wraps `requireRole`
 * around its body — i.e. "what error do I receive when I deny a
 * non-owner request, and how do I let an owner through?"
 *
 * SPEC: auth-public-signup/spec §5 ROLE-MODEL — `requireRole('owner')`
 *   - authenticated + role === 'owner' → return the AuthenticatedUser
 *   - authenticated + role !== 'owner' → throw UnauthorizedError
 *   - unauthenticated                  → redirect to /sign-in
 *
 * Contract assertions:
 *   - the thrown error is the typed `UnauthorizedError` exported from
 *     `src/server/auth/requireRole.ts` (NOT a generic Error);
 *   - the error carries `role` (actual) and `required` (expected) so the
 *     calling handler can log a precise denial reason;
 *   - the owner pass-through returns the same shape as `requireUser()`
 *     so downstream handlers do not need to special-case the role.
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

function setSession(value: string | undefined): void {
  mocks.cookiesMock.mockResolvedValue({
    get: (name: string) => (name === "session" && value ? { value } : undefined),
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

describe("requireRole('owner') — route-guard contract", () => {
  it("denies a non-owner session with a typed UnauthorizedError carrying role + required", async () => {
    setSession("non-owner-token");
    mockGetSessionResponse({
      user: { id: "u-1", email: "regular-user@example.com", emailVerified: true },
    });
    mocks.upsertUserMock.mockResolvedValue({
      id: "u-1",
      email: "regular-user@example.com",
      role: "user",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Simulate a route handler that wraps `requireRole('owner')` around
    // its body. The contract we assert: the throw is the typed error,
    // not a plain Error or a redirect signal.
    let captured: unknown;
    try {
      await requireRole("owner");
      throw new Error("requireRole should have denied the non-owner");
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(UnauthorizedError);
    const err = captured as UnauthorizedError;
    expect(err.role).toBe("user");
    expect(err.required).toBe("owner");
    // The error name lets server logs filter denials without parsing the
    // message string. This is the discovery contract for the route layer.
    expect(err.name).toBe("UnauthorizedError");
    expect(err.message.toLowerCase()).toContain("owner");
  });

  it("returns the authenticated owner unchanged — the same shape as requireUser()", async () => {
    setSession("owner-token");
    mockGetSessionResponse({
      user: { id: "u-owner", email: "owner@bootstrap.invalid", emailVerified: true },
    });
    mocks.upsertUserMock.mockResolvedValue({
      id: "u-owner",
      email: "owner@bootstrap.invalid",
      role: "owner",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const user = await requireRole("owner");
    // Same shape as requireUser so route handlers do not have to
    // special-case the role-checked identity.
    expect(user.role).toBe("owner");
    expect(user.id).toBe("u-owner");
    expect(user.emailVerified).toBe(true);
    expect(["owner", "user"]).toContain(user.role);
  });

  it("propagates the redirect signal when the caller has no session (delegates to requireUser)", async () => {
    setSession(undefined);

    // requireRole delegates the unauthenticated path to requireUser, which
    // calls `redirect('/sign-in?next=...')`. The route handler observes
    // the same redirect throw it would see from requireUser.
    await expect(requireRole("owner")).rejects.toMatchObject({
      __redirect: expect.stringContaining("/sign-in"),
    });
  });
});
