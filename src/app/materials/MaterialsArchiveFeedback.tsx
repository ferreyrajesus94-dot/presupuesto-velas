"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { buildMaterialLifecycleCopy, type MaterialLifecycleResult } from "./materialLifecycle";
import type { MaterialView } from "./MaterialViewFilter";

type FeedbackContextValue = {
  reportLifecycle: (result: MaterialLifecycleResult) => void;
};

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

// Default no-op so a control can be rendered in isolation (tests) without a
// provider. Production code always wraps the list in <MaterialsArchiveFeedback>.
const NO_OP: FeedbackContextValue = { reportLifecycle: () => {} };

export function useMaterialArchiveFeedback(): FeedbackContextValue {
  return useContext(FeedbackContext) ?? NO_OP;
}

type FocusDestination = "next-row" | "show-archived";

export function MaterialsArchiveFeedback({
  view,
  hasRemainingRows,
  children,
}: {
  view: MaterialView;
  hasRemainingRows: boolean;
  children: ReactNode;
}) {
  const [result, setResult] = useState<MaterialLifecycleResult | null>(null);
  const reportLifecycle = useCallback((next: MaterialLifecycleResult) => {
    setResult(next);
  }, []);

  // R3-003: deterministic focus destination after a successful archive in the
  // active view. The row being archived unmounts, so we move focus to a
  // sensible sibling so keyboard and screen-reader users keep their place.
  useEffect(() => {
    if (!result) return;
    if (view !== "active" || result.operation !== "archive") return;
    const destination: FocusDestination = hasRemainingRows ? "next-row" : "show-archived";
    const target = document.querySelector<HTMLElement>(
      destination === "next-row"
        ? '[data-archive-focus="next-row"]'
        : '[data-archive-focus="show-archived"]',
    );
    target?.focus();
  }, [result, view, hasRemainingRows]);

  return (
    <FeedbackContext.Provider value={{ reportLifecycle }}>
      {children}
      {result ? (
        <p
          role="status"
          aria-live="polite"
          data-testid="lifecycle-status"
          className="text-sm text-emerald-800"
        >
          {buildMaterialLifecycleCopy(result)}
        </p>
      ) : null}
    </FeedbackContext.Provider>
  );
}
