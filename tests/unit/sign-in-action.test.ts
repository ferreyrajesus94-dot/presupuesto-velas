import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const redirect = vi.fn((url: string) => {
    const err = new Error(`__redirect:${url}`) as Error & { __redirect?: string };
    err.__redirect = url;
    throw err;
  });
  return {
    redirectMock: redirect,
    setSessionCookieMock: vi.fn(),
    upsertOwnerMock: vi.fn(),
  };
});

vi.mock("../../src/server/auth/ownerEnv", () => ({
  getNeonAuthBaseUrl: () => "https://auth.example.test",
  getOwnerId: () => "owner-1",
  getOwnerEmail: () => "owner@example.com",
}));
vi.mock("../../src/server/auth/session", () => ({
  NEON_SESSION_COOKIE_NAMES: [
    "__Secure-neon-auth.session_token",
    "neon-auth.session_token",
    "better-auth.session_token",
  ],
  setSessionCookie: mocks.setSessionCookieMock,
}));
vi.mock("../../src/server/repositories/owner", () => ({ upsertOwner: mocks.upsertOwnerMock }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirectMock }));

import { signInAction } from "../../src/server/actions/signIn";

function makeFormData(email: string, password: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

const NEON_OK = (user: { id: string; email: string }, cookieName = "better-auth.session_token") =>
  new Response(JSON.stringify({ user }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${cookieName}=tok-xyz; Path=/; HttpOnly`,
    },
  });

describe("signInAction owner allowlist (PR #2d verification-fix CRITICAL #2)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://app.example.com");
    mocks.setSessionCookieMock.mockReset();
    mocks.upsertOwnerMock.mockReset();
    mocks.redirectMock.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("upserts the owner and sets the session cookie when credentials match OWNER_USER_ID/OWNER_EMAIL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(NEON_OK({ id: "owner-1", email: "owner@example.com" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      signInAction({}, makeFormData("owner@example.com", "secret")),
    ).rejects.toMatchObject({ __redirect: "/" });

    expect(mocks.upsertOwnerMock).toHaveBeenCalledTimes(1);
    expect(mocks.upsertOwnerMock).toHaveBeenCalledWith({
      id: "owner-1",
      email: "owner@example.com",
    });
    expect(mocks.setSessionCookieMock).toHaveBeenCalledTimes(1);
    expect(mocks.setSessionCookieMock).toHaveBeenCalledWith("tok-xyz", "better-auth.session_token");
  });

  it.each(["__Secure-neon-auth.session_token", "neon-auth.session_token"])(
    "preserves the supported upstream cookie identity %s",
    async (cookieName) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(NEON_OK({ id: "owner-1", email: "owner@example.com" }, cookieName)),
      );

      await expect(
        signInAction({}, makeFormData("owner@example.com", "secret")),
      ).rejects.toMatchObject({ __redirect: "/" });

      expect(mocks.setSessionCookieMock).toHaveBeenCalledWith("tok-xyz", cookieName);
    },
  );

  it("rejects a successful response without a supported session cookie", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          NEON_OK({ id: "owner-1", email: "owner@example.com" }, "other-auth.session_token"),
        ),
    );

    const result = await signInAction({}, makeFormData("owner@example.com", "secret"));

    expect(result.errors?._form).toEqual(["Sign-in did not return a session cookie."]);
    expect(mocks.upsertOwnerMock).not.toHaveBeenCalled();
    expect(mocks.setSessionCookieMock).not.toHaveBeenCalled();
    expect(mocks.redirectMock).not.toHaveBeenCalled();
  });

  it("returns a uniform form error and performs no mutation when credentials are invalid (401)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await signInAction({}, makeFormData("intruder@example.com", "wrong"));

    expect(result.errors?._form).toEqual(["Invalid email or password."]);
    expect(mocks.upsertOwnerMock).not.toHaveBeenCalled();
    expect(mocks.setSessionCookieMock).not.toHaveBeenCalled();
    expect(mocks.redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to /403 and does NOT mutate app_owner when a valid non-owner authenticates", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(NEON_OK({ id: "intruder", email: "intruder@example.com" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      signInAction({}, makeFormData("intruder@example.com", "secret")),
    ).rejects.toMatchObject({ __redirect: "/403" });

    expect(mocks.upsertOwnerMock).not.toHaveBeenCalled();
    expect(mocks.setSessionCookieMock).not.toHaveBeenCalled();
    expect(mocks.redirectMock).toHaveBeenCalledWith("/403");
  });
});
