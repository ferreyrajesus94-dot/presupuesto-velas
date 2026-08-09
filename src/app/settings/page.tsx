import { requireUser } from "@/server/auth/requireUser";
import { ThemeToggle } from "@/components/theme/ThemeProvider";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { SignOutForm } from "./SignOutForm";

export const metadata = { title: "Configuración" };

/**
 * v0.4.4 — `/settings` page.
 *
 * Server component. `requireUser()` redirects unauthenticated visitors
 * to `/sign-in` (and unverified to `/verify-email`) — so by the time we
 * render, the user is a verified Neon Auth session. We display the
 * session's email + role and give the user two actions: change
 * password (form posting to `changePasswordAction`) and sign out
 * (form posting to `signOutAction`).
 *
 * Roles are `owner` (bootstrap-matched email) or `user` (default). We
 * render the role badge as informational only — there's no admin UI yet
 * (the reserved `requireRole('owner')` guard from PR2 is the contract
 * for future admin routes).
 */
export default async function SettingsPage() {
  const user = await requireUser();
  const roleLabel = user.role === "owner" ? "Administrador" : "Usuario";
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center justify-center gap-6 bg-canvas px-4 py-10 text-ink">
      <header className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-ink-muted">
          Calculadora Flor
        </p>
        <h1 className="text-2xl font-semibold text-wrap-balance">Configuración</h1>
        <p className="text-sm text-ink-muted text-wrap-balance">
          Cambiá tu contraseña o cerrá la sesión.
        </p>
      </header>

      <section
        aria-label="Datos de la cuenta"
        className="w-full rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm"
      >
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-ink-muted">Email</dt>
            <dd className="font-mono text-ink">{user.email}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-ink-muted">Rol</dt>
            <dd>
              <span
                className={
                  user.role === "owner"
                    ? "inline-flex items-center rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-on-brand"
                    : "inline-flex items-center rounded-full border border-border-subtle bg-surface-soft px-2 py-0.5 text-xs font-medium text-ink-muted"
                }
              >
                {roleLabel}
              </span>
            </dd>
          </div>
        </dl>
      </section>

      <section
        aria-label="Apariencia"
        className="w-full rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm"
      >
        <h2 className="mb-3 text-base font-semibold text-ink">Apariencia</h2>
        <p className="mb-3 text-sm text-ink-muted">
          Cambiá entre tema claro, oscuro o seguí al sistema.
        </p>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <span className="text-sm text-ink-muted">Cambiar tema</span>
        </div>
      </section>

      <section
        aria-label="Cambiar contraseña"
        className="w-full rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm"
      >
        <h2 className="mb-3 text-base font-semibold text-ink">Cambiar contraseña</h2>
        <ChangePasswordForm />
      </section>

      <section
        aria-label="Cerrar sesión"
        className="w-full rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm"
      >
        <h2 className="mb-3 text-base font-semibold text-ink">Cerrar sesión</h2>
        <p className="mb-3 text-sm text-ink-muted">
          Vas a salir de tu cuenta en este navegador. Tus datos quedan guardados.
        </p>
        <SignOutForm />
      </section>
    </div>
  );
}