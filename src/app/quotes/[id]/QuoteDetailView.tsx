"use client";

import Link from "next/link";
import { useState } from "react";
import { isExpiredSent } from "@/domain/quoteExpired";
import { projectQuote, type ProjectionVisibility } from "@/domain/projection";
import { formatArsFromDecimalString } from "@/lib/moneyFormat";
import type { QuoteRecord } from "@/server/repositories/quotes";

type Status = "draft" | "sent" | "accepted" | "rejected" | "expired";

function displayStatus(quote: QuoteRecord, now: Date): Status {
  const status = quote.quote.status;
  if (isExpiredSent({ status, expirationDate: quote.quote.expirationDate }, now)) {
    return "expired";
  }
  return status;
}

function formatDate(iso: string): string {
  return iso.split("-").reverse().join("/");
}

/**
 * PR4h — Read-only quote detail view. Renders the current snapshot with
 * local visibility toggles (NOT persisted to the DB in PR4h — see PR4i).
 * Edit/Delete buttons are draft-only; `sent`/`accepted`/`rejected` show
 * "Solo lectura" and surface expired status derived from the expiration date.
 */
export function QuoteDetailView({ quote, now }: { quote: QuoteRecord; now: Date }) {
  const version = quote.versions.find(({ versionNo }) => versionNo === quote.quote.currentVersion);
  const models = quote.models.filter((row) => row.versionNo === quote.quote.currentVersion);
  const indirects = quote.indirectCosts.filter(
    (row) => row.versionNo === quote.quote.currentVersion,
  );

  const [visibility, setVisibility] = useState<ProjectionVisibility>({
    internalCost: version?.visibilityInternal ?? true,
    profitMargin: version?.visibilityProfit ?? true,
  });

  const status = displayStatus(quote, now);
  const isDraft = quote.quote.status === "draft";
  const customerName = quote.quote.customerName?.trim() || "Sin cliente";

  const projected = version
    ? projectQuote(
        {
          id: quote.quote.id,
          models: models.map((m) => ({
            recipeId: m.recipeId,
            quantity: m.quantity,
            perUnitCost: m.unitCost,
            lineTotal: m.lineTotal,
          })),
          indirectCosts: indirects.map(({ name, amount }) => ({ name, amount })),
          materialsTotal: version.materialsTotal,
          indirectTotal: version.indirectTotal,
          profitValue: version.profitAmount,
          total: version.finalPrice,
          depositAmount: version.depositAmount,
          depositPercent: version.depositPercent,
          expirationDate: quote.quote.expirationDate,
          visibility: {
            internalCost: visibility.internalCost ?? true,
            profitMargin: visibility.profitMargin ?? true,
          },
          computedAt: version.createdAt,
          profitMethod: version.profitMethod,
        },
        visibility,
      )
    : null;

  return (
    <section
      aria-label="Detalle de cotización"
      className="flex flex-col gap-6 rounded-2xl border border-rose-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-700">Cliente</p>
          <p className="text-xl font-semibold">{customerName}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="quote-status"
            className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-950"
          >
            {status}
          </span>
          <span className="text-sm text-zinc-700">
            Vence: {formatDate(quote.quote.expirationDate)}
          </span>
        </div>
      </header>

      <section aria-label="Modelos" className="flex flex-col gap-2">
        <h2 className="font-medium">Modelos</h2>
        <ol aria-label="Modelos" className="flex flex-col gap-2">
          {models.map((m) => (
            <li
              key={`${m.quoteId}-${m.versionNo}-${m.position}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-100 bg-rose-50/40 px-3 py-2"
            >
              <span className="font-medium">{m.recipeName}</span>
              <span className="text-sm text-zinc-700">Cantidad: {m.quantity}</span>
              <span className="text-sm font-semibold">
                {formatArsFromDecimalString(m.lineTotal)}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-label="Visibilidad"
        className="flex flex-wrap gap-4 rounded-xl border border-rose-100 bg-rose-50/40 p-3"
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={visibility.internalCost ?? true}
            onChange={(e) => setVisibility((v) => ({ ...v, internalCost: e.target.checked }))}
          />
          <span>Mostrar costo interno</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={visibility.profitMargin ?? true}
            onChange={(e) => setVisibility((v) => ({ ...v, profitMargin: e.target.checked }))}
          />
          <span>Mostrar margen de ganancia</span>
        </label>
      </section>

      {visibility.internalCost && indirects.length > 0 ? (
        <section aria-label="Costos indirectos" className="flex flex-col gap-2">
          <h2 className="font-medium">Costos indirectos</h2>
          <ol aria-label="Costos indirectos" className="flex flex-col gap-1">
            {indirects.map((ic) => (
              <li
                key={`${ic.quoteId}-${ic.versionNo}-${ic.position}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-rose-100 bg-rose-50/30 px-3 py-1 text-sm"
              >
                <span>{ic.name}</span>
                <span className="font-semibold">{formatArsFromDecimalString(ic.amount)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {projected ? (
        <section
          aria-label="Totales"
          className="flex flex-col gap-1 rounded-xl border border-rose-100 bg-rose-50/40 p-4 text-sm"
        >
          {visibility.internalCost && projected.materialsTotal ? (
            <p>
              Materiales:{" "}
              <span className="font-semibold">
                {formatArsFromDecimalString(projected.materialsTotal)}
              </span>
            </p>
          ) : null}
          {visibility.internalCost && projected.indirectTotal ? (
            <p>
              Indirectos:{" "}
              <span className="font-semibold">
                {formatArsFromDecimalString(projected.indirectTotal)}
              </span>
            </p>
          ) : null}
          {visibility.profitMargin && projected.profitValue ? (
            <p>
              Ganancia:{" "}
              <span className="font-semibold">
                {formatArsFromDecimalString(projected.profitValue)}
              </span>
            </p>
          ) : null}
          <p className="text-base">
            Total:{" "}
            <span className="font-semibold">{formatArsFromDecimalString(projected.total)}</span>
          </p>
        </section>
      ) : null}

      {projected ? (
        <section
          aria-label="Seña"
          className="flex flex-wrap gap-4 rounded-xl border border-rose-100 bg-rose-50/40 p-4 text-sm"
        >
          <p>
            Porcentaje de seña: <span className="font-semibold">{projected.depositPercent}%</span>
          </p>
          <p>
            Monto de seña:{" "}
            <span className="font-semibold">
              {formatArsFromDecimalString(projected.depositAmount)}
            </span>
          </p>
        </section>
      ) : null}

      <footer className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/quotes" className="font-semibold text-rose-900 underline">
          ← Volver
        </Link>
        {isDraft ? (
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/quotes/${quote.quote.id}/edit`}
              className="rounded-lg bg-rose-900 px-4 py-2 font-semibold text-white"
            >
              Editar
            </Link>
            <DeleteDraftButton id={quote.quote.id} />
          </div>
        ) : (
          <p className="text-sm text-zinc-700">Solo lectura — esta cotización no puede editarse.</p>
        )}
      </footer>
    </section>
  );
}

function DeleteDraftButton({ id }: { id: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onClick() {
    if (pending) return;
    if (!confirm("¿Eliminar este borrador?")) return;
    setPending(true);
    setError(null);
    const { deleteQuoteDraftAction } = await import("@/server/actions/quotes-delete");
    const result = await deleteQuoteDraftAction(id);
    setPending(false);
    if (result.ok) {
      window.location.href = "/quotes";
      return;
    }
    setError(result.error.message);
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-lg border border-rose-900 px-4 py-2 font-semibold text-rose-900 disabled:opacity-60"
      >
        {pending ? "Eliminando..." : "Eliminar"}
      </button>
      <p role="alert" className="text-sm text-rose-800">
        {error ?? ""}
      </p>
    </div>
  );
}
