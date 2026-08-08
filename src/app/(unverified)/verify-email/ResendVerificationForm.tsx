"use client";
import { useActionState } from "react";
import {
  resendVerificationAction,
  type ResendVerificationState,
} from "@/server/actions/resendVerification";

const initial: ResendVerificationState = {};

/**
 * PR3.auth-ui (Task 3.7) — `ResendVerificationForm`.
 *
 * Minimal client component: a single submit button + localized success /
 * error surface. Uses `useActionState` directly (no RHF/Zod) because the
 * form has zero user-supplied fields — the email comes from the session,
 * not the form body.
 *
 * Success state: a localized confirmation "Listo, revisá tu casilla."
 * Error state: the `state.errors._form` returned by the action.
 */
export function ResendVerificationForm() {
  const [state, formAction, pending] = useActionState(resendVerificationAction, initial);
  return (
    <form action={formAction} className="flex w-full flex-col gap-4" aria-busy={pending}>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-md bg-brand px-4 text-on-brand disabled:opacity-60"
      >
        {pending ? "Reenviando…" : "Reenviar email de verificación"}
      </button>
      {state.ok ? (
        <p role="status" className="text-sm text-status-success">
          Listo, revisá tu casilla.
        </p>
      ) : null}
      {state.errors?._form?.map((m) => (
        <p key={m} role="alert" className="text-sm text-status-danger">
          {m}
        </p>
      ))}
    </form>
  );
}
