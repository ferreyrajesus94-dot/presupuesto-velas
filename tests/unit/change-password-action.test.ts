import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/headers cookies
const mocks = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  fetchMock: vi.fn(),
  cookiesMock: vi.fn(),
}));
let cookieJar: Record<string, { value: string }> = {};

vi.mock("next/navigation", () => ({
  redirect: (url: string) => mocks.redirectMock(url),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => cookieJar[name],
    set: vi.fn(),
  }),
}));

vi.mock("@/server/auth/userEnv", () => ({
  getNeonAuthBaseUrl: () => "https://auth.test.local",
}));
vi.mock("@/server/auth/appBaseUrl", () => ({
  getAppBaseUrl: () => "https://app.test.local",
}));

vi.stubGlobal("fetch", mocks.fetchMock);

import { changePasswordAction } from "@/server/actions/changePassword";

function makeForm(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

describe("changePasswordAction", () => {
  beforeEach(() => {
    mocks.redirectMock.mockClear();
    mocks.fetchMock.mockReset();
    mocks.cookiesMock.mockReset();
    cookieJar = {
      session: { value: "jwt-token-abc" },
      "session-upstream": { value: "b" }, // better-auth.session_token
    };
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects empty currentPassword", async () => {
    const state = await changePasswordAction(
      {},
      makeForm({ currentPassword: "", newPassword: "newpass123", confirmPassword: "newpass123" }),
    );
    expect(state.errors?.currentPassword).toBeDefined();
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects newPassword shorter than 8 characters", async () => {
    const state = await changePasswordAction(
      {},
      makeForm({ currentPassword: "old", newPassword: "short", confirmPassword: "short" }),
    );
    expect(state.errors?.newPassword?.[0]).toMatch(/8 caracteres/i);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when newPassword !== confirmPassword", async () => {
    const state = await changePasswordAction(
      {},
      makeForm({ currentPassword: "old", newPassword: "newpass123", confirmPassword: "different" }),
    );
    expect(state.errors?.confirmPassword?.[0]).toMatch(/no coinciden/i);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when newPassword === currentPassword", async () => {
    const state = await changePasswordAction(
      {},
      makeForm({ currentPassword: "samepass123", newPassword: "samepass123", confirmPassword: "samepass123" }),
    );
    expect(state.errors?.newPassword?.[0]).toMatch(/distinta/i);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the upstream session cookie in the Cookie header (Better Auth auth)", async () => {
    mocks.fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await changePasswordAction(
      {},
      makeForm({ currentPassword: "oldpass", newPassword: "newpass123", confirmPassword: "newpass123" }),
    );
    const [calledUrl, init] = mocks.fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Cookie ?? headers.cookie).toBe("better-auth.session_token=jwt-token-abc");
  });

  it("uses __Secure-neon-auth.session_token when upstream variant is 'p'", async () => {
    cookieJar["session-upstream"] = { value: "p" };
    mocks.fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await changePasswordAction(
      {},
      makeForm({ currentPassword: "oldpass", newPassword: "newpass123", confirmPassword: "newpass123" }),
    );
    const [, init] = mocks.fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Cookie).toBe(
      "__Secure-neon-auth.session_token=jwt-token-abc",
    );
  });

  it("uses neon-auth.session_token when upstream variant is 'n'", async () => {
    cookieJar["session-upstream"] = { value: "n" };
    mocks.fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await changePasswordAction(
      {},
      makeForm({ currentPassword: "oldpass", newPassword: "newpass123", confirmPassword: "newpass123" }),
    );
    const [, init] = mocks.fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Cookie).toBe(
      "neon-auth.session_token=jwt-token-abc",
    );
  });

  it("posts to /change-password with currentPassword + newPassword in body", async () => {
    mocks.fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await changePasswordAction(
      {},
      makeForm({ currentPassword: "oldpass", newPassword: "newpass123", confirmPassword: "newpass123" }),
    );
    const [url, init] = mocks.fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://auth.test.local/change-password");
    expect(JSON.parse(init.body as string)).toEqual({
      currentPassword: "oldpass",
      newPassword: "newpass123",
    });
  });

  it("returns ok=true on 200", async () => {
    mocks.fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const state = await changePasswordAction(
      {},
      makeForm({ currentPassword: "oldpass", newPassword: "newpass123", confirmPassword: "newpass123" }),
    );
    expect(state.ok).toBe(true);
    expect(state.errors).toBeUndefined();
  });

  it("returns currentPassword field error when Better Auth rejects INVALID_PASSWORD (400)", async () => {
    mocks.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "INVALID_PASSWORD", message: "Invalid password" }), {
        status: 400,
      }),
    );
    const state = await changePasswordAction(
      {},
      makeForm({ currentPassword: "wrongpass", newPassword: "newpass123", confirmPassword: "newpass123" }),
    );
    expect(state.errors?.currentPassword?.[0]).toMatch(/actual es incorrecta/i);
    expect(state.errors?._form).toBeUndefined();
  });

  it("returns newPassword field error when Better Auth rejects password policy violation", async () => {
    mocks.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Password too short" }), { status: 400 }),
    );
    const state = await changePasswordAction(
      {},
      makeForm({ currentPassword: "oldpass", newPassword: "newpass123", confirmPassword: "newpass123" }),
    );
    expect(state.errors?.newPassword?.[0]).toMatch(/8 caracteres/i);
  });

  it("returns _form error on 401 (expired session)", async () => {
    mocks.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "UNAUTHORIZED" }), { status: 401 }),
    );
    const state = await changePasswordAction(
      {},
      makeForm({ currentPassword: "oldpass", newPassword: "newpass123", confirmPassword: "newpass123" }),
    );
    expect(state.errors?._form?.[0]).toMatch(/sesi[oó]n expir/i);
  });

  it("returns _form error on 5xx with no message", async () => {
    mocks.fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const state = await changePasswordAction(
      {},
      makeForm({ currentPassword: "oldpass", newPassword: "newpass123", confirmPassword: "newpass123" }),
    );
    expect(state.errors?._form?.[0]).toMatch(/no pudimos cambiar/i);
  });

  it("sets the Origin header from getAppBaseUrl", async () => {
    mocks.fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await changePasswordAction(
      {},
      makeForm({ currentPassword: "oldpass", newPassword: "newpass123", confirmPassword: "newpass123" }),
    );
    const [, init] = mocks.fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Origin).toBe("https://app.test.local");
  });
});