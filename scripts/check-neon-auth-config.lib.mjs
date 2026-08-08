/**
 * PR3.auth-ui (Task 3.1) — Pure logic for the pre-merge Neon Auth
 * config check. Extracted from `scripts/check-neon-auth-config.mjs` so
 * unit tests can exercise the flag/origin assertions without hitting
 * the Neon HTTP API.
 *
 * SPEC §NEON-AUTH-CONFIG: the branch MUST have
 *   1. `auth_methods.email_password.allow_sign_up` === true
 *   2. `auth_methods.email_password.email_verification_method` ∈ {link, otp}
 *      — SPEC §2 ("SIGN-UP") requests `link`, but Neon Auth rejects
 *      `link` against the `shared` email provider ("Verification link
 *      is not supported for shared email provider"). `otp` is the
 *      achievable fallback when the Neon email provider type is
 *      `shared`. Custom SMTP (`standard`) is required for `link`.
 *   3. `auth_methods.email_password.enabled` === true
 *   4. `allow_localhost` === true (dev-mode flow)
 *   5. `trusted_origins` ⊇ {Vercel production apex, Vercel preview wildcard}
 *
 * The `SKIP_LOCALHOST` env flag exists for production-only checks.
 * The `EXPECTED_VERIFICATION_METHOD` env flag defaults to `link`; set
 * it to `otp` if the production Neon email provider is `shared`.
 */

export const REQUIRED_TRUSTED_ORIGINS = [
  "https://presupuesto-velas.vercel.app",
  "https://*.vercel.app",
];

export const ALLOWED_VERIFICATION_METHODS = ["link", "otp"];

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
  const { skipLocalhost = false, expectedVerificationMethod = "link" } = opts;
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
  if (!ALLOWED_VERIFICATION_METHODS.includes(emailPassword.email_verification_method)) {
    failures.push({
      check: "email_verification_method",
      expected: ALLOWED_VERIFICATION_METHODS.join("|"),
      actual: emailPassword.email_verification_method,
      fix: "PATCH /auth_methods with email_verification_method='link' (custom SMTP) or 'otp' (shared SMTP)",
    });
  } else if (expectedVerificationMethod !== emailPassword.email_verification_method) {
    failures.push({
      check: "email_verification_method",
      expected: expectedVerificationMethod,
      actual: emailPassword.email_verification_method,
      fix: `PATCH /auth_methods with email_verification_method='${expectedVerificationMethod}' (only achievable with custom SMTP for 'link')`,
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
