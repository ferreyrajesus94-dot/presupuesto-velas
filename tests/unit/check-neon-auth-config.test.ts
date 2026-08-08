import { describe, expect, it } from "vitest";

/**
 * PR3.auth-ui (Task 3.1) — RED-first unit test for the Neon Auth config
 * check pure logic. The HTTP wrapper lives in
 * `scripts/check-neon-auth-config.mjs`; the testable surface lives in
 * `scripts/check-neon-auth-config.lib.mjs`.
 *
 * Covers:
 *   - Happy path: production branch with all required flags + origins
 *     → zero failures.
 *   - `allow_sign_up` not flipped → failure with the fix message.
 *   - `email_verification_method` is still `otp` → failure.
 *   - `trusted_origins` missing the Vercel production apex → failure
 *     with the missing entry surfaced.
 *   - Wildcard `https://*.vercel.app` is satisfied by an apex entry that
 *     matches the pattern.
 *   - `SKIP_LOCALHOST=true` ignores the `allow_localhost` check.
 */

import {
  REQUIRED_TRUSTED_ORIGINS,
  diffRequiredOrigins,
  runChecks,
} from "../../scripts/check-neon-auth-config.lib.mjs";

describe("check-neon-auth-config.lib (PR3 task 3.1)", () => {
  describe("REQUIRED_TRUSTED_ORIGINS", () => {
    it("includes the Vercel production apex and the Vercel preview wildcard", () => {
      expect(REQUIRED_TRUSTED_ORIGINS).toContain("https://presupuesto-velas.vercel.app");
      expect(REQUIRED_TRUSTED_ORIGINS).toContain("https://*.vercel.app");
    });
  });

  describe("diffRequiredOrigins", () => {
    it("returns no missing entries when the apex + wildcard are present", () => {
      expect(
        diffRequiredOrigins([
          "https://presupuesto-velas.vercel.app",
          "https://presupuesto-velas-feature-abc123.vercel.app",
        ]),
      ).toEqual([]);
    });

    it("surfaces the production apex as missing when only previews are trusted", () => {
      const missing = diffRequiredOrigins(["https://presupuesto-velas-abc.vercel.app"]);
      expect(missing).toContain("https://presupuesto-velas.vercel.app");
    });

    it("returns an empty array when trusted_origins is empty", () => {
      const missing = diffRequiredOrigins([]);
      expect(missing).toEqual([...REQUIRED_TRUSTED_ORIGINS]);
    });
  });

  describe("runChecks — happy path", () => {
    it("returns zero failures when the branch is fully configured for sign-up (link method)", () => {
      const config = {
        allow_localhost: true,
        trusted_origins: [
          "https://presupuesto-velas.vercel.app",
          "https://presupuesto-velas-abc.vercel.app",
        ],
        auth_methods: {
          email_password: {
            enabled: true,
            allow_sign_up: true,
            email_verification_method: "link",
          },
        },
      };
      expect(runChecks(config)).toEqual([]);
    });

    it("returns zero failures in OTP mode when EXPECTED_VERIFICATION_METHOD=otp (shared SMTP)", () => {
      const config = {
        allow_localhost: true,
        trusted_origins: ["https://presupuesto-velas.vercel.app"],
        auth_methods: {
          email_password: {
            enabled: true,
            allow_sign_up: true,
            email_verification_method: "otp",
          },
        },
      };
      expect(runChecks(config, { expectedVerificationMethod: "otp" })).toEqual([]);
    });

    it("returns zero failures in production-only mode with SKIP_LOCALHOST", () => {
      const config = {
        allow_localhost: false,
        trusted_origins: ["https://presupuesto-velas.vercel.app"],
        auth_methods: {
          email_password: {
            enabled: true,
            allow_sign_up: true,
            email_verification_method: "link",
          },
        },
      };
      expect(runChecks(config, { skipLocalhost: true })).toEqual([]);
    });
  });

  describe("runChecks — failure cases", () => {
    it("flags allow_sign_up=false with the fix message", () => {
      const config = {
        allow_localhost: true,
        trusted_origins: ["https://presupuesto-velas.vercel.app"],
        auth_methods: {
          email_password: {
            enabled: true,
            allow_sign_up: false,
            email_verification_method: "link",
          },
        },
      };
      const failures = runChecks(config);
      const signUpFailure = failures.find((f) => f.check === "allow_sign_up");
      expect(signUpFailure).toBeDefined();
      expect(signUpFailure?.expected).toBe(true);
      expect(signUpFailure?.actual).toBe(false);
      expect(signUpFailure?.fix).toMatch(/allow_sign_up=true/);
    });

    it("flags email_verification_method=otp when EXPECTED_VERIFICATION_METHOD=link (link requires custom SMTP)", () => {
      const config = {
        allow_localhost: true,
        trusted_origins: ["https://presupuesto-velas.vercel.app"],
        auth_methods: {
          email_password: {
            enabled: true,
            allow_sign_up: true,
            email_verification_method: "otp",
          },
        },
      };
      const failures = runChecks(config);
      const methodFailure = failures.find((f) => f.check === "email_verification_method");
      expect(methodFailure).toBeDefined();
      expect(methodFailure?.expected).toBe("link");
      expect(methodFailure?.actual).toBe("otp");
      expect(methodFailure?.fix).toMatch(/custom SMTP/);
    });

    it("flags an unsupported email_verification_method value (anything outside link|otp)", () => {
      const config = {
        allow_localhost: true,
        trusted_origins: ["https://presupuesto-velas.vercel.app"],
        auth_methods: {
          email_password: {
            enabled: true,
            allow_sign_up: true,
            email_verification_method: "magic",
          },
        },
      };
      const failures = runChecks(config);
      const methodFailure = failures.find((f) => f.check === "email_verification_method");
      expect(methodFailure).toBeDefined();
      expect(methodFailure?.fix).toMatch(/link.*otp/);
    });

    it("flags a missing Vercel preview wildcard with the missing entry", () => {
      const config = {
        allow_localhost: true,
        trusted_origins: [], // nothing trusted
        auth_methods: {
          email_password: {
            enabled: true,
            allow_sign_up: true,
            email_verification_method: "link",
          },
        },
      };
      const failures = runChecks(config);
      const originFailure = failures.find((f) => f.check === "trusted_origins");
      expect(originFailure).toBeDefined();
      expect(originFailure?.missing).toEqual(expect.arrayContaining([...REQUIRED_TRUSTED_ORIGINS]));
    });

    it("flags allow_localhost=false when not in SKIP_LOCALHOST mode", () => {
      const config = {
        allow_localhost: false,
        trusted_origins: ["https://presupuesto-velas.vercel.app"],
        auth_methods: {
          email_password: {
            enabled: true,
            allow_sign_up: true,
            email_verification_method: "link",
          },
        },
      };
      const failures = runChecks(config);
      expect(failures.some((f) => f.check === "allow_localhost")).toBe(true);
    });

    it("flags a missing email_password.enabled flag", () => {
      const config = {
        allow_localhost: true,
        trusted_origins: ["https://presupuesto-velas.vercel.app"],
        auth_methods: {
          email_password: { allow_sign_up: true, email_verification_method: "link" },
        },
      };
      const failures = runChecks(config);
      expect(failures.some((f) => f.check === "auth_methods.email_password.enabled")).toBe(true);
    });
  });
});
