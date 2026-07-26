"use client";

import { createContext, useContext } from "react";
import type { MaterialLifecycleResult } from "./materialLifecycle";

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
