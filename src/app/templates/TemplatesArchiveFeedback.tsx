"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { buildTemplateLifecycleCopy, type TemplateLifecycleOperation } from "./templateLifecycle";
import type { TemplateView } from "./TemplateViewFilter";

export type TemplateLifecycleResult = {
  operation: TemplateLifecycleOperation;
  templateId: string;
  templateName: string;
};

type FeedbackContextValue = { reportLifecycle: (result: TemplateLifecycleResult) => void };

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function useTemplateArchiveFeedback(): FeedbackContextValue {
  return useContext(FeedbackContext) ?? { reportLifecycle: () => {} };
}

export function TemplatesArchiveFeedback({
  view,
  children,
}: {
  view: TemplateView;
  children: ReactNode;
}) {
  const [result, setResult] = useState<TemplateLifecycleResult | null>(null);
  const reportLifecycle = useCallback((next: TemplateLifecycleResult) => setResult(next), []);

  // PR3z.focus: deterministic focus destination after a successful archive in
  // the active view. The row being archived unmounts, so we move focus to a
  // sensible sibling so keyboard and screen-reader users keep their place.
  // The effect early-returns on restore (keeps the row mounted) and on the
  // all view (rows do not unmount).
  useEffect(() => {
    if (!result) return;
    if (view !== "active" || result.operation !== "archive") return;
    // First try the next-row destination: a focus marker whose source is
    // NOT the template we just archived. The source's button is still in the
    // DOM until the post-revalidation render commits, so we must filter it
    // out explicitly to avoid leaving focus on a soon-to-be-unmounted
    // element.
    const nextRow = Array.from(
      document.querySelectorAll<HTMLElement>('[data-archive-focus="next-row"]'),
    ).find((el) => el.getAttribute("data-archive-source") !== result.templateId);
    if (nextRow) {
      nextRow.focus();
      return;
    }
    // No next row: fall back to the pre-slice "Show archived" seam that
    // already lives on the nav and the empty-state link.
    document.querySelector<HTMLElement>('[data-archive-focus="show-archived"]')?.focus();
  }, [result, view]);

  return (
    <FeedbackContext.Provider value={{ reportLifecycle }}>
      {children}
      {result ? (
        <p role="status" aria-live="polite" className="text-sm text-status-success">
          {buildTemplateLifecycleCopy({ operation: result.operation, templateName: result.templateName })}
        </p>
      ) : null}
    </FeedbackContext.Provider>
  );
}
