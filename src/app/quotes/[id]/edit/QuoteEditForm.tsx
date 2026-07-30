"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { quoteDraftInputSchema } from "@/server/validation/quoteSchema";
import { appendQuoteVersionAction } from "@/server/actions/quotes";
import { deleteQuoteDraftAction } from "@/server/actions/quotes-delete";
import type { QuoteRecord } from "@/server/repositories/quotes";
import type { Recipe } from "@/server/repositories/recipes";
import { ModelLineEditor } from "@/app/quotes/new/ModelLineEditor";
import { IndirectCostEditor } from "@/app/quotes/new/IndirectCostEditor";
import { QuoteVisibilityToggles } from "@/app/quotes/new/QuoteVisibilityToggles";

const controlClass = "rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-ink";

const formSchema = quoteDraftInputSchema;
export type QuoteEditFormValues = z.input<typeof formSchema>;

/**
 * PR4h — Edit form. Pre-fills an existing draft quote's snapshot and
 * submits a new version via `appendQuoteVersionAction`. The "Eliminar
 * borrador" button calls `deleteQuoteDraftAction` and pushes back to
 * `/quotes`. Non-draft status is rejected at the page loader level.
 */
export default function QuoteEditForm({
  quote,
  recipes,
}: {
  quote: QuoteRecord;
  recipes: readonly Recipe[];
}) {
  const sortedRecipes = useMemo(
    () => [...recipes].sort((a, b) => a.name.localeCompare(b.name)),
    [recipes],
  );
  const version = quote.versions.find(({ versionNo }) => versionNo === quote.quote.currentVersion);
  const models = quote.models.filter((row) => row.versionNo === quote.quote.currentVersion);
  const indirects = quote.indirectCosts.filter(
    (row) => row.versionNo === quote.quote.currentVersion,
  );

  const initialProfit: QuoteEditFormValues["profit"] =
    version?.profitMethod === "fixed"
      ? { mode: "fixed", amount: version.profitValue }
      : { mode: "percentage", percent: version?.profitValue ?? "0" };

  const initial: QuoteEditFormValues = {
    expirationDate: quote.quote.expirationDate,
    profit: initialProfit,
    depositPercent: version?.depositPercent ?? "0",
    indirectCosts: indirects.map((ic) => ({ name: ic.name, amount: ic.amount })),
    models: models.map((m) => ({
      recipeId: m.recipeId,
      quantity: m.quantity,
    })),
    visibility: {
      internalCost: version?.visibilityInternal ?? true,
      profitMargin: version?.visibilityProfit ?? true,
    },
  };

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<QuoteEditFormValues>({
    resolver: zodResolver(formSchema, undefined, { mode: "sync" }),
    defaultValues: initial,
  });

  const modelsFieldArray = useFieldArray({ control, name: "models" });
  const indirectsFieldArray = useFieldArray({ control, name: "indirectCosts" });
  const profitMode = initialProfit.mode;

  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const recipeById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);

  const onSubmit = (data: QuoteEditFormValues): void => {
    setSubmitError(null);
    startTransition(async () => {
      const enrichedModels = data.models.map((m) => {
        const recipe = recipeById.get(m.recipeId);
        return {
          recipeId: m.recipeId,
          quantity: m.quantity,
          perUnitCostDecimal: recipe?.unitCost ?? "0",
        };
      });
      const result = await appendQuoteVersionAction(
        quote.quote.id,
        { ...data, models: enrichedModels },
        quote.quote.lockVersion,
      );
      if (!result.ok) {
        setSubmitError("No se pudo actualizar la cotización.");
        return;
      }
      router.push(`/quotes/${quote.quote.id}`);
    });
  };

  async function onDelete() {
    if (deletePending) return;
    if (!confirm("¿Eliminar este borrador? Esta acción no se puede deshacer.")) return;
    setDeletePending(true);
    setSubmitError(null);
    const result = await deleteQuoteDraftAction(quote.quote.id);
    setDeletePending(false);
    if (result.ok) {
      router.push("/quotes");
      return;
    }
    setSubmitError("No se pudo eliminar el borrador.");
  }

  const modelErrors = errors.models as
    | Array<{ recipeId?: { message?: string }; quantity?: { message?: string } } | undefined>
    | undefined;
  const indirectErrors = errors.indirectCosts as
    Array<{ name?: { message?: string }; amount?: { message?: string } } | undefined> | undefined;

  return (
    <section
      aria-label="Editar cotización"
      className="rounded-2xl border border-border-subtle bg-surface-raised p-5 shadow-sm sm:p-6"
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        autoComplete="off"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="quote-customer" className="font-medium text-ink">
            Cliente
          </label>
          <input
            id="quote-customer"
            type="text"
            maxLength={50}
            placeholder="Opcional"
            defaultValue={quote.quote.customerName ?? ""}
            {...register("customerName" as keyof QuoteEditFormValues)}
            className={controlClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="quote-expiration" className="font-medium text-ink">
            Vencimiento
          </label>
          <input
            id="quote-expiration"
            type="date"
            aria-invalid={Boolean(errors.expirationDate)}
            {...register("expirationDate")}
            className={controlClass}
          />
        </div>
        <ModelLineEditor
          control={control}
          recipes={sortedRecipes}
          fieldArray={modelsFieldArray}
          onAppend={() => modelsFieldArray.append({ recipeId: "", quantity: "1" })}
          errorBag={modelErrors}
        />
        <fieldset className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface-soft p-4">
          <legend className="px-1 font-medium text-ink">Ganancia</legend>
          <Controller
            name="profit.mode"
            control={control}
            render={({ field }) => (
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-ink">
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
                <label className="flex items-center gap-2 text-ink">
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
              <label htmlFor="quote-profit-percent" className="font-medium text-ink">
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
              <label htmlFor="quote-profit-amount" className="font-medium text-ink">
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
        <IndirectCostEditor
          control={control}
          fieldArray={indirectsFieldArray}
          errorBag={indirectErrors}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="quote-deposit-percent" className="font-medium text-ink">
            Porcentaje de seña (%)
          </label>
          <input
            id="quote-deposit-percent"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            {...register("depositPercent")}
            className={controlClass}
          />
        </div>
        <QuoteVisibilityToggles register={register} />
        <div role="status" aria-live="polite" className="text-sm text-status-danger">
          {submitError ? submitError : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-brand px-4 py-2.5 font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            {isPending ? "Guardando..." : "Guardar cambios"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deletePending}
            className="rounded-md border border-border-subtle bg-surface-raised px-4 py-2.5 font-semibold text-brand disabled:opacity-60"
          >
            {deletePending ? "Eliminando..." : "Eliminar borrador"}
          </button>
        </div>
      </form>
    </section>
  );
}
