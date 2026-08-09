import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR3.auth-ui (Task 3.7) — `resendVerificationAction` RED-first unit test.
 *
 * Covers the VERIFY-GATE scenario from SPEC §3 (auth-public-signup):
 *   - The resend action POSTs to Neon Auth `/send-verification-email` with
 *     the CURRENT session's email. The Neon endpoint handles both `link`
 *     and `otp` verification modes (mode is configured on the branch, not
 *     on the per-request body — SPEC amendment 2026-08-07).
 *   - When there is NO session, the action MUST error gracefully (the
 *     user is redirected to `/sign-in` from the page; the action itself
 *     never trusts anonymous POSTs to mail someone).
 *   - On 2xx the action returns a success state the form can display.
 *   - On 4xx/5xx the action returns a localized `state.errors._form`.
 *
 * Strict TDD: this file references `resendVerificationAction` and
 * `ResendVerificationState` which do not exist yet. The import will FAIL
 * to resolve → RED. Task 3.7 then writes the minimum production code to
 * make these tests pass → GREEN.
 */

const mocks = vi.hoisted(() => {
  return {
    fetchSessionUserMock: vi.fn(),
  };
});

vi.mock("../../src/server/auth/userEnv", () => ({
  getNeonAuthBaseUrl: () => "https://auth.example.test",
}));
vi.mock("../../src/server/auth/appBaseUrl", () => ({
  getAppBaseUrl: () => "https://app.test.local",
}));
vi.mock("../../src/server/auth/session", () => ({
  fetchSessionUser: mocks.fetchSessionUserMock,
}));

import { resendVerificationAction } from "../../src/server/actions/resendVerification";

function makeFormData(): FormData {
  // The action reads the email from the SESSION, not from the form body.
  // An attacker that POSTs `email=victim@example.com` cannot redirect the
  // verification mail. We still pass an arbitrary `email` field to prove
  // it is ignored.
  const fd = new FormData();
  fd.set("email", "attacker@example.com");
  return fd;
}

const NEON_RESEND_OK = () =>
  new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const NEON_RESEND_RATELIMIT = () =>
  new Response(JSON.stringify({ message: "Too many requests" }), {
    status: 429,
    headers: { "Content-Type": "application/json" },
  });

describe("resendVerificationAction public verify-email (PR3 task 3.7)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.fetchSessionUserMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("passes callbackURL pointing to /verify-email so Better Auth can include it in the email body when supported", async () => {
    mocks.fetchSessionUserMock.mockResolvedValue({
      id: "u-pending-5",
      email: "callback@example.com",
    });
    const fetchMock = vi.fn().mockResolvedValue(NEON_RESEND_OK());
    vi.stubGlobal("fetch", fetchMock);

    await resendVerificationAction({}, makeFormData());

    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(calledInit.body));
    expect(body.callbackURL).toBe("https://app.test.local/verify-email");
  });

  it("sends Origin header matching the configured APP_BASE_URL", async () => {
    mocks.fetchSessionUserMock.mockResolvedValue({
      id: "u-pending-6",
      email: "origin@example.com",
    });
    const fetchMock = vi.fn().mockResolvedValue(NEON_RESEND_OK());
    vi.stubGlobal("fetch", fetchMock);

    await resendVerificationAction({}, makeFormData());

    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((calledInit.headers as Record<string, string>).Origin).toBe("https://app.test.local");
  });

  it("returns a form error and performs no Neon POST when there is no session", async () => {
    mocks.fetchSessionUserMock.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await resendVerificationAction({}, makeFormData());

    expect(result.errors?._form).toBeDefined();
    // Localized user-facing copy — "Necesitás iniciar sesión."
    expect(result.errors?._form?.[0]).toMatch(/sesi[oó]n|inici[áa]|necesit/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs Neon /send-verification-email with the SESSION email (not the form body)", async () => {
    mocks.fetchSessionUserMock.mockResolvedValue({
      id: "u-pending-1",
      email: "pending@example.com",
    });
    const fetchMock = vi.fn().mockResolvedValue(NEON_RESEND_OK());
    vi.stubGlobal("fetch", fetchMock);

    const result = await resendVerificationAction({}, makeFormData());

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("https://auth.example.test/send-verification-email");
    expect(calledInit.method).toBe("POST");
    const body = JSON.parse(String(calledInit.body));
    // Critical: the SESSION email — not the attacker's form-supplied email.
    expect(body.email).toBe("pending@example.com");
    expect(body.email).not.toBe("attacker@example.com");
  });

  it("returns ok=true on a Neon 200 with no email-verification-mode switch (mode-agnostic)", async () => {
    mocks.fetchSessionUserMock.mockResolvedValue({
      id: "u-pending-2",
      email: "another@example.com",
    });
    const fetchMock = vi.fn().mockResolvedValue(NEON_RESEND_OK());
    vi.stubGlobal("fetch", fetchMock);

    const result = await resendVerificationAction({}, makeFormData());

    expect(result.ok).toBe(true);
    expect(result.errors).toBeUndefined();
    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(calledInit.body));
    // The action does NOT pass `email_verification`. The Neon endpoint
    // honors the branch-configured mode (`link` or `otp`) regardless of
    // per-request body — SPEC amendment 2026-08-07.
    expect(body.email_verification).toBeUndefined();
  });

  it("returns a localized form error when Neon responds 429 (rate limit)", async () => {
    mocks.fetchSessionUserMock.mockResolvedValue({
      id: "u-pending-3",
      email: "ratelimited@example.com",
    });
    const fetchMock = vi.fn().mockResolvedValue(NEON_RESEND_RATELIMIT());
    vi.stubGlobal("fetch", fetchMock);

    const result = await resendVerificationAction({}, makeFormData());

    expect(result.ok).toBeFalsy();
    expect(result.errors?._form).toBeDefined();
    expect(result.errors?._form?.[0]).toMatch(/reintent|esper|ratelimit|moment/i);
  });

  it("returns a uniform form error when Neon responds 5xx (network/upstream)", async () => {
    mocks.fetchSessionUserMock.mockResolvedValue({
      id: "u-pending-4",
      email: "offline@example.com",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resendVerificationAction({}, makeFormData());

    expect(result.errors?._form).toBeDefined();
  });
});
