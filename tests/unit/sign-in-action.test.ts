import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR2.auth-core (Task 2.7) — `signInAction` rewritten to drop the
 * legacy owner allowlist, call `upsertUser` (not `upsertOwner`), and
 * honor the hidden `<input name="next">` field by redirecting to
 * `<next || '/'>`. Tests in this file assert the NEW behavior.
 *
 * The legacy allowlist tests (`/403` redirect for non-owners, owner email
 * case-insensitive match, OWNER_USER_ID round-trip) are removed — they
 * are superseded by the user-era tests in `tests/integration/require-user.test.ts`
 * and `tests/integration/app-user-bootstrap.test.ts`. Per SPEC:
 * REQUIREMENT VERIFY-GATE, sign-in is no longer a write gate; unverified
 * users now see `/sign-in?hint=verify-email` instead of `/403`.
 */

const mocks = vi.hoisted(() => {
  const redirect = vi.fn((url: string) => {
    const err = new Error(`__redirect:${url}`) as Error & { __redirect?: string };
    err.__redirect = url;
    throw err;
  });
  return {
    redirectMock: redirect,
    setSessionCookieMock: vi.fn(),
    upsertUserMock: vi.fn(),
  };
});

vi.mock("../../src/server/auth/userEnv", () => ({
  getNeonAuthBaseUrl: () => "https://auth.example.test",
  getBootstrapOwnerEmail: () => "bootstrap-owner@example.com",
}));
vi.mock("../../src/server/auth/session", () => ({
  NEON_SESSION_COOKIE_NAMES: [
    "__Secure-neon-auth.session_token",
    "neon-auth.session_token",
    "better-auth.session_token",
  ],
  setSessionCookie: mocks.setSessionCookieMock,
}));
vi.mock("../../src/server/repositories/user", () => ({ upsertUser: mocks.upsertUserMock }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirectMock }));

import { signInAction } from "../../src/server/actions/signIn";

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const NEON_OK = (
  user: { id: string; email: string; emailVerified?: boolean },
  cookieName = "better-auth.session_token",
) =>
  new Response(JSON.stringify({ user }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${cookieName}=tok-xyz; Path=/; HttpOnly`,
    },
  });

describe("signInAction user-era rewrite (PR2 task 2.7)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://app.example.com");
    mocks.setSessionCookieMock.mockReset();
    mocks.upsertUserMock.mockReset();
    mocks.redirectMock.mockClear();
    // default upsertUser returns a minimal AppUser-shape row
    mocks.upsertUserMock.mockImplementation(
      async (input: { id: string; email: string; emailVerified: boolean }) => ({
        id: input.id,
        email: input.email,
        role: "user",
        emailVerified: input.emailVerified,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("upserts the user and redirects to '/' when no next is supplied", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(NEON_OK({ id: "u-1", email: "anyone@example.com", emailVerified: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      signInAction({}, makeFormData({ email: "anyone@example.com", password: "secret" })),
    ).rejects.toMatchObject({ __redirect: "/" });

    expect(mocks.upsertUserMock).toHaveBeenCalledTimes(1);
    expect(mocks.upsertUserMock).toHaveBeenCalledWith({
      id: "u-1",
      email: "anyone@example.com",
      emailVerified: true,
      requestedRole: undefined,
    });
    expect(mocks.setSessionCookieMock).toHaveBeenCalledWith("tok-xyz", "better-auth.session_token");
  });

  it.each(["__Secure-neon-auth.session_token", "neon-auth.session_token"])(
    "redirects to '/' and preserves upstream cookie identity %s",
    async (cookieName) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            NEON_OK({ id: "u-1", email: "anyone@example.com", emailVerified: true }, cookieName),
          ),
      );

      await expect(
        signInAction({}, makeFormData({ email: "anyone@example.com", password: "secret" })),
      ).rejects.toMatchObject({ __redirect: "/" });

      expect(mocks.setSessionCookieMock).toHaveBeenCalledWith("tok-xyz", cookieName);
    },
  );

  it("redirects to the hidden `next` field when present and valid", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(NEON_OK({ id: "u-1", email: "anyone@example.com", emailVerified: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      signInAction(
        {},
        makeFormData({
          email: "anyone@example.com",
          password: "secret",
          next: "/materials",
        }),
      ),
    ).rejects.toMatchObject({ __redirect: "/materials" });
  });

  it("ignores `next` when it is not a same-origin path (falls back to '/')", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(NEON_OK({ id: "u-1", email: "anyone@example.com", emailVerified: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      signInAction(
        {},
        makeFormData({
          email: "anyone@example.com",
          password: "secret",
          next: "https://evil.example.com/phish",
        }),
      ),
    ).rejects.toMatchObject({ __redirect: "/" });
  });

  it("ignores `next` when it is an empty string (falls back to '/')", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(NEON_OK({ id: "u-1", email: "anyone@example.com", emailVerified: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      signInAction(
        {},
        makeFormData({
          email: "anyone@example.com",
          password: "secret",
          next: "",
        }),
      ),
    ).rejects.toMatchObject({ __redirect: "/" });
  });

  it("upserts the user with `requestedRole='owner'` when email matches BOOTSTRAP_OWNER_EMAIL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      NEON_OK({
        id: "boot-1",
        email: "bootstrap-owner@example.com",
        emailVerified: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    mocks.upsertUserMock.mockImplementation(
      async (input: { id: string; email: string; emailVerified: boolean }) => ({
        id: input.id,
        email: input.email,
        role: "owner",
        emailVerified: input.emailVerified,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    await expect(
      signInAction({}, makeFormData({ email: "bootstrap-owner@example.com", password: "secret" })),
    ).rejects.toMatchObject({ __redirect: "/" });

    expect(mocks.upsertUserMock).toHaveBeenCalledWith({
      id: "boot-1",
      email: "bootstrap-owner@example.com",
      emailVerified: true,
      requestedRole: "owner",
    });
  });

  it("does NOT allowlist non-owner signers (no /403 redirect; user proceeds)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      NEON_OK({
        id: "intruder-1",
        email: "intruder@example.com",
        emailVerified: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      signInAction({}, makeFormData({ email: "intruder@example.com", password: "secret" })),
    ).rejects.toMatchObject({ __redirect: "/" });

    // upsertUser IS called — every verified user gets an app_user row.
    expect(mocks.upsertUserMock).toHaveBeenCalledTimes(1);
    expect(mocks.setSessionCookieMock).toHaveBeenCalledTimes(1);
    // No /403 redirect was issued.
    expect(mocks.redirectMock).not.toHaveBeenCalledWith("/403");
  });

  it("returns a uniform form error and performs no mutation when credentials are invalid (401)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await signInAction(
      {},
      makeFormData({ email: "intruder@example.com", password: "wrong" }),
    );

    expect(result.errors?._form).toEqual(["Invalid email or password."]);
    expect(mocks.upsertUserMock).not.toHaveBeenCalled();
    expect(mocks.setSessionCookieMock).not.toHaveBeenCalled();
    expect(mocks.redirectMock).not.toHaveBeenCalled();
  });

  it("returns a form error when the response lacks a supported session cookie", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          NEON_OK(
            { id: "u-1", email: "anyone@example.com", emailVerified: true },
            "other-auth.session_token",
          ),
        ),
    );

    const result = await signInAction(
      {},
      makeFormData({ email: "anyone@example.com", password: "secret" }),
    );

    expect(result.errors?._form).toEqual(["Sign-in did not return a session cookie."]);
    expect(mocks.upsertUserMock).not.toHaveBeenCalled();
    expect(mocks.setSessionCookieMock).not.toHaveBeenCalled();
    expect(mocks.redirectMock).not.toHaveBeenCalled();
  });

  it("returns a form error when the response body lacks a user", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": "better-auth.session_token=tok-xyz; Path=/; HttpOnly",
          },
        }),
      ),
    );

    const result = await signInAction(
      {},
      makeFormData({ email: "anyone@example.com", password: "secret" }),
    );

    expect(result.errors?._form).toEqual(["Sign-in did not return a user."]);
    expect(mocks.upsertUserMock).not.toHaveBeenCalled();
    expect(mocks.setSessionCookieMock).not.toHaveBeenCalled();
  });

  it("defaults `emailVerified` to false when Neon Auth omits the flag (verification gate stays strict)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(NEON_OK({ id: "u-1", email: "anyone@example.com" })); // no emailVerified
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      signInAction({}, makeFormData({ email: "anyone@example.com", password: "secret" })),
    ).rejects.toMatchObject({ __redirect: "/" });

    expect(mocks.upsertUserMock).toHaveBeenCalledWith({
      id: "u-1",
      email: "anyone@example.com",
      emailVerified: false,
      requestedRole: undefined,
    });
  });
});
