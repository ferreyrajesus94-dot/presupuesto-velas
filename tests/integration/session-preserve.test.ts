import { execSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

/**
 * PR2.auth-core (Task 2.9) — SESSION-PRESERVE regression test.
 *
 * Asserts two invariants that must hold across PR2 + PR3 of the
 * auth-public-signup chain:
 *   1. Byte-identity of `src/server/auth/session.ts` against
 *      `feature/auth-public-signup-pr2-2-integration` (the SESSION-PRESERVE
 *      constraint). `git diff` MUST be empty.
 *   2. The supported upstream cookie variant round-trip
 *      (`__Secure-neon-auth.session_token`, `neon-auth.session_token`,
 *      `better-auth.session_token`) survives a `setSessionCookie` →
 *      `readSessionToken` round-trip in `next/headers`'s mocked cookie jar.
 *
 * The first invariant is enforced by reading the diff against the merge
 * base's session.ts and asserting the diff is empty. CI must run this
 * test BEFORE merging PR2 and PR3.
 */

const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { value: cookieJar.get(name) as string } : undefined,
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
}));

import { NEON_SESSION_COOKIE_NAMES } from "../../src/server/auth/session";
import * as sessionModule from "../../src/server/auth/session";

// We resolve via `git rev-parse` so the test is portable across worktrees.
function sessionDiffAgainst(targetRef: string): string {
  try {
    const out = execSync(`git diff ${targetRef} -- src/server/auth/session.ts`, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return out;
  } catch (error) {
    // git diff exits non-zero when the target ref cannot be resolved.
    return `<git diff failed: ${(error as Error).message}>`;
  }
}

describe("SESSION-PRESERVE — session.ts byte-identity", () => {
  it("session.ts is byte-identical against the PR2.2 merge base", () => {
    // The PR2.3 chain base is `feature/auth-public-signup-pr2-2-integration`.
    // After merge, CI also runs this assertion against `origin/main` per
    // Task 5.5 (archive-time check).
    const diff = sessionDiffAgainst("feature/auth-public-signup-pr2-2-integration");
    expect(diff).toBe("");
  });
});

describe("SESSION-PRESERVE — cookie variant round-trip", () => {
  it.each(NEON_SESSION_COOKIE_NAMES)(
    "%s round-trips through setSessionCookie → readSessionToken",
    async (variant) => {
      cookieJar.clear();
      await sessionModule.setSessionCookie("tok-xyz", variant);
      const roundTripped = await sessionModule.readSessionToken();
      expect(roundTripped).toBe("tok-xyz");
      // The session-upstream variant letter must reflect the original
      // cookie name (p / n / b) so a subsequent /get-session call rebuilds
      // the correct upstream `Cookie:` header.
      const expectedLetter: Record<string, string> = {
        "__Secure-neon-auth.session_token": "p",
        "neon-auth.session_token": "n",
        "better-auth.session_token": "b",
      };
      expect(cookieJar.get("session-upstream")).toBe(expectedLetter[variant]);
    },
  );

  it("clearSessionCookie removes both session + session-upstream", async () => {
    cookieJar.clear();
    await sessionModule.setSessionCookie("tok-xyz", "better-auth.session_token");
    expect(cookieJar.has("session")).toBe(true);
    expect(cookieJar.has("session-upstream")).toBe(true);
    await sessionModule.clearSessionCookie();
    expect(cookieJar.has("session")).toBe(false);
    expect(cookieJar.has("session-upstream")).toBe(false);
    expect(await sessionModule.readSessionToken()).toBeNull();
  });
});
