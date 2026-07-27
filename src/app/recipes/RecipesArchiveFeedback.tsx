"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { buildRecipeLifecycleCopy, type RecipeLifecycleOperation } from "./recipeLifecycle";

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

export function RecipesArchiveFeedback({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<RecipeLifecycleResult | null>(null);
  const reportLifecycle = useCallback((next: RecipeLifecycleResult) => setResult(next), []);

  return (
    <FeedbackContext.Provider value={{ reportLifecycle }}>
      {children}
      {result ? (
        <p role="status" aria-live="polite" className="text-sm text-emerald-800">
          {buildRecipeLifecycleCopy({ operation: result.operation, recipeName: result.recipeName })}
        </p>
      ) : null}
    </FeedbackContext.Provider>
  );
}
