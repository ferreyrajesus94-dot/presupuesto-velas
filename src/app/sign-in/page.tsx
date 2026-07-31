import { SignInForm } from "./SignInForm";

export const metadata = { title: "Iniciar sesión" };

export default function SignInPage() {
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
      <div className="w-full rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm">
        <SignInForm />
      </div>
    </div>
  );
}
