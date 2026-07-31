"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { buildRecipeLifecycleCopy, type RecipeLifecycleOperation } from "./recipeLifecycle";
import type { RecipeView } from "./RecipeViewFilter";

export type RecipeLifecycleResult = {
  operation: RecipeLifecycleOperation;
  recipeId: string;
  recipeName: string;
};

type FeedbackContextValue = { reportLifecycle: (result: RecipeLifecycleResult) => void };

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function useRecipeArchiveFeedback(): FeedbackContextValue {
  return useContext(FeedbackContext) ?? { reportLifecycle: () => {} };
}

export function RecipesArchiveFeedback({
  view,
  children,
}: {
  view: RecipeView;
  children: ReactNode;
}) {
  const [result, setResult] = useState<RecipeLifecycleResult | null>(null);
  const reportLifecycle = useCallback((next: RecipeLifecycleResult) => setResult(next), []);

  // PR3z.focus: deterministic focus destination after a successful archive in
  // the active view. The row being archived unmounts, so we move focus to a
  // sensible sibling so keyboard and screen-reader users keep their place.
  // The effect early-returns on restore (keeps the row mounted) and on the
  // all view (rows do not unmount).
  useEffect(() => {
    if (!result) return;
    if (view !== "active" || result.operation !== "archive") return;
    // First try the next-row destination: a focus marker whose source is
    // NOT the recipe we just archived. The source's button is still in the
    // DOM until the post-revalidation render commits, so we must filter it
    // out explicitly to avoid leaving focus on a soon-to-be-unmounted
    // element.
    const nextRow = Array.from(
      document.querySelectorAll<HTMLElement>('[data-archive-focus="next-row"]'),
    ).find((el) => el.getAttribute("data-archive-source") !== result.recipeId);
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
          {buildRecipeLifecycleCopy({ operation: result.operation, recipeName: result.recipeName })}
        </p>
      ) : null}
    </FeedbackContext.Provider>
  );
}
