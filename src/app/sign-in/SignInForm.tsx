"use client";
import Link from "next/link";
import { useActionState } from "react";
import { signInAction, type SignInState } from "@/server/actions/signIn";

const initial: SignInState = {};

/**
 * PR3.auth-ui (Task 3.6) — `SignInForm` updated.
 *
 *   - Adds a hidden `<input name="next">` propagated from the URL via
 *     the `next` prop (the `proxy.ts` redirect contract). `signInAction`
 *     honors the field and redirects to `<next || '/'>` on success.
 *   - Adds a "Create account" CTA below the form linking to `/sign-up`
 *     (matches the design's `/sign-in` ↔ `/sign-up` parity surface).
 *
 * The hidden input is rendered with `defaultValue` (not `value`) so
 * React does not force the form to re-render when the parent re-renders
 * — the field is purely a transport for the server action.
 */
export function SignInForm({ next = "" }: { next?: string } = {}) {
  const [state, action, pending] = useActionState(signInAction, initial);
  return (
    <form action={action} className="flex w-full flex-col gap-4" aria-describedby="sign-in-help">
      <input type="hidden" name="next" value={next} />
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
      <p className="text-sm text-ink-muted">
        ¿No tenés cuenta?{" "}
        <Link
          href="/sign-up"
          className="inline-flex min-h-11 items-center font-semibold text-brand underline-offset-4 hover:underline"
        >
          Crear cuenta
        </Link>
      </p>
      <p id="sign-in-help" className="text-xs text-ink-muted">
        Inicio de sesión seguro con Neon Auth.
      </p>
    </form>
  );
}
