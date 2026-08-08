#!/usr/bin/env node
/**
 * PR3.auth-ui (Task 3.1) — Pre-merge Neon Auth config check.
 *
 * Thin CLI wrapper over `scripts/check-neon-auth-config.lib.mjs` —
 * the pure logic (flag assertions + trusted-origins diff) lives there
 * so unit tests can exercise it without an HTTP round-trip.
 *
 * Reads Neon Auth config via the Neon API. Required env:
 *   - `NEON_API_KEY`
 *   - `NEON_PROJECT_ID`
 *   - `NEON_BRANCH_ID`
 *
 * Exit codes:
 *   0  all checks pass
 *   1  one or more checks failed (diff printed to stderr)
 *   2  required env missing or upstream error
 *
 * Usage:
 *   NEON_API_KEY=... NEON_PROJECT_ID=... NEON_BRANCH_ID=... \
 *     node scripts/check-neon-auth-config.mjs
 *
 *   # Production-only (skip the `allow_localhost` assertion):
 *   SKIP_LOCALHOST=1 node scripts/check-neon-auth-config.mjs
 */

import process from "node:process";
import { REQUIRED_TRUSTED_ORIGINS, runChecks } from "./check-neon-auth-config.lib.mjs";

const REQUIRED_ENV = ["NEON_API_KEY", "NEON_PROJECT_ID", "NEON_BRANCH_ID"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[check-neon-auth-config] missing required env: ${key}`);
    process.exit(2);
  }
}
const NEON_API_KEY = process.env.NEON_API_KEY;
const NEON_PROJECT_ID = process.env.NEON_PROJECT_ID;
const NEON_BRANCH_ID = process.env.NEON_BRANCH_ID;
const SKIP_LOCALHOST = process.env.SKIP_LOCALHOST === "1";

const NEON_API_BASE = "https://console.neon.tech/api/v2";

async function fetchNeonAuthConfig() {
  const url = `${NEON_API_BASE}/projects/${encodeURIComponent(NEON_PROJECT_ID)}/branches/${encodeURIComponent(NEON_BRANCH_ID)}/auth`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${NEON_API_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Neon API GET /auth returned ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

async function main() {
  let config;
  try {
    config = await fetchNeonAuthConfig();
  } catch (err) {
    console.error(`[check-neon-auth-config] upstream error: ${err.message}`);
    process.exit(2);
  }
  const failures = runChecks(config, { skipLocalhost: SKIP_LOCALHOST });
  if (failures.length === 0) {
    console.log(
      `[check-neon-auth-config] OK — allow_sign_up=true, email_verification_method=link, trusted_origins covers ${REQUIRED_TRUSTED_ORIGINS.join(", ")}, allow_localhost=${SKIP_LOCALHOST ? "(skipped)" : "true"}`,
    );
    process.exit(0);
  }
  console.error("[check-neon-auth-config] FAIL — Neon Auth config is not sign-up-ready:");
  for (const f of failures) {
    console.error(
      `  - ${f.check}: expected ${JSON.stringify(f.expected)}; got ${JSON.stringify(f.actual)}`,
    );
    if (f.missing) console.error(`    missing origins: ${f.missing.join(", ")}`);
    console.error(`    fix: ${f.fix}`);
  }
  process.exit(1);
}

main();
