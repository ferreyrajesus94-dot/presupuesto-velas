"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useFocusTrap } from "@/components/a11y/useFocusTrap";

export type FieldHelpProps = {
  id: string;
  title: string;
  intro: string;
  bullets: readonly string[];
  tip: string;
};

export function FieldHelp({ id, title, intro, bullets, tip }: FieldHelpProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const reactId = useId();
  const titleId = `${id || reactId}-title`;
  const introId = `${id || reactId}-intro`;

  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useFocusTrap(dialogRef, open);

  function onBackdropMouseDown(event: React.MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) close();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Ayuda: ${title}`}
        aria-haspopup="dialog"
        data-testid={`field-help-trigger-${id}`}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          suppressHydrationWarning
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>
      {open ? (
        <div
          role="presentation"
          data-testid={`field-help-backdrop-${id}`}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(43,13,24,0.55)] px-4 py-6"
          onMouseDown={onBackdropMouseDown}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={introId}
            tabIndex={-1}
            data-testid={`field-help-dialog-${id}`}
            className="flex max-h-[min(90dvh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl"
          >
            <header className="flex items-start justify-between gap-3 border-b border-border-subtle bg-surface-soft p-4">
              <h2 id={titleId} className="text-lg font-semibold text-ink">
                {title}
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="Cerrar ayuda"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </header>
            <div className="flex flex-col gap-3 overflow-y-auto p-4 text-sm">
              <section>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Qué es
                </p>
                <p id={introId} className="mt-1 text-ink">
                  {intro}
                </p>
              </section>
              {bullets.length > 0 ? (
                <section>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Por qué lo pedimos / cómo se usa
                  </p>
                  <ul className="mt-1 flex flex-col gap-1.5 text-ink">
                    {bullets.map((bullet) => (
                      <li key={bullet} className="flex items-start gap-2">
                        <span className="text-brand" aria-hidden="true">
                          •
                        </span>
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <p className="mt-2 rounded-lg bg-surface-soft p-3 text-xs text-ink-muted">💡 {tip}</p>
            </div>
            <footer className="flex justify-end border-t border-border-subtle bg-surface-soft p-3">
              <button
                type="button"
                onClick={close}
                className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-on-brand transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Entendido
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
