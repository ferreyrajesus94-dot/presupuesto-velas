"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { startTransition, useActionState, useEffect, useRef } from "react";
import { useForm, useWatch, type FieldErrors, type UseFormReset } from "react-hook-form";
import { createMaterialAction, type MaterialActionState } from "@/server/actions/materials";
import { DIMENSIONS, UNITS_BY_DIMENSION } from "@/domain/units";
import {
  materialInputSchema,
  type MaterialInput,
  type ParsedMaterialInput,
} from "@/server/validation/materialSchema";

export const blankMaterialValues: MaterialInput = {
  name: "",
  dimension: "mass",
  baseUnit: "g",
  purchaseUnit: "g",
  purchaseQuantity: "",
  purchasePrice: "",
};

// U4: rosa-crema tokens; focus/touch targets inherit from globals.css.
const controlClass = "rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-ink";
const selectClass = controlClass;
type MaterialFormErrors = FieldErrors<MaterialInput> & {
  unitCost?: { message?: string };
};
type MaterialAction = (
  previous: MaterialActionState,
  formData: FormData,
) => Promise<MaterialActionState>;

type MaterialFormProps = {
  action?: MaterialAction;
  defaultValues?: MaterialInput;
  idPrefix?: string;
  title?: string;
  labelSuffix?: string;
  hiddenFields?: Record<string, string>;
  submitLabel?: string;
  pendingLabel?: string;
  successMessage?: string;
  onSuccess?: (reset: UseFormReset<MaterialInput>) => void;
};

function options(values: readonly string[]) {
  return values.map((value) => (
    <option key={value} value={value}>
      {value}
    </option>
  ));
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-status-danger">
      {message}
    </p>
  );
}

export function MaterialForm({
  action = createMaterialAction,
  defaultValues = blankMaterialValues,
  idPrefix = "",
  title = "Agregar material",
  labelSuffix = "",
  hiddenFields,
  submitLabel = "Crear material",
  pendingLabel = "Creando material…",
  successMessage = "Material creado.",
  onSuccess,
}: MaterialFormProps) {
  const sectionId = idPrefix || "new-material";
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const {
    control,
    register,
    handleSubmit,
    reset,
    setFocus,
    setValue,
    formState: { errors },
  } = useForm<MaterialInput, unknown, ParsedMaterialInput>({
    resolver: zodResolver(materialInputSchema, undefined, { mode: "sync" }),
    defaultValues,
  });
  const dimension = useWatch({ control, name: "dimension" });
  const units = UNITS_BY_DIMENSION[dimension] ?? UNITS_BY_DIMENSION.mass;
  const initialDimension = useRef(dimension);

  useEffect(() => {
    if (initialDimension.current === dimension) return;
    initialDimension.current = dimension;
    setValue("baseUnit", units[0]);
    setValue("purchaseUnit", units[0]);
  }, [dimension, setValue, units]);

  const handledActionState = useRef(state);
  useEffect(() => {
    if (handledActionState.current === state) return;
    handledActionState.current = state;

    if (state.status === "success") {
      onSuccess?.(reset);
      return;
    }

    if (state.status === "error" && state.fieldErrors?.unitCost) {
      setFocus("purchasePrice");
    }
  }, [onSuccess, reset, setFocus, state]);

  const inputId = (field: string) => `${idPrefix ? `${idPrefix}-` : "material-"}${field}`;
  const errorId = (field: string) => `${idPrefix ? `${idPrefix}-` : ""}${field}-error`;
  const label = (name: string) => `${name}${labelSuffix}`;

  function messageFor(field: keyof MaterialInput): string | undefined {
    return errors[field]?.message?.toString() ?? state.fieldErrors?.[field]?.[0];
  }
  const unitCostMessage =
    (errors as MaterialFormErrors).unitCost?.message ?? state.fieldErrors?.unitCost?.[0];

  function focusDerivedCostError(validationErrors: FieldErrors<MaterialInput>) {
    if ((validationErrors as MaterialFormErrors).unitCost) setFocus("purchasePrice");
  }

  function submit(values: ParsedMaterialInput, event?: React.BaseSyntheticEvent) {
    void values;
    const form = event?.target;
    if (!(form instanceof HTMLFormElement)) return;
    startTransition(() => formAction(new FormData(form)));
  }

  return (
    <section
      id={sectionId}
      aria-labelledby={`${sectionId}-heading`}
      className="rounded-2xl border border-border-subtle bg-surface-raised p-5 shadow-sm sm:p-6"
    >
      <h2 id={`${sectionId}-heading`} className="text-xl font-semibold">
        {title}
      </h2>
      <form
        onSubmit={handleSubmit(submit, focusDerivedCostError)}
        noValidate
        autoComplete="off"
        className="mt-5 flex flex-col gap-4"
      >
        {hiddenFields
          ? Object.entries(hiddenFields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))
          : null}
        <label className="flex flex-col gap-1 font-medium" htmlFor={inputId("name")}>
          {label("Nombre")}
          <input
            id={inputId("name")}
            {...register("name")}
            aria-describedby={errorId("name")}
            className={controlClass}
          />
          <FieldError id={errorId("name")} message={messageFor("name")} />
        </label>
        <label className="flex flex-col gap-1 font-medium" htmlFor={inputId("dimension")}>
          {label("Dimensión")}
          <select id={inputId("dimension")} {...register("dimension")} className={selectClass}>
            {options(DIMENSIONS)}
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 font-medium" htmlFor={inputId("base-unit")}>
            {label("Unidad base")}
            <select
              id={inputId("base-unit")}
              {...register("baseUnit")}
              aria-describedby={errorId("base-unit")}
              className={selectClass}
            >
              {options(units)}
            </select>
            <FieldError id={errorId("base-unit")} message={messageFor("baseUnit")} />
          </label>
          <label className="flex flex-col gap-1 font-medium" htmlFor={inputId("purchase-unit")}>
            {label("Unidad de compra")}
            <select
              id={inputId("purchase-unit")}
              {...register("purchaseUnit")}
              aria-describedby={errorId("purchase-unit")}
              className={selectClass}
            >
              {options(units)}
            </select>
            <FieldError id={errorId("purchase-unit")} message={messageFor("purchaseUnit")} />
          </label>
        </div>
        <label className="flex flex-col gap-1 font-medium" htmlFor={inputId("purchase-quantity")}>
          {label("Cantidad de compra")}
          <input
            id={inputId("purchase-quantity")}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            {...register("purchaseQuantity")}
            aria-describedby={errorId("purchase-quantity")}
            className={controlClass}
          />
          <FieldError id={errorId("purchase-quantity")} message={messageFor("purchaseQuantity")} />
        </label>
        <label className="flex flex-col gap-1 font-medium" htmlFor={inputId("purchase-price")}>
          {label("Precio de compra (ARS)")}
          <input
            id={inputId("purchase-price")}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            {...register("purchasePrice")}
            aria-describedby={`${errorId("purchase-price")} ${errorId("unit-cost")}`}
            className={controlClass}
          />
          <FieldError id={errorId("purchase-price")} message={messageFor("purchasePrice")} />
        </label>
        <FieldError id={errorId("unit-cost")} message={unitCostMessage} />
        {state.message ? (
          <p
            role={state.status === "error" ? "alert" : "status"}
            aria-live="polite"
            className="text-sm text-status-danger"
          >
            {state.message}
          </p>
        ) : null}
        {state.status === "success" ? (
          <p role="status" aria-live="polite" className="text-sm text-status-success">
            {successMessage}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-base font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? pendingLabel : submitLabel}
        </button>
      </form>
    </section>
  );
}

export function MaterialCreateForm() {
  return <MaterialForm onSuccess={(reset) => reset(blankMaterialValues)} />;
}
