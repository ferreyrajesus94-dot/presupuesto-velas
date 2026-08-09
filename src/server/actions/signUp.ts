"use server";
import { redirect } from "next/navigation";
import { getAppBaseUrl } from "../auth/appBaseUrl";
import { getNeonAuthBaseUrl } from "../auth/userEnv";
import { setSessionCookie } from "../auth/session";
import { extractNeonSessionCookie } from "../auth/neonCookie";
import { SignUpSchema } from "../auth/authSchema";

/**
 * PR3.auth-ui (Task 3.4) — public sign-up server action.
 *
 *   - Validates the form against `SignUpSchema` (email + password +
 *     `confirmPassword` refinement).
 *   - POSTs Neon Auth `/sign-up/email` with `email_verification: 'link'`
 *     and a `name` derived from the email local part (the form has no
 *     name field).
 *   - On success (2xx) → `redirect('/sign-in?hint=verify-email')`. NO
 *     session cookie is set; the user lands on `/sign-in` with a banner
 *     that says "Check your inbox" and the verification link in the
 *     email does the real auth work.
 *   - On Neon 4xx → return localized `state.errors._form` (duplicate,
 *     weak password, etc.). We map the upstream `message` to a Spanish
 *     form-level error.
 *   - On Neon 5xx → uniform `state.errors._form`; the caller can retry.
 *
 * Mirrors the structure of `signInAction` (PR2.2) so a future PR3.7 can
 * share an `extractNeonSessionCookie` helper once `signUpAction` also
 * needs one. For now there is no cookie extraction — the verification
 * link does the auth.
 */

export type SignUpState = {
  errors?: { email?: string[]; password?: string[]; confirmPassword?: string[]; _form?: string[] };
  values?: { email?: string };
};

function localizedFormError(upstreamMessage: string | null, status: number): string {
  const lower = upstreamMessage?.toLowerCase() ?? "";
  if (lower.includes("already") || lower.includes("exists") || lower.includes("registered")) {
    return "Ya existe una cuenta con ese email. Iniciá sesión o usá otro email.";
  }
  if (lower.includes("password") || status === 400) {
    return "La contraseña no cumple los requisitos de seguridad.";
  }
  return "No pudimos crear la cuenta. Intentá de nuevo en unos minutos.";
}

export async function signUpAction(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const parsed = SignUpSchema.safeParse({ email, password, confirmPassword });
  if (!parsed.success) {
    return {
      errors: parsed.error.flatten().fieldErrors,
      values: { email },
    };
  }

  const base = getNeonAuthBaseUrl();
  const appBaseUrl = getAppBaseUrl();
  const name = parsed.data.email.split("@")[0] || "User";

  const res = await fetch(`${base}/sign-up/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: appBaseUrl,
    },
    body: JSON.stringify({
      email: parsed.data.email,
      password: parsed.data.password,
      name,
      email_verification: "link",
      callbackURL: `${appBaseUrl}/verify-email`,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    const upstreamMessage = typeof body?.message === "string" ? body.message : null;
    return {
      errors: { _form: [localizedFormError(upstreamMessage, res.status)] },
      values: { email: parsed.data.email },
    };
  }

  // Verification-first flow, but auto-sign-in: Better Auth's
  // `/sign-up/email` response includes the same `set-cookie` header
  // as `/sign-in/email`, so we forward it to our jar the same way
  // `signInAction` does. The user lands on `/verify-email` already
  // signed in (with `emailVerified: false`), so the page renders the
  // OTP input form instead of redirecting back to `/sign-in`.
  //
  // If the upstream returns no cookie (some Better Auth configs skip
  // the set-cookie on sign-up), we fall through to the redirect
  // without setting a session — the user lands on `/verify-email`
  // unauthenticated, where the form action still works (it accepts
  // email + OTP and verifies via Better Auth's `/email-otp/verify-email`
  // endpoint which DOES issue a session).
  const setCookie = res.headers.get("set-cookie") ?? "";
  const sessionCookie = extractNeonSessionCookie(setCookie);
  if (sessionCookie) {
    const value = decodeURIComponent(sessionCookie.rawValue);
    await setSessionCookie(value, sessionCookie.name);
  }

  redirect("/verify-email");
}
