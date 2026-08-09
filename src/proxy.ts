import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "@/lib/publicPrefixes";

/**
 * Optimistic redirect only — no DB or upstream auth call.
 * `requireUser()` (in `src/server/auth/requireUser.ts`) is the secure check.
 *
 * SPEC §PUBLIC-PREFIXES: must include `/sign-up` so unsigned visitors reach
 * the public sign-up page. Tests in `tests/integration/proxy-prefixes.test.ts`
 * pin this contract as a strict superset of `['/sign-in', '/sign-up', '/403',
 * '/api/auth', '/_next']`.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  const session = request.cookies.get("session")?.value;
  if (!session) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
