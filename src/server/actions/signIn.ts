"use server";
import { redirect } from "next/navigation";
import { getAppBaseUrl } from "../auth/appBaseUrl";
import { getNeonAuthBaseUrl } from "../auth/ownerEnv";
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
  if (body?.user && typeof body.user.id === "string" && typeof body.user.email === "string") {
    await upsertOwner({ id: body.user.id, email: body.user.email });
  }
  await setSessionCookie(value);
  redirect("/");
}
