"use client";

import { useMemo } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  DEFAULT_EXPIRATION_DAYS,
  DEFAULT_PROFIT_MODE,
  DEFAULT_PROFIT_PERCENT,
  DEFAULT_QUOTE_DEPOSIT_PERCENT,
  DEFAULT_VISIBILITY,
} from "@/domain/quoteDefaults";
import { quoteDraftInputSchema } from "@/server/validation/quoteSchema";
import type { Recipe } from "@/server/repositories/recipes";
import { ModelLineEditor } from "./ModelLineEditor";
import { QuoteVisibilityToggles } from "./QuoteVisibilityToggles";

const controlClass =
  "rounded-lg border border-zinc-300 px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700";

const pad = (n: number): string => String(n).padStart(2, "0");
const defaultExpirationDate = (): string => {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate() + DEFAULT_EXPIRATION_DAYS);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const startOfTodayLocal = (n: Date): Date => new Date(n.getFullYear(), n.getMonth(), n.getDate());

/** Form schema = PR4d Zod input + one past-date UX refinement. */
const formSchema = quoteDraftInputSchema.refine(
  (data) => {
    const e = new Date(`${data.expirationDate}T00:00:00`);
    return !Number.isNaN(e.getTime()) && e >= startOfTodayLocal(new Date());
  },
  { path: ["expirationDate"], message: "La fecha de vencimiento debe ser hoy o posterior" },
);

export type QuoteDraftFormValues = z.input<typeof formSchema>;
const blankModel = (): QuoteDraftFormValues["models"][number] => ({ recipeId: "", quantity: "1" });

export function QuoteCreateForm({ recipes }: { recipes: readonly Recipe[] }) {
  const sortedRecipes = useMemo(
    () => [...recipes].sort((a, b) => a.name.localeCompare(b.name)),
    [recipes],
  );
  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<QuoteDraftFormValues>({
    resolver: zodResolver(formSchema, undefined, { mode: "sync" }),
    defaultValues: {
      expirationDate: defaultExpirationDate(),
      profit: {
        mode: DEFAULT_PROFIT_MODE,
        percent: DEFAULT_PROFIT_PERCENT,
      } as QuoteDraftFormValues["profit"],
      depositPercent: DEFAULT_QUOTE_DEPOSIT_PERCENT,
      indirectCosts: [],
      models: [blankModel()],
      visibility: { ...DEFAULT_VISIBILITY },
    },
  });
  const modelsFieldArray = useFieldArray({ control, name: "models" });
  const profitMode = useWatch({ control, name: "profit.mode" }) ?? DEFAULT_PROFIT_MODE;

  // PR4g.2 submit is a no-op; PR4g.3 will wire createQuoteDraftAction +
  // appendQuoteVersionAction. Validation still runs via zodResolver.
  const onSubmit = (): void => {
    /* PR4g.3 placeholder */
  };

  const expirationError = errors.expirationDate?.message;
  const modelErrors = errors.models as
    | Array<{ recipeId?: { message?: string }; quantity?: { message?: string } } | undefined>
    | undefined;

  return (
    <section
      id="new-quote"
      aria-label="Nueva cotización"
      className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        autoComplete="off"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="quote-customer" className="font-medium">
            Cliente
          </label>
          <input
            id="quote-customer"
            type="text"
            maxLength={50}
            placeholder="Opcional"
            aria-describedby="quote-customer-hint"
            {...register("customerName" as keyof QuoteDraftFormValues)}
            className={controlClass}
          />
          <p id="quote-customer-hint" className="text-xs text-zinc-600">
            Opcional, hasta 50 caracteres.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="quote-expiration" className="font-medium">
            Vencimiento
          </label>
          <input
            id="quote-expiration"
            type="date"
            aria-describedby="quote-expiration-error"
            aria-invalid={Boolean(expirationError)}
            {...register("expirationDate")}
            className={controlClass}
          />
          {expirationError ? (
            <p id="quote-expiration-error" role="alert" className="text-sm text-rose-800">
              {expirationError}
            </p>
          ) : null}
        </div>
        <ModelLineEditor
          control={control}
          recipes={sortedRecipes}
          fieldArray={modelsFieldArray}
          onAppend={() => modelsFieldArray.append(blankModel())}
          errorBag={modelErrors}
        />
        <fieldset className="flex flex-col gap-2 rounded-xl border border-rose-100 bg-rose-50/40 p-4">
          <legend className="px-1 font-medium">Ganancia</legend>
          <Controller
            name="profit.mode"
            control={control}
            render={({ field }) => (
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    value="percentage"
                    checked={field.value === "percentage"}
                    onChange={() => {
                      field.onChange("percentage");
                      setValue("profit.amount", "");
                    }}
                  />
                  Porcentaje
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    value="fixed"
                    checked={field.value === "fixed"}
                    onChange={() => {
                      field.onChange("fixed");
                      setValue("profit.percent", "");
                    }}
                  />
                  Modo fijo
                </label>
              </div>
            )}
          />
          {profitMode === "percentage" ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="quote-profit-percent" className="font-medium">
                Porcentaje de ganancia (%)
              </label>
              <input
                id="quote-profit-percent"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                {...register("profit.percent" as const)}
                className={controlClass}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label htmlFor="quote-profit-amount" className="font-medium">
                Monto fijo de ganancia (ARS)
              </label>
              <input
                id="quote-profit-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                {...register("profit.amount" as const)}
                className={controlClass}
              />
            </div>
          )}
        </fieldset>
        <QuoteVisibilityToggles register={register} />
        <p className="text-xs text-zinc-600">
          PR4g.3 will wire the submit action. Clicking Crear borrador ahora solo valida el
          formulario.
        </p>
        <button
          type="submit"
          className="rounded-lg bg-rose-900 px-4 py-2.5 font-semibold text-white transition-opacity hover:bg-rose-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700"
        >
          Crear borrador
        </button>
      </form>
    </section>
  );
}
