"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { startTransition, useActionState, useEffect, useRef } from "react";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { createMaterialAction } from "@/server/actions/materials";
import { DIMENSIONS, UNITS_BY_DIMENSION } from "@/domain/units";
import {
  materialInputSchema,
  type MaterialInput,
  type ParsedMaterialInput,
} from "@/server/validation/materialSchema";

const defaultValues: MaterialInput = {
  name: "",
  dimension: "mass",
  baseUnit: "g",
  purchaseUnit: "g",
  purchaseQuantity: "",
  purchasePrice: "",
};
const controlClass =
  "rounded-lg border border-zinc-300 px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700";
const selectClass = `${controlClass} bg-white`;
type MaterialFormErrors = FieldErrors<MaterialInput> & {
  unitCost?: { message?: string };
};

function options(values: readonly string[]) {
  return values.map((value) => (
    <option key={value} value={value}>
      {value}
    </option>
  ));
}

function FieldError({ field, message }: { field: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${field}-error`} role="alert" className="text-sm text-rose-800">
      {message}
    </p>
  );
}

export function MaterialCreateForm() {
  const [state, formAction, pending] = useActionState(createMaterialAction, { status: "idle" });
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

  useEffect(() => {
    setValue("baseUnit", units[0]);
    setValue("purchaseUnit", units[0]);
  }, [setValue, units]);

  const handledActionState = useRef(state);
  useEffect(() => {
    if (handledActionState.current === state) return;
    handledActionState.current = state;

    if (state.status === "success") {
      reset(defaultValues);
      return;
    }

    if (state.status === "error" && state.fieldErrors?.unitCost) {
      setFocus("purchasePrice");
    }
  }, [reset, setFocus, state]);

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
      id="new-material"
      aria-labelledby="new-material-heading"
      className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <h2 id="new-material-heading" className="text-xl font-semibold">
        Add a material
      </h2>
      <form
        onSubmit={handleSubmit(submit, focusDerivedCostError)}
        noValidate
        className="mt-5 flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1 font-medium" htmlFor="material-name">
          Name
          <input
            id="material-name"
            {...register("name")}
            aria-describedby="name-error"
            className={controlClass}
          />
          <FieldError field="name" message={messageFor("name")} />
        </label>
        <label className="flex flex-col gap-1 font-medium" htmlFor="material-dimension">
          Dimension
          <select id="material-dimension" {...register("dimension")} className={selectClass}>
            {options(DIMENSIONS)}
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 font-medium" htmlFor="material-base-unit">
            Base unit
            <select
              id="material-base-unit"
              {...register("baseUnit")}
              aria-describedby="base-unit-error"
              className={selectClass}
            >
              {options(units)}
            </select>
            <FieldError field="base-unit" message={messageFor("baseUnit")} />
          </label>
          <label className="flex flex-col gap-1 font-medium" htmlFor="material-purchase-unit">
            Purchase unit
            <select
              id="material-purchase-unit"
              {...register("purchaseUnit")}
              aria-describedby="purchase-unit-error"
              className={selectClass}
            >
              {options(units)}
            </select>
            <FieldError field="purchase-unit" message={messageFor("purchaseUnit")} />
          </label>
        </div>
        <label className="flex flex-col gap-1 font-medium" htmlFor="material-purchase-quantity">
          Purchase quantity
          <input
            id="material-purchase-quantity"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            {...register("purchaseQuantity")}
            aria-describedby="purchase-quantity-error"
            className={controlClass}
          />
          <FieldError field="purchase-quantity" message={messageFor("purchaseQuantity")} />
        </label>
        <label className="flex flex-col gap-1 font-medium" htmlFor="material-purchase-price">
          Purchase price (ARS)
          <input
            id="material-purchase-price"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            {...register("purchasePrice")}
            aria-describedby="purchase-price-error unit-cost-error"
            className={controlClass}
          />
          <FieldError field="purchase-price" message={messageFor("purchasePrice")} />
        </label>
        <FieldError field="unit-cost" message={unitCostMessage} />
        {state.message && (
          <p
            role={state.status === "error" ? "alert" : "status"}
            aria-live="polite"
            className="text-sm text-rose-800"
          >
            {state.message}
          </p>
        )}
        {state.status === "success" && (
          <p role="status" aria-live="polite" className="text-sm text-emerald-800">
            Material created.
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-rose-900 px-4 py-2.5 font-semibold text-white transition-opacity hover:bg-rose-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Creating material…" : "Create material"}
        </button>
      </form>
    </section>
  );
}
