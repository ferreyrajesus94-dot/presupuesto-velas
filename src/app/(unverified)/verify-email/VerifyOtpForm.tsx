"use client";
import { useActionState } from "react";
import { verifyEmailOtpAction, type VerifyEmailOtpState } from "@/server/actions/verifyEmailOtp";

const initial: VerifyEmailOtpState = {};

/**
 * Hotfix for v0.4.0 — `VerifyOtpForm`.
 *
 * Better Auth's `email_verification_method: "otp"` flow needs the user to
 * submit the 6-digit OTP. PR3.2 only shipped the resend button (no input),
 * leaving users with no way to verify. This form fills the gap.
 *
 * - `email` is pre-filled from the session when available (read-only
 *   hidden input), so the user only types the OTP. If the form needs to
 *   accept a manual email override (e.g. for re-verifying after a
 *   session reset), the action handles both paths.
 * - `otp` is a 6-digit numeric input (`inputMode="numeric"`, `pattern`
 *   enforces shape on submit; the action's Zod schema enforces it on
 *   the server).
 * - Success: server-side redirect to `/sign-in?verified=1`.
 * - Failure: localized error from `state.errors._form` (INVALID_OTP,
 *   rate-limit, etc.) per `verifyEmailOtpAction.localizedOtpError`.
 */
export function VerifyOtpForm({ defaultEmail = "" }: { defaultEmail?: string }) {
  const [state, formAction, pending] = useActionState(verifyEmailOtpAction, initial);
  return (
    <form action={formAction} className="flex w-full flex-col gap-4" aria-busy={pending}>
      <input type="hidden" name="email" value={defaultEmail} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">Email</span>
        <input
          type="email"
          value={defaultEmail}
          readOnly={Boolean(defaultEmail)}
          aria-readonly={Boolean(defaultEmail)}
          disabled
          className="rounded-md border border-border-subtle bg-surface-muted px-3 py-2 text-ink disabled:cursor-not-allowed disabled:opacity-70"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">Código de verificación</span>
        <input
          type="text"
          name="otp"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          minLength={6}
          aria-describedby="otp-help"
          className="rounded-md border border-border-subtle bg-surface px-3 py-2 text-ink tracking-[0.4em] text-center text-lg"
          placeholder="123456"
        />
        <span id="otp-help" className="text-xs text-ink-muted">
          Ingresá el código de 6 dígitos que te enviamos por mail.
        </span>
      </label>
      {state.errors?.email?.map((m) => (
        <p key={m} role="alert" className="text-sm text-status-danger">
          {m}
        </p>
      ))}
      {state.errors?.otp?.map((m) => (
        <p key={m} role="alert" className="text-sm text-status-danger">
          {m}
        </p>
      ))}
      {state.errors?._form?.map((m) => (
        <p key={m} role="alert" className="text-sm text-status-danger">
          {m}
        </p>
      ))}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-on-brand disabled:opacity-60"
      >
        {pending ? "Verificando…" : "Verificar"}
      </button>
    </form>
  );
}