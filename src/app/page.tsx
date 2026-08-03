import Link from "next/link";
import { requireOwner } from "@/server/auth/requireOwner";
import { listMaterials } from "@/server/repositories/materials";
import { listTemplates } from "@/server/repositories/templates";
import { listQuotes } from "@/server/repositories/quotes";

const MAX_RECENT_QUOTES = 5;

type QuoteStatus = "draft" | "sent" | "accepted" | "rejected";

function formatExpirationDate(iso: string): string {
  return iso.split("-").reverse().join("/");
}

function statusLabel(status: QuoteStatus): string {
  switch (status) {
    case "draft":
      return "Borrador";
    case "sent":
      return "Enviada";
    case "accepted":
      return "Aceptada";
    case "rejected":
      return "Rechazada";
  }
}

export default async function Home() {
  const owner = await requireOwner();
  const [materials, templates, quotes] = await Promise.all([
    listMaterials(owner.id),
    listTemplates(owner.id),
    listQuotes(owner.id),
  ]);

  const totalsEmpty = materials.length === 0 && templates.length === 0 && quotes.length === 0;
  const recentQuotes = quotes.slice(-MAX_RECENT_QUOTES).reverse();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 bg-canvas px-4 py-8 text-ink sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 rounded-2xl bg-brand-gradient p-6 text-on-brand shadow sm:p-8">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-on-brand/80">
              Calculadora Flor
            </p>
            <h1 className="text-3xl font-semibold text-wrap-balance">🕯️ Calculadora de Velas Flor</h1>
            <p className="max-w-2xl text-sm text-on-brand/85">
              Organizá tus insumos, plantillas y cotizaciones desde un solo lugar.
            </p>
          </div>
          <button
            type="button"
            data-help="config"
            aria-label="Ayuda sobre el inicio"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-on-brand/40 text-on-brand transition-transform hover:-translate-y-1"
          >
            <span aria-hidden="true">?</span>
          </button>
        </div>
      </header>

      {totalsEmpty ? (
        <section
          aria-labelledby="dashboard-empty-heading"
          className="flex flex-col gap-3 rounded-2xl border border-dashed border-border-subtle bg-surface p-6 shadow-sm"
        >
          <h2
            id="dashboard-empty-heading"
            className="text-xl font-semibold text-ink text-wrap-balance"
          >
            Empezá con tu primer material
          </h2>
          <p className="text-sm text-ink-muted">
            Cargá los materiales que usás para hacer velas, armá recetas y generá cotizaciones para
            tus clientas.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link
              href="/materials"
              className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-on-brand"
            >
              Ir a Materiales
            </Link>
            <Link
              href="/templates"
              className="inline-flex min-h-11 items-center rounded-md border border-border-subtle bg-surface px-4 text-ink hover:bg-surface-soft"
            >
              Ir a Plantillas
            </Link>
            <Link
              href="/quotes/new"
              className="inline-flex min-h-11 items-center rounded-md border border-border-subtle bg-surface px-4 text-ink hover:bg-surface-soft"
            >
              Crear cotización
            </Link>
          </div>
        </section>
      ) : (
        <section aria-label="Resumen" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard
            icon="📦"
            title="Materiales"
            count={materials.length}
            singular="material"
            plural="materiales"
            href="/materials"
            cta="Ver materiales"
          />
          <SummaryCard
            icon="📋"
            title="Plantillas"
            count={templates.length}
            singular="plantilla"
            plural="plantillas"
            href="/templates"
            cta="Ver plantillas"
          />
          <SummaryCard
            icon="🧮"
            title="Cotizaciones activas"
            count={quotes.length}
            singular="cotización activa"
            plural="cotizaciones activas"
            href="/quotes"
            cta="Ver cotizaciones"
          />
        </section>
      )}

      <section aria-labelledby="recent-quotes-heading" className="flex flex-col gap-3">
        <header className="flex items-end justify-between gap-3">
          <h2
            id="recent-quotes-heading"
            className="text-xl font-semibold text-ink text-wrap-balance"
          >
            Cotizaciones recientes
          </h2>
          <Link href="/quotes" className="text-sm font-semibold text-brand underline">
            Ver todas
          </Link>
        </header>
        {recentQuotes.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border-subtle bg-surface p-6 text-sm text-ink-muted">
            Todavía no hay cotizaciones activas. Empezá creando una.
          </p>
        ) : (
          <ul
            aria-label="Cotizaciones recientes"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {recentQuotes.map(({ quote }) => (
            <li
                key={quote.id}
                className="rounded-2xl border border-border bg-surface p-6 shadow transition-transform hover:-translate-y-1"
              >
                <Link
                  href={`/quotes/${quote.id}`}
                  className="flex flex-col gap-2 text-ink no-underline"
                >
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">
                    Vence {formatExpirationDate(quote.expirationDate)}
                  </span>
                  <span className="text-base font-semibold text-ink">
                    {quote.customerName?.trim() || "Sin cliente"}
                  </span>
                  <span className="inline-flex w-fit rounded-full bg-surface-soft px-2 py-1 text-xs font-semibold text-ink">
                    {statusLabel(quote.status)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!totalsEmpty && (
        <footer className="flex justify-end">
          <Link
            href="/quotes/new"
            className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-on-brand"
          >
            + Nueva cotización
          </Link>
        </footer>
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  title,
  count,
  singular,
  plural,
  href,
  cta,
}: {
  icon: string;
  title: string;
  count: number;
  singular: string;
  plural: string;
  href: string;
  cta: string;
}) {
  const noun = count === 1 ? singular : plural;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-6 shadow transition-transform hover:-translate-y-1">
      <span className="text-3xl" aria-hidden="true">{icon}</span>
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-ink-muted">{title}</p>
      <p className="text-3xl font-semibold text-ink" aria-label={`${count} ${noun}`}>
        {count}
      </p>
      <Link
        href={href}
        className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline"
      >
        {cta} →
      </Link>
    </div>
  );
}
