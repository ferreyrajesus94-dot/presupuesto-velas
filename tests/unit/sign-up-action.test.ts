import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR3.auth-ui (Task 3.4) + v0.4.6 hotfix — `signUpAction` RED-first unit test.
 *
 * Covers the SIGN-UP scenario from SPEC §2 (auth-public-signup):
 *   - Happy path: valid email + matching passwords → Neon POST
 *     `/sign-up/email` is issued with `email_verification: 'link'`. The
 *     action redirects to `/verify-email` (NOT `/sign-in?hint=...`) and,
 *     if Better Auth returned a session cookie in the response, the
 *     cookie is forwarded to our jar so the user lands on `/verify-email`
 *     already signed in. v0.4.6 added the auto-sign-in + redirect change
 *     so the user doesn't have to manually navigate to the verify page.
 *   - Duplicate email: Neon returns 4xx → action returns
 *     `state.errors._form` and no redirect, no session set.
 *   - Weak password: Neon returns 4xx → action returns
 *     `state.errors._form` and no redirect.
 *   - Password mismatch: Zod refinement surfaces a `confirmPassword`
 *     field error BEFORE any Neon call.
 *
 * Strict TDD: this file references `signUpAction` which does not exist
 * yet. The import will FAIL to resolve → RED. Task 3.4 then writes the
 * minimum production code to make these tests pass → GREEN.
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
vi.mock("next/navigation", () => ({ redirect: mocks.redirectMock }));

import { signUpAction } from "../../src/server/actions/signUp";

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const NEON_SIGNUP_OK = (overrides: { id?: string; email?: string; setCookie?: string } = {}) =>
  new Response(
    JSON.stringify({
      user: {
        id: overrides.id ?? "new-user-1",
        email: overrides.email ?? "newbie@example.com",
        emailVerified: false,
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...(overrides.setCookie !== undefined
          ? { "set-cookie": overrides.setCookie }
          : {}),
      },
    },
  );

describe("signUpAction public sign-up (PR3 task 3.4 + v0.4.6 hotfix)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://app.example.com");
    mocks.setSessionCookieMock.mockReset();
    mocks.redirectMock.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("redirects to /verify-email on a happy path Neon /sign-up/email 200 (v0.4.6 was /sign-in?hint=verify-email)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(NEON_SIGNUP_OK());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      signUpAction(
        {},
        makeFormData({
          email: "newbie@example.com",
          password: "supersecret123",
          confirmPassword: "supersecret123",
        }),
      ),
    ).rejects.toMatchObject({ __redirect: "/verify-email" });

    // Neon POST issued with email_verification: 'link'
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("https://auth.example.test/sign-up/email");
    expect(calledInit.method).toBe("POST");
    const body = JSON.parse(String(calledInit.body));
    expect(body).toMatchObject({
      email: "newbie@example.com",
      password: "supersecret123",
      email_verification: "link",
    });
  });

  it("does NOT call setSessionCookie when Better Auth returns no set-cookie header (defensive)", async () => {
    // NEON_SIGNUP_OK() default has NO set-cookie header
    const fetchMock = vi.fn().mockResolvedValue(NEON_SIGNUP_OK());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      signUpAction(
        {},
        makeFormData({
          email: "newbie@example.com",
          password: "supersecret123",
          confirmPassword: "supersecret123",
        }),
      ),
    ).rejects.toMatchObject({ __redirect: "/verify-email" });

    expect(mocks.setSessionCookieMock).not.toHaveBeenCalled();
  });

  it("extracts the Better Auth session cookie from set-cookie and forwards it (v0.4.6 auto-sign-in)", async () => {
    const setCookieValue =
      "__Secure-neon-auth.session_token=jwt-abc.DefGhi; HttpOnly; Path=/; SameSite=Lax";
    const fetchMock = vi.fn().mockResolvedValue(NEON_SIGNUP_OK({ setCookie: setCookieValue }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      signUpAction(
        {},
        makeFormData({
          email: "newbie@example.com",
          password: "supersecret123",
          confirmPassword: "supersecret123",
        }),
      ),
    ).rejects.toMatchObject({ __redirect: "/verify-email" });

    expect(mocks.setSessionCookieMock).toHaveBeenCalledTimes(1);
    expect(mocks.setSessionCookieMock).toHaveBeenCalledWith(
      "jwt-abc.DefGhi",
      "__Secure-neon-auth.session_token",
    );
  });

  it("handles the legacy 'better-auth.session_token' variant in the set-cookie header", async () => {
    const setCookieValue = "better-auth.session_token=legacy-jwt-value; Path=/; HttpOnly";
    const fetchMock = vi.fn().mockResolvedValue(NEON_SIGNUP_OK({ setCookie: setCookieValue }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      signUpAction(
        {},
        makeFormData({
          email: "newbie@example.com",
          password: "supersecret123",
          confirmPassword: "supersecret123",
        }),
      ),
    ).rejects.toMatchObject({ __redirect: "/verify-email" });

    expect(mocks.setSessionCookieMock).toHaveBeenCalledWith(
      "legacy-jwt-value",
      "better-auth.session_token",
    );
  });

  it("derives a Neon `name` from the email local part when no name is supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      NEON_SIGNUP_OK({
        id: "new-user-2",
        email: "ada.lovelace@example.com",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      signUpAction(
        {},
        makeFormData({
          email: "ada.lovelace@example.com",
          password: "supersecret123",
          confirmPassword: "supersecret123",
        }),
      ),
    ).rejects.toMatchObject({ __redirect: "/verify-email" });

    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(calledInit.body));
    expect(body.name).toBe("ada.lovelace");
  });

  it("returns state.errors._form when Neon reports a duplicate email (422) and does not redirect", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Email already in use" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await signUpAction(
      {},
      makeFormData({
        email: "dupe@example.com",
        password: "supersecret123",
        confirmPassword: "supersecret123",
      }),
    );

    expect(result.errors?._form).toBeDefined();
    expect(result.errors?._form?.[0]).toMatch(/ya existe|cuenta|email/i);
    expect(mocks.redirectMock).not.toHaveBeenCalled();
    expect(mocks.setSessionCookieMock).not.toHaveBeenCalled();
  });

  it("returns state.errors._form when Neon rejects a weak password (400) and does not redirect", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ message: "Password is too weak — use at least 8 characters" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await signUpAction(
      {},
      makeFormData({
        email: "weakpw@example.com",
        password: "supersecret123",
        confirmPassword: "supersecret123",
      }),
    );

    expect(result.errors?._form).toBeDefined();
    expect(result.errors?._form?.[0]).toMatch(/contraseñ|requisitos|seguridad/i);
    expect(mocks.redirectMock).not.toHaveBeenCalled();
    expect(mocks.setSessionCookieMock).not.toHaveBeenCalled();
  });

  it("returns state.errors.confirmPassword when passwords mismatch (Zod refinement — no Neon call)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await signUpAction(
      {},
      makeFormData({
        email: "mismatch@example.com",
        password: "supersecret123",
        confirmPassword: "DIFFERENT",
      }),
    );

    expect(result.errors?.confirmPassword).toBeDefined();
    expect(result.errors?.confirmPassword?.[0]).toMatch(/match/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.redirectMock).not.toHaveBeenCalled();
    expect(mocks.setSessionCookieMock).not.toHaveBeenCalled();
  });

  it("returns state.errors.email when the email is not RFC-compliant (no Neon call)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await signUpAction(
      {},
      makeFormData({
        email: "not-an-email",
        password: "supersecret123",
        confirmPassword: "supersecret123",
      }),
    );

    expect(result.errors?.email).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.redirectMock).not.toHaveBeenCalled();
  });

  it("returns a uniform network-error state.errors._form when Neon is unreachable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await signUpAction(
      {},
      makeFormData({
        email: "offline@example.com",
        password: "supersecret123",
        confirmPassword: "supersecret123",
      }),
    );

    expect(result.errors?._form).toBeDefined();
    expect(mocks.redirectMock).not.toHaveBeenCalled();
    expect(mocks.setSessionCookieMock).not.toHaveBeenCalled();
  });
});