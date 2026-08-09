"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { startTransition, useActionState, useEffect, useRef } from "react";
import { useForm, useWatch, type FieldErrors, type UseFormReset } from "react-hook-form";
import { createMaterialAction, type MaterialActionState } from "@/server/actions/materials";
import { DIMENSIONS, UNITS_BY_DIMENSION } from "@/domain/units";
import { formatArsDecimalDisplay, formatDecimalInput } from "@/lib/moneyFormat";
import { dimensionLabel, unitLabel, unitSingularLabel } from "@/lib/unitLabels";
import { FieldHelp } from "@/components/help/FieldHelp";
import {
  materialInputSchema,
  type MaterialInput,
  type ParsedMaterialInput,
} from "@/server/validation/materialSchema";

export const blankMaterialValues: MaterialInput = {
  name: "",
  dimension: "mass",
  baseUnit: "g",
  purchaseUnit: "kg",
  purchaseQuantity: "",
  purchasePrice: "",
};

// Smart defaults for the unit pair when the dimension changes. The base
// unit is the smaller one (used in templates / quotes) and the purchase
// unit is the larger one (the typical bulk-buy unit from a supplier). The
// `count` dimension has a single unit so both slots collapse to it.
function defaultUnitsForDimension(
  dimension: MaterialInput["dimension"],
): { baseUnit: MaterialInput["baseUnit"]; purchaseUnit: MaterialInput["purchaseUnit"] } {
  const units = UNITS_BY_DIMENSION[dimension] ?? UNITS_BY_DIMENSION.mass;
  const baseUnit = units[0] ?? "g";
  const purchaseUnit = units[1] ?? baseUnit;
  return { baseUnit, purchaseUnit };
}

// U4: rosa-crema tokens; focus/touch targets inherit from globals.css.
const controlClass =
  "w-full min-w-0 rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-ink";
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
  layout?: "card" | "row";
  unitCost?: string;
  onSuccess?: (reset: UseFormReset<MaterialInput>) => void;
};

function options(values: readonly string[], label: (value: string) => string) {
  return values.map((value) => (
    <option key={value} value={value}>
      {label(value)}
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

const FIELD_HELP: Record<
  keyof MaterialInput | "unitCost",
  {
    title: string;
    intro: string;
    bullets: readonly string[];
    tip: string;
  }
> = {
  name: {
    title: "Nombre",
    intro: 'Es el nombre humano del insumo (por ejemplo, "Cera de soja").',
    bullets: ["Lo usamos en plantillas y cotizaciones para identificar el material."],
    tip: "Tiene que ser único por owner; si ya existe uno igual, el server lo rechaza.",
  },
  dimension: {
    title: "Dimensión",
    intro: "Es la magnitud física del insumo: peso, volumen, longitud o cantidad.",
    bullets: ["Sirve para impedir que sumes, por ejemplo, gramos con mililitros."],
    tip: "Cambiar la dimensión reinicia las unidades base y de compra a la primera opción válida.",
  },
  baseUnit: {
    title: "Unidad base",
    intro: "Es la unidad en la que se expresa el costo unitario del insumo.",
    bullets: [
      "Las plantillas multiplican cantidades por este costo unitario, por eso debe ser estable.",
    ],
    tip: "Una vez que el material entra en una plantilla, no podés cambiar la unidad base.",
  },
  purchaseUnit: {
    title: "Unidad de compra",
    intro: "Es la unidad en la que comprás el material en tu proveedor.",
    bullets: [
      "A partir de la cantidad y del precio de compra, calculamos el costo por unidad base.",
    ],
    tip: "Tiene que compartir dimensión con la unidad base (no podés mezclar kg con ml).",
  },
  purchaseQuantity: {
    title: "Cantidad de compra",
    intro: "Cuánto comprás en la unidad de compra (por ejemplo, 1 kilogramo o 5 litros).",
    bullets: ["Sirve para convertir el precio de compra al costo por unidad base."],
    tip: "En dimensión Cantidad, la cantidad tiene que ser un entero.",
  },
  purchasePrice: {
    title: "Precio de compra (ARS)",
    intro: "Cuánto pagás por esa cantidad de compra, en pesos argentinos.",
    bullets: ["Combinado con la cantidad, define el costo unitario base del insumo."],
    tip: "Ajustá este campo cuando cambian los precios del proveedor; el costo unitario se recalcula solo.",
  },
  unitCost: {
    title: "Precio unitario derivado",
    intro:
      "Es el costo por unidad base que el sistema calcula a partir del precio y la cantidad de compra.",
    bullets: ["Es el valor que multiplica las cantidades en cada plantilla."],
    tip: "Si ves un valor raro, revisá las unidades base y de compra antes de archivar el material.",
  },
};

function FieldHelpIcon({ fieldKey }: { fieldKey: keyof MaterialInput | "unitCost" }) {
  const content = FIELD_HELP[fieldKey];
  return (
    <FieldHelp
      id={fieldKey}
      title={content.title}
      intro={content.intro}
      bullets={content.bullets}
      tip={content.tip}
    />
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
  layout = "card",
  unitCost,
  onSuccess,
}: MaterialFormProps) {
  const sectionId = idPrefix || "new-material";
  const isRow = layout === "row";
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
    // Reset the unit pair to the dimension's smart defaults: baseUnit → the
    // smaller unit (g/ml/cm/unit), purchaseUnit → the larger one (kg/L/m)
    // when the dimension has two. This avoids the previous "g/g" default
    // that silently produced a 1000× too-high unit cost. The schema's
    // dimension/unit compatibility check still validates the final pair.
    const { baseUnit, purchaseUnit } = defaultUnitsForDimension(dimension);
    setValue("baseUnit", baseUnit);
    setValue("purchaseUnit", purchaseUnit);
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

  const fieldLabelClass = isRow
    ? "text-xs font-semibold uppercase tracking-wide text-ink-muted md:sr-only"
    : undefined;
  const formControlClass = isRow ? `${controlClass} text-sm` : controlClass;
  const hasFeedback = Boolean(unitCostMessage || state.message || state.status === "success");
  const feedback = hasFeedback ? (
    <div
      className={isRow ? "min-w-0 md:col-span-full md:col-start-1 md:row-start-2" : "sm:col-span-2"}
    >
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
    </div>
  ) : null;
  const currentSubmitLabel = pending ? pendingLabel : submitLabel;

  const form = (
    <form
      onSubmit={handleSubmit(submit, focusDerivedCostError)}
      noValidate
      autoComplete="off"
      aria-busy={pending}
      className={isRow ? "contents" : "mt-5 grid gap-4 sm:grid-cols-2"}
    >
      {hiddenFields
        ? Object.entries(hiddenFields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))
        : null}
      <div className="min-w-0">
        {isRow ? <h3 className="sr-only">{title}</h3> : null}
        <div className="flex items-start gap-1">
          <label
            className="flex min-w-0 flex-1 flex-col gap-1 font-medium"
            htmlFor={inputId("name")}
          >
            <span className={fieldLabelClass}>{label("Nombre")}</span>
            <input
              id={inputId("name")}
              {...register("name")}
              aria-describedby={errorId("name")}
              aria-invalid={Boolean(messageFor("name"))}
              className={formControlClass}
            />
            <FieldError id={errorId("name")} message={messageFor("name")} />
          </label>
          {!isRow ? <FieldHelpIcon fieldKey="name" /> : null}
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-start gap-1">
          <label
            className="flex min-w-0 flex-1 flex-col gap-1 font-medium"
            htmlFor={inputId("dimension")}
          >
            <span className={fieldLabelClass}>{label("Dimensión")}</span>
            <select
              id={inputId("dimension")}
              {...register("dimension")}
              aria-describedby={errorId("dimension")}
              aria-invalid={Boolean(messageFor("dimension"))}
              className={isRow ? `${selectClass} text-sm` : selectClass}
            >
              {options(DIMENSIONS, dimensionLabel)}
            </select>
            <FieldError id={errorId("dimension")} message={messageFor("dimension")} />
          </label>
          {!isRow ? <FieldHelpIcon fieldKey="dimension" /> : null}
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-start gap-1">
          <label
            className="flex min-w-0 flex-1 flex-col gap-1 font-medium"
            htmlFor={inputId("base-unit")}
          >
            <span className={fieldLabelClass}>{label("Unidad base")}</span>
            <select
              id={inputId("base-unit")}
              {...register("baseUnit")}
              aria-describedby={errorId("base-unit")}
              aria-invalid={Boolean(messageFor("baseUnit"))}
              className={isRow ? `${selectClass} text-sm` : selectClass}
            >
              {options(units, unitLabel)}
            </select>
            <FieldError id={errorId("base-unit")} message={messageFor("baseUnit")} />
          </label>
          {!isRow ? <FieldHelpIcon fieldKey="baseUnit" /> : null}
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-start gap-1">
          <label
            className="flex min-w-0 flex-1 flex-col gap-1 font-medium"
            htmlFor={inputId("purchase-unit")}
          >
            <span className={fieldLabelClass}>{label("Unidad de compra")}</span>
            <select
              id={inputId("purchase-unit")}
              {...register("purchaseUnit")}
              aria-describedby={errorId("purchase-unit")}
              aria-invalid={Boolean(messageFor("purchaseUnit"))}
              className={isRow ? `${selectClass} text-sm` : selectClass}
            >
              {options(units, unitLabel)}
            </select>
            <FieldError id={errorId("purchase-unit")} message={messageFor("purchaseUnit")} />
          </label>
          {!isRow ? <FieldHelpIcon fieldKey="purchaseUnit" /> : null}
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-start gap-1">
          <label
            className="flex min-w-0 flex-1 flex-col gap-1 font-medium"
            htmlFor={inputId("purchase-quantity")}
          >
            <span className={fieldLabelClass}>{label("Cantidad de compra")}</span>
            <input
              id={inputId("purchase-quantity")}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              {...register("purchaseQuantity", {
                setValueAs: (value) => (value === "" ? "" : formatDecimalInput(value)),
              })}
              aria-describedby={errorId("purchase-quantity")}
              aria-invalid={Boolean(messageFor("purchaseQuantity"))}
              className={`${formControlClass} tabular-nums`}
            />
            <FieldError
              id={errorId("purchase-quantity")}
              message={messageFor("purchaseQuantity")}
            />
          </label>
          {!isRow ? <FieldHelpIcon fieldKey="purchaseQuantity" /> : null}
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-start gap-1">
          <label
            className="flex min-w-0 flex-1 flex-col gap-1 font-medium"
            htmlFor={inputId("purchase-price")}
          >
            <span className={fieldLabelClass}>{label("Precio de compra (ARS)")}</span>
            <input
              id={inputId("purchase-price")}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              {...register("purchasePrice", {
                setValueAs: (value) => (value === "" ? "" : formatDecimalInput(value)),
              })}
              aria-describedby={`${errorId("purchase-price")} ${errorId("unit-cost")}`}
              aria-invalid={Boolean(messageFor("purchasePrice") || unitCostMessage)}
              className={`${formControlClass} tabular-nums`}
            />
            <FieldError id={errorId("purchase-price")} message={messageFor("purchasePrice")} />
          </label>
          {!isRow ? <FieldHelpIcon fieldKey="purchasePrice" /> : null}
        </div>
      </div>
      {isRow ? (
        <div className="min-w-0">
          <div className="flex items-start gap-1">
            <label
              className="flex min-w-0 flex-1 flex-col gap-1 font-medium"
              htmlFor={inputId("unit-cost")}
            >
              <span className={fieldLabelClass}>{label("Precio unitario derivado")}</span>
              <input
                id={inputId("unit-cost")}
                type="text"
                value={`${unitCost ? formatArsDecimalDisplay(unitCost) : "ARS —"} por ${unitSingularLabel(defaultValues.baseUnit)}`}
                readOnly
                className={`${formControlClass} bg-surface-soft font-semibold tabular-nums`}
              />
            </label>
          </div>
        </div>
      ) : null}
      <div
        className={
          isRow ? "flex min-w-0 flex-col gap-1 md:col-start-8 md:row-start-1" : "sm:col-span-2"
        }
      >
        {isRow ? <span className={fieldLabelClass}>Acción de edición</span> : null}
        <button
          type="submit"
          disabled={pending}
          aria-label={isRow ? currentSubmitLabel : undefined}
          className={
            isRow
              ? "inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand px-3 text-sm font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
              : "inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand px-4 text-base font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          }
        >
          {isRow ? (pending ? "Guardando…" : "Guardar") : currentSubmitLabel}
        </button>
      </div>
      {feedback}
    </form>
  );

  if (isRow) return form;

  return (
    <section
      id={sectionId}
      aria-labelledby={`${sectionId}-heading`}
      className="rounded-2xl border border-border-subtle bg-surface-raised p-5 shadow-sm sm:p-6"
    >
      <h2 id={`${sectionId}-heading`} className="text-xl font-semibold">
        {title}
      </h2>
      {form}
    </section>
  );
}

export function MaterialCreateForm() {
  return <MaterialForm onSuccess={(reset) => reset(blankMaterialValues)} />;
}
