"use client";
import { useActionState } from "react";
import { signInAction, type SignInState } from "@/server/actions/signIn";

const initial: SignInState = {};

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, initial);
  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span>Email</span>
        <input
          name="email"
          type="email"
          required
          defaultValue={state.values?.email ?? ""}
          autoComplete="email"
          className="rounded border px-2 py-1"
        />
        {state.errors?.email?.map((e) => (
          <p key={e} role="alert" className="text-sm text-red-700">
            {e}
          </p>
        ))}
      </label>
      <label className="flex flex-col gap-1">
        <span>Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="rounded border px-2 py-1"
        />
        {state.errors?.password?.map((e) => (
          <p key={e} role="alert" className="text-sm text-red-700">
            {e}
          </p>
        ))}
      </label>
      {state.errors?._form?.map((e) => (
        <p key={e} role="alert" className="text-sm text-red-700">
          {e}
        </p>
      ))}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
