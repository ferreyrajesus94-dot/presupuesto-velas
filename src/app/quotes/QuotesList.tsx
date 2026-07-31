import Decimal from "decimal.js";
import Link from "next/link";
import { isExpiredSent } from "@/domain/quoteExpired";
import type { QuoteStatus } from "@/domain/snapshot";

export type QuoteView = "active" | "archived";
export type QuoteListItem = {
  id: string;
  customerName: string | null;
  expirationDate: string;
  total: string;
  status: Exclude<QuoteStatus, "expired">;
};

function formatMoney(value: string): string {
  const [integer, decimals] = new Decimal(value)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2)
    .split(".");
  return `ARS ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${decimals}`;
}

function formatDate(iso: string): string {
  return iso.split("-").reverse().join("/");
}

function displayStatus(quote: QuoteListItem, now: Date): QuoteStatus {
  return isExpiredSent(quote, now) ? "expired" : quote.status;
}

const STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Borrador",
  sent: "Enviada",
  accepted: "Aceptada",
  rejected: "Rechazada",
  expired: "Vencida",
};

export function QuotesList({
  quotes,
  view,
  now,
}: {
  quotes: QuoteListItem[];
  view: QuoteView;
  now: Date;
}) {
  if (quotes.length === 0) {
    return (
      <section
        aria-labelledby="empty-quotes"
        className="rounded-2xl border border-border-subtle bg-surface-soft p-6"
      >
        <h2 id="empty-quotes" className="text-xl font-semibold text-ink">
          Todavía no hay cotizaciones
        </h2>
        <p className="mt-2 text-sm text-ink-muted">Creá una cotización para empezar.</p>
        <Link
          className="mt-4 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
          href="/quotes/new"
        >
          Crear la primera cotización
        </Link>
      </section>
    );
  }

  const noun = quotes.length === 1 ? "cotización" : "cotizaciones";
  const adjective =
    view === "active"
      ? quotes.length === 1
        ? "activa"
        : "activas"
      : quotes.length === 1
        ? "archivada"
        : "archivadas";
  return (
    <section className="flex flex-col gap-3" aria-label="Cotizaciones">
      <p className="text-sm font-medium text-ink-muted">
        {quotes.length} {noun} {adjective}
      </p>
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Cotizaciones">
        {quotes.map((quote) => {
          const customer = quote.customerName?.trim() || "Sin cliente";
          const status = displayStatus(quote, now);
          const label = STATUS_LABEL[status];
          return (
            <li
              key={quote.id}
              data-testid="quote-card"
              className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border-subtle bg-surface-raised p-4 shadow-sm"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Cliente
                </span>
                <h2 className="min-w-0 break-words overflow-wrap-anywhere font-semibold text-ink">
                  {customer}
                </h2>
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Vencimiento
                  </dt>
                  <dd className="min-w-0 break-words text-ink">
                    {formatDate(quote.expirationDate)}
                  </dd>
                </div>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Total
                  </dt>
                  <dd className="min-w-0 break-words overflow-wrap-anywhere font-semibold text-ink">
                    {formatMoney(quote.total)}
                  </dd>
                </div>
              </dl>
              <div className="flex items-center justify-between gap-3">
                <span
                  data-testid="quote-status"
                  aria-label={`Estado ${label}`}
                  className="inline-flex min-h-7 items-center rounded-full bg-surface-soft px-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted"
                >
                  {label}
                </span>
                <Link
                  href={`/quotes/${quote.id}`}
                  aria-label={`Ver cotización de ${customer}`}
                  className="inline-flex min-h-11 min-w-0 items-center justify-center break-words rounded-full border border-border-subtle bg-surface-raised px-4 text-sm font-semibold text-brand hover:bg-surface-soft"
                >
                  Ver cotización
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
