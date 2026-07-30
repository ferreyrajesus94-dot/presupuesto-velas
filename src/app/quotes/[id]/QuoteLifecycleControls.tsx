"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { isExpiredSent } from "@/domain/quoteExpired";
import type { QuoteStatus } from "@/domain/snapshot";
import { transitionQuoteStatusAction } from "@/server/actions/quotes";
import type { QuoteRecord } from "@/server/repositories/quotes";

/**
 * PR4i — Lifecycle controls for the quote detail view. Renders status-aware
 * action buttons (or immutability messaging) and calls the PR4e FSM server
 * action (`transitionQuoteStatusAction`) inside a `useTransition`. Success
 * and error feedback surface in a `role="status" aria-live="polite"` live
 * region; focus returns to the action button the user clicked so keyboard
 * and screen-reader users keep their place after `router.refresh()` re-renders
 * the page. A past-expiration `sent` quote shows both buttons but ALSO an
 * `alert`-role warning so the accept path is gated by the owner duplicating
 * the quote into a new draft (future PR).
 */
export function QuoteLifecycleControls({ quote, now }: { quote: QuoteRecord; now: Date }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(
    null,
  );
  const triggeredRef = useRef<HTMLButtonElement | null>(null);

  const status = quote.quote.status;
  const lockVersion = quote.quote.lockVersion;
  const expired = isExpiredSent({ status, expirationDate: quote.quote.expirationDate }, now);

  function runTransition(
    button: HTMLButtonElement,
    from: QuoteStatus,
    to: QuoteStatus,
    successMessage: string,
  ): void {
    triggeredRef.current = button;
    setFeedback(null);
    startTransition(async () => {
      const result = await transitionQuoteStatusAction(quote.quote.id, from, to, lockVersion);
      if (result.ok) {
        setFeedback({ kind: "success", message: successMessage });
        router.refresh();
      } else {
        setFeedback({ kind: "error", message: result.error.message });
      }
    });
  }

  // Restore focus to the button the user clicked once the transition settles.
  // `useTransition` toggles `isPending` from true → false here; the effect
  // fires and refocuses the captured ref. The ref is cleared so a follow-up
  // click can capture a fresh button.
  useEffect(() => {
    if (!isPending && triggeredRef.current) {
      triggeredRef.current.focus();
      triggeredRef.current = null;
    }
  }, [isPending]);

  // ----- Status-specific render branches -----

  // Terminal (accepted / rejected) → no actions, immutability message.
  if (status === "accepted" || status === "rejected") {
    return (
      <Wrapper>
        <p className="text-ink">Inmutable — esta cotización no puede modificarse.</p>
        <FeedbackRegion feedback={feedback} />
      </Wrapper>
    );
  }

  // Sent past expiration → both buttons rendered but disabled, plus the
  // warning. The owner must duplicate into a new draft to accept (future PR).
  if (status === "sent" && expired) {
    return (
      <Wrapper>
        <p className="text-ink">Vencida — esta cotización ya pasó su fecha de vencimiento.</p>
        <div
          role="alert"
          className="rounded-lg border border-border-subtle bg-surface-soft px-3 py-2 text-ink"
        >
          Esta cotización está vencida. Duplicar para aceptar.
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled
            className="rounded-md border border-border-subtle bg-surface-raised px-4 py-2 font-semibold text-brand disabled:opacity-50"
          >
            Marcar como aceptado
          </button>
          <button
            type="button"
            disabled
            className="rounded-md border border-border-subtle bg-surface-raised px-4 py-2 font-semibold text-brand disabled:opacity-50"
          >
            Marcar como rechazado
          </button>
        </div>
        <FeedbackRegion feedback={feedback} />
      </Wrapper>
    );
  }

  // Draft → "Marcar como enviado" only.
  if (status === "draft") {
    return (
      <Wrapper>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={(event) =>
              runTransition(event.currentTarget, "draft", "sent", "Cotización enviada")
            }
            className="rounded-md bg-brand px-4 py-2 font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            Marcar como enviado
          </button>
        </div>
        <FeedbackRegion feedback={feedback} />
      </Wrapper>
    );
  }

  // Sent (not expired) → accept + reject buttons.
  if (status === "sent") {
    return (
      <Wrapper>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={(event) =>
              runTransition(event.currentTarget, "sent", "accepted", "Cotización aceptada")
            }
            className="rounded-md bg-brand px-4 py-2 font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            Marcar como aceptado
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={(event) =>
              runTransition(event.currentTarget, "sent", "rejected", "Cotización rechazada")
            }
            className="rounded-md border border-border-subtle bg-surface-raised px-4 py-2 font-semibold text-brand disabled:opacity-60"
          >
            Marcar como rechazado
          </button>
        </div>
        <FeedbackRegion feedback={feedback} />
      </Wrapper>
    );
  }

  // `expired` (derived only) — covered by the `sent && expired` branch above,
  // but defensive: any unexpected status falls through to the immutability
  // message so the page never renders action buttons we can't fulfill.
  return (
    <Wrapper>
      <p className="text-ink">Inmutable — esta cotización no puede modificarse.</p>
      <FeedbackRegion feedback={feedback} />
    </Wrapper>
  );
}

const SECTION_CLASS =
  "flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface-soft p-3 text-sm";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <section aria-label="Acciones de cotización" className={SECTION_CLASS}>
      {children}
    </section>
  );
}

function FeedbackRegion({
  feedback,
}: {
  feedback: { kind: "success" | "error"; message: string } | null;
}) {
  if (!feedback) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={feedback.kind === "success" ? "text-status-success" : "text-status-danger"}
    >
      {feedback.message}
    </p>
  );
}
