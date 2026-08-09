"use server";
import { redirect } from "next/navigation";
import { getAppBaseUrl } from "../auth/appBaseUrl";
import { getBootstrapOwnerEmail, getNeonAuthBaseUrl } from "../auth/userEnv";
import {
  setSessionCookie,
} from "../auth/session";
import { extractNeonSessionCookie } from "../auth/neonCookie";
import { AuthSchema } from "../auth/authSchema";
import { upsertUser } from "../repositories/user";

/**
 * PR2.auth-core (Task 2.7) — `signInAction` rewritten for the user era.
 *
 *   - No allowlist gate. Every verified Neon Auth signer is upserted into
 *     `app_user` with `role='owner'` iff `email === BOOTSTRAP_OWNER_EMAIL`
 *     AND `emailVerified === true`. All other verified signers land as
 *     `role='user'`.
 *   - Honors a hidden `<input name="next">` from the form. Same-origin
 *     absolute paths (`/materials`, `/quotes/abc`, …) redirect there;
 *     cross-origin or empty values fall back to `/`.
 *   - Sign-in is no longer a write gate; verification is. The `/403`
 *     allowlist path was retired in PR2 and never resurrected in PR3.
 *     `/403` itself remains available for any future role-gated route.
 *
 * The local `extractNeonSessionCookie` helper stays inline because
 * `session.ts` is byte-identical (SESSION-PRESERVE); extracting it to
 * `src/server/auth/neonCookie.ts` is deferred until a non-PR2 caller
 * needs it.
 */

export type SignInState = {
  errors?: { email?: string[]; password?: string[]; _form?: string[] };
  values?: { email?: string };
};

function readNext(formData: FormData): string {
  const raw = formData.get("next");
  if (typeof raw !== "string") return "/";
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "/";
  // Same-origin absolute paths only. Reject protocol-relative URLs
  // ("//evil.example.com"), absolute URLs ("https://evil.example.com"),
  // and any value that doesn't start with a forward slash.
  if (!trimmed.startsWith("/")) return "/";
  if (trimmed.startsWith("//")) return "/";
  return trimmed;
}

function resolveRequestedRole(email: string, emailVerified: boolean): "owner" | undefined {
  if (!emailVerified) return undefined;
  const bootstrap = getBootstrapOwnerEmail();
  if (bootstrap === null) return undefined;
  return email.toLowerCase() === bootstrap.toLowerCase() ? "owner" : undefined;
}

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const parsed = AuthSchema.safeParse({ email, password });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors, values: { email } };
  }
  const base = getNeonAuthBaseUrl();
  const appBaseUrl = getAppBaseUrl();
  const res = await fetch(`${base}/sign-in/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: appBaseUrl,
    },
    body: JSON.stringify({
      email: parsed.data.email,
      password: parsed.data.password,
      callbackURL: `${appBaseUrl}/`,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    return {
      errors: { _form: ["Invalid email or password."] },
      values: { email },
    };
  }
  const sessionCookie = extractNeonSessionCookie(res.headers.get("set-cookie") ?? "");
  if (!sessionCookie) {
    return {
      errors: { _form: ["Sign-in did not return a session cookie."] },
      values: { email },
    };
  }
  const value = decodeURIComponent(sessionCookie.rawValue);
  const body = (await res.json().catch(() => null)) as {
    user?: { id?: unknown; email?: unknown; emailVerified?: unknown };
  } | null;
  const user = body?.user;
  if (!user || typeof user.id !== "string" || typeof user.email !== "string") {
    return {
      errors: { _form: ["Sign-in did not return a user."] },
      values: { email },
    };
  }
  const emailVerified = typeof user.emailVerified === "boolean" ? user.emailVerified : false;
  await upsertUser({
    id: user.id,
    email: user.email,
    emailVerified,
    requestedRole: resolveRequestedRole(user.email, emailVerified),
  });
  await setSessionCookie(value, sessionCookie.name);
  redirect(readNext(formData));
}
