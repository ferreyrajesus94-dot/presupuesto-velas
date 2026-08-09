import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyEmailOtpAction } from "@/server/actions/verifyEmailOtp";

// Mock next/navigation redirect
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

// Mock userEnv + session
let mockSessionEmail: string | null = null;
vi.mock("@/server/auth/session", () => ({
  fetchSessionUser: async () =>
    mockSessionEmail ? { id: "u-1", email: mockSessionEmail, role: "user", emailVerified: false } : null,
}));
vi.mock("@/server/auth/userEnv", () => ({
  getNeonAuthBaseUrl: () => "https://auth.test.local",
}));
vi.mock("@/server/auth/appBaseUrl", () => ({
  getAppBaseUrl: () => "https://app.test.local",
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function makeForm(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

describe("verifyEmailOtpAction", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    fetchMock.mockReset();
    mockSessionEmail = null;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects invalid email format", async () => {
    const state = await verifyEmailOtpAction({}, makeForm({ email: "not-an-email", otp: "123456" }));
    expect(state.errors?.email?.[0]).toMatch(/inválido/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects otp that is not 6 digits", async () => {
    const state = await verifyEmailOtpAction({}, makeForm({ email: "a@b.com", otp: "12345" }));
    expect(state.errors?.otp?.[0]).toMatch(/6 dígitos/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects otp with non-numeric characters", async () => {
    const state = await verifyEmailOtpAction({}, makeForm({ email: "a@b.com", otp: "12345a" }));
    expect(state.errors?.otp?.[0]).toMatch(/6 dígitos/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses session email when form email is empty", async () => {
    mockSessionEmail = "session@example.com";
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    try {
      await verifyEmailOtpAction({}, makeForm({ email: "", otp: "123456" }));
    } catch (e) {
      // redirect throws — expected
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ email: "session@example.com", otp: "123456" });
  });

  it("uses form email when no session", async () => {
    mockSessionEmail = null;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    try {
      await verifyEmailOtpAction({}, makeForm({ email: "form@example.com", otp: "123456" }));
    } catch {
      // redirect throws
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ email: "form@example.com", otp: "123456" });
  });

  it("lowercases the email before posting", async () => {
    mockSessionEmail = null;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    try {
      await verifyEmailOtpAction({}, makeForm({ email: "Foo@Bar.COM", otp: "123456" }));
    } catch {}
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).email).toBe("foo@bar.com");
  });

  it("redirects to /sign-in?verified=1 on 200", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await expect(
      verifyEmailOtpAction({}, makeForm({ email: "a@b.com", otp: "123456" })),
    ).rejects.toThrow(/NEXT_REDIRECT:\/sign-in\?verified=1/);
  });

  it("returns localized error on 400 INVALID_OTP", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "INVALID_OTP", message: "Invalid OTP" }), { status: 400 }),
    );
    const state = await verifyEmailOtpAction({}, makeForm({ email: "a@b.com", otp: "123456" }));
    expect(state.errors?._form?.[0]).toMatch(/código inválido o expirado/i);
  });

  it("returns localized error on 429 rate-limit", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "RATE_LIMITED", message: "Too many requests" }), { status: 429 }),
    );
    const state = await verifyEmailOtpAction({}, makeForm({ email: "a@b.com", otp: "123456" }));
    expect(state.errors?._form?.[0]).toMatch(/demasiados intentos/i);
  });

  it("returns generic error on 500 with no upstream message", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }));
    const state = await verifyEmailOtpAction({}, makeForm({ email: "a@b.com", otp: "123456" }));
    expect(state.errors?._form?.[0]).toMatch(/no pudimos verificar/i);
  });

  it("sends the Origin header from getAppBaseUrl", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    try {
      await verifyEmailOtpAction({}, makeForm({ email: "a@b.com", otp: "123456" }));
    } catch {}
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Origin).toBe("https://app.test.local");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("posts to /sign-in/email-otp", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    try {
      await verifyEmailOtpAction({}, makeForm({ email: "a@b.com", otp: "123456" }));
    } catch {}
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://auth.test.local/sign-in/email-otp");
  });
});