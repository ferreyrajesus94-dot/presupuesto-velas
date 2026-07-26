import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect only — no DB or upstream auth call.
 * `requireOwner()` (in `src/server/auth/requireOwner.ts`) is the secure check.
 */
const PUBLIC_PREFIXES = ["/sign-in", "/403", "/api/auth", "/_next"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p),
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();
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
