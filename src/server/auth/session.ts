import "server-only";
import { cookies } from "next/headers";
import { getNeonAuthBaseUrl } from "./ownerEnv";

const SESSION_COOKIE = "session";
const NEON_COOKIE = "better-auth.session_token";

export type SessionUser = { id: string; email: string };

export async function setSessionCookie(value: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

export async function fetchSessionUser(): Promise<SessionUser | null> {
  const token = await readSessionToken();
  if (!token) return null;
  const base = getNeonAuthBaseUrl();
  const res = await fetch(`${base}/get-session`, {
    headers: { Cookie: `${NEON_COOKIE}=${token}` },
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
