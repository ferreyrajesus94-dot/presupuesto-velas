"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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

  // PR4.5 — bulk discount (per-task spec: useState, inline editable, live
  // recalculation). The discount is local to the calculator; persistence
  // into the saved quote is wired in PR4.7. Each line receives the discount
  // when its quantity meets the threshold (default 10 units, configurable).
  const [bulkEnabled, setBulkEnabled] = useState(false);
  const [bulkDiscountPct, setBulkDiscountPct] = useState("20");
  const [bulkMinQty, setBulkMinQty] = useState("10");

  const bulkDiscount = useMemo(() => {
    if (!bulkEnabled) return { applied: new Decimal(0), perLine: [] as Decimal[] };
    let pct: Decimal;
    try {
      pct = new Decimal(bulkDiscountPct || "0");
      if (pct.isNaN() || pct.isNegative()) pct = new Decimal(0);
      if (pct.greaterThan(100)) pct = new Decimal(100);
    } catch {
      pct = new Decimal(0);
    }
    let minQty: number;
    try {
      minQty = Math.max(1, Math.floor(Number(bulkMinQty)));
      if (!Number.isFinite(minQty) || minQty < 1) minQty = 1;
    } catch {
      minQty = 1;
    }
    const discountFactor = pct.div(100);
    const perLine: Decimal[] = [];
    let applied = new Decimal(0);
    for (const m of watchedModels) {
      const template = m.recipeId ? templateById.get(m.recipeId) : undefined;
      if (!template) {
        perLine.push(new Decimal(0));
        continue;
      }
      const lineTotal = computeLineTotal(template.unitCost, m.quantity);
      if (lineTotal === null) {
        perLine.push(new Decimal(0));
        continue;
      }
      // Threshold gate: per-task spec — discount applies only when quantity
      // meets the configured minimum.
      const qtyRaw = m.quantity;
      let qty = 0;
      try {
        qty = Number(qtyRaw);
        if (!Number.isFinite(qty) || qty <= 0) qty = 0;
      } catch {
        qty = 0;
      }
      const lineApplied =
        qty >= minQty ? new Decimal(lineTotal).mul(discountFactor) : new Decimal(0);
      perLine.push(lineApplied);
      applied = applied.add(lineApplied);
    }
    return { applied, perLine };
  }, [bulkEnabled, bulkDiscountPct, bulkMinQty, watchedModels, templateById]);

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

  const materialsTotalAfterDiscount = useMemo(
    () => Decimal.max(new Decimal(0), materialsTotal.sub(bulkDiscount.applied)),
    [materialsTotal, bulkDiscount.applied],
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
        return materialsTotalAfterDiscount.add(indirectTotal)
          .mul(new Decimal(percent))
          .div(100);
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
  }, [profitMode, watchedProfit, materialsTotalAfterDiscount, indirectTotal]);

  const total = useMemo(
    () => materialsTotalAfterDiscount.add(indirectTotal).add(profitTotal),
    [materialsTotalAfterDiscount, indirectTotal, profitTotal],
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
      data-tour-target="calculator"
       className="rounded-2xl border border-border bg-surface p-6 shadow sm:p-8"
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
        {sortedTemplates.length === 0 ? (
          <section
            aria-labelledby="empty-templates-hint"
            className="flex flex-col gap-3 rounded-xl border border-dashed border-border-subtle bg-surface-soft p-4"
          >
            <h2 id="empty-templates-hint" className="text-base font-semibold text-ink text-wrap-balance">
              🕯️ Primero creá una plantilla
            </h2>
            <p className="text-sm text-ink-muted">
              Una cotización necesita al menos un modelo con sus materiales y costos para calcular
              el precio. Cuando termines la plantilla, volvé acá para armar la cotización.
            </p>
            <a
              href="/templates"
              className="mt-1 inline-flex min-h-11 w-fit items-center rounded-md bg-brand px-4 text-sm font-semibold text-on-brand"
            >
              + Ir a Plantillas
            </a>
          </section>
        ) : null}
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
        <BulkDiscountEditor
          enabled={bulkEnabled}
          onToggle={setBulkEnabled}
          percent={bulkDiscountPct}
          onPercentChange={setBulkDiscountPct}
          minQty={bulkMinQty}
          onMinQtyChange={setBulkMinQty}
        />
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
          {bulkDiscount.applied.greaterThan(0) ? (
            <p className="text-status-success">
              Descuento por mayoreo: −
              <span className="font-semibold" data-testid="bulk-discount-amount">
                {formatArsFromDecimalString(bulkDiscount.applied.toString())}
              </span>
            </p>
          ) : null}
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

/**
 * PR4.5 — inline bulk-discount editor.
 *
 * The discount inputs live in React state (`useState` in the parent) and
 * recompute the calculator's totals on every change. Per the
 * `calculator-with-template` and `quotes-delta` specs:
 *  - Both inputs accept decimal values.
 *  - Reject negative or non-numeric input by ignoring the event (the
 *    previous valid value remains active).
 *  - The discount applies only to lines whose quantity meets the threshold.
 *  - aria-describedby points each input at its accessible description.
 */
function BulkDiscountEditor({
  enabled,
  onToggle,
  percent,
  onPercentChange,
  minQty,
  onMinQtyChange,
}: {
  enabled: boolean;
  onToggle: (next: boolean) => void;
  percent: string;
  onPercentChange: (next: string) => void;
  minQty: string;
  onMinQtyChange: (next: string) => void;
}) {
  // Track the last valid value in a ref so we can recover when the user
  // clears the field and then types something invalid. Without this, the
  // closure-captured `percent` would be empty after clear, defeating the
  // "preserve previous valid value" contract.
  const lastValidPercent = useRef(percent);
  const lastValidMinQty = useRef(minQty);
  useEffect(() => {
    if (percent !== "") lastValidPercent.current = percent;
  }, [percent]);
  useEffect(() => {
    if (minQty !== "") lastValidMinQty.current = minQty;
  }, [minQty]);

  // Filter percent values: allow empty (cleared), digits + at most one dot,
  // reject negatives. Anything outside that set is dropped silently so the
  // previous valid value remains.
  function sanitizePercent(raw: string): string {
    if (raw === "") return raw;
    if (!/^\d{0,3}(\.\d{0,2})?$/.test(raw)) return lastValidPercent.current;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) return lastValidPercent.current;
    return raw;
  }
  function sanitizeMinQty(raw: string): string {
    if (raw === "") return raw;
    if (!/^\d{0,9}$/.test(raw)) return lastValidMinQty.current;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1 || n > 1_000_000) return lastValidMinQty.current;
    return raw;
  }
  return (
    <fieldset
      aria-label="Descuento por mayoreo"
      className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface-soft p-4"
    >
      <legend className="px-1 font-medium text-ink">Descuento por mayoreo</legend>
      <label className="flex items-center gap-2 text-ink">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          aria-describedby="bulk-discount-hint"
          data-testid="bulk-discount-toggle"
        />
        <span>Activar descuento por mayoreo</span>
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="bulk-discount-percent" className="font-medium text-ink">
            Descuento %
          </label>
          <input
            id="bulk-discount-percent"
            type="number"
            inputMode="decimal"
            min="0"
            max="100"
            step="any"
            value={percent}
            disabled={!enabled}
            onChange={(e) => onPercentChange(sanitizePercent(e.target.value))}
            aria-describedby="bulk-discount-percent-hint"
            data-testid="bulk-discount-percent"
            className={controlClass}
          />
          <p id="bulk-discount-percent-hint" className="text-xs text-ink-muted">
            Porcentaje que se descuenta del subtotal.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="bulk-discount-min-qty" className="font-medium text-ink">
            Aplica desde N u.
          </label>
          <input
            id="bulk-discount-min-qty"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={minQty}
            disabled={!enabled}
            onChange={(e) => onMinQtyChange(sanitizeMinQty(e.target.value))}
            aria-describedby="bulk-discount-min-qty-hint"
            data-testid="bulk-discount-min-qty"
            className={controlClass}
          />
          <p id="bulk-discount-min-qty-hint" className="text-xs text-ink-muted">
            Cantidad mínima por línea para activar el descuento.
          </p>
        </div>
      </div>
      <p id="bulk-discount-hint" className="text-xs text-ink-muted">
        Consejo: el descuento se aplica a las líneas que igualen o superen el mínimo.
      </p>
    </fieldset>
  );
}
