"use client";

import { useWatch, type Control, type UseFieldArrayReturn } from "react-hook-form";
import Decimal from "decimal.js";
import { formatArsFromDecimalString } from "@/lib/moneyFormat";
import type { Recipe } from "@/server/repositories/recipes";
import type { QuoteDraftFormValues } from "./QuoteCreateForm";

const controlClass =
  "rounded-lg border border-zinc-300 px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700";
const selectClass = `${controlClass} bg-white`;

type RowErrors = { recipeId?: { message?: string }; quantity?: { message?: string } };

/**
 * PR4g.2 — model line editor (RHF `useFieldArray` consumer).
 * One row per model: recipe select, quantity input, read-only unit cost and
 * line total, remove button. Submit wiring is PR4g.3.
 */
export function ModelLineEditor({
  control,
  recipes,
  fieldArray,
  onAppend,
  errorBag,
}: {
  control: Control<QuoteDraftFormValues>;
  recipes: readonly Recipe[];
  fieldArray: UseFieldArrayReturn<QuoteDraftFormValues, "models", "id">;
  onAppend: () => void;
  errorBag: ReadonlyArray<RowErrors | undefined> | undefined;
}) {
  const { fields, remove } = fieldArray;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-rose-100 bg-rose-50/40 p-4">
      <header className="flex items-center justify-between">
        <h3 className="font-medium">Modelos</h3>
        <span className="text-sm text-zinc-700">{fields.length} en la cotización</span>
      </header>
      <ol aria-label="Modelos" className="flex flex-col gap-3">
        {fields.map((field, index) => (
          <ModelRow
            key={field.id}
            index={index}
            control={control}
            recipes={recipes}
            onRemove={() => remove(index)}
            rowErrors={errorBag?.[index]}
          />
        ))}
      </ol>
      <button
        type="button"
        onClick={onAppend}
        className="self-start font-semibold text-rose-900 underline"
      >
        Agregar modelo
      </button>
    </section>
  );
}

function ModelRow({
  index,
  control,
  recipes,
  onRemove,
  rowErrors,
}: {
  index: number;
  control: Control<QuoteDraftFormValues>;
  recipes: readonly Recipe[];
  onRemove: () => void;
  rowErrors: RowErrors | undefined;
}) {
  const recipeName = `models.${index}.recipeId` as const;
  const qtyName = `models.${index}.quantity` as const;
  const watchedRecipeId = useWatch({ control, name: recipeName }) as string | undefined;
  const watchedQuantity = useWatch({ control, name: qtyName }) as string | undefined;
  const selected = recipes.find((recipe) => recipe.id === watchedRecipeId);
  const lineTotal = computeLineTotal(selected?.unitCost, watchedQuantity);
  return (
    <li
      aria-label={`Modelo ${index + 1}`}
      data-testid={`quote-model-${index + 1}`}
      className="flex flex-col gap-2 rounded-xl border border-rose-100 bg-white p-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-700">Modelo {index + 1}</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Quitar modelo ${index + 1}`}
          className="font-semibold text-rose-900 underline"
        >
          Quitar
        </button>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`quote-model-${index}-recipe`} className="font-medium">
          Receta
        </label>
        <select
          id={`quote-model-${index}-recipe`}
          {...control.register(recipeName)}
          aria-describedby={`quote-model-${index}-recipe-error`}
          aria-invalid={Boolean(rowErrors?.recipeId)}
          className={selectClass}
        >
          <option value="">Elegí un modelo</option>
          {recipes.map((recipe) => (
            <option key={recipe.id} value={recipe.id}>
              {recipe.name}
            </option>
          ))}
        </select>
        {rowErrors?.recipeId?.message ? (
          <p
            id={`quote-model-${index}-recipe-error`}
            role="alert"
            className="text-sm text-rose-800"
          >
            {rowErrors.recipeId.message}
          </p>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`quote-model-${index}-quantity`} className="font-medium">
            Cantidad
          </label>
          <input
            id={`quote-model-${index}-quantity`}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            {...control.register(qtyName)}
            aria-describedby={`quote-model-${index}-quantity-error`}
            aria-invalid={Boolean(rowErrors?.quantity)}
            className={controlClass}
          />
          {rowErrors?.quantity?.message ? (
            <p
              id={`quote-model-${index}-quantity-error`}
              role="alert"
              className="text-sm text-rose-800"
            >
              {rowErrors.quantity.message}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1 text-sm text-zinc-700">
          <span>
            Costo unitario:{" "}
            <span className="font-semibold">
              {selected ? formatArsFromDecimalString(selected.unitCost) : "—"}
            </span>
          </span>
          <span>
            Total línea:{" "}
            <span className="font-semibold">
              {lineTotal !== null ? formatArsFromDecimalString(lineTotal) : "—"}
            </span>
          </span>
        </div>
      </div>
    </li>
  );
}

/**
 * Pure Decimal.js helper — `unitCost × quantity` for a single model row.
 * Returns `null` when either input is missing or the quantity is non-positive.
 */
export function computeLineTotal(
  unitCost: string | undefined,
  quantity: string | number | undefined,
): string | null {
  if (typeof unitCost !== "string" || unitCost === "") return null;
  if (quantity === undefined || quantity === null || quantity === "") return null;
  const qtyString = typeof quantity === "number" ? String(quantity) : quantity;
  try {
    const qty = new Decimal(qtyString);
    if (qty.lte(0)) return null;
    return new Decimal(unitCost).mul(qty).toString();
  } catch {
    return null;
  }
}
