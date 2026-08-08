import "server-only";

/**
 * Auth-related env access for `auth-public-signup`. PR2.auth-core of
 * `sdd/auth-public-signup` introduces this file as the canonical home for
 * auth/user env reads so the legacy `ownerEnv.ts` allowlist helpers can be
 * retired without disturbing `src/server/auth/session.ts` (SESSION-PRESERVE
 * invariant — the cookie parsing module must stay byte-identical through
 * PR2 + PR3; `ownerEnv.ts` remains as a thin re-export shim until PR2.2
 * deletes the legacy allowlist gates).
 *
 * Exports:
 *   - `getNeonAuthBaseUrl()`: the upstream auth endpoint. Preserved from
 *     `ownerEnv.ts` for `session.ts`'s unchanged import.
 *   - `getBootstrapOwnerEmail()`: the env-pinned email that auto-promotes
 *     the matching Neon Auth sign-in to `role='owner'` (ROLE-MODEL scenario).
 *     Returns `null` when unset so callers can opt out of promotion without
 *     throwing.
 */

export function getNeonAuthBaseUrl(): string {
  const url = process.env.NEON_AUTH_BASE_URL;
  if (!url) throw new Error("NEON_AUTH_BASE_URL is not set");
  return url.replace(/\/+$/, "");
}

export function getBootstrapOwnerEmail(): string | null {
  const raw = process.env.BOOTSTRAP_OWNER_EMAIL?.trim();
  return raw && raw.length > 0 ? raw : null;
}
