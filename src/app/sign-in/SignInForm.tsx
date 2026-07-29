"use client";
import { useActionState } from "react";
import { signInAction, type SignInState } from "@/server/actions/signIn";

const initial: SignInState = {};

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, initial);
  return (
    <form action={action} className="flex w-full flex-col gap-4" aria-describedby="sign-in-help">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-ink">Email</span>
        <input
          name="email"
          type="email"
          required
          defaultValue={state.values?.email ?? ""}
          autoComplete="email"
          className="rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-ink"
        />
        {state.errors?.email?.map((e) => (
          <p key={e} role="alert" className="text-sm text-status-danger">
            {e}
          </p>
        ))}
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-ink">Contraseña</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-ink"
        />
        {state.errors?.password?.map((e) => (
          <p key={e} role="alert" className="text-sm text-status-danger">
            {e}
          </p>
        ))}
      </label>
      {state.errors?._form?.map((e) => (
        <p key={e} role="alert" className="text-sm text-status-danger">
          {e}
        </p>
      ))}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-md bg-brand px-4 text-on-brand disabled:opacity-60"
      >
        {pending ? "Iniciando sesión…" : "Iniciar sesión"}
      </button>
      <p id="sign-in-help" className="text-xs text-ink-muted">
        Inicio de sesión seguro con Neon Auth.
      </p>
    </form>
  );
}
