import { describe, expect, it } from "vitest";
import { AuthSchema, SignUpSchema } from "../../src/server/auth/authSchema";

/**
 * PR2.auth-core — Zod schemas for sign-in (AuthSchema) and sign-up
 * (SignUpSchema). Replaces the legacy `signInSchema.ts` (single
 * `SignInSchema`) with `authSchema.ts` that exports both:
 *   - `AuthSchema`: { email, password } — unchanged shape, kept so PR2's
 *     rewrite of `signInAction` and PR3's `signUpAction` can share the
 *     validation primitive for the email + password fields.
 *   - `SignUpSchema`: AuthSchema + `confirmPassword` refinement that
 *     asserts `confirmPassword === password` (with a user-visible error
 *     path so the form layer can surface a localized message).
 */

describe("AuthSchema (Zod unit)", () => {
  it("accepts a well-formed email and a non-empty password", () => {
    const r = AuthSchema.safeParse({ email: "owner@example.com", password: "secret" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe("owner@example.com");
      expect(r.data.password).toBe("secret");
    }
  });

  it("rejects a malformed email with a user-visible field error", () => {
    const r = AuthSchema.safeParse({ email: "not-an-email", password: "secret" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.email).toBeDefined();
      expect(r.error.flatten().fieldErrors.email?.[0]).toBe("Enter a valid email");
    }
  });

  it("rejects an empty password with a user-visible field error", () => {
    const r = AuthSchema.safeParse({ email: "owner@example.com", password: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.password?.[0]).toBe("Password is required");
    }
  });
});

describe("SignUpSchema (Zod unit)", () => {
  const valid = { email: "new@example.com", password: "p4ssword!", confirmPassword: "p4ssword!" };

  it("accepts matching email + password + confirmPassword", () => {
    const r = SignUpSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe("new@example.com");
      expect(r.data.password).toBe("p4ssword!");
      expect(r.data.confirmPassword).toBe("p4ssword!");
    }
  });

  it("rejects mismatched confirmPassword with a user-visible field error", () => {
    const r = SignUpSchema.safeParse({
      email: valid.email,
      password: valid.password,
      confirmPassword: "different",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const flat = r.error.flatten().fieldErrors;
      expect(flat.confirmPassword).toBeDefined();
      expect(flat.confirmPassword?.[0]).toMatch(/match/i);
    }
  });

  it("rejects a malformed email in the signup path", () => {
    const r = SignUpSchema.safeParse({
      email: "not-an-email",
      password: valid.password,
      confirmPassword: valid.confirmPassword,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.email?.[0]).toBe("Enter a valid email");
    }
  });

  it("rejects an empty password in the signup path", () => {
    const r = SignUpSchema.safeParse({
      email: valid.email,
      password: "",
      confirmPassword: "",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.password?.[0]).toBe("Password is required");
    }
  });

  it("rejects an empty confirmPassword with a user-visible field error", () => {
    const r = SignUpSchema.safeParse({
      email: valid.email,
      password: valid.password,
      confirmPassword: "",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.flatten().fieldErrors.confirmPassword?.[0] ?? "";
      // Either the empty-string check (min(1)) or the mismatch refinement
      // produces a user-visible error; the form layer surfaces either.
      expect(msg).toMatch(/required|match/i);
    }
  });
});
