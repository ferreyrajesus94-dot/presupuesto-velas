"use client";

import { type Control, type UseFieldArrayReturn, useWatch } from "react-hook-form";
import Decimal from "decimal.js";
import { formatArsFromDecimalString } from "@/lib/moneyFormat";
import type { QuoteDraftFormValues } from "./QuoteCreateForm";

const controlClass = "rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-ink";

type RowErrors = { name?: { message?: string }; amount?: { message?: string } };

/**
 * PR4g.3 — indirect cost editor (RHF `useFieldArray` consumer).
 * One row per concept: name + amount inputs + remove button. A running total
 * (Decimal.js) is rendered at the bottom. The editor seeds the form's
 * default values (`labor`, `electricity`, `transport`, `waste`) but stays
 * generic — callers own the field array path.
 */
export function IndirectCostEditor({
  control,
  fieldArray,
  errorBag,
}: {
  control: Control<QuoteDraftFormValues>;
  fieldArray: UseFieldArrayReturn<QuoteDraftFormValues, "indirectCosts", "id">;
  errorBag: ReadonlyArray<RowErrors | undefined> | undefined;
}) {
  const { fields, append, remove } = fieldArray;
  const watched = useWatch({ control, name: "indirectCosts" }) ?? [];
  const total = watched.reduce((acc, row) => {
    try {
      const amount = new Decimal(row.amount ?? "0");
      if (amount.isNegative()) return acc;
      return acc.add(amount);
    } catch {
      return acc;
    }
  }, new Decimal(0));
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface-soft p-4">
      <header className="flex items-center justify-between">
        <h3 className="font-medium text-ink">Costos indirectos</h3>
        <span className="text-sm text-ink-muted">{fields.length} conceptos</span>
      </header>
      <ol aria-label="Costos indirectos" className="flex flex-col gap-3">
        {fields.map((field, index) => (
          <IndirectRow
            key={field.id}
            index={index}
            control={control}
            onRemove={() => remove(index)}
            rowErrors={errorBag?.[index]}
          />
        ))}
      </ol>
      <p className="text-sm text-ink-muted">
        Total indirectos:{" "}
        <span className="font-semibold text-ink" data-testid="indirect-total">
          {formatArsFromDecimalString(total.toString())}
        </span>
      </p>
      <button
        type="button"
        onClick={() => append({ name: "", amount: "0" })}
        className="self-start font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:text-ink"
      >
        Agregar concepto
      </button>
    </section>
  );
}

function IndirectRow({
  index,
  control,
  onRemove,
  rowErrors,
}: {
  index: number;
  control: Control<QuoteDraftFormValues>;
  onRemove: () => void;
  rowErrors: RowErrors | undefined;
}) {
  const nameField = `indirectCosts.${index}.name` as const;
  const amountField = `indirectCosts.${index}.amount` as const;
  const nameId = `quote-indirect-${index}-name`;
  const amountId = `quote-indirect-${index}-amount`;
  return (
    <li
      aria-label={`Concepto ${index + 1}`}
      data-testid={`quote-indirect-${index + 1}`}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-border-subtle bg-surface-raised p-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-ink-muted">Concepto {index + 1}</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Quitar concepto ${index + 1}`}
          className="font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:text-ink"
        >
          Quitar
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={nameId} className="font-medium text-ink">
            Concepto
          </label>
          <input
            id={nameId}
            type="text"
            maxLength={30}
            placeholder="Ej: mano de obra"
            aria-describedby={`${nameId}-error`}
            aria-invalid={Boolean(rowErrors?.name)}
            {...control.register(nameField)}
            className={`${controlClass} min-w-0`}
          />
          {rowErrors?.name?.message ? (
            <p id={`${nameId}-error`} role="alert" className="text-sm text-status-danger">
              {rowErrors.name.message}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={amountId} className="font-medium text-ink">
            Monto (ARS)
          </label>
          <input
            id={amountId}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            aria-describedby={`${amountId}-error`}
            aria-invalid={Boolean(rowErrors?.amount)}
            {...control.register(amountField)}
            className={controlClass}
          />
          {rowErrors?.amount?.message ? (
            <p id={`${amountId}-error`} role="alert" className="text-sm text-status-danger">
              {rowErrors.amount.message}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}
