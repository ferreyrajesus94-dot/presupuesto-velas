"use server";
import { redirect } from "next/navigation";
import { clearSessionCookie } from "../auth/session";

/**
 * v0.4.4 — `signOutAction`.
 *
 * Two-step sign-out (defense in depth):
 *   1. POST `{ }` to Better Auth `/sign-out` to invalidate the server-side
 *      session token (so a stolen cookie is no longer usable). Better
 *      Auth's session table will drop the row.
 *   2. Clear the local `session` + `session-upstream` cookies via
 *      `clearSessionCookie()` so the browser stops sending them.
 *
 * Both calls are best-effort. If Better Auth is unreachable we still
 * clear the local cookies — the user expects to be logged out regardless.
 * Errors from the upstream are swallowed (sign-out should never fail
 * from the user's perspective).
 *
 * After clearing, redirect to `/sign-in` with `next=/` so the sign-in
 * form knows where to land them next.
 */
export type SignOutState = {
  ok?: boolean;
  errors?: { _form?: string[] };
};

export async function signOutAction(_prev: SignOutState, _formData: FormData): Promise<SignOutState> {
  // void _formData: useActionState contract requires the FormData arg even
  // though this action takes no user input.
  void _formData;
  const base = (await import("../auth/userEnv")).getNeonAuthBaseUrl();
  // Best-effort upstream invalidation. We don't care about the response;
  // even on 401/403/500 the local cookies below take the user out.
  try {
    await fetch(`${base}/sign-out`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
  } catch {
    // network error — fall through to local cookie clear
  }

  // Always clear local cookies, even if upstream failed.
  await clearSessionCookie();
  redirect("/sign-in");
}