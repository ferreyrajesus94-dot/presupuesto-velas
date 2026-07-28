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
    <section aria-label="Compartir cotización" className="flex flex-col gap-2">
      {oversized ? (
        <p role="alert">Mensaje demasiado largo para WhatsApp</p>
      ) : (
        <a
          href={buildWhatsAppShareUrl(quote, visibility)}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-rose-900 underline"
        >
          Compartir por WhatsApp
        </a>
      )}
      <button
        type="button"
        onClick={copyText}
        className="self-start rounded-lg border border-rose-900 px-4 py-2 font-semibold text-rose-900"
      >
        Copiar texto
      </button>
      <p role="status" aria-live="polite" className="text-sm text-zinc-700">
        {copyFeedback}
      </p>
    </section>
  );
}
