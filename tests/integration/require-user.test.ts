import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * PR2.auth-core (Task 2.10) — renamed + rewritten for the user era.
 *
 * Replaces `tests/integration/requireOwner.test.ts`. Asserts the
 * `requireUser()` redirect matrix at the integration boundary:
 *   - no session cookie                 → `redirect('/sign-in?next=...')`
 *   - session + Neon Auth 200 null body → `redirect('/sign-in?next=...')` (stale cookie)
 *   - verified session                 → returns `{ id, email, role, emailVerified }`
 *   - unverified session               → `redirect('/sign-in?hint=verify-email')`
 *
 * The old `/403` "non-owner denial" test is gone — the legacy allowlist is
 * retired. The bootstrap-promotion matrix is covered by
 * `tests/integration/app-user-bootstrap.test.ts`.
 *
 * `requireUser` is exported as a fresh module here (no shared shim): the
 * route handler is no longer `requireOwner`, so the test asserts the new
 * contract end-to-end without leaking the owner-era allowlist semantics.
 */

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const err = new Error(`__redirect:${url}`) as Error & { __redirect?: string };
    err.__redirect = url;
    throw err;
  }),
}));
vi.mock("../../src/server/auth/userEnv", () => ({
  getNeonAuthBaseUrl: () => "https://example.test/auth",
  getBootstrapOwnerEmail: () => "bootstrap-owner@example.com",
}));

import { cookies } from "next/headers";
import { requireUser } from "../../src/server/auth/requireUser";

const mockedCookies = vi.mocked(cookies);

function setSessionCookieValue(value: string | undefined) {
  mockedCookies.mockResolvedValue({
    get: (name: string) => (name === "session" && value ? { value } : undefined),
  } as never);
}

describe("requireUser (synchronized deny test)", () => {
  let realFetch: typeof fetch;
  beforeEach(() => {
    realFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
    vi.clearAllMocks();
  });

  it("redirects to /sign-in?next=/ when the session cookie is missing", async () => {
    setSessionCookieValue(undefined);
    await expect(requireUser()).rejects.toMatchObject({
      __redirect: "/sign-in?next=%2F",
    });
  });

  it("redirects to /sign-in?next=/ when Neon Auth returns no user (stale cookie)", async () => {
    setSessionCookieValue("stale-token");
    global.fetch = vi.fn(
      async () =>
        new Response("null", { status: 200, headers: { "Content-Type": "application/json" } }),
    ) as typeof fetch;
    await expect(requireUser()).rejects.toMatchObject({
      __redirect: "/sign-in?next=%2F",
    });
  });

  it("redirects to /sign-in?hint=verify-email when the session exists but emailVerified=false", async () => {
    setSessionCookieValue("unverified-token");
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ user: { id: "u-1", email: "u@example.com", emailVerified: false } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    await expect(requireUser()).rejects.toMatchObject({
      __redirect: "/sign-in?hint=verify-email",
    });
  });

  it("returns the verified user with role + emailVerified when the session is valid", async () => {
    setSessionCookieValue("verified-token");
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            user: {
              id: "u-1",
              email: "u@example.com",
              emailVerified: true,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    const user = await requireUser();
    expect(user.id).toBe("u-1");
    expect(user.email).toBe("u@example.com");
    expect(user.emailVerified).toBe(true);
    // role is whatever upsertUser decides (mocked elsewhere; here we just
    // assert shape presence).
    expect(["owner", "user"]).toContain(user.role);
    // Verify the /get-session call used the cookie we set
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://example.test/auth/get-session");
    expect((init as RequestInit).headers).toMatchObject({
      Cookie: "better-auth.session_token=verified-token",
    });
  });

  it("forwards a custom `pathname` as the `next` query parameter on missing session", async () => {
    setSessionCookieValue(undefined);
    await expect(requireUser({ pathname: "/quotes/abc" })).rejects.toMatchObject({
      __redirect: "/sign-in?next=%2Fquotes%2Fabc",
    });
  });
});