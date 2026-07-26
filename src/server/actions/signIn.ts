"use server";
import { redirect } from "next/navigation";
import { getAppBaseUrl } from "../auth/appBaseUrl";
import { getNeonAuthBaseUrl, getOwnerEmail, getOwnerId } from "../auth/ownerEnv";
import { setSessionCookie } from "../auth/session";
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
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = setCookie.match(/(?:^|,\s*)better-auth\.session_token=([^;]+)/i);
  const raw = m?.[1];
  if (!raw) {
    return {
      errors: { _form: ["Sign-in did not return a session cookie."] },
      values: { email },
    };
  }
  const value = decodeURIComponent(raw);
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
  await setSessionCookie(value);
  redirect("/");
}
