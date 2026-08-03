"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/components/a11y/useFocusTrap";
import { HELP_CONTENT, type HelpTabKey } from "./content";

/**
 * PR4 help modal — per-tab contextual help.
 *
 * - Mounted at the layout root; listens for clicks on any element with a
 *   `data-help="<tab>"` attribute to open the matching tab.
 * - Three close channels: X button, Escape key, backdrop click.
 * - Focus returns to the trigger button on close so keyboard users keep
 *   their place.
 * - Body scrolls inside the modal; header remains pinned.
 * - `prefers-reduced-motion: reduce` is honored via the 0ms CSS transition
 *   defaults in `globals.css`.
 */

export function HelpModal() {
  const [activeTab, setActiveTab] = useState<HelpTabKey | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setActiveTab(null);
    // Return focus to the trigger that opened the modal.
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  // Global click + keyboard listener: any `data-help="<tab>"` button
  // opens the modal. The listener is only attached once (at mount) and
  // gates on `activeTab` to avoid interfering with the modal's own Esc
  // handler when the modal is open.
  useEffect(() => {
    function onClick(event: MouseEvent): void {
      if (activeTab) return;
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-help]",
      );
      if (!target) return;
      const key = target.dataset.help as HelpTabKey | undefined;
      if (!key || !(key in HELP_CONTENT)) return;
      event.preventDefault();
      triggerRef.current = target;
      setActiveTab(key);
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      if (!activeTab) return;
      event.preventDefault();
      close();
    }
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [activeTab, close]);

  // Focus trap: cycle Tab between the modal's focusable children while the
  // modal is open and move focus to the first child when the trap activates.
  useFocusTrap(dialogRef, activeTab !== null);

  // Backdrop click handler — only close when the click landed on the
  // backdrop itself, not on any descendant (e.g. the dialog content).
  function onBackdropMouseDown(event: React.MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) close();
  }

  if (!activeTab) return null;
  const content = HELP_CONTENT[activeTab];
  return (
    <div
      role="presentation"
      data-testid="help-modal-root"
      data-help-tab={activeTab}
      className="fixed inset-0 z-[55] flex items-center justify-center bg-[rgba(43,13,24,0.55)] px-4 py-6"
      onMouseDown={onBackdropMouseDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        aria-describedby="help-modal-intro"
        ref={dialogRef}
        tabIndex={-1}
        className="flex max-h-[min(90dvh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border-subtle bg-surface-soft p-4">
          <div className="flex items-start gap-2">
            <span className="text-2xl" aria-hidden="true">
              {content.emoji}
            </span>
            <h2 id="help-modal-title" className="text-lg font-semibold text-ink">
              {content.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Cerrar ayuda"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink-muted hover:text-ink"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>
        <div className="flex flex-col gap-3 overflow-y-auto p-4 text-sm">
          <p id="help-modal-intro" className="text-ink-muted">
            {content.intro}
          </p>
          <p className="font-semibold text-ink">Podés hacer esto:</p>
          <ul className="flex flex-col gap-1.5 text-ink">
            {content.bullets.map((bullet) => (
              <li key={bullet} className="flex items-start gap-2">
                <span className="text-brand" aria-hidden="true">
                  •
                </span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 rounded-lg bg-surface-soft p-3 text-xs text-ink-muted">
            💡 {content.tip}
          </p>
        </div>
        <footer className="flex justify-end border-t border-border-subtle bg-surface-soft p-3">
          <button
            type="button"
            onClick={close}
            className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-on-brand hover:opacity-90"
          >
            Entendido
          </button>
        </footer>
      </div>
    </div>
  );
}
