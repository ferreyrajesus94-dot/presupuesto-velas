/**
 * Owner allowlist env access. Vercel env wins; local .env.local may use
 * `TEST_OWNER_*` (from HC-A) as a stand-in until the secrets are promoted.
 */
function readPrimary(name: string, fallbackName: string): string {
  const primary = process.env[name];
  if (primary) return primary;
  const fallback = process.env[fallbackName];
  if (!fallback) throw new Error(`${name} is not set`);
  return fallback;
}

export function getOwnerId(): string {
  return readPrimary("OWNER_USER_ID", "TEST_OWNER_USER_ID");
}

export function getOwnerEmail(): string {
  return readPrimary("OWNER_EMAIL", "TEST_OWNER_EMAIL");
}

export function getNeonAuthBaseUrl(): string {
  const url = process.env.NEON_AUTH_BASE_URL;
  if (!url) throw new Error("NEON_AUTH_BASE_URL is not set");
  return url.replace(/\/+$/, "");
}
