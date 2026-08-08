/**
 * PR3.auth-ui (Task 3.1) — Pure logic for the pre-merge Neon Auth
 * config check. Extracted from `scripts/check-neon-auth-config.mjs` so
 * unit tests can exercise the flag/origin assertions without hitting
 * the Neon HTTP API.
 *
 * SPEC §NEON-AUTH-CONFIG: the branch MUST have
 *   1. `auth_methods.email_password.allow_sign_up` === true
 *   2. `auth_methods.email_password.email_verification_method` === "link"
 *   3. `auth_methods.email_password.enabled` === true
 *   4. `allow_localhost` === true (dev-mode flow)
 *   5. `trusted_origins` ⊇ {Vercel production apex, Vercel preview wildcard}
 *
 * The `SKIP_LOCALHOST` env flag exists for production-only checks.
 */

export const REQUIRED_TRUSTED_ORIGINS = [
  "https://presupuesto-velas.vercel.app",
  "https://*.vercel.app",
];

export function diffRequiredOrigins(trustedOrigins) {
  return REQUIRED_TRUSTED_ORIGINS.filter((origin) => {
    if (origin.includes("*")) {
      const [scheme, hostPattern] = origin.split("://");
      const wildcard = hostPattern.replace(/\*/g, ".*");
      const regex = new RegExp(`^${scheme}://${wildcard}$`);
      return !trustedOrigins.some((existing) => regex.test(existing));
    }
    return !trustedOrigins.includes(origin);
  });
}

export function runChecks(config, opts = {}) {
  const { skipLocalhost = false } = opts;
  const failures = [];
  const emailPassword = config?.auth_methods?.email_password ?? {};

  if (emailPassword.allow_sign_up !== true) {
    failures.push({
      check: "allow_sign_up",
      expected: true,
      actual: emailPassword.allow_sign_up,
      fix: "PATCH /auth_methods with allow_sign_up=true (Neon_configure_neon_auth)",
    });
  }
  if (emailPassword.email_verification_method !== "link") {
    failures.push({
      check: "email_verification_method",
      expected: "link",
      actual: emailPassword.email_verification_method,
      fix: "PATCH /auth_methods with email_verification_method='link'",
    });
  }
  if (emailPassword.enabled !== true) {
    failures.push({
      check: "auth_methods.email_password.enabled",
      expected: true,
      actual: emailPassword.enabled,
      fix: "PATCH /auth_methods with enabled=true",
    });
  }
  if (!skipLocalhost && config?.allow_localhost !== true) {
    failures.push({
      check: "allow_localhost",
      expected: true,
      actual: config?.allow_localhost,
      fix: "PATCH /allow_localhost with allow_localhost=true",
    });
  }

  const trustedOrigins = Array.isArray(config?.trusted_origins) ? config.trusted_origins : [];
  const missingOrigins = diffRequiredOrigins(trustedOrigins);
  if (missingOrigins.length > 0) {
    failures.push({
      check: "trusted_origins",
      expected: REQUIRED_TRUSTED_ORIGINS.join(", "),
      actual: trustedOrigins.join(", "),
      missing: missingOrigins,
      fix: "POST /trusted_origins for each missing entry",
    });
  }
  return failures;
}
