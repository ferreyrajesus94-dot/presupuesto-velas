import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR3.auth-ui (Task 3.5) — `signUpAction` RED-first unit test.
 *
 * Covers the SIGN-UP scenario from SPEC §2 (auth-public-signup):
 *   - Happy path: valid email + matching passwords → Neon POST
 *     `/sign-up/email` is issued with `email_verification: 'link'`, the
 *     user is upserted in Neon Auth with `emailVerified=false`, and the
 *     action redirects to `/sign-in?hint=verify-email`. NO session
 *     cookie is set (verification-first flow).
 *   - Duplicate email: Neon returns 4xx → action returns
 *     `state.errors._form` and no redirect, no upsertUser call.
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

const NEON_SIGNUP_OK = (overrides: { id?: string; email?: string } = {}) =>
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
        // Critical: NO Set-Cookie. Verification-first flow does not
        // establish a session until the user clicks the email link.
      },
    },
  );

describe("signUpAction public sign-up (PR3 task 3.4)", () => {
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

  it("redirects to /sign-in?hint=verify-email on a happy path Neon /sign-up/email 200", async () => {
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
    ).rejects.toMatchObject({ __redirect: "/sign-in?hint=verify-email" });

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
    // Verification-first: no session cookie is set.
    expect(mocks.setSessionCookieMock).not.toHaveBeenCalled();
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
    ).rejects.toMatchObject({ __redirect: "/sign-in?hint=verify-email" });

    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(calledInit.body));
    expect(body.name).toBe("ada.lovelace");
    expect(mocks.setSessionCookieMock).not.toHaveBeenCalled();
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
    expect(result.errors?._form?.[0]).toMatch(/already|exists|registered/i);
    expect(mocks.redirectMock).not.toHaveBeenCalled();
    expect(mocks.setSessionCookieMock).not.toHaveBeenCalled();
  });

  it("returns state.errors._form when Neon rejects a weak password (400) and does not redirect", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
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
    expect(result.errors?._form?.[0]).toMatch(/password/i);
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
    // Neon MUST NOT be called when the form fails local validation.
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
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 502 }),
    );
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
