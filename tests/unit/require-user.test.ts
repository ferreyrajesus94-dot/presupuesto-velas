import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR2.auth-core — RED-first unit tests for `requireUser`. Mirrors the spec
 * scenarios under REQUIREMENT: AUTH-IDENTITY + VERIFY-GATE:
 *   - no session          → redirect(`/sign-in?next=<pathname || '/'>'`)
 *   - session, !verified  → redirect(`/sign-in?hint=verify-email`)
 *   - session, verified,  → atomic `upsertUser` → return row
 *     missing row
 *   - session, verified,  → return existing row
 *     existing row
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
    bootstrapEmail: "owner@bootstrap.invalid" as string | null,
    fetchMock: vi.fn(),
  };
});

vi.mock("next/headers", () => ({ cookies: mocks.cookiesMock }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirectMock }));

vi.mock("../../src/server/auth/userEnv", () => ({
  getBootstrapOwnerEmail: () => mocks.bootstrapEmail,
  getNeonAuthBaseUrl: () => "https://auth.example.test",
}));

vi.mock("../../src/server/repositories/user", () => ({
  upsertUser: mocks.upsertUserMock,
}));

import { requireUser } from "../../src/server/auth/requireUser";

function setSession(
  value: string | undefined,
  upstreamVariant: string | undefined = "b",
): void {
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
  mocks.bootstrapEmail = "owner@bootstrap.invalid";
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("requireUser (redirect matrix)", () => {
  it("redirects to /sign-in when no session cookie is present", async () => {
    setSession(undefined);

    await expect(requireUser({ pathname: "/materials" })).rejects.toMatchObject({
      __redirect: "/sign-in?next=%2Fmaterials",
    });
    expect(mocks.upsertUserMock).not.toHaveBeenCalled();
  });

  it("preserves the original pathname when set via opts.pathname", async () => {
    setSession(undefined);

    await expect(requireUser({ pathname: "/quotes/abc" })).rejects.toMatchObject({
      __redirect: "/sign-in?next=%2Fquotes%2Fabc",
    });
  });

  it("falls back to next='/' when opts.pathname is omitted", async () => {
    setSession(undefined);

    await expect(requireUser()).rejects.toMatchObject({
      __redirect: "/sign-in?next=%2F",
    });
  });

  it("redirects to /sign-in?hint=verify-email when the session is not verified", async () => {
    setSession("tok-1");
    mockGetSessionResponse({ user: { id: "u-1", email: "u-1@example.com", emailVerified: false } });

    await expect(requireUser()).rejects.toMatchObject({
      __redirect: "/sign-in?hint=verify-email",
    });
    expect(mocks.upsertUserMock).not.toHaveBeenCalled();
  });

  it("treats missing emailVerified as unverified (defensive default)", async () => {
    setSession("tok-1");
    mockGetSessionResponse({ user: { id: "u-1", email: "u-1@example.com" } });

    await expect(requireUser()).rejects.toMatchObject({
      __redirect: "/sign-in?hint=verify-email",
    });
  });

  it("upserts via upsertUser and returns the row when the session is verified", async () => {
    setSession("tok-1");
    mockGetSessionResponse({ user: { id: "u-1", email: "user-1@example.com", emailVerified: true } });
    mocks.upsertUserMock.mockResolvedValue({
      id: "u-1",
      email: "user-1@example.com",
      role: "user",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await requireUser();
    expect(result).toEqual({
      id: "u-1",
      email: "user-1@example.com",
      role: "user",
      emailVerified: true,
    });
    expect(mocks.upsertUserMock).toHaveBeenCalledWith({
      id: "u-1",
      email: "user-1@example.com",
      emailVerified: true,
      requestedRole: undefined,
    });
  });

  it("promotes to role='owner' when the verified email matches BOOTSTRAP_OWNER_EMAIL", async () => {
    setSession("tok-1");
    mockGetSessionResponse({
      user: { id: "u-1", email: "OWNER@BOOTSTRAP.invalid", emailVerified: true },
    });
    mocks.upsertUserMock.mockResolvedValue({
      id: "u-1",
      email: "OWNER@BOOTSTRAP.invalid",
      role: "owner",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await requireUser();
    expect(result.role).toBe("owner");
    expect(mocks.upsertUserMock).toHaveBeenCalledWith({
      id: "u-1",
      email: "OWNER@BOOTSTRAP.invalid",
      emailVerified: true,
      requestedRole: "owner",
    });
  });

  it("does not request role='owner' when the email does not match the bootstrap env", async () => {
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

    const result = await requireUser();
    expect(result.role).toBe("user");
    expect(mocks.upsertUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestedRole: undefined }),
    );
  });

  it("passes undefined requestedRole when BOOTSTRAP_OWNER_EMAIL is unset (no privilege escalation)", async () => {
    mocks.bootstrapEmail = null;
    setSession("tok-1");
    mockGetSessionResponse({
      user: { id: "u-1", email: "anyone@example.com", emailVerified: true },
    });
    mocks.upsertUserMock.mockResolvedValue({
      id: "u-1",
      email: "anyone@example.com",
      role: "user",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await requireUser();
    expect(result.role).toBe("user");
    expect(mocks.upsertUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestedRole: undefined }),
    );
  });

  it("redirects to /sign-in when /get-session returns a non-OK response (stale cookie)", async () => {
    setSession("tok-1");
    mockGetSessionResponse("expired", 401);

    await expect(requireUser()).rejects.toMatchObject({
      __redirect: expect.stringContaining("/sign-in"),
    });
    expect(mocks.upsertUserMock).not.toHaveBeenCalled();
  });

  it("forwards the supported upstream cookie identity to Neon", async () => {
    setSession("tok-1", "p");
    mockGetSessionResponse({ user: { id: "u-1", email: "user-1@example.com", emailVerified: true } });
    mocks.upsertUserMock.mockResolvedValue({
      id: "u-1",
      email: "user-1@example.com",
      role: "user",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await requireUser();
    expect(mocks.fetchMock).toHaveBeenCalledWith(
      "https://auth.example.test/get-session",
      expect.objectContaining({
        headers: { Cookie: "__Secure-neon-auth.session_token=tok-1" },
      }),
    );
  });
});
