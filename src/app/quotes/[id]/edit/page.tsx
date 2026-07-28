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
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 bg-[#fffaf5] px-4 py-8 text-zinc-900 sm:px-6 lg:px-8">
      <nav>
        <Link href={`/quotes/${id}`} className="font-semibold text-rose-900 underline">
          ← Volver
        </Link>
      </nav>
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-800">
          Calculadora Flor
        </p>
        <h1 className="mt-2 text-3xl font-semibold">
          {isDraft ? "Editar cotización" : "Cotización no editable"}
        </h1>
      </header>
      {isDraft ? (
        <QuoteEditForm quote={quote} recipes={recipes} />
      ) : (
        <section className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-zinc-700">
            Solo borradores editables. Esta cotización está en estado{" "}
            <span className="font-semibold">{quote.quote.status}</span> y no puede modificarse.
          </p>
        </section>
      )}
    </main>
  );
}
