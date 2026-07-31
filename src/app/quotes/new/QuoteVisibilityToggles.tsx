"use client";

import type { UseFormRegister } from "react-hook-form";
import type { QuoteDraftFormValues } from "./QuoteCreateForm";

/** PR4g.2 — visibility toggles for internalCost + profitMargin. */
export function QuoteVisibilityToggles({
  register,
}: {
  register: UseFormRegister<QuoteDraftFormValues>;
}) {
  return (
    <fieldset className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface-soft p-4">
      <legend className="px-1 font-medium text-ink">Visibilidad</legend>
      <label className="flex items-center gap-2 text-ink">
        <input type="checkbox" {...register("visibility.internalCost")} />
        <span>Mostrar costo interno</span>
      </label>
      <label className="flex items-center gap-2 text-ink">
        <input type="checkbox" {...register("visibility.profitMargin")} />
        <span>Mostrar margen de ganancia</span>
      </label>
    </fieldset>
  );
}
