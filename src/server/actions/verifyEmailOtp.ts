"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAppBaseUrl } from "../auth/appBaseUrl";
import { getNeonAuthBaseUrl } from "../auth/userEnv";
import {
  NEON_SESSION_COOKIE_NAMES,
  setSessionCookie,
  type NeonSessionCookieName,
} from "../auth/session";
import { fetchSessionUser } from "../auth/session";

/**
 * v0.4.3 hotfix — `verifyEmailOtpAction`.
 *
 *   - PR3.2 originally shipped only the resend form, leaving users with
 *     no way to submit the 6-digit OTP. v0.4.1 added the VerifyOtpForm
 *     and the action — but the action posted to `/sign-in/email-otp`,
 *     which is Better Auth's SIGN-IN-with-OTP endpoint (not email
 *     verification). Every OTP was rejected with INVALID_OTP.
 *
 *   - v0.4.3 fix: post to `/email-otp/verify-email`, which is Better
 *     Auth's OTP plugin endpoint for email verification after sign-up.
 *     The endpoint accepts `{ email, otp }`, hashes the OTP the same way
 *     as the generator (SHA-256, base64url-encoded, no salt), and on
 *     match sets `emailVerified = true` and returns a session token.
 *
 *   - Auto-sign-in: Better Auth's response includes `token` (a session
 *     JWT). We extract it the same way `signInAction` does, set our
 *     `session` cookie + `session-upstream` cookie, and redirect to
 *     `/`. `requireUser` then upserts the `app_user` row (with bootstrap
 *     promotion if the email matches `BOOTSTRAP_OWNER_EMAIL`).
 *
 * Security:
 *   - The OTP is single-use and `expiresAt` is enforced by Better Auth;
 *     we do not cache or replay.
 *   - The session cookie is `httpOnly`, `secure` in production, and
 *     scoped to the same upstream cookie variant Better Auth returned.
 *   - We always source the email from the SESSION (if available) to
 *     prevent an attacker from forcing a different email through the
 *     form body. The form's hidden input still lets the user see what
 *     email we're targeting.
 */

export type VerifyEmailOtpState = {
  errors?: { email?: string[]; otp?: string[]; _form?: string[] };
};

const OtpSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email inválido"),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "El código debe tener 6 dígitos"),
});

function localizedOtpError(upstreamMessage: string | null, status: number): string {
  const lower = upstreamMessage?.toLowerCase() ?? "";
  if (lower.includes("invalid") || status === 400) {
    return "Código inválido o expirado. Pedí uno nuevo con el botón de abajo.";
  }
  if (lower.includes("too many") || lower.includes("rate") || status === 429) {
    return "Demasiados intentos. Esperá unos minutos y volvé a pedir un código.";
  }
  return "No pudimos verificar el código. Intentá de nuevo en unos minutos.";
}

function extractNeonSessionCookie(
  setCookie: string,
): { name: NeonSessionCookieName; rawValue: string } | null {
  for (const name of NEON_SESSION_COOKIE_NAMES) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = setCookie.match(new RegExp(`(?:^|,\\s*)${escapedName}=([^;,]+)`));
    if (match) return { name, rawValue: match[1] };
  }
  return null;
}

export async function verifyEmailOtpAction(
  _prev: VerifyEmailOtpState,
  formData: FormData,
): Promise<VerifyEmailOtpState> {
  const session = await fetchSessionUser();
  const formEmail = String(formData.get("email") ?? "").trim();
  const otp = String(formData.get("otp") ?? "").trim();

  const email = (session?.email ?? formEmail).toLowerCase();
  const parsed = OtpSchema.safeParse({ email, otp });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const base = getNeonAuthBaseUrl();
  const appBaseUrl = getAppBaseUrl();
  const res = await fetch(`${base}/email-otp/verify-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: appBaseUrl,
    },
    body: JSON.stringify({ email: parsed.data.email, otp: parsed.data.otp }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    const upstreamMessage = typeof body?.message === "string" ? body.message : null;
    return {
      errors: { _form: [localizedOtpError(upstreamMessage, res.status)] },
    };
  }

  // Success. Better Auth returns `{ status, token, user }`; the session
  // cookie is also set in the `set-cookie` header. Extract it the same
  // way signInAction does so the `session` + `session-upstream` cookie
  // pair is set on our domain and `requireUser` reads it on the next
  // protected route.
  const setCookie = res.headers.get("set-cookie") ?? "";
  const sessionCookie = extractNeonSessionCookie(setCookie);
  if (sessionCookie) {
    const value = decodeURIComponent(sessionCookie.rawValue);
    await setSessionCookie(value, sessionCookie.name);
  }

  redirect("/");
}