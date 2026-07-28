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

function displayStatus(quote: QuoteListItem, now: Date): QuoteStatus {
  return isExpiredSent(quote, now) ? "expired" : quote.status;
}

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
      <section className="rounded-2xl border border-dashed border-rose-300 bg-rose-50 p-6">
        <h2 className="text-xl font-semibold">Todavía no hay cotizaciones</h2>
        <p className="mt-2 text-sm text-zinc-700">Creá una cotización para empezar.</p>
        <Link
          className="mt-4 inline-block font-semibold text-rose-900 underline"
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
    <section className="space-y-3" aria-label="Cotizaciones">
      <p className="text-sm font-medium text-zinc-700">
        {quotes.length} {noun} {adjective}
      </p>
      <table className="w-full table-fixed rounded-2xl border border-rose-200 bg-white text-left text-sm shadow-sm">
        <thead className="bg-rose-50 text-rose-950">
          <tr>
            <th className="w-[28%] p-3">Cliente</th>
            <th className="w-[24%] p-3">Vencimiento</th>
            <th className="w-[30%] p-3">Total</th>
            <th className="w-[18%] p-3">Estado</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((quote) => (
            <tr key={quote.id} className="border-t border-rose-100 align-top">
              <td className="break-words p-3 font-medium">
                {quote.customerName?.trim() || "Sin cliente"}
              </td>
              <td className="p-3">{quote.expirationDate.split("-").reverse().join("/")}</td>
              <td className="break-words p-3">{formatMoney(quote.total)}</td>
              <td className="p-3">
                <span
                  data-testid="quote-status"
                  className="rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-950"
                >
                  {displayStatus(quote, now)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
