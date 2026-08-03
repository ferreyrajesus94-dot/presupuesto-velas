"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Decimal from "decimal.js";
import {
  DEFAULT_EXPIRATION_DAYS,
  DEFAULT_INDIRECT_COST_NAMES,
  DEFAULT_PROFIT_MODE,
  DEFAULT_PROFIT_PERCENT,
  DEFAULT_QUOTE_DEPOSIT_PERCENT,
  DEFAULT_VISIBILITY,
} from "@/domain/quoteDefaults";
import { suggestDepositPercent } from "@/domain/quoteDepositSuggestion";
import { formatArsFromDecimalString } from "@/lib/moneyFormat";
import { quoteDraftInputSchema } from "@/server/validation/quoteSchema";
import { createQuoteDraftAction, appendQuoteVersionAction } from "@/server/actions/quotes";
import type { Template } from "@/server/repositories/templates";
import { ModelLineEditor, computeLineTotal } from "./ModelLineEditor";
import { QuoteVisibilityToggles } from "./QuoteVisibilityToggles";
import { IndirectCostEditor } from "./IndirectCostEditor";

const controlClass = "rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-ink";

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
const defaultIndirectCosts = DEFAULT_INDIRECT_COST_NAMES.map((name) => ({
  name,
  amount: "0",
}));

export function QuoteCreateForm({ templates }: { templates: readonly Template[] }) {
  const sortedTemplates = useMemo(
    () => [...templates].sort((a, b) => a.name.localeCompare(b.name)),
    [templates],
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
      indirectCosts: defaultIndirectCosts,
      models: [blankModel()],
      visibility: { ...DEFAULT_VISIBILITY },
    },
  });
  const modelsFieldArray = useFieldArray({ control, name: "models" });
  const indirectsFieldArray = useFieldArray({ control, name: "indirectCosts" });
  const profitMode = useWatch({ control, name: "profit.mode" }) ?? DEFAULT_PROFIT_MODE;

  // PR4g.3 — derived totals (Decimal.js, no `Number()` on money).
  // Stable empty arrays so `useMemo` deps don't churn on every render —
  // `useWatch` returns a fresh array on each render if the underlying value
  // is an array, which would invalidate the memo below.
  const EMPTY_MODELS: ReadonlyArray<never> = [];
  const EMPTY_INDIRECTS: ReadonlyArray<never> = [];
  const watchedModels = useWatch({ control, name: "models" }) ?? EMPTY_MODELS;
  const watchedIndirects = useWatch({ control, name: "indirectCosts" }) ?? EMPTY_INDIRECTS;
  const watchedProfit = useWatch({ control, name: "profit" });
  const watchedDepositPercent =
    useWatch({ control, name: "depositPercent" }) ?? DEFAULT_QUOTE_DEPOSIT_PERCENT;
  const templateById = useMemo(() => new Map(templates.map((r) => [r.id, r])), [templates]);

  const materialsTotal = useMemo(
    () =>
      watchedModels.reduce((acc, m) => {
        const template = m.recipeId ? templateById.get(m.recipeId) : undefined;
        if (!template) return acc;
        const lineTotal = computeLineTotal(template.unitCost, m.quantity);
        if (lineTotal === null) return acc;
        return acc.add(lineTotal);
      }, new Decimal(0)),
    [watchedModels, templateById],
  );

  const indirectTotal = useMemo(
    () =>
      watchedIndirects.reduce((acc, ic) => {
        try {
          const amount = new Decimal(ic.amount ?? "0");
          if (amount.isNegative()) return acc;
          return acc.add(amount);
        } catch {
          return acc;
        }
      }, new Decimal(0)),
    [watchedIndirects],
  );

  const profitTotal = useMemo(() => {
    if (profitMode === "percentage") {
      const percent =
        watchedProfit?.mode === "percentage" ? watchedProfit.percent : DEFAULT_PROFIT_PERCENT;
      try {
        return materialsTotal.add(indirectTotal).mul(new Decimal(percent)).div(100);
      } catch {
        return new Decimal(0);
      }
    }
    const amount = watchedProfit?.mode === "fixed" ? watchedProfit.amount : "0";
    try {
      return new Decimal(amount);
    } catch {
      return new Decimal(0);
    }
  }, [profitMode, watchedProfit, materialsTotal, indirectTotal]);

  const total = useMemo(
    () => materialsTotal.add(indirectTotal).add(profitTotal),
    [materialsTotal, indirectTotal, profitTotal],
  );

  const suggestedPercent = useMemo(() => {
    try {
      return suggestDepositPercent(
        materialsTotal.toString(),
        indirectTotal.toString(),
        profitTotal.toString(),
      );
    } catch {
      return "0";
    }
  }, [materialsTotal, indirectTotal, profitTotal]);

  const depositAmount = useMemo(() => {
    try {
      return total.mul(new Decimal(watchedDepositPercent)).div(100);
    } catch {
      return new Decimal(0);
    }
  }, [total, watchedDepositPercent]);

  // PR4g.3 — submit wiring (createQuoteDraftAction → appendQuoteVersionAction → router.push).
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = (data: QuoteDraftFormValues): void => {
    setSubmitError(null);
    startTransition(async () => {
      const draft = await createQuoteDraftAction(data);
      if (!draft.ok) {
        setSubmitError("No se pudo crear la cotización.");
        return;
      }
      const quoteId = draft.value.quote.id;
      const lockVersion = draft.value.quote.lockVersion;
      // Inject each model's `perUnitCostDecimal` from the templates catalog.
      const enrichedModels = data.models.map((m) => {
        const template = templateById.get(m.recipeId);
        return {
          recipeId: m.recipeId,
          quantity: m.quantity,
          perUnitCostDecimal: template?.unitCost ?? "0",
        };
      });
      const version = await appendQuoteVersionAction(
        quoteId,
        { ...data, models: enrichedModels },
        lockVersion,
      );
      if (!version.ok) {
        setSubmitError("No se pudo crear la cotización.");
        return;
      }
      router.push(`/quotes/${quoteId}`);
    });
  };

  const expirationError = errors.expirationDate?.message;
  const rawModelErrors = errors.models as
    | Array<{ recipeId?: { message?: string }; quantity?: { message?: string } } | undefined>
    | undefined;
  const rawIndirectErrors = errors.indirectCosts as
    Array<{ name?: { message?: string }; amount?: { message?: string } } | undefined> | undefined;
  // Translate raw Zod field errors into direct Spanish fallbacks.
  const modelErrors = rawModelErrors?.map((row) => ({
    recipeId: row?.recipeId?.message ? { message: "Seleccioná un modelo." } : undefined,
    quantity: row?.quantity?.message ? { message: "La cantidad debe ser mayor que 0." } : undefined,
  }));
  const indirectErrors = rawIndirectErrors?.map((row) => ({
    name: row?.name?.message ? { message: "Ingresá un nombre para el costo." } : undefined,
    amount: row?.amount?.message ? { message: "Ingresá un monto válido." } : undefined,
  }));

  return (
    <section
      id="new-quote"
      aria-label="Nueva cotización"
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
            aria-describedby="quote-customer-hint"
            {...register("customerName" as keyof QuoteDraftFormValues)}
            className={controlClass}
          />
          <p id="quote-customer-hint" className="text-xs text-ink-muted">
            Opcional, hasta 50 caracteres.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="quote-expiration" className="font-medium text-ink">
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
            <p id="quote-expiration-error" role="alert" className="text-sm text-status-danger">
              {expirationError}
            </p>
          ) : null}
        </div>
        <ModelLineEditor
          control={control}
          templates={sortedTemplates}
          fieldArray={modelsFieldArray}
          onAppend={() => modelsFieldArray.append(blankModel())}
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
        <section
          aria-label="Totales"
          className="flex flex-col gap-1 rounded-xl border border-border-subtle bg-surface-soft p-4 text-sm"
        >
          <h3 className="font-medium text-ink">Totales</h3>
          <p>
            Materiales:{" "}
            <span className="font-semibold text-ink" data-testid="materials-total">
              {formatArsFromDecimalString(materialsTotal.toString())}
            </span>
          </p>
          <p>
            Indirectos:{" "}
            <span className="font-semibold text-ink" data-testid="grand-indirect-total">
              {formatArsFromDecimalString(indirectTotal.toString())}
            </span>
          </p>
          <p>
            Ganancia:{" "}
            <span className="font-semibold text-ink" data-testid="profit-total">
              {formatArsFromDecimalString(profitTotal.toString())}
            </span>
          </p>
          <p>
            Total:{" "}
            <span className="font-semibold text-ink" data-testid="grand-total">
              {formatArsFromDecimalString(total.toString())}
            </span>
          </p>
        </section>
        <fieldset className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface-soft p-4">
          <legend className="px-1 font-medium text-ink">Seña</legend>
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
          <p className="text-sm text-ink-muted">
            Sugerencia para cubrir materiales:{" "}
            <span className="font-semibold text-ink" data-testid="suggested-percent">
              {suggestedPercent}%
            </span>{" "}
            <span className="text-xs text-ink-muted">
              ({formatArsFromDecimalString(depositAmount.toString())} con el porcentaje actual)
            </span>
          </p>
          <button
            type="button"
            onClick={() => setValue("depositPercent", suggestedPercent, { shouldDirty: true })}
            className="self-start font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:text-ink"
          >
            Aplicar sugerencia
          </button>
        </fieldset>
        <QuoteVisibilityToggles register={register} />
        <div role="status" aria-live="polite" className="text-sm text-status-danger">
          {submitError ? submitError : null}
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-brand px-4 py-2.5 font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {isPending ? "Creando..." : "Crear borrador"}
        </button>
      </form>
    </section>
  );
}
