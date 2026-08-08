import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/requireUser";
import { getQuote } from "@/server/repositories/quotes";
import { QuoteDetailView } from "./QuoteDetailView";

/**
 * PR2.auth-core (Task 2.8) — `/quotes/[id]` Server Component loader.
 * `requireUser()` + `getQuote()` (which already scopes by user + excludes
 * terminal in the active view). Any `null` from `getQuote` triggers
 * Next's 404.
 */
export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const quote = await getQuote(user.id, id);
  if (!quote) notFound();
  return (
    // Root layout owns <main id="main">; this page must not nest another one.
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 bg-canvas px-4 py-8 text-ink sm:px-6 lg:px-8">
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
        <h1 className="mt-2 text-3xl font-semibold text-ink">Detalle de cotización</h1>
      </header>
      <QuoteDetailView quote={quote} now={new Date()} />
    </div>
  );
}