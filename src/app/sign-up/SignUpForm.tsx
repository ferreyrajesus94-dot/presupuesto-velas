"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { signUpAction, type SignUpState } from "@/server/actions/signUp";
import { SignUpSchema, type SignUpInput } from "@/server/auth/authSchema";

const initial: SignUpState = {};

const inputClass =
  "w-full rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-ink";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-status-danger">
      {message}
    </p>
  );
}

/**
 * PR3.auth-ui (Task 3.3) — public sign-up form.
 *
 * RHF + Zod (via `SignUpSchema`) handles the synchronous validation
 * surface (email + password + confirmPassword refinement); the
 * `signUpAction` server action handles the asynchronous Neon
 * `/sign-up/email` call and returns its own `state.errors` for any
 * upstream Neon Auth failures (duplicate email, weak password, network).
 *
 * Submit flow:
 *   - RHF `handleSubmit` validates locally with `SignUpSchema`; on pass
 *     we build a `FormData` from the form element and dispatch it to
 *     `signUpAction` via `useActionState`'s `formAction` inside a
 *     `startTransition` (so `pending` reflects the server round-trip).
 *   - On 2xx the server action `redirect()`s to
 *     `/sign-in?hint=verify-email`; React's `useActionState` re-throws
 *     the redirect signal and the page never re-renders.
 *
 * Errors are surfaced from two sources:
 *   1. RHF's `formState.errors` (sync, e.g. invalid email shape).
 *   2. The `state.errors` returned by `signUpAction` (async, e.g.
 *      Neon 422 duplicate-email or 400 weak-password).
 */
export function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUpAction, initial);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors: rhfErrors },
  } = useForm<SignUpInput>({
    resolver: zodResolver(SignUpSchema),
    defaultValues: { email: "", password: "", confirmPassword: "" },
  });
  const lastAppliedState = useRef(state);

  // Surface server-side errors back into RHF so the input borders
  // highlight the offending fields and the user gets one unified
  // error surface per field.
  useEffect(() => {
    if (lastAppliedState.current === state) return;
    lastAppliedState.current = state;
    if (!state.errors) return;
    if (state.errors.email?.[0])
      setError("email", { type: "server", message: state.errors.email[0] });
    if (state.errors.password?.[0])
      setError("password", { type: "server", message: state.errors.password[0] });
    if (state.errors.confirmPassword?.[0])
      setError("confirmPassword", {
        type: "server",
        message: state.errors.confirmPassword[0],
      });
  }, [state, setError]);

  function submit(values: SignUpInput, event?: React.BaseSyntheticEvent) {
    void values;
    const form = event?.target;
    if (!(form instanceof HTMLFormElement)) return;
    startTransition(() => formAction(new FormData(form)));
  }

  return (
    <form
      onSubmit={handleSubmit(submit)}
      noValidate
      aria-busy={pending}
      className="flex w-full flex-col gap-4"
      aria-describedby="sign-up-help"
    >
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-ink">Email</span>
        <input
          {...register("email")}
          type="email"
          autoComplete="email"
          aria-invalid={rhfErrors.email ? "true" : "false"}
          aria-describedby="sign-up-email-error"
          className={inputClass}
        />
        <FieldError id="sign-up-email-error" message={rhfErrors.email?.message} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-ink">Contraseña</span>
        <input
          {...register("password")}
          type="password"
          autoComplete="new-password"
          aria-invalid={rhfErrors.password ? "true" : "false"}
          aria-describedby="sign-up-password-error"
          className={inputClass}
        />
        <FieldError id="sign-up-password-error" message={rhfErrors.password?.message} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-ink">Repetir contraseña</span>
        <input
          {...register("confirmPassword")}
          type="password"
          autoComplete="new-password"
          aria-invalid={rhfErrors.confirmPassword ? "true" : "false"}
          aria-describedby="sign-up-confirm-error"
          className={inputClass}
        />
        <FieldError id="sign-up-confirm-error" message={rhfErrors.confirmPassword?.message} />
      </label>
      {state.errors?._form?.map((m) => (
        <p key={m} role="alert" className="text-sm text-status-danger">
          {m}
        </p>
      ))}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-md bg-brand px-4 text-on-brand disabled:opacity-60"
      >
        {pending ? "Creando cuenta…" : "Crear cuenta"}
      </button>
      <p className="text-sm text-ink-muted">
        ¿Ya tenés cuenta?{" "}
        <Link href="/sign-in" className="font-semibold text-brand hover:underline">
          Iniciá sesión
        </Link>
      </p>
      <p id="sign-up-help" className="text-xs text-ink-muted">
        Te enviaremos un email para verificar tu dirección antes de habilitar la cuenta.
      </p>
    </form>
  );
}
