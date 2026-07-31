import Link from "next/link";

export const metadata = { title: "Acceso denegado" };

export default function ForbiddenPage() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center justify-center gap-4 bg-canvas px-4 py-10 text-center text-ink">
      <header className="flex flex-col items-center gap-2">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-ink-muted">
          Calculadora Flor
        </p>
        <h1 className="text-2xl font-semibold text-wrap-balance">Acceso denegado (403)</h1>
      </header>
      <p className="text-sm text-ink-muted text-wrap-balance">
        Esta cuenta no es la titular del espacio. Iniciá sesión con la cuenta autorizada para
        continuar.
      </p>
      <Link
        href="/sign-in"
        className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-on-brand"
      >
        Volver a iniciar sesión
      </Link>
    </div>
  );
}
