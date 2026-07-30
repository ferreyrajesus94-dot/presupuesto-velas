import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/server/auth/requireOwner";
import { getQuote } from "@/server/repositories/quotes";
import { listRecipes } from "@/server/repositories/recipes";
import { isExpiredSent } from "@/domain/quoteExpired";
import QuoteEditForm from "./QuoteEditForm";

/**
 * U7b — page-localized status labels. The status logic (`isDraft`, etc.)
 * remains English/typed; only the visible label is translated so the
 * non-draft page never leaks raw enum tokens to the user. `expired` is a
 * presentation-only derived key (never stored) for `sent` quotes whose
 * `expirationDate` is past — see `displayEditStatus()` below.
 */
const STATUS_LABEL: Record<"draft" | "sent" | "expired" | "accepted" | "rejected", string> = {
  draft: "Borrador",
  sent: "Enviada",
  expired: "Vencida",
  accepted: "Aceptada",
  rejected: "Rechazada",
};

/**
 * U7b — derive the visible status at the presentation boundary. The
 * persisted `quote.quote.status` stays untouched (no schema/action/payload
 * changes); only the visible enum key is mapped. Drafts never enter this
 * path because the page renders `QuoteEditForm` for them, but the helper is
 * shaped to take the full persisted status type to keep the call site clean.
 */
function displayEditStatus(
  quoteStatus: "draft" | "sent" | "accepted" | "rejected",
  expirationDate: string,
  now: Date,
): "draft" | "sent" | "expired" | "accepted" | "rejected" {
  if (quoteStatus === "sent" && isExpiredSent({ status: "sent", expirationDate }, now)) {
    return "expired";
  }
  return quoteStatus;
}

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
            <span className="font-semibold text-ink">
              {
                STATUS_LABEL[
                  displayEditStatus(quote.quote.status, quote.quote.expirationDate, new Date())
                ]
              }
            </span>{" "}
            y no puede modificarse.
          </p>
        </section>
      )}
    </main>
  );
}
