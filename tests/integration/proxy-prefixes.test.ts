/**
 * PR3.auth-ui (Task 3.8) — PUBLIC-PREFIXES regression test.
 *
 * Asserts the optimistic-cookie-only redirect in `src/proxy.ts` honors
 * the SPEC §PUBLIC-PREFIXES contract:
 *
 *   - `PUBLIC_PREFIXES` exported from `src/proxy.ts` is a strict superset
 *     of `['/sign-in', '/sign-up', '/403', '/api/auth', '/_next']`.
 *   - Unsigned request to `/sign-up` returns `NextResponse.next()`
 *     (bypasses the optimistic redirect — `requireUser` enforces the
 *     verified gate at the page layer).
 *   - Unsigned request to a protected route (e.g. `/materials`) returns
 *     `NextResponse.redirect('/sign-in?next=/materials')` (the proxy's
 *     only job — no DB, no upstream auth call).
 *
 * Runs at the `integration` layer because it exercises a Next.js
 * `NextRequest`/`NextResponse` boundary that depends on the production
 * module graph (we cannot fully mock `next/server` without losing the
 * cookie/URL semantics we want to assert).
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { PUBLIC_PREFIXES, proxy } from "../../src/proxy";

const REQUIRED_SUPERSET = [
  "/sign-in",
  "/sign-up",
  "/403",
  "/api/auth",
  "/_next",
] as const;

function buildRequest(pathname: string): NextRequest {
  const url = new URL(pathname, "http://localhost:3000");
  return new NextRequest(url, { headers: { cookie: "" } });
}

describe("proxy — PUBLIC_PREFIXES contract", () => {
  it("exports PUBLIC_PREFIXES as a non-empty readonly list", () => {
    expect(Array.isArray(PUBLIC_PREFIXES)).toBe(true);
    expect(PUBLIC_PREFIXES.length).toBeGreaterThan(0);
    for (const prefix of PUBLIC_PREFIXES) {
      expect(prefix.startsWith("/")).toBe(true);
    }
  });

  it("PUBLIC_PREFIXES is a strict superset of the required prefixes", () => {
    for (const required of REQUIRED_SUPERSET) {
      expect(PUBLIC_PREFIXES, `missing required prefix: ${required}`).toContain(required);
    }
  });

  it("PUBLIC_PREFIXES does not contain protected app routes", () => {
    // Id-enumeration / accidental-public guard. The proxy's optimistic
    // redirect is the only thing standing between an unsigned visitor
    // and protected routes — make sure we never accidentally whitelist
    // them.
    const PROTECTED = ["/", "/materials", "/templates", "/quotes", "/recipes"];
    for (const path of PROTECTED) {
      expect(PUBLIC_PREFIXES, `protected route leaked into PUBLIC_PREFIXES: ${path}`).not.toContain(
        path,
      );
    }
  });
});

describe("proxy — optimistic cookie-only redirect", () => {
  it("unsigned request to /sign-up bypasses the redirect (PUBLIC)", async () => {
    const res = await proxy(buildRequest("/sign-up"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("unsigned request to /sign-up/anything bypasses the redirect (sub-path PUBLIC)", async () => {
    const res = await proxy(buildRequest("/sign-up/some/extra"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("unsigned request to /sign-in bypasses the redirect (PUBLIC)", async () => {
    const res = await proxy(buildRequest("/sign-in"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("unsigned request to /api/auth/session bypasses the redirect (PUBLIC)", async () => {
    const res = await proxy(buildRequest("/api/auth/session"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("unsigned request to /403 bypasses the redirect (PUBLIC)", async () => {
    const res = await proxy(buildRequest("/403"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("unsigned request to /_next/static/foo.js bypasses the redirect (PUBLIC)", async () => {
    const res = await proxy(buildRequest("/_next/static/foo.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("unsigned request to /materials redirects to /sign-in?next=/materials", async () => {
    const res = await proxy(buildRequest("/materials"));
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/sign-in");
    expect(location).toContain("next=%2Fmaterials");
  });

  it("unsigned request to /quotes/abc-123 redirects with next encoded", async () => {
    const res = await proxy(buildRequest("/quotes/abc-123"));
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/sign-in");
    expect(location).toContain("next=%2Fquotes%2Fabc-123");
  });

  it("signed request to /materials does NOT redirect (cookie present)", async () => {
    const req = new NextRequest(new URL("/materials", "http://localhost:3000"), {
      headers: { cookie: "session=tok-xyz" },
    });
    const res = await proxy(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});