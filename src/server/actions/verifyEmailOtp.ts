"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAppBaseUrl } from "../auth/appBaseUrl";
import { getNeonAuthBaseUrl } from "../auth/userEnv";
import { fetchSessionUser } from "../auth/session";

/**
 * Hotfix for v0.4.0 — `verifyEmailOtpAction`.
 *
 * Better Auth's `email_verification_method: "otp"` flow requires the user
 * to submit the 6-digit OTP to `/sign-in/email-otp`. PR3.2 originally
 * shipped only the resend form (no input UI), so users who received the
 * OTP had nowhere to enter it. This action fills that gap.
 *
 * The email is sourced from the SESSION when available (avoids asking the
 * user to re-type it), with a `defaultValue` on the form field. If the
 * form body carries an `email` override (the form sends a hidden input
 * when the user manually types one), it's honored — but the session
 * wins if both are present. The OTP is always sourced from the form body
 * (never from the session — there is no session OTP).
 *
 * Security:
 *   - The OTP is single-use and `expiresAt` is enforced by Neon Auth; we
 *     do not cache or replay.
 *   - Defense in depth: the form accepts any email, but if it doesn't
 *     match the session email, we use the form email (Better Auth keys
 *     verification on email+OTP). The session is the UX hint, not the
 *     security boundary — Neon Auth is.
 */
export type VerifyEmailOtpState = {
  errors?: { email?: string[]; otp?: string[]; _form?: string[] };
};

const OtpSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email inválido"),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "El código debe tener 6 dígitos"),
});

function localizedOtpError(upstreamMessage: string | null, status: number): string {
  const lower = upstreamMessage?.toLowerCase() ?? "";
  if (lower.includes("invalid") || status === 400) {
    return "Código inválido o expirado. Pedí uno nuevo con el botón de abajo.";
  }
  if (lower.includes("too many") || lower.includes("rate") || status === 429) {
    return "Demasiados intentos. Esperá unos minutos y volvé a pedir un código.";
  }
  return "No pudimos verificar el código. Intentá de nuevo en unos minutos.";
}

export async function verifyEmailOtpAction(
  _prev: VerifyEmailOtpState,
  formData: FormData,
): Promise<VerifyEmailOtpState> {
  const session = await fetchSessionUser();
  const formEmail = String(formData.get("email") ?? "").trim();
  const otp = String(formData.get("otp") ?? "").trim();

  const email = (session?.email ?? formEmail).toLowerCase();
  const parsed = OtpSchema.safeParse({ email, otp });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const base = getNeonAuthBaseUrl();
  const appBaseUrl = getAppBaseUrl();
  const res = await fetch(`${base}/sign-in/email-otp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: appBaseUrl,
    },
    body: JSON.stringify({ email: parsed.data.email, otp: parsed.data.otp }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    const upstreamMessage = typeof body?.message === "string" ? body.message : null;
    return {
      errors: { _form: [localizedOtpError(upstreamMessage, res.status)] },
    };
  }

  redirect("/sign-in?verified=1");
}