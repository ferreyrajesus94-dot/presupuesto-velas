import { z } from "zod";

/**
 * PR2.auth-core — shared auth Zod schemas.
 *
 * Replaces `src/server/auth/signInSchema.ts` (single `SignInSchema`) with
 * `authSchema.ts` exporting two schemas:
 *
 *   - `AuthSchema`: email + password. Used by `signInAction` (PR2.2) and
 *     the `/sign-in` form. Same shape as the legacy `SignInSchema`.
 *   - `SignUpSchema`: `AuthSchema` + `confirmPassword`, plus a refinement
 *     that asserts `confirmPassword === password` and surfaces a user-
 *     visible error so the `/sign-up` form can localize the message.
 *
 * The file lives in `src/server/auth/authSchema.ts` (not under
 * `src/server/actions/`) so both `signIn.ts` and the future `signUp.ts`
 * (PR3) import the same validation primitive.
 */

export const AuthSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export type AuthInput = z.infer<typeof AuthSchema>;

export const SignUpSchema = AuthSchema.extend({
  confirmPassword: z.string().min(1, "Password confirmation is required"),
}).refine((value) => value.password === value.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export type SignUpInput = z.infer<typeof SignUpSchema>;
