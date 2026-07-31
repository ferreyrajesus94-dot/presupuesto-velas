import { describe, expect, it } from "vitest";
import { SignInSchema } from "../../src/server/auth/signInSchema";

describe("SignInSchema (Zod unit)", () => {
  it("accepts a well-formed email and a non-empty password", () => {
    const r = SignInSchema.safeParse({ email: "owner@example.com", password: "secret" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe("owner@example.com");
      expect(r.data.password).toBe("secret");
    }
  });

  it("rejects a malformed email with a user-visible field error", () => {
    const r = SignInSchema.safeParse({ email: "not-an-email", password: "secret" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.email).toBeDefined();
      expect(r.error.flatten().fieldErrors.email?.[0]).toBe("Enter a valid email");
    }
  });

  it("rejects an empty password with a user-visible field error", () => {
    const r = SignInSchema.safeParse({ email: "owner@example.com", password: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.password?.[0]).toBe("Password is required");
    }
  });
});
