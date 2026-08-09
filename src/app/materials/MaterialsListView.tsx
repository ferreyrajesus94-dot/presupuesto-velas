"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { updateMaterialAction } from "@/server/actions/materials";
import { formatArsDecimalDisplay, formatDecimalDisplay } from "@/lib/moneyFormat";
import { dimensionLabel, unitLabel, unitSingularLabel } from "@/lib/unitLabels";
import { MaterialArchiveControl } from "./MaterialArchiveControl";
import type { MaterialListItem } from "./MaterialsList";

/**
 * Editable compact list view for /materials. The cards mode (the
 * default) inlines the full edit form for every material, which
 * burns ~600px of vertical space per material on mobile. The
 * list mode is a compact table where each row is a sub-form
 * with inline inputs for the most-edited fields (name, purchase
 * quantity, purchase price) and a "Guardar" button — the
 * uncommonly-changed fields (dimension, base unit, purchase unit)
 * ride along as hidden inputs so the existing `updateMaterialAction`
 * Server Action handles the round-trip.
 *
 * Layout: a 12-column CSS grid. Desktop (≥md) maps to the 8-column
 * table feel (Insumo / Dimensión / Compra / Cant. / Precio / Costo
 * unitario / Estado / Acción). Mobile (<md) collapses the 8
 * columns into a stacked card so the inputs are reachable with
 * the thumb and the long unit label never clips the viewport.
 */
// 7 columns on ≥md: name (with status pill inline) | dimension | unit
// | qty | price | cost | action. Estado used to take its own column
// but the "ACTIVO" / "Archivado" pill clipped the Guardar button
// when both were tight; folding the pill into the name cell gives
// the action column enough room for both buttons. The action
// column is the widest fixed track so the "Guardar" label fits.
const GRID_COLS =
  "md:grid-cols-[minmax(9rem,1.4fr)_minmax(4rem,0.45fr)_minmax(4rem,0.45fr)_minmax(4.5rem,0.55fr)_minmax(5rem,0.6fr)_minmax(6.5rem,0.7fr)_minmax(10rem,1.1fr)]";

export function MaterialsListView({ materials }: { materials: MaterialListItem[] }) {
  if (materials.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border-subtle bg-surface p-6 text-sm text-ink-muted">
        No hay materiales para mostrar en este modo.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {materials.map((material) => (
        <MaterialListRow key={material.id} material={material} />
      ))}
    </div>
  );
}

function MaterialListRow({ material }: { material: MaterialListItem }) {
  const router = useRouter();
  const [state, formAction] = useActionState(updateMaterialAction, { status: "idle" });
  const formRef = useRef<HTMLFormElement | null>(null);
  const statusRef = useRef<HTMLSpanElement | null>(null);
  const pendingRef = useRef<boolean>(false);

  // After a successful save, reset the form to the latest server
  // values (so the unsaved-changes dot clears) and refresh the
  // page so the unit cost + anywhere else the data is rendered
  // reflects the new value. The action returns a state with
  // `status: "success"` and the material id; we ignore the rest.
  useEffect(() => {
    if (state.status === "success" && formRef.current) {
      formRef.current.reset();
      router.refresh();
    }
  }, [state, router]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className={`grid grid-cols-1 gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm md:gap-2 md:p-2 ${GRID_COLS}`}
    >
      {/*
       * Hidden inputs preserve the orthogonal fields the user can't
       * edit from this row (dimension + the two unit keys) so the
       * existing `updateMaterialAction` schema validation passes
       * without us re-implementing a row-level form schema.
       */}
      <input type="hidden" name="id" value={material.id} />
      <input type="hidden" name="dimension" value={material.dimension} />
      <input type="hidden" name="baseUnit" value={material.baseUnit} />
      <input type="hidden" name="purchaseUnit" value={material.purchaseUnit} />

      {/* Insumo (name) — spans all columns on mobile, col 1 on desktop.
          On ≥md the status pill sits next to the name input so the
          Estado column isn't needed and the action column can
          breathe (the previous layout clipped the "ACTIVO" pill and
          the "Guardar" button when both were tight columns). */}
      <label className="md:col-span-1 md:row-start-1 flex flex-col gap-1">
        <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-muted md:sr-only">
          Insumo
        </span>
        <div className="flex items-center gap-2">
          <input
            name="name"
            defaultValue={material.name}
            required
            aria-invalid={Boolean(state.fieldErrors?.name)}
            className="min-h-11 w-full min-w-0 rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-sm font-semibold text-ink focus:border-brand focus:outline-none"
          />
          {material.archived ? (
            <span
              data-testid="archived-badge"
              aria-label={`${material.name} está archivado`}
              className="inline-flex shrink-0 min-h-7 items-center rounded-full bg-surface px-2 text-[0.65rem] font-semibold uppercase tracking-wide text-ink-muted"
            >
              Archivado
            </span>
          ) : (
            <span className="hidden md:inline-flex shrink-0 min-h-7 items-center rounded-full bg-status-success/15 px-2.5 text-xs font-semibold uppercase tracking-wide text-status-success">
              Activo
            </span>
          )}
        </div>
        {state.fieldErrors?.name?.[0] ? (
          <span className="text-xs text-status-danger">{state.fieldErrors.name[0]}</span>
        ) : null}
      </label>

      {/* Dimensión — desktop only, read-only display */}
      <div className="hidden md:flex md:col-start-2 md:row-start-1 md:items-center md:px-3 md:text-sm md:text-ink-muted">
        {dimensionLabel(material.dimension)}
      </div>

      {/* Compra (unit) — desktop only */}
      <div className="hidden md:flex md:col-start-3 md:row-start-1 md:items-center md:px-3 md:text-sm md:text-ink-muted">
        {unitLabel(material.purchaseUnit)}
      </div>

      {/*
       * Cant. + Precio sit side-by-side on mobile (grid-cols-2) so the
       * row doesn't blow up vertically; on ≥md each label takes its
       * own grid column (col-start-4 / col-start-5) and the
       * `flex flex-col` reverts to the original full-width single-
       * column stack.
       */}
      <div className="grid grid-cols-2 gap-2 md:col-span-1 md:col-start-4 md:row-start-1 md:grid-cols-1">
        <label className="flex flex-col gap-1">
          <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-muted md:sr-only">
            Cantidad
          </span>
          <input
            name="purchaseQuantity"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            defaultValue={formatDecimalInputValue(material.purchaseQuantity)}
            required
            aria-label="Cantidad de compra"
            aria-invalid={Boolean(state.fieldErrors?.purchaseQuantity)}
            className="min-h-11 w-full min-w-0 rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-right text-sm tabular-nums text-ink focus:border-brand focus:outline-none"
          />
          {state.fieldErrors?.purchaseQuantity?.[0] ? (
            <span className="text-xs text-status-danger">{state.fieldErrors.purchaseQuantity[0]}</span>
          ) : null}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-muted md:sr-only">
            Precio (ARS)
          </span>
          <input
            name="purchasePrice"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            defaultValue={formatDecimalInputValue(material.purchasePrice)}
            required
            aria-label="Precio de compra"
            aria-invalid={Boolean(state.fieldErrors?.purchasePrice)}
            className="min-h-11 w-full min-w-0 rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-right text-sm tabular-nums text-ink focus:border-brand focus:outline-none"
          />
          {state.fieldErrors?.purchasePrice?.[0] ? (
            <span className="text-xs text-status-danger">{state.fieldErrors.purchasePrice[0]}</span>
          ) : null}
        </label>
      </div>

      {/* Costo unitario — read-only derived value, big on the right */}
      <div className="md:col-start-6 md:row-start-1 flex flex-row items-center justify-between gap-2 md:flex-col md:items-end md:justify-center md:gap-0 md:text-right">
        <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-muted md:sr-only">
          Costo unitario
        </span>
        <div className="flex flex-col items-end gap-0 leading-tight">
          <span className="text-base font-semibold tabular-nums text-ink md:text-base">
            {formatArsDecimalDisplay(material.unitCost)}
          </span>
          <span className="text-[0.7rem] font-normal text-ink-muted">
            por {unitSingularLabel(material.baseUnit)}
          </span>
        </div>
      </div>

      {/* Acción — Guardar + Archivar */}
      <div className="flex items-center justify-end gap-2 md:col-start-7 md:row-start-1 md:px-3">
        <SubmitButton />
        <MaterialArchiveControl
          material={{
            id: material.id,
            name: material.name,
            archived: material.archived,
          }}
        />
      </div>
    </form>
  );
}

function SubmitButton() {
  // useFormStatus reads the parent <form>'s pending state without
  // re-rendering the whole row. The submit button disables itself
  // and shows a "Guardando…" label while the action is in flight.
  const status = useFormStatus();
  const pending = status.pending;
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center rounded-md bg-brand px-3 text-sm font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Guardando…" : "Guardar"}
    </button>
  );
}

/**
 * Strip trailing zeros from a decimal string the DB returns (e.g.
 * "3.0000000000" → "3") so the number input shows a clean default
 * value the user can edit without the cursor landing on a zero.
 * Falls back to the raw string for non-canonical inputs.
 */
function formatDecimalInputValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (!trimmed.includes(".")) return trimmed;
  return trimmed.replace(/\.?0+$/, "");
}
