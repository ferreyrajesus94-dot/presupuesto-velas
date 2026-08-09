import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { upsertUser } from "../repositories/user";
import { getBootstrapOwnerEmail, getNeonAuthBaseUrl } from "./userEnv";

/**
 * PR2.auth-core + v0.4.2 hotfix — `requireUser(opts?)`.
 *
 * Returns `{ id, email, role, emailVerified }` from any valid Neon Auth
 * session, atomically upserting the `app_user` row on first verified call.
 * Replaces the legacy single-owner allowlist guard. Redirect semantics:
 *
 *   - no session          → `redirect("/sign-in?next=<pathname || '/'>")`
 *   - session, !verified  → `redirect("/verify-email")`        (v0.4.2: was `/sign-in?hint=verify-email`)
 *   - session, verified   → `upsertUser(...)` → return the persisted row
 *
 * v0.4.2 redirect change: unverified sessions now go DIRECTLY to
 * `/verify-email` (where the OTP input form lives) instead of bouncing
 * through `/sign-in?hint=verify-email` (which only shows a banner). The
 * user-reported pain point: "if you lose the verify tab and sign in
 * again, you should land back on the verify page". `requireUser` is
 * the only chokepoint for every protected route, so redirecting here
 * means ANY protected-route access while unverified returns the user
 * to the verify page — they cannot get lost.
 *
 * Design constraints (locked in `sdd/auth-public-signup/design`):
 *   - `src/server/auth/session.ts` stays byte-identical (SESSION-PRESERVE),
 *     so we cannot reuse its internal cookie + variant mapping. The helpers
 *     below intentionally re-declare the constants and read the cookies
 *     directly. The duplication is the cost of not modifying `session.ts`.
 *   - `upsertUser`'s bootstrap-promotion rule requires both `email` match
 *     and `requestedRole='owner'` to land `role='owner'`; `requireUser`
 *     decides whether to pass that hint.
 */

type NeonSessionCookieName =
  "__Secure-neon-auth.session_token" | "neon-auth.session_token" | "better-auth.session_token";

const NEON_SESSION_COOKIE_NAMES: readonly NeonSessionCookieName[] = [
  "__Secure-neon-auth.session_token",
  "neon-auth.session_token",
  "better-auth.session_token",
] as const;

const LEGACY_NEON_COOKIE: NeonSessionCookieName = "better-auth.session_token";

const COOKIE_NAME_BY_VARIANT: Record<string, NeonSessionCookieName> = {
  p: "__Secure-neon-auth.session_token",
  n: "neon-auth.session_token",
  b: "better-auth.session_token",
};

const SESSION_COOKIE = "session";
const SESSION_UPSTREAM_COOKIE = "session-upstream";

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: "owner" | "user";
  emailVerified: boolean;
};

type SessionUserWithVerification = {
  id: string;
  email: string;
  emailVerified: boolean;
};

async function readSession(): Promise<{
  token: string;
  upstreamName: NeonSessionCookieName;
} | null> {
  const jar = await cookies();
  const stored = jar.get(SESSION_COOKIE)?.value;
  if (!stored) return null;
  const variant = jar.get(SESSION_UPSTREAM_COOKIE)?.value;
  return {
    token: stored,
    upstreamName: COOKIE_NAME_BY_VARIANT[variant ?? ""] ?? LEGACY_NEON_COOKIE,
  };
}

async function fetchSessionUserWithVerification(): Promise<SessionUserWithVerification | null> {
  const session = await readSession();
  if (!session) return null;
  const base = getNeonAuthBaseUrl();
  const res = await fetch(`${base}/get-session`, {
    headers: { Cookie: `${session.upstreamName}=${session.token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    user?: { id?: unknown; email?: unknown; emailVerified?: unknown };
  } | null;
  const u = body?.user;
  if (!u || typeof u.id !== "string" || typeof u.email !== "string") return null;
  const emailVerified = typeof u.emailVerified === "boolean" ? u.emailVerified : false;
  return { id: u.id, email: u.email, emailVerified };
}

function buildNextQuery(pathname: string | undefined): string {
  const safe = pathname && pathname.startsWith("/") ? pathname : "/";
  return `next=${encodeURIComponent(safe)}`;
}

function resolveRequestedRole(email: string): "owner" | undefined {
  const bootstrap = getBootstrapOwnerEmail();
  if (bootstrap === null) return undefined;
  return email.toLowerCase() === bootstrap.toLowerCase() ? "owner" : undefined;
}

export type RequireUserOptions = {
  pathname?: string;
};

export async function requireUser(opts: RequireUserOptions = {}): Promise<AuthenticatedUser> {
  const user = await fetchSessionUserWithVerification();
  if (!user) {
    redirect(`/sign-in?${buildNextQuery(opts.pathname)}`);
  }
  if (!user.emailVerified) {
    redirect("/verify-email");
  }
  const requestedRole = resolveRequestedRole(user.email);
  const row = await upsertUser({
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    requestedRole,
  });
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    emailVerified: row.emailVerified,
  };
}

// Export the cookie-name list so callers / tests can mirror the supported
// set without importing `session.ts` (preserving SESSION-PRESERVE).
export const SUPPORTED_NEON_COOKIE_NAMES = NEON_SESSION_COOKIE_NAMES;
