"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { startTransition, useActionState, useEffect, useMemo, useRef } from "react";
import { useFieldArray, useForm, useWatch, type FieldErrors } from "react-hook-form";
import { updateTemplateAction, type TemplateActionState } from "@/server/actions/templates";
import { UNITS_BY_DIMENSION, getUnitDimension, type Unit } from "@/domain/units";
import { templateInputSchema, type TemplateInput } from "@/server/validation/templateSchema";

export type TemplateEditItem = { materialId: string; quantity: string; unit: Unit };
export type TemplateEditValue = { id: string; name: string; items: TemplateEditItem[] };
export type TemplateMaterialOption = { id: string; name: string; baseUnit: string; unitCost: string };

const controlClass = "rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-ink";
const selectClass = controlClass;
const blankItem: TemplateEditItem = { materialId: "", quantity: "", unit: "g" };

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-status-danger">
      {message}
    </p>
  );
}

// Index-aware parser: the Server Action returns `fieldErrors.items` as a
// flat string[]; indexed entries read `items[i].field: message` and we
// strip the prefix so it lands on the matching row + field. Unindexed
// messages fall back by row index (matches the create form behavior).
function rowServerMessage(
  state: TemplateActionState,
  index: number,
  field: "materialId" | "quantity" | "unit",
): string | undefined {
  const messages = state.fieldErrors?.items ?? [];
  return (
    messages
      .find((message) => message.startsWith(`items[${index}].${field}`))
      ?.replace(/^items\[\d+\]\.[^:]+:\s*/, "") ?? messages[index]
  );
}

function rowErrorFor(
  state: TemplateActionState,
  rowErrors: FieldErrors<TemplateInput["items"][number]> | undefined,
  field: "materialId" | "quantity" | "unit",
  index: number,
): { aria: boolean; message: string | undefined } {
  const hasError = Boolean(rowErrors?.[field]?.message ?? rowServerMessage(state, index, field));
  const message = hasError
    ? field === "materialId"
      ? "Seleccioná un material disponible."
      : field === "quantity"
        ? "Ingresá una cantidad válida mayor que cero, con hasta 6 decimales."
        : "Seleccioná una unidad válida para el material."
    : undefined;
  return { aria: hasError, message };
}

export function TemplateEditForm({
  template,
  materials,
}: {
  template: TemplateEditValue;
  materials: readonly TemplateMaterialOption[];
}) {
  const sortedMaterials = useMemo(
    () => [...materials].sort((a, b) => a.name.localeCompare(b.name)),
    [materials],
  );
  const [state, formAction, pending] = useActionState(updateTemplateAction, { status: "idle" });
  const defaultValues = useMemo<TemplateInput>(
    () => ({
      name: template.name,
      items: template.items.length > 0 ? template.items : [blankItem],
    }),
    [template],
  );
  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<TemplateInput>({
    resolver: zodResolver(templateInputSchema, undefined, { mode: "sync" }),
    defaultValues,
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const watchedItems = useWatch({ control, name: "items" }) ?? [];

  // Edit never resets on success — the user keeps iterating on the same
  // template. The ref marks the state as handled so a later error doesn't
  // accidentally clear a previous success message.
  const handledActionState = useRef(state);
  useEffect(() => {
    handledActionState.current = state;
  }, [state]);

  const sectionId = `edit-template-${template.id}`;

  function materialChange(index: number, nextId: string) {
    setValue(`items.${index}.materialId`, nextId, { shouldDirty: true });
    const material = sortedMaterials.find((item) => item.id === nextId);
    const units = material
      ? (UNITS_BY_DIMENSION[getUnitDimension(material.baseUnit)] ?? UNITS_BY_DIMENSION.mass)
      : ["g"];
    setValue(`items.${index}.unit`, units[0] as Unit, { shouldDirty: true });
  }

  function submit(_values: TemplateInput, event?: React.BaseSyntheticEvent) {
    const form = event?.target;
    if (!(form instanceof HTMLFormElement)) return;
    const data = new FormData(form);
    data.set("id", template.id);
    data.set("items", JSON.stringify(watchedItems));
    startTransition(() => formAction(data));
  }

  const itemErrors = errors.items as
    Array<FieldErrors<TemplateInput["items"][number]> | undefined> | undefined;
  const hasNameError = Boolean(errors.name?.message ?? state.fieldErrors?.name?.[0]);
  const nameMessage = hasNameError ? "Ingresá un nombre para la plantilla." : undefined;

  function renderRow(field: (typeof fields)[number], index: number): React.ReactElement {
    const item = watchedItems[index] ?? blankItem;
    const material = sortedMaterials.find((option) => option.id === item.materialId);
    const units = material
      ? (UNITS_BY_DIMENSION[getUnitDimension(material.baseUnit)] ?? UNITS_BY_DIMENSION.mass)
      : UNITS_BY_DIMENSION.mass;
    const rowErrors = itemErrors?.[index];
    const materialErr = rowErrorFor(state, rowErrors, "materialId", index);
    const quantityErr = rowErrorFor(state, rowErrors, "quantity", index);
    const unitErr = rowErrorFor(state, rowErrors, "unit", index);
    return (
      <li
        key={field.id}
        aria-label={`Ingrediente ${index + 1}`}
        data-testid={`template-edit-item-${index + 1}`}
        className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface-raised p-3"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-ink-muted">Ingrediente {index + 1}</span>
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
          <label
            className="font-medium text-ink"
            htmlFor={`${sectionId}-item-${index}-material`}
          >
            Material
          </label>
          <select
            id={`${sectionId}-item-${index}-material`}
            {...register(`items.${index}.materialId`)}
            onChange={(event) => materialChange(index, event.target.value)}
            aria-describedby={`${sectionId}-item-${index}-material-error`}
            aria-invalid={materialErr.aria}
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
            id={`${sectionId}-item-${index}-material-error`}
            message={materialErr.message}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label
              className="font-medium text-ink"
              htmlFor={`${sectionId}-item-${index}-quantity`}
            >
              Cantidad
            </label>
            <input
              id={`${sectionId}-item-${index}-quantity`}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              {...register(`items.${index}.quantity`)}
              aria-describedby={`${sectionId}-item-${index}-quantity-error`}
              aria-invalid={quantityErr.aria}
              className={controlClass}
            />
            <FieldError
              id={`${sectionId}-item-${index}-quantity-error`}
              message={quantityErr.message}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-medium text-ink" htmlFor={`${sectionId}-item-${index}-unit`}>
              Unidad
            </label>
            <select
              id={`${sectionId}-item-${index}-unit`}
              {...register(`items.${index}.unit`)}
              aria-describedby={`${sectionId}-item-${index}-unit-error`}
              aria-invalid={unitErr.aria}
              className={selectClass}
            >
              {units.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
            <FieldError id={`${sectionId}-item-${index}-unit-error`} message={unitErr.message} />
          </div>
        </div>
      </li>
    );
  }

  return (
    <section
      id={sectionId}
      aria-labelledby={`${sectionId}-heading`}
      className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-surface-soft p-3"
    >
      <h3 id={`${sectionId}-heading`} className="text-base font-semibold text-ink">
        Editar plantilla: {template.name}
      </h3>
      <form
        onSubmit={handleSubmit(submit)}
        noValidate
        autoComplete="off"
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="id" value={template.id} />
        <div className="flex flex-col gap-1">
          <label className="font-medium text-ink" htmlFor={`${sectionId}-name`}>
            Nombre de {template.name}
          </label>
          <input
            id={`${sectionId}-name`}
            {...register("name")}
            aria-describedby={`${sectionId}-name-error`}
            aria-invalid={Boolean(nameMessage)}
            className={controlClass}
          />
          <FieldError id={`${sectionId}-name-error`} message={nameMessage} />
        </div>
        <ol aria-label="Ingredientes de la plantilla" className="flex flex-col gap-3">
          {fields.map((field, index) => renderRow(field, index))}
        </ol>
        {errors.items?.root?.message ? (
          <FieldError id={`${sectionId}-items-error`} message="Agregá al menos un ingrediente." />
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
            No se pudo actualizar la plantilla.
          </p>
        ) : null}
        {state.status === "success" ? (
          <p role="status" aria-live="polite" className="text-sm text-status-success">
            Plantilla actualizada.
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-4 py-2.5 font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Guardando plantilla…" : "Guardar plantilla"}
        </button>
      </form>
    </section>
  );
}
