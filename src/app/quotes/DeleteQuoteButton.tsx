"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteQuoteDraftAction } from "@/server/actions/quotes-delete";

/**
 * Per-card trash button. Confirms via `window.confirm` (Playwright handles
 * this through a one-shot dialog listener). On success, calls
 * `router.refresh()` so the server-preloaded list collapses without a
 * hard reload.
 *
 * Why not `window.location.reload()`? A hard reload in dev mode
 * triggers Next.js's "compiling…" fallback, which the dev runtime
 * renders as the "This page couldn't load" screen for a few hundred
 * ms. The user sees that flash even though the action succeeded.
 * `router.refresh()` is a soft refetch — same RSC payload is re-streamed
 * from the server, but no document reload, so the dev-mode spinner
 * never surfaces.
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
        // Soft refetch — re-runs the Server Component pipeline, which
        // re-queries `listQuotes` and re-streams the new RSC payload
        // for the page. The QuoteList re-renders with the deleted row
        // gone, no full document reload.
        router.refresh();
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