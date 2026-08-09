/**
 * Single source of truth for routes that do NOT require authentication.
 * Consumed by:
 *  - `src/proxy.ts` (middleware) — anonymous-friendly routes that skip the
 *    session check.
 *  - `src/components/tour/Tutorial.tsx` — routes where the tutorial overlay
 *    must NOT mount (it would block the unauthenticated UI behind a z-[60]
 *    backdrop on the first paint).
 *
 * `isPublicPath()` accepts the leading-slash conventions used by Next.js
 * pathname checks: an exact match, a path under the prefix, or the prefix
 * itself with a query/hash.
 */
export const PUBLIC_PREFIXES = ["/sign-in", "/sign-up", "/403", "/api/auth", "/_next"] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p),
  );
}