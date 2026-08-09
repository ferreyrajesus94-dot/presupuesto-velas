"use client";

import { useActionState } from "react";
import {
  changePasswordAction,
  type ChangePasswordState,
} from "@/server/actions/changePassword";

const initial: ChangePasswordState = {};

/**
 * v0.4.4 — change-password form. Three fields (current + new +
 * confirm), `useActionState` for the per-field error surface. The
 * server action validates with Zod (refinements: newPassword matches
 * confirm, newPassword differs from current) before contacting
 * Better Auth, so most failures surface as instant field errors.
 */
export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, initial);
  return (
    <form action={formAction} className="flex w-full flex-col gap-4" aria-busy={pending}>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">Contraseña actual</span>
        <input
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          className="rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-ink"
        />
        {state.errors?.currentPassword?.map((m) => (
          <p key={m} role="alert" className="text-sm text-status-danger">
            {m}
          </p>
        ))}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">Nueva contraseña</span>
        <input
          name="newPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-ink"
        />
        {state.errors?.newPassword?.map((m) => (
          <p key={m} role="alert" className="text-sm text-status-danger">
            {m}
          </p>
        ))}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">Confirmar nueva contraseña</span>
        <input
          name="confirmPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-ink"
        />
        {state.errors?.confirmPassword?.map((m) => (
          <p key={m} role="alert" className="text-sm text-status-danger">
            {m}
          </p>
        ))}
      </label>
      {state.errors?._form?.map((m) => (
        <p key={m} role="alert" className="text-sm text-status-danger">
          {m}
        </p>
      ))}
      {state.ok ? (
        <p role="status" className="text-sm text-status-success">
          Contraseña actualizada.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-on-brand disabled:opacity-60"
      >
        {pending ? "Guardando…" : "Cambiar contraseña"}
      </button>
    </form>
  );
}