"use client";

import { useState } from "react";
import { buildWhatsAppShareText, buildWhatsAppShareUrl, isOversized } from "@/domain/quoteWhatsApp";
import type { ProjectionVisibility } from "@/domain/projection";
import type { QuoteRecord } from "@/server/repositories/quotes";

export function QuoteShareLinks({
  quote,
  visibility,
}: {
  quote: QuoteRecord;
  visibility: ProjectionVisibility;
}) {
  const text = buildWhatsAppShareText(quote, visibility);
  const oversized = isOversized(text);
  const [copyFeedback, setCopyFeedback] = useState("");

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback("Enlace copiado");
    } catch {
      setCopyFeedback("Error al copiar");
    }
  }

  return (
    <section
      aria-label="Compartir presupuesto"
      className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface-soft p-3 text-sm"
    >
      {oversized ? (
        <p role="alert" className="text-status-danger">
          Mensaje demasiado largo para WhatsApp
        </p>
      ) : (
        <a
          href={buildWhatsAppShareUrl(quote, visibility)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center break-words font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:text-ink"
        >
          Compartir por WhatsApp
        </a>
      )}
      <button
        type="button"
        onClick={copyText}
        className="self-start rounded-md border border-border-subtle bg-surface-raised px-4 py-2 font-semibold text-brand transition-colors hover:bg-surface-soft disabled:opacity-60"
      >
        Copiar texto
      </button>
      <p role="status" aria-live="polite" className="text-sm text-ink-muted">
        {copyFeedback}
      </p>
    </section>
  );
}
