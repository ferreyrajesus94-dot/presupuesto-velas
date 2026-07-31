import Link from "next/link";
import { requireOwner } from "@/server/auth/requireOwner";
import { listRecipes } from "@/server/repositories/recipes";
import { QuoteCreateForm } from "./QuoteCreateForm";

/**
 * PR4g.2 — `/quotes/new` Server Component loader.
 *
 * Authenticate via `requireOwner()`, fetch active recipes (no archived), and
 * mount the Client Component form shell. Indirects, deposit auto-suggest, and
 * submission wiring are PR4g.3.
 */
export default async function NewQuotePage() {
  const owner = await requireOwner();
  const records = await listRecipes(owner.id);
  // active only; archived recipes excluded — the form must not let the user
  // pick an archived recipe because its items/cost are frozen for history.
  const activeRecipes = records
    .filter(({ recipe }) => recipe.archivedAt === null)
    .map(({ recipe }) => recipe);
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 bg-canvas px-4 py-8 text-ink sm:px-6 lg:px-8">
      <nav>
        <Link
          href="/quotes"
          className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
        >
          ← Cotizaciones
        </Link>
      </nav>
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">
          Calculadora Flor
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Nueva cotización</h1>
      </header>
      <QuoteCreateForm recipes={activeRecipes} />
    </main>
  );
}
