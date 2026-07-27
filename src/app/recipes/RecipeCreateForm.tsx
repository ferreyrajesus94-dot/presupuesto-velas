"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { startTransition, useActionState, useEffect, useMemo, useRef } from "react";
import { Controller, useForm, useWatch, type FieldErrors } from "react-hook-form";
import { createRecipeAction } from "@/server/actions/recipes";
import { UNITS_BY_DIMENSION, getUnitDimension, type Unit } from "@/domain/units";
import { recipeInputSchema, type RecipeInput } from "@/server/validation/recipeSchema";

export type RecipeMaterialOption = {
  id: string;
  name: string;
  baseUnit: string;
  unitCost: string;
};

const controlClass =
  "rounded-lg border border-zinc-300 px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700";
const selectClass = `${controlClass} bg-white`;

const blankValues: RecipeInput = {
  name: "",
  items: [{ materialId: "", quantity: "", unit: "g" as Unit }],
};

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  // Rendered outside the field's <label> so the alert text does not pollute
  // the input's accessible name; aria-describedby on the input keeps the
  // error semantically associated with the field.
  return (
    <p id={id} role="alert" className="text-sm text-rose-800">
      {message}
    </p>
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
  // The foundation slice ships a single item row. The dynamic add/remove
  // array lives in the next autonomous child slice (PR3t.items).
  const materialId = useWatch({ control, name: "items.0.materialId" }) ?? "";
  const quantity = useWatch({ control, name: "items.0.quantity" }) ?? "";
  const unit = (useWatch({ control, name: "items.0.unit" }) ?? "g") as Unit;
  const selectedMaterial = sortedMaterials.find((m) => m.id === materialId);
  const dimension = selectedMaterial ? getUnitDimension(selectedMaterial.baseUnit) : "mass";
  const allowedUnits = UNITS_BY_DIMENSION[dimension] ?? UNITS_BY_DIMENSION.mass;

  function handleMaterialChange(nextId: string) {
    setValue("items.0.materialId", nextId, { shouldDirty: true });
    const material = sortedMaterials.find((m) => m.id === nextId);
    const nextUnit: Unit = material
      ? ((UNITS_BY_DIMENSION[getUnitDimension(material.baseUnit)] ??
          UNITS_BY_DIMENSION.mass)[0] as Unit)
      : "g";
    setValue("items.0.unit", nextUnit, { shouldDirty: true });
  }

  // Reset on a successful Server Action response. The ref guards against
  // re-running on every render — only fires once per actual action result.
  const handledActionState = useRef(state);
  useEffect(() => {
    if (handledActionState.current === state) return;
    handledActionState.current = state;
    if (state.status === "success") reset(blankValues);
  }, [reset, state]);

  const nameMessage = errors.name?.message?.toString() ?? state.fieldErrors?.name?.[0];
  const itemErrors = errors.items as
    Array<FieldErrors<RecipeInput["items"][number]> | undefined> | undefined;
  const rowError = itemErrors?.[0];
  const materialMessage = rowError?.materialId?.message?.toString();
  const quantityMessage = rowError?.quantity?.message?.toString();
  const unitMessage = rowError?.unit?.message?.toString();

  function submit(_values: RecipeInput, event?: React.BaseSyntheticEvent) {
    const form = event?.target;
    if (!(form instanceof HTMLFormElement)) return;
    const data = new FormData(form);
    // Server Action expects a single `items` JSON entry decoded by
    // readRecipeItems().
    data.set("items", JSON.stringify([{ materialId, quantity, unit }]));
    startTransition(() => formAction(data));
  }

  return (
    <section
      id="new-recipe"
      aria-labelledby="new-recipe-heading"
      className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <h2 id="new-recipe-heading" className="text-xl font-semibold">
        Create recipe
      </h2>
      <form
        onSubmit={handleSubmit(submit)}
        noValidate
        autoComplete="off"
        className="mt-5 flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <label className="font-medium" htmlFor="recipe-name">
            Name
          </label>
          <input
            id="recipe-name"
            {...register("name")}
            aria-describedby="recipe-name-error"
            className={controlClass}
          />
          <FieldError id="recipe-name-error" message={nameMessage} />
        </div>

        <ol aria-label="Recipe materials" className="flex flex-col gap-3">
          <li
            aria-label="Item 1"
            data-testid="recipe-item-1"
            className="flex flex-col gap-3 rounded-xl border border-rose-100 bg-rose-50/40 p-3"
          >
            <span className="text-sm font-semibold text-zinc-700">Item 1</span>
            <Controller
              control={control}
              name="items.0.materialId"
              render={({ field }) => (
                <div className="flex flex-col gap-1">
                  <label className="font-medium" htmlFor="recipe-item-0-material">
                    Material
                  </label>
                  <select
                    id="recipe-item-0-material"
                    value={field.value ?? ""}
                    onChange={(event) => {
                      field.onChange(event.target.value);
                      handleMaterialChange(event.target.value);
                    }}
                    aria-describedby="recipe-item-0-material-error"
                    className={selectClass}
                  >
                    <option value="">Select a material</option>
                    {sortedMaterials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <FieldError id="recipe-item-0-material-error" message={materialMessage} />
                </div>
              )}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="font-medium" htmlFor="recipe-item-0-quantity">
                  Quantity
                </label>
                <input
                  id="recipe-item-0-quantity"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  {...register("items.0.quantity")}
                  aria-describedby="recipe-item-0-quantity-error"
                  className={controlClass}
                />
                <FieldError id="recipe-item-0-quantity-error" message={quantityMessage} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-medium" htmlFor="recipe-item-0-unit">
                  Unit
                </label>
                <select
                  id="recipe-item-0-unit"
                  {...register("items.0.unit")}
                  aria-describedby="recipe-item-0-unit-error"
                  className={selectClass}
                >
                  {allowedUnits.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <FieldError id="recipe-item-0-unit-error" message={unitMessage} />
              </div>
            </div>
          </li>
        </ol>

        {state.message && state.status !== "success" ? (
          <p role="alert" aria-live="polite" className="text-sm text-rose-800">
            {state.message}
          </p>
        ) : null}
        {state.status === "success" ? (
          <p role="status" aria-live="polite" className="text-sm text-emerald-800">
            Recipe created.
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-rose-900 px-4 py-2.5 font-semibold text-white transition-opacity hover:bg-rose-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Creating recipe…" : "Create recipe"}
        </button>
      </form>
    </section>
  );
}
