import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/auth/ownerEnv", () => ({
  getNeonAuthBaseUrl: () => "https://auth.example.test",
}));
vi.mock("../../src/server/auth/session", () => ({ setSessionCookie: vi.fn() }));
vi.mock("../../src/server/repositories/owner", () => ({ upsertOwner: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { signInAction } from "../../src/server/actions/signIn";

describe("signInAction application URL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses one normalized production origin for the Origin header and callback", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://app.example.com/");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const formData = new FormData();
    formData.set("email", "owner@example.com");
    formData.set("password", "secret");

    await signInAction({}, formData);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://auth.example.test/sign-in/email",
      expect.objectContaining({
        headers: expect.objectContaining({ Origin: "https://app.example.com" }),
        body: JSON.stringify({
          email: "owner@example.com",
          password: "secret",
          callbackURL: "https://app.example.com/",
        }),
      }),
    );
  });
});
