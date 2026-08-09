"use client";

import Link from "next/link";
import { useState } from "react";
import { isExpiredSent } from "@/domain/quoteExpired";
import { projectQuote, type ProjectionVisibility } from "@/domain/projection";
import { formatArsFromDecimalString, formatDecimalInput } from "@/lib/moneyFormat";
import type { QuoteRecord } from "@/server/repositories/quotes";
import { QuoteLifecycleControls } from "./QuoteLifecycleControls";
import { QuoteShareLinks } from "./QuoteShareLinks";

type Status = "draft" | "sent" | "accepted" | "rejected" | "expired";

const STATUS_LABEL: Record<Status, string> = {
  draft: "Borrador",
  sent: "Enviada",
  accepted: "Aceptada",
  rejected: "Rechazada",
  expired: "Vencida",
};

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
  const statusLabel = STATUS_LABEL[status];
  const isDraft = quote.quote.status === "draft";
  const customerName = quote.quote.customerName?.trim() || "Sin cliente";

  const projected = version
    ? projectQuote(
        {
          id: quote.quote.id,
          models: models.map((m) => ({
            recipeId: m.templateId,
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
      className="flex flex-col gap-6 rounded-2xl border border-border bg-surface p-6 shadow sm:p-8"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-semibold text-ink-muted">Cliente</p>
          <p className="min-w-0 break-words text-xl font-semibold text-ink">{customerName}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="quote-status"
            aria-label={`Estado ${statusLabel}`}
             className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold uppercase tracking-wide ${
               status === "accepted"
                 ? "bg-status-success/15 text-status-success"
                 : status === "rejected" || status === "expired"
                   ? "bg-status-danger/15 text-status-danger"
                   : status === "sent"
                     ? "bg-brand/15 text-brand"
                     : "bg-surface-soft text-ink-muted"
             }`}
          >
            {statusLabel}
          </span>
          <span className="text-sm text-ink-muted">
            Vence: {formatDate(quote.quote.expirationDate)}
          </span>
        </div>
      </header>

      <section aria-label="Modelos" className="flex flex-col gap-2">
        <h2 className="font-medium text-ink">Modelos</h2>
        <ol aria-label="Modelos" className="flex flex-col gap-2">
          {models.map((m) => (
            <li
              key={`${m.quoteId}-${m.versionNo}-${m.position}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-surface-soft px-3 py-2"
            >
              <span className="font-medium text-ink">{m.templateName}</span>
              <span className="text-sm text-ink-muted">Cantidad: {formatDecimalInput(m.quantity)}</span>
              <span className="min-w-0 break-words text-sm font-semibold text-ink">
                {formatArsFromDecimalString(m.lineTotal)}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-label="Visibilidad"
        className="flex flex-wrap gap-4 rounded-xl border border-border-subtle bg-surface-soft p-3 text-sm"
      >
        <label className="flex items-center gap-2 text-ink">
          <input
            type="checkbox"
            checked={visibility.internalCost ?? true}
            onChange={(e) => setVisibility((v) => ({ ...v, internalCost: e.target.checked }))}
          />
          <span>Mostrar costo interno</span>
        </label>
        <label className="flex items-center gap-2 text-ink">
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
          <h2 className="font-medium text-ink">Costos indirectos</h2>
          <ol aria-label="Costos indirectos" className="flex flex-col gap-1">
            {indirects.map((ic) => (
              <li
                key={`${ic.quoteId}-${ic.versionNo}-${ic.position}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface-soft px-3 py-1 text-sm"
              >
                <span className="text-ink">{ic.name}</span>
                <span className="font-semibold text-ink">
                  {formatArsFromDecimalString(ic.amount)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {projected ? (
        <section
          aria-label="Totales"
          className="flex flex-col gap-1 rounded-xl border border-border-subtle bg-surface-soft p-4 text-sm"
        >
          {visibility.internalCost && projected.materialsTotal ? (
            <p className="text-ink-muted">
              Materiales:{" "}
              <span className="font-semibold text-ink">
                {formatArsFromDecimalString(projected.materialsTotal)}
              </span>
            </p>
          ) : null}
          {visibility.internalCost && projected.indirectTotal ? (
            <p className="text-ink-muted">
              Indirectos:{" "}
              <span className="font-semibold text-ink">
                {formatArsFromDecimalString(projected.indirectTotal)}
              </span>
            </p>
          ) : null}
          {visibility.profitMargin && projected.profitValue ? (
            <p className="text-ink-muted">
              Ganancia:{" "}
              <span className="font-semibold text-ink">
                {formatArsFromDecimalString(projected.profitValue)}
              </span>
            </p>
          ) : null}
          <p className="text-base text-ink-muted">
            Total:{" "}
            <span className="min-w-0 break-words overflow-wrap-anywhere font-semibold text-ink">
              {formatArsFromDecimalString(projected.total)}
            </span>
          </p>
        </section>
      ) : null}

      {projected ? (
        <section
          aria-label="Seña"
          className="flex flex-wrap gap-4 rounded-xl border border-border-subtle bg-surface-soft p-4 text-sm"
        >
          <p className="text-ink-muted">
            Porcentaje de seña:{" "}
            <span className="font-semibold text-ink">{projected.depositPercent}%</span>
          </p>
          <p className="text-ink-muted">
            Monto de seña:{" "}
            <span className="font-semibold text-ink">
              {formatArsFromDecimalString(projected.depositAmount)}
            </span>
          </p>
        </section>
      ) : null}

      <footer className="flex flex-col gap-3">
        <QuoteLifecycleControls quote={quote} now={now} />
        {version ? <QuoteShareLinks quote={quote} visibility={visibility} /> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/quotes"
            className="inline-flex min-h-11 min-w-0 items-center break-words font-semibold text-brand underline underline-offset-4"
          >
            ← Volver
          </Link>
          {isDraft ? (
            <div className="flex flex-wrap gap-3">
              <Link
                href={`/quotes/${quote.quote.id}/edit`}
                className="inline-flex min-h-11 min-w-0 items-center break-words rounded-md bg-brand px-4 font-semibold text-on-brand hover:opacity-90"
              >
                Editar
              </Link>
              <DeleteDraftButton id={quote.quote.id} />
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              Solo lectura — esta cotización no puede editarse.
            </p>
          )}
        </div>
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
    setError("No se pudo eliminar el borrador.");
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex min-h-11 items-center rounded-md border border-border-subtle bg-surface-raised px-4 font-semibold text-brand disabled:opacity-60"
      >
        {pending ? "Eliminando..." : "Eliminar"}
      </button>
      <p role="alert" className="text-sm text-status-danger">
        {error ?? ""}
      </p>
    </div>
  );
}
