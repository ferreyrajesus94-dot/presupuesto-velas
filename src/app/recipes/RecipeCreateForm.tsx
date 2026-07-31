"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { startTransition, useActionState, useEffect, useMemo, useRef } from "react";
import { useFieldArray, useForm, useWatch, type FieldErrors } from "react-hook-form";
import { createRecipeAction, type RecipeActionState } from "@/server/actions/recipes";
import { UNITS_BY_DIMENSION, getUnitDimension, type Unit } from "@/domain/units";
import { recipeInputSchema, type RecipeInput } from "@/server/validation/recipeSchema";

export type RecipeMaterialOption = { id: string; name: string; baseUnit: string; unitCost: string };
const controlClass = "rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-ink";
const selectClass = controlClass;
const blankItem: RecipeInput["items"][number] = { materialId: "", quantity: "", unit: "g" as Unit };
const blankValues: RecipeInput = { name: "", items: [blankItem] };

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-status-danger">
      {message}
    </p>
  );
}

function serverItemMessage(state: RecipeActionState, index: number, field: string) {
  const messages = state.fieldErrors?.items ?? [];
  return (
    messages
      .find((message) => message.startsWith(`items[${index}].${field}`))
      ?.replace(/^items\[\d+\]\.[^:]+:\s*/, "") ?? messages[index]
  );
}

export function RecipeCreateForm({ materials }: { materials: readonly RecipeMaterialOption[] }) {
  const sortedMaterials = useMemo(
    () => [...materials].sort((a, b) => a.name.localeCompare(b.name)),
    [materials],
  );
  const [state, formAction, pending] = useActionState(createRecipeAction, { status: "idle" });
  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<RecipeInput>({
    resolver: zodResolver(recipeInputSchema, undefined, { mode: "sync" }),
    defaultValues: blankValues,
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const watchedItems = useWatch({ control, name: "items" }) ?? [];
  const handledActionState = useRef(state);
  useEffect(() => {
    if (handledActionState.current === state) return;
    handledActionState.current = state;
    if (state.status === "success") reset(blankValues);
  }, [reset, state]);

  function materialChange(index: number, nextId: string) {
    setValue(`items.${index}.materialId`, nextId, { shouldDirty: true });
    const material = sortedMaterials.find((item) => item.id === nextId);
    const units = material
      ? (UNITS_BY_DIMENSION[getUnitDimension(material.baseUnit)] ?? UNITS_BY_DIMENSION.mass)
      : ["g"];
    setValue(`items.${index}.unit`, units[0] as Unit, { shouldDirty: true });
  }
  function submit(_values: RecipeInput, event?: React.BaseSyntheticEvent) {
    const form = event?.target;
    if (!(form instanceof HTMLFormElement)) return;
    const data = new FormData(form);
    data.set("items", JSON.stringify(watchedItems));
    startTransition(() => formAction(data));
  }
  const itemErrors = errors.items as
    Array<FieldErrors<RecipeInput["items"][number]> | undefined> | undefined;
  const hasNameError = Boolean(errors.name?.message ?? state.fieldErrors?.name?.[0]);
  const nameMessage = hasNameError ? "Ingresá un nombre para la receta." : undefined;
  return (
    <section
      id="new-recipe"
      aria-labelledby="new-recipe-heading"
      className="rounded-2xl border border-border-subtle bg-surface-raised p-5 shadow-sm sm:p-6"
    >
      <h2 id="new-recipe-heading" className="text-xl font-semibold text-ink">
        Nueva receta
      </h2>
      <form
        onSubmit={handleSubmit(submit)}
        noValidate
        autoComplete="off"
        className="mt-5 flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <label className="font-medium text-ink" htmlFor="recipe-name">
            Nombre
          </label>
          <input
            id="recipe-name"
            {...register("name")}
            aria-describedby="recipe-name-error"
            aria-invalid={Boolean(nameMessage)}
            className={controlClass}
          />
          <FieldError id="recipe-name-error" message={nameMessage} />
        </div>
        <ol aria-label="Ingredientes de la receta" className="flex flex-col gap-3">
          {fields.map((field, index) => {
            const item = watchedItems[index] ?? blankItem;
            const material = sortedMaterials.find((option) => option.id === item.materialId);
            const units = material
              ? (UNITS_BY_DIMENSION[getUnitDimension(material.baseUnit)] ?? UNITS_BY_DIMENSION.mass)
              : UNITS_BY_DIMENSION.mass;
            const rowErrors = itemErrors?.[index];
            const materialMessage =
              (rowErrors?.materialId?.message ?? serverItemMessage(state, index, "materialId"))
                ? "Seleccioná un material disponible."
                : undefined;
            const quantityMessage =
              (rowErrors?.quantity?.message ?? serverItemMessage(state, index, "quantity"))
                ? "Ingresá una cantidad válida mayor que cero, con hasta 6 decimales."
                : undefined;
            const unitMessage =
              (rowErrors?.unit?.message ?? serverItemMessage(state, index, "unit"))
                ? "Seleccioná una unidad válida para el material."
                : undefined;
            return (
              <li
                key={field.id}
                aria-label={`Ingrediente ${index + 1}`}
                data-testid={`recipe-item-${index + 1}`}
                className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface-soft p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink-muted">
                    Ingrediente {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    aria-label={`Quitar ingrediente ${index + 1}`}
                    className="font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:text-ink"
                  >
                    Quitar
                  </button>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-medium text-ink" htmlFor={`recipe-item-${index}-material`}>
                    Material
                  </label>
                  <select
                    id={`recipe-item-${index}-material`}
                    {...register(`items.${index}.materialId`)}
                    onChange={(event) => materialChange(index, event.target.value)}
                    aria-describedby={`recipe-item-${index}-material-error`}
                    aria-invalid={Boolean(materialMessage)}
                    className={selectClass}
                  >
                    <option value="">Seleccioná un material</option>
                    {sortedMaterials.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  <FieldError
                    id={`recipe-item-${index}-material-error`}
                    message={materialMessage}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label
                      className="font-medium text-ink"
                      htmlFor={`recipe-item-${index}-quantity`}
                    >
                      Cantidad
                    </label>
                    <input
                      id={`recipe-item-${index}-quantity`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      {...register(`items.${index}.quantity`)}
                      aria-describedby={`recipe-item-${index}-quantity-error`}
                      aria-invalid={Boolean(quantityMessage)}
                      className={controlClass}
                    />
                    <FieldError
                      id={`recipe-item-${index}-quantity-error`}
                      message={quantityMessage}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-medium text-ink" htmlFor={`recipe-item-${index}-unit`}>
                      Unidad
                    </label>
                    <select
                      id={`recipe-item-${index}-unit`}
                      {...register(`items.${index}.unit`)}
                      aria-describedby={`recipe-item-${index}-unit-error`}
                      aria-invalid={Boolean(unitMessage)}
                      className={selectClass}
                    >
                      {units.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit}
                        </option>
                      ))}
                    </select>
                    <FieldError id={`recipe-item-${index}-unit-error`} message={unitMessage} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        {errors.items?.root?.message ? (
          <FieldError id="recipe-items-error" message="Agregá al menos un ingrediente." />
        ) : null}
        <button
          type="button"
          onClick={() => append(blankItem)}
          className="self-start font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:text-ink"
        >
          Agregar ingrediente
        </button>
        {state.message && state.status !== "success" ? (
          <p role="alert" aria-live="polite" className="text-sm text-status-danger">
            No se pudo crear la receta.
          </p>
        ) : null}
        {state.status === "success" ? (
          <p role="status" aria-live="polite" className="text-sm text-status-success">
            Receta creada.
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-4 py-2.5 font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Creando receta…" : "Crear receta"}
        </button>
      </form>
    </section>
  );
}
