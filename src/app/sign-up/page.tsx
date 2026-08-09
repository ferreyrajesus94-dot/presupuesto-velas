import { SignUpForm } from "./SignUpForm";

export const metadata = { title: "Crear cuenta" };

export default function SignUpPage() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center justify-center gap-6 bg-canvas px-4 py-10 text-ink">
      <header className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-ink-muted">
          Calculadora Flor
        </p>
        <h1 className="text-2xl font-semibold text-wrap-balance">Crear cuenta</h1>
        <p className="text-sm text-ink-muted text-wrap-balance">
          Registrate para guardar tus materiales, plantillas y presupuestos.
        </p>
      </header>
      <div className="w-full rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm">
        <SignUpForm />
      </div>
    </div>
  );
}
