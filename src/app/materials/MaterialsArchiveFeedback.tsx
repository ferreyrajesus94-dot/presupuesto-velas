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
    if (!hasRemainingRows) {
      // Last row archived: focus the "Show archived" affordance so keyboard
      // users can navigate to the archived view from the empty state.
      document.querySelector<HTMLElement>('[data-archive-focus="show-archived"]')?.focus();
      return;
    }
    // Rows remain: focus the first archive button whose row is NOT the one
    // that was just archived. The archived row's button is still in the DOM
    // until revalidation commits, so we must filter it out explicitly to
    // avoid leaving focus on a soon-to-be-unmounted element when the
    // remaining-row count stays truthy across the transition.
    // U4: the visible verb is `Archivar` (es-AR); the filter must match it.
    const archivedLabel = `Archivar ${result.materialName}`;
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('[data-archive-focus="next-row"]'),
    );
    const surviving = candidates.find((el) => el.getAttribute("aria-label") !== archivedLabel);
    surviving?.focus();
  }, [result, view, hasRemainingRows]);

  return (
    <FeedbackContext.Provider value={{ reportLifecycle }}>
      {children}
      {result ? (
        <p
          role="status"
          aria-live="polite"
          data-testid="lifecycle-status"
          className="text-sm text-status-success"
        >
          {buildMaterialLifecycleCopy(result)}
        </p>
      ) : null}
    </FeedbackContext.Provider>
  );
}
