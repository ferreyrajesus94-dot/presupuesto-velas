import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("../../src/server/auth/ownerEnv", () => ({
  getNeonAuthBaseUrl: () => "https://auth.example.test",
}));

import { cookies } from "next/headers";
import {
  clearSessionCookie,
  fetchSessionUser,
  setSessionCookie,
  type NeonSessionCookieName,
} from "../../src/server/auth/session";

const mockedCookies = vi.mocked(cookies);

describe("Neon session cookie forwarding", () => {
  let storedValue: string | undefined;
  let storedVariant: string | undefined;

  beforeEach(() => {
    storedValue = undefined;
    storedVariant = undefined;
    mockedCookies.mockResolvedValue({
      get: (name: string) => {
        const value = name === "session" ? storedValue : storedVariant;
        return value ? { value } : undefined;
      },
      set: (name: string, value: string) => {
        if (name === "session") storedValue = value;
        else storedVariant = value;
      },
      delete: (name: string) =>
        name === "session" ? (storedValue = undefined) : (storedVariant = undefined),
    } as never);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ user: { id: "owner-1", email: "owner@example.com" } })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each<NeonSessionCookieName>([
    "__Secure-neon-auth.session_token",
    "neon-auth.session_token",
    "better-auth.session_token",
  ])("forwards the selected supported cookie identity %s", async (cookieName) => {
    await setSessionCookie("tok-xyz", cookieName);
    expect(storedValue).toBe("tok-xyz");

    await expect(fetchSessionUser()).resolves.toEqual({
      id: "owner-1",
      email: "owner@example.com",
    });
    expect(fetch).toHaveBeenCalledWith("https://auth.example.test/get-session", {
      headers: { Cookie: `${cookieName}=tok-xyz` },
      cache: "no-store",
    });
  });

  it.each([undefined, "invalid"])("uses legacy upstream for marker %s", async (variant) => {
    storedValue = "legacy-token";
    storedVariant = variant;

    await fetchSessionUser();

    expect(fetch).toHaveBeenCalledWith(
      "https://auth.example.test/get-session",
      expect.objectContaining({
        headers: { Cookie: "better-auth.session_token=legacy-token" },
      }),
    );
  });

  it("clears the session and upstream marker", async () => {
    await setSessionCookie("tok-xyz", "neon-auth.session_token");
    await clearSessionCookie();
    expect([storedValue, storedVariant]).toEqual([undefined, undefined]);
  });
});
