import "server-only";
import { NEON_SESSION_COOKIE_NAMES, type NeonSessionCookieName } from "./session";

/**
 * v0.4.6 — shared helper for `signInAction`, `signUpAction`, and
 * `verifyEmailOtpAction`. All three Better Auth endpoints that issue a
 * session (`/sign-in/email`, `/sign-up/email`, `/email-otp/verify-email`)
 * return the session token in BOTH the response body (for convenience)
 * AND the `set-cookie` response header. We prefer the header value
 * because it carries the upstream cookie variant (Better Auth may use
 * any of the three flavors depending on the deployment); the body
 * field doesn't tell us which variant was set.
 *
 * The function is intentionally a pure string-parser with no I/O so it
 * can live in `src/server/auth/` without touching the SESSION-PRESERVE
 * constraint on `session.ts` (the only module that must stay
 * byte-identical vs origin/main).
 *
 * If the upstream returned multiple `set-cookie` headers, the API
 * already concatenates them with `, ` separators per RFC 6265 §3. We
 * split on those boundaries so the regex matches a single cookie
 * name, not a substring of another cookie's value.
 *
 * Returns `null` when none of the three Better Auth cookie variants are
 * present — the caller treats this as "no session issued" and skips
 * `setSessionCookie`.
 */
export function extractNeonSessionCookie(
  setCookie: string,
): { name: NeonSessionCookieName; rawValue: string } | null {
  for (const name of NEON_SESSION_COOKIE_NAMES) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = setCookie.match(new RegExp(`(?:^|,\\s*)${escapedName}=([^;,]+)`));
    if (match) return { name, rawValue: match[1] };
  }
  return null;
}