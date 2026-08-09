import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyEmailOtpAction } from "@/server/actions/verifyEmailOtp";

// Mock next/navigation redirect
const mocks = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  setSessionCookieMock: vi.fn(),
  fetchMock: vi.fn(),
}));
let mockSessionEmail: string | null = null;

vi.mock("next/navigation", () => ({
  redirect: (url: string) => mocks.redirectMock(url),
}));

vi.mock("@/server/auth/session", () => ({
  fetchSessionUser: async () =>
    mockSessionEmail ? { id: "u-1", email: mockSessionEmail, role: "user", emailVerified: false } : null,
  setSessionCookie: mocks.setSessionCookieMock,
  NEON_SESSION_COOKIE_NAMES: [
    "__Secure-neon-auth.session_token",
    "neon-auth.session_token",
    "better-auth.session_token",
  ] as const,
}));
vi.mock("@/server/auth/userEnv", () => ({
  getNeonAuthBaseUrl: () => "https://auth.test.local",
}));
vi.mock("@/server/auth/appBaseUrl", () => ({
  getAppBaseUrl: () => "https://app.test.local",
}));

vi.stubGlobal("fetch", mocks.fetchMock);

function makeForm(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

describe("verifyEmailOtpAction", () => {
beforeEach(() => {
  mocks.redirectMock.mockClear();
  mocks.setSessionCookieMock.mockReset();
  mocks.fetchMock.mockReset();
  mockSessionEmail = null;
});
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects invalid email format", async () => {
    const state = await verifyEmailOtpAction({}, makeForm({ email: "not-an-email", otp: "123456" }));
    expect(state.errors?.email?.[0]).toMatch(/inválido/i);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects otp that is not 6 digits", async () => {
    const state = await verifyEmailOtpAction({}, makeForm({ email: "a@b.com", otp: "12345" }));
    expect(state.errors?.otp?.[0]).toMatch(/6 dígitos/i);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects otp with non-numeric characters", async () => {
    const state = await verifyEmailOtpAction({}, makeForm({ email: "a@b.com", otp: "12345a" }));
    expect(state.errors?.otp?.[0]).toMatch(/6 dígitos/i);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it("uses session email when form email is empty", async () => {
    mockSessionEmail = "session@example.com";
    mocks.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    try {
      await verifyEmailOtpAction({}, makeForm({ email: "", otp: "123456" }));
    } catch (e) {
      // redirect throws — expected
    }
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = mocks.fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ email: "session@example.com", otp: "123456" });
  });

  it("uses form email when no session", async () => {
    mockSessionEmail = null;
    mocks.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    try {
      await verifyEmailOtpAction({}, makeForm({ email: "form@example.com", otp: "123456" }));
    } catch {
      // redirect throws
    }
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = mocks.fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ email: "form@example.com", otp: "123456" });
  });

  it("lowercases the email before posting", async () => {
    mockSessionEmail = null;
    mocks.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    try {
      await verifyEmailOtpAction({}, makeForm({ email: "Foo@Bar.COM", otp: "123456" }));
    } catch {}
    const [, init] = mocks.fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).email).toBe("foo@bar.com");
  });

it("redirects to / on 200 (which triggers requireUser → app_user upsert + role='owner' promotion)", async () => {
    mocks.fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await expect(
      verifyEmailOtpAction({}, makeForm({ email: "a@b.com", otp: "123456" })),
    ).rejects.toThrow(/NEXT_REDIRECT:\/$/);
  });

  it("returns localized error on 400 INVALID_OTP", async () => {
    mocks.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "INVALID_OTP", message: "Invalid OTP" }), { status: 400 }),
    );
    const state = await verifyEmailOtpAction({}, makeForm({ email: "a@b.com", otp: "123456" }));
    expect(state.errors?._form?.[0]).toMatch(/código inválido o expirado/i);
  });

  it("returns localized error on 429 rate-limit", async () => {
    mocks.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "RATE_LIMITED", message: "Too many requests" }), { status: 429 }),
    );
    const state = await verifyEmailOtpAction({}, makeForm({ email: "a@b.com", otp: "123456" }));
    expect(state.errors?._form?.[0]).toMatch(/demasiados intentos/i);
  });

  it("returns generic error on 500 with no upstream message", async () => {
    mocks.fetchMock.mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }));
    const state = await verifyEmailOtpAction({}, makeForm({ email: "a@b.com", otp: "123456" }));
    expect(state.errors?._form?.[0]).toMatch(/no pudimos verificar/i);
  });

  it("sends the Origin header from getAppBaseUrl", async () => {
    mocks.fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    try {
      await verifyEmailOtpAction({}, makeForm({ email: "a@b.com", otp: "123456" }));
    } catch {}
    const [, init] = mocks.fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Origin).toBe("https://app.test.local");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("posts to /email-otp/verify-email (Better Auth OTP plugin endpoint for email verification)", async () => {
    mocks.fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    try {
      await verifyEmailOtpAction({}, makeForm({ email: "a@b.com", otp: "123456" }));
    } catch {}
    const [url] = mocks.fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://auth.test.local/email-otp/verify-email");
  });

  it("extracts the Better Auth session cookie from set-cookie and forwards it to setSessionCookie (auto-sign-in)", async () => {
    mockSessionEmail = null;
    mocks.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: {
          "set-cookie":
            "__Secure-neon-auth.session_token=jwt-abc.DefGhi; HttpOnly; Path=/; SameSite=Lax",
        },
      }),
    );
    try {
      await verifyEmailOtpAction({}, makeForm({ email: "a@b.com", otp: "123456" }));
    } catch {}
    // setSessionCookie called once with the JWT and the upstream name
    expect(mocks.setSessionCookieMock).toHaveBeenCalledTimes(1);
    expect(mocks.setSessionCookieMock).toHaveBeenCalledWith("jwt-abc.DefGhi", "__Secure-neon-auth.session_token");
  });

  it("does not call setSessionCookie when Better Auth does not return a set-cookie header (defensive)", async () => {
    mockSessionEmail = null;
    mocks.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: true }), { status: 200 }),
    );
    try {
      await verifyEmailOtpAction({}, makeForm({ email: "a@b.com", otp: "123456" }));
    } catch {}
    expect(mocks.setSessionCookieMock).not.toHaveBeenCalled();
  });
});