"use server";
import { redirect } from "next/navigation";
import { getAppBaseUrl } from "../auth/appBaseUrl";
import { getNeonAuthBaseUrl, getOwnerEmail, getOwnerId } from "../auth/ownerEnv";
import {
  NEON_SESSION_COOKIE_NAMES,
  setSessionCookie,
  type NeonSessionCookieName,
} from "../auth/session";
import { SignInSchema } from "../auth/signInSchema";
import { upsertOwner } from "../repositories/owner";

export type SignInState = {
  errors?: { email?: string[]; password?: string[]; _form?: string[] };
  values?: { email?: string };
};

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const parsed = SignInSchema.safeParse({ email, password });
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
    user?: { id?: unknown; email?: unknown };
  } | null;
  const user = body?.user;
  if (!user || typeof user.id !== "string" || typeof user.email !== "string") {
    return {
      errors: { _form: ["Sign-in did not return a user."] },
      values: { email },
    };
  }
  // Authorize BEFORE any app_owner mutation: only the configured owner is allowed
  // to seed the singleton row. A valid non-owner must reach /403 without a write.
  const ownerId = getOwnerId();
  const ownerEmail = getOwnerEmail();
  if (user.id !== ownerId || user.email.toLowerCase() !== ownerEmail.toLowerCase()) {
    redirect("/403");
  }
  await upsertOwner({ id: user.id, email: user.email });
  await setSessionCookie(value, sessionCookie.name);
  redirect("/");
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
