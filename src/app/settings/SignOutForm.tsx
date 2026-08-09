"use client";

import { useActionState } from "react";
import { signOutAction, type SignOutState } from "@/server/actions/signOut";

const initial: SignOutState = {};

/**
 * v0.4.4 — minimal sign-out form. Single button, no fields, calls
 * `signOutAction` which clears local cookies + Best Auth session and
 * redirects to `/sign-in`.
 */
export function SignOutForm() {
  const [state, formAction, pending] = useActionState(signOutAction, initial);
  return (
    <form action={formAction} aria-busy={pending}>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-border-subtle bg-surface px-4 text-ink hover:bg-surface-soft disabled:opacity-60"
      >
        {pending ? "Cerrando sesión…" : "Cerrar sesión"}
      </button>
      {state.errors?._form?.map((m) => (
        <p key={m} role="alert" className="mt-2 text-sm text-status-danger">
          {m}
        </p>
      ))}
    </form>
  );
}