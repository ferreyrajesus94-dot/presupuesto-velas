import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/server/auth/requireOwner";
import { getQuote } from "@/server/repositories/quotes";
import { QuoteDetailView } from "./QuoteDetailView";

/**
 * PR4h — `/quotes/[id]` Server Component loader. `requireOwner()` +
 * `getQuote()` (which already scopes by owner + excludes terminal in
 * the active view). Any `null` from `getQuote` triggers Next's 404.
 */
export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  const { id } = await params;
  const quote = await getQuote(owner.id, id);
  if (!quote) notFound();
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 bg-[#fffaf5] px-4 py-8 text-zinc-900 sm:px-6 lg:px-8">
      <nav>
        <Link href="/quotes" className="font-semibold text-rose-900 underline">
          ← Cotizaciones
        </Link>
      </nav>
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-800">
          Calculadora Flor
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Detalle de cotización</h1>
      </header>
      <QuoteDetailView quote={quote} now={new Date()} />
    </main>
  );
}
