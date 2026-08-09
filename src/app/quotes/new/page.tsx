import Link from "next/link";
import { requireUser } from "@/server/auth/requireUser";
import { listTemplates } from "@/server/repositories/templates";
import { QuoteCreateForm } from "./QuoteCreateForm";

/**
 * PR2.auth-core (Task 2.8) — `/quotes/new` Server Component loader.
 *
 * Authenticate via `requireUser()`, fetch active templates (no archived),
 * and mount the Client Component form shell. Indirects, deposit
 * auto-suggest, and submission wiring are PR4g.3.
 */
export default async function NewQuotePage() {
  const user = await requireUser();
  const records = await listTemplates(user.id);
  // active only; archived templates excluded — the form must not let the user
  // pick an archived template because its items/cost are frozen for history.
  const activeTemplates = records
    .filter(({ template }) => template.archivedAt === null)
    .map(({ template }) => template);
  return (
    // Root layout owns <main id="main">; this page must not nest another one.
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 bg-canvas px-4 py-8 text-ink sm:px-6 lg:px-8">
      <nav className="flex items-center justify-between">
        <Link
          href="/quotes"
          className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
        >
          ← Presupuestos
        </Link>
        <button type="button" data-help="calculator" aria-label="Ayuda sobre la calculadora" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border text-ink">
          ?
        </button>
      </nav>
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">
          Calculadora Flor
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Nueva presupuesto</h1>
      </header>
      <QuoteCreateForm templates={activeTemplates} />
    </div>
  );
}
