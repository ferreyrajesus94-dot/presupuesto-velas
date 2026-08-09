"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteQuoteDraftAction } from "@/server/actions/quotes-delete";

/**
 * Per-card trash button. Confirms via `window.confirm` (Playwright handles
 * this through a one-shot dialog listener). On success, hard-reloads so
 * the server-preloaded list and per-card `data-testid="quote-card"` nodes
 * collapse together — same pattern as the templates cleanup CTA.
 */
export function DeleteQuoteButton({
  quoteId,
  customerName,
}: {
  quoteId: string;
  customerName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `¿Eliminar el presupuesto de "${customerName}"? Esta acción no se puede deshacer.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteQuoteDraftAction(quoteId);
      if (result.ok) {
        // Hard reload keeps the server-preloaded list in sync without
        // mirroring the entire `quotes` array into client state.
        window.location.reload();
      } else {
        // Surface server-side errors as a non-blocking alert. The most
        // common case is `TERMINAL_STATUS` for an already-sent/accepted
        // quote; the alert tells the user why nothing happened.
        const code = "error" in result ? result.error.code : "UNKNOWN";
        const message = "error" in result ? result.error.message : "No se pudo eliminar.";
        window.alert(`No se pudo eliminar el presupuesto (${code}). ${message}`);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      data-testid="quote-delete"
      aria-label={`Eliminar presupuesto de ${customerName}`}
      title="Eliminar"
      className="inline-flex min-h-11 min-w-0 items-center justify-center rounded-full border border-status-danger/40 bg-surface-raised px-4 text-sm font-semibold text-status-danger transition-colors hover:bg-status-danger/10 disabled:opacity-60"
    >
      {pending ? "Eliminando…" : "Eliminar"}
    </button>
  );
}