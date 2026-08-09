"use server";
import { getAppBaseUrl } from "../auth/appBaseUrl";
import { getNeonAuthBaseUrl } from "../auth/userEnv";
import { fetchSessionUser } from "../auth/session";

/**
 * PR3.auth-ui (Task 3.7) — `resendVerificationAction`.
 *
 * Re-triggers Neon Auth `/send-verification-email` for the CURRENT
 * session's email. SPEC amendment 2026-08-07: the Neon endpoint honors
 * the branch-configured verification mode (`link` or `otp`) regardless
 * of the per-request body, so this action never sets `email_verification`
 * — the same action works whether Neon is configured for link-based or
 * OTP-based email verification.
 *
 * Security:
 *   - The email is sourced from `fetchSessionUser()`, NEVER from the
 *     form body. An attacker POSTing `email=victim@example.com` cannot
 *     redirect the verification mail.
 *   - When there is no session, the action errors gracefully (the page
 *     layer is responsible for redirecting unsigned visitors to
 *     `/sign-in`; the action itself never trusts anonymous POSTs).
 *
 * Mirrors the structure of `signUpAction` and `signInAction`: localized
 * form errors, no cookie extraction (verification-first flow), mode-
 * agnostic body.
 */

export type ResendVerificationState = {
  ok?: boolean;
  errors?: { _form?: string[] };
};

function localizedResendError(upstreamMessage: string | null, status: number): string {
  const lower = upstreamMessage?.toLowerCase() ?? "";
  if (lower.includes("too many") || lower.includes("rate") || status === 429) {
    return "Esperá unos minutos antes de reenviar el email de verificación.";
  }
  return "No pudimos reenviar el email. Intentá de nuevo en unos minutos.";
}

export async function resendVerificationAction(
  _prev: ResendVerificationState,
  _formData: FormData,
): Promise<ResendVerificationState> {
  // The action sources the email from the session, not the form body, so
  // the unused FormData is intentional. The signature must remain
  // `useActionState`-compatible.
  void _formData;
  const session = await fetchSessionUser();
  if (!session) {
    return {
      errors: { _form: ["Necesitás iniciar sesión para reenviar el email de verificación."] },
    };
  }

  const base = getNeonAuthBaseUrl();
  const appBaseUrl = getAppBaseUrl();
  const res = await fetch(`${base}/send-verification-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: appBaseUrl,
    },
    body: JSON.stringify({
      email: session.email,
      callbackURL: `${appBaseUrl}/verify-email`,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    const upstreamMessage = typeof body?.message === "string" ? body.message : null;
    return {
      errors: { _form: [localizedResendError(upstreamMessage, res.status)] },
    };
  }

  return { ok: true };
}
