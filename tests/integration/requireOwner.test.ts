import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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
vi.mock("../../src/server/auth/ownerEnv", () => ({
  getNeonAuthBaseUrl: () => "https://example.test/auth",
  getOwnerId: () => "owner-1",
  getOwnerEmail: () => "owner@example.com",
}));

import { cookies } from "next/headers";
import { requireOwner } from "../../src/server/auth/requireOwner";

const mockedCookies = vi.mocked(cookies);

function setSessionCookieValue(value: string | undefined) {
  mockedCookies.mockResolvedValue({
    get: (name: string) => (name === "session" && value ? { value } : undefined),
  } as never);
}

describe("requireOwner (synchronized deny test)", () => {
  let realFetch: typeof fetch;
  beforeEach(() => {
    realFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
    vi.clearAllMocks();
  });

  it("redirects to /sign-in when the session cookie is missing", async () => {
    setSessionCookieValue(undefined);
    await expect(requireOwner()).rejects.toMatchObject({ __redirect: "/sign-in" });
  });

  it("redirects to /sign-in when Neon Auth returns no user (stale cookie)", async () => {
    setSessionCookieValue("stale-token");
    global.fetch = vi.fn(
      async () =>
        new Response("null", { status: 200, headers: { "Content-Type": "application/json" } }),
    ) as typeof fetch;
    await expect(requireOwner()).rejects.toMatchObject({ __redirect: "/sign-in" });
  });

  it("redirects to /403 when a valid session belongs to a different user (NON-OWNER DENIAL)", async () => {
    setSessionCookieValue("intruder-token");
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ user: { id: "intruder", email: "intruder@example.com" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as typeof fetch;
    await expect(requireOwner()).rejects.toMatchObject({ __redirect: "/403" });
  });

  it("returns the owner when session matches OWNER_USER_ID and OWNER_EMAIL (case-insensitive email)", async () => {
    setSessionCookieValue("owner-token");
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ user: { id: "owner-1", email: "OWNER@example.com" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as typeof fetch;
    const user = await requireOwner();
    expect(user.id).toBe("owner-1");
    expect(user.email.toLowerCase()).toBe("owner@example.com");
    // Verify the /get-session call used the cookie we set
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://example.test/auth/get-session");
    expect((init as RequestInit).headers).toMatchObject({
      Cookie: "better-auth.session_token=owner-token",
    });
  });
});
