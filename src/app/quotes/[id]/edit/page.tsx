import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/server/auth/requireOwner";
import { getQuote } from "@/server/repositories/quotes";
import { listRecipes } from "@/server/repositories/recipes";
import QuoteEditForm from "./QuoteEditForm";

/**
 * PR4h — `/quotes/[id]/edit` Server Component loader. Only `draft`
 * quotes are editable; non-draft quotes show a "Solo borradores
 * editables" message with a back link to the detail view. Forms for
 * drafts mount the `QuoteEditForm` Client Component with the existing
 * snapshot pre-filled.
 */
export default async function QuoteEditPage({ params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  const { id } = await params;
  const quote = await getQuote(owner.id, id);
  if (!quote) notFound();
  const isDraft = quote.quote.status === "draft";
  const recipes = isDraft
    ? (await listRecipes(owner.id))
        .filter(({ recipe }) => recipe.archivedAt === null)
        .map(({ recipe }) => recipe)
    : [];
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 bg-canvas px-4 py-8 text-ink sm:px-6 lg:px-8">
      <nav>
        <Link
          href={`/quotes/${id}`}
          className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
        >
          ← Volver
        </Link>
      </nav>
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">
          Calculadora Flor
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">
          {isDraft ? "Editar cotización" : "Cotización no editable"}
        </h1>
      </header>
      {isDraft ? (
        <QuoteEditForm quote={quote} recipes={recipes} />
      ) : (
        <section className="rounded-2xl border border-border-subtle bg-surface-raised p-5 shadow-sm">
          <p className="text-sm text-ink-muted">
            Solo borradores editables. Esta cotización está en estado{" "}
            <span className="font-semibold text-ink">{quote.quote.status}</span> y no puede
            modificarse.
          </p>
        </section>
      )}
    </main>
  );
}
