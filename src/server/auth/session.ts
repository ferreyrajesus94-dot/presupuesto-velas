import "server-only";
import { cookies } from "next/headers";
import { getNeonAuthBaseUrl } from "./ownerEnv";

const SESSION_COOKIE = "session";
const SESSION_UPSTREAM_COOKIE = "session-upstream";
export const NEON_SESSION_COOKIE_NAMES = [
  "__Secure-neon-auth.session_token",
  "neon-auth.session_token",
  "better-auth.session_token",
] as const;

export type NeonSessionCookieName = (typeof NEON_SESSION_COOKIE_NAMES)[number];

const LEGACY_NEON_COOKIE: NeonSessionCookieName = "better-auth.session_token";
const COOKIE_VARIANT_BY_NAME: Record<NeonSessionCookieName, string> = {
  "__Secure-neon-auth.session_token": "p",
  "neon-auth.session_token": "n",
  "better-auth.session_token": "b",
};
const COOKIE_NAME_BY_VARIANT: Record<string, NeonSessionCookieName> = {
  p: "__Secure-neon-auth.session_token",
  n: "neon-auth.session_token",
  b: "better-auth.session_token",
};

export type SessionUser = { id: string; email: string };

export async function setSessionCookie(value: string, upstreamName: NeonSessionCookieName) {
  const jar = await cookies();
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  } as const;
  jar.set(SESSION_COOKIE, value, options);
  jar.set(SESSION_UPSTREAM_COOKIE, COOKIE_VARIANT_BY_NAME[upstreamName], options);
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(SESSION_UPSTREAM_COOKIE);
}

export async function readSessionToken(): Promise<string | null> {
  return (await readSession())?.token ?? null;
}

export async function fetchSessionUser(): Promise<SessionUser | null> {
  const session = await readSession();
  if (!session) return null;
  const base = getNeonAuthBaseUrl();
  const res = await fetch(`${base}/get-session`, {
    headers: { Cookie: `${session.upstreamName}=${session.token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    user?: { id?: unknown; email?: unknown };
  } | null;
  const u = body?.user;
  if (!u || typeof u.id !== "string" || typeof u.email !== "string") return null;
  return { id: u.id, email: u.email };
}

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
