import { SignInForm } from "./SignInForm";

export const metadata = { title: "Iniciar sesión" };

/**
 * PR3.auth-ui (Task 3.6) — `/sign-in` page.
 *
 *   - Reads optional `searchParams`:
 *     - `hint=verify-email` → renders a "Check your inbox" banner above
 *       the form (shown after `/sign-up` redirects, or when a verified
 *       user signs out, or when `requireUser` bounces an unverified
 *       visitor). Copy is mode-agnostic (works for both `link` and
 *       `otp` verification).
 *     - `next=<pathname>` → propagated into the form via the hidden
 *       `<input name="next">` so the signed-in user lands back where
 *       they started (matches the `proxy.ts` redirect contract).
 *   - The "Create account" CTA lives in `SignInForm` so the form owns
 *     its full sign-in/sign-up affordance surface.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<{ hint?: string; next?: string }> | { hint?: string; next?: string };
}) {
  const params =
    (searchParams && "then" in (searchParams as object)
      ? await (searchParams as Promise<{ hint?: string; next?: string }>)
      : (searchParams as { hint?: string; next?: string } | undefined)) ?? {};
  const showVerifyBanner = params.hint === "verify-email";
  const next = typeof params.next === "string" ? params.next : "";
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center justify-center gap-6 bg-canvas px-4 py-10 text-ink">
      <header className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-ink-muted">
          Calculadora Flor
        </p>
        <h1 className="text-2xl font-semibold text-wrap-balance">Iniciar sesión</h1>
        <p className="text-sm text-ink-muted text-wrap-balance">
          Accedé con tu cuenta autorizada para ver materiales, recetas y cotizaciones.
        </p>
      </header>
      {showVerifyBanner ? (
        <div
          role="status"
          aria-live="polite"
          className="w-full rounded-md border border-border-subtle bg-surface-soft px-4 py-3 text-sm text-ink"
        >
          <p className="font-semibold">Revisá tu casilla</p>
          <p className="text-ink-muted">
            Te enviamos un mensaje para verificar tu cuenta. Si no lo ves, revisá spam.
          </p>
        </div>
      ) : null}
      <div className="w-full rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm">
        <SignInForm next={next} />
      </div>
    </div>
  );
}
