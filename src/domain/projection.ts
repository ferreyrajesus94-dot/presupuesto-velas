import { DEFAULT_VISIBILITY } from "./quoteDefaults";
import type { QuoteSnapshot, QuoteSnapshotIndirectCost, QuoteSnapshotModel } from "./quote";
import { freezeForStorage } from "./snapshot";

/**
 * Visibility toggles for `projectQuote`. Each field is optional; omitted
 * toggles fall back to `DEFAULT_VISIBILITY` (PR4a.math). `internalCost=false`
 * strips material unit costs AND the indirect cost list; `profitMargin=false`
 * strips `profitValue` and `profitMethod`.
 */
export interface ProjectionVisibility {
  internalCost?: boolean;
  profitMargin?: boolean;
}

/** Resolved, fully-concrete visibility (always present in the projected view). */
export interface ResolvedVisibility {
  readonly internalCost: boolean;
  readonly profitMargin: boolean;
}

/** Material line entry. `perUnitCost` is `undefined` when internal-cost visibility is off. */
export interface ProjectedModel {
  recipeId: string;
  quantity: string;
  perUnitCost: string | undefined;
  lineTotal: string;
}

/** Indirect cost line entry. The list becomes `[]` when internal-cost visibility is off. */
export interface ProjectedIndirectCost {
  name: string;
  amount: string;
}

/**
 * Derived view over a `QuoteSnapshot` for PDF / WhatsApp output. The snapshot
 * is the source of truth; stripped fields are `undefined` (shape preserved)
 * so PDF / WhatsApp templates read the same keys without branching.
 */
export interface ProjectedQuote {
  id: string;
  models: ProjectedModel[];
  indirectCosts: ProjectedIndirectCost[];
  depositAmount: string;
  depositPercent: string;
  expirationDate: string;
  total: string;
  computedAt: Date;
  visibility: ResolvedVisibility;
  materialsTotal: string | undefined; // undefined when internalCost=false
  indirectTotal: string | undefined; // undefined when internalCost=false
  profitValue: string | undefined; // undefined when profitMargin=false
  profitMethod: "percentage" | "fixed" | undefined; // undefined when profitMargin=false
}

function resolveVisibility(visibility?: ProjectionVisibility): ResolvedVisibility {
  return {
    internalCost: visibility?.internalCost ?? DEFAULT_VISIBILITY.internalCost,
    profitMargin: visibility?.profitMargin ?? DEFAULT_VISIBILITY.profitMargin,
  };
}

function projectModels(
  models: ReadonlyArray<QuoteSnapshotModel>,
  showInternalCost: boolean,
): ProjectedModel[] {
  return models.map((m) => ({
    recipeId: m.recipeId,
    quantity: m.quantity,
    perUnitCost: showInternalCost ? m.perUnitCost : undefined,
    lineTotal: m.lineTotal,
  }));
}

function projectIndirectCosts(
  indirectCosts: ReadonlyArray<QuoteSnapshotIndirectCost>,
  showInternalCost: boolean,
): ProjectedIndirectCost[] {
  if (!showInternalCost) return [];
  return indirectCosts.map((ic) => ({ name: ic.name, amount: ic.amount }));
}

/**
 * Return a derived view with the visibility toggles applied. The snapshot is
 * never mutated (deep clone first); the projected view is deeply frozen.
 * Stripped fields are `undefined`, preserving shape for templates.
 */
export function projectQuote(
  snapshot: QuoteSnapshot,
  visibility?: ProjectionVisibility,
): ProjectedQuote {
  const resolved = resolveVisibility(visibility);
  // Defensive deep clone — the projected object literal already avoids
  // reference sharing, but the explicit clone makes the immutability
  // contract obvious to future readers.
  const cloned = structuredClone(snapshot) as QuoteSnapshot;

  const projected: ProjectedQuote = {
    id: cloned.id,
    models: projectModels(cloned.models, resolved.internalCost),
    indirectCosts: projectIndirectCosts(cloned.indirectCosts, resolved.internalCost),
    depositAmount: cloned.depositAmount,
    depositPercent: cloned.depositPercent,
    expirationDate: cloned.expirationDate,
    total: cloned.total,
    computedAt: cloned.computedAt,
    visibility: Object.freeze({
      internalCost: resolved.internalCost,
      profitMargin: resolved.profitMargin,
    }) satisfies ResolvedVisibility,
    materialsTotal: resolved.internalCost ? cloned.materialsTotal : undefined,
    indirectTotal: resolved.internalCost ? cloned.indirectTotal : undefined,
    profitValue: resolved.profitMargin ? cloned.profitValue : undefined,
    profitMethod: resolved.profitMargin ? cloned.profitMethod : undefined,
  };

  return freezeForStorage(projected);
}
