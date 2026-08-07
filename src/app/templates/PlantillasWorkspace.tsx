"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { calcTemplateSummary } from "@/domain/templateSummary";
import { formatArsDecimalDisplay, formatDecimalInput } from "@/lib/moneyFormat";
import { unitSingularLabel } from "@/lib/unitLabels";
import {
  createBlankTemplateAction,
  deleteTemplateAction,
  saveTemplateAction,
} from "@/server/actions/templates";
import type {
  PlantillaClientItem,
  PlantillaClientMaterial,
  PlantillaClientTemplate,
} from "./types";

/**
 * PR4.7 + save flow — state-driven plantillas workspace.
 *
 * Holds the `state.templates` array as the single source of truth for the
 * rendered list. Exposes `createTemplate`, `duplicateTemplate`, `deleteTemplate`
 * and `saveTemplate` actions that mutate the array in place so the rendered
 * list, the per-template summary, and the empty state all derive from a
 * single client-side state.
 *
 * The Server Component still preloads the initial template catalog; this
 * Client Component takes over rendering from the moment it's mounted. The
 * existing server-action–backed archive control is preserved so the
 * lifecycle story (archive/restore) is unchanged.
 *
 * Shared types and the `toClientTemplate` helper live in `./types` so Server
 * Components can import them without crossing the `"use client"` boundary.
 */

const ARCHIVED_TEMPLATE_KEY_PREFIX = "plantilla-archived-";
const LOCAL_TEMPLATE_KEY_PREFIX = "local-";

function isArchivedTemplateKey(id: string): boolean {
  return id.startsWith(ARCHIVED_TEMPLATE_KEY_PREFIX);
}

function isLocalPlaceholderId(id: string): boolean {
  return id.startsWith(LOCAL_TEMPLATE_KEY_PREFIX);
}

// Projection of a template's persisted fields used for the dirty comparison.
// We deliberately exclude the derived `name`/`unit` per row (those are
// projections from `materialId`) so material swaps that also bump the unitCost
// still register dirty via the `materialId`+`quantity` pair plus the rolled-up
// unitCost in the persisted snapshot.
type TemplateSnapshot = {
  name: string;
  items: Array<{ id: string; materialId: string; quantity: string; unit: string }>;
  time: string;
  hourlyRate: string;
  overhead: string;
  marginPct: string;
  unitCost: string;
};

function toSnapshot(t: PlantillaClientTemplate): TemplateSnapshot {
  return {
    name: t.name,
    items: t.items.map((row) => ({
      id: row.id,
      materialId: row.materialId,
      quantity: row.quantity,
      unit: row.unit,
    })),
    time: t.time,
    hourlyRate: t.hourlyRate,
    overhead: t.overhead,
    marginPct: t.marginPct,
    unitCost: t.unitCost,
  };
}

function itemsEqual(a: TemplateSnapshot["items"], b: TemplateSnapshot["items"]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]!;
    const right = b[i]!;
    if (
      left.id !== right.id ||
      left.materialId !== right.materialId ||
      left.quantity !== right.quantity ||
      left.unit !== right.unit
    ) {
      return false;
    }
  }
  return true;
}

type SnapshotMap = Record<string, TemplateSnapshot>;

function snapshotsFromTemplates(templates: readonly PlantillaClientTemplate[]): SnapshotMap {
  const next: SnapshotMap = {};
  for (const t of templates) next[t.id] = toSnapshot(t);
  return next;
}

export function PlantillasWorkspace({
  initialTemplates,
  materials,
}: {
  initialTemplates: readonly PlantillaClientTemplate[];
  materials: readonly PlantillaClientMaterial[];
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState<PlantillaClientTemplate[]>(() =>
    [...initialTemplates].sort((a, b) => a.name.localeCompare(b.name)),
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const [, startTemplatesTransition] = useTransition();
  // Per-template save lock so two concurrent Guardar clicks on different
  // cards don't share a single busy flag. Set to true at the start of the
  // save transition and cleared when the transition settles.
  const [savingId, setSavingId] = useState<string | null>(null);
  // Holds the template we optimistically removed so we can restore it if the
  // Server Action rejects the delete (NOT_FOUND, auth redirect, etc.).
  const deletedRef = useRef<PlantillaClientTemplate | null>(null);
  // Snapshot of each template's persisted fields, kept in state so the
  // dirty comparison can read it during render. Seeded once from
  // `initialTemplates`; updated when initialTemplates change (e.g., after
  // router.refresh()) and again after each successful save.
  const [snapshots, setSnapshots] = useState<SnapshotMap>(() =>
    snapshotsFromTemplates(initialTemplates),
  );
  // Re-sync snapshots whenever the server-preloaded template list changes
  // (e.g., after router.refresh() pulled new state). Local-only placeholders
  // (id starts with `local-`) keep their snapshot untouched so pending
  // edits are not erased mid-render.
  useEffect(() => {
    const incoming = snapshotsFromTemplates(initialTemplates);
    setSnapshots((prev) => {
      const next: SnapshotMap = { ...prev, ...incoming };
      const incomingKeys = new Set(Object.keys(incoming));
      for (const key of Object.keys(next)) {
        if (!incomingKeys.has(key) && !isLocalPlaceholderId(key)) {
          delete next[key];
        }
      }
      return next;
    });
  }, [initialTemplates]);

  const createTemplate = useCallback(() => {
    const placeholderId = `${LOCAL_TEMPLATE_KEY_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const next: PlantillaClientTemplate = {
      id: placeholderId,
      name: "Nueva plantilla",
      unitCost: "0",
      archivedAt: null,
      items: [],
      time: "",
      hourlyRate: "",
      overhead: "",
      marginPct: "30",
    };
    setTemplates((prev) => [next, ...prev]);
    setActionError(null);

    const formData = new FormData();
    startTemplatesTransition(async () => {
      const result = await createBlankTemplateAction(formData);
      if (result.status === "success") {
        setTemplates((prev) =>
          prev.map((t) =>
            t.id === placeholderId ? { ...t, id: result.id, name: result.name } : t,
          ),
        );
      } else {
        // Roll back the optimistic prepend and surface a friendly message
        // so the user can retry or rename before clicking again.
        setTemplates((prev) => prev.filter((t) => t.id !== placeholderId));
        setSnapshots((prev) => {
          const { [placeholderId]: _removed, ...rest } = prev;
          void _removed;
          return rest;
        });
        setActionError(result.message);
      }
    });
  }, []);

  const duplicateTemplate = useCallback((sourceId: string) => {
    setTemplates((prev) => {
      const source = prev.find((t) => t.id === sourceId);
      if (!source) return prev;
      const id = `${LOCAL_TEMPLATE_KEY_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const copy: PlantillaClientTemplate = {
        ...source,
        id,
        name: `${source.name} (copia)`,
        // Cloned items get fresh client ids so the existing per-row identity
        // (key={row.id}) keeps working without cross-row leakage.
        items: source.items.map((row) => ({
          ...row,
          id: `row-${id}-${Math.random().toString(36).slice(2, 8)}`,
        })),
      };
      return [copy, ...prev];
    });
  }, []);

  const deleteTemplate = useCallback(
    (id: string) => {
      const target = templates.find((t) => t.id === id);
      if (!target) return;
      // Remember the row so we can restore it if the Server Action fails —
      // we never want the local state to drift away from the persisted row
      // when the network / DB rejected the mutation.
      deletedRef.current = target;
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      setSnapshots((prev) => {
        const { [id]: _removed, ...rest } = prev;
        void _removed;
        return rest;
      });
      setActionError(null);

      const formData = new FormData();
      formData.set("id", id);
      startTemplatesTransition(async () => {
        const result = await deleteTemplateAction(formData);
        const restored = deletedRef.current;
        deletedRef.current = null;
        if (result.status !== "success") {
          if (restored) {
            setTemplates((prev) =>
              prev.some((t) => t.id === restored.id) ? prev : [restored, ...prev],
            );
            setSnapshots((prev) => ({ ...prev, [restored.id]: toSnapshot(restored) }));
          }
          setActionError(result.message);
        }
      });
    },
    [templates],
  );

  const addMaterialToTemplate = useCallback(
    (templateId: string) => {
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === templateId
            ? {
                ...t,
                items: [
                  ...t.items,
                  {
                    id: `row-${templateId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    materialId: "",
                    quantity: "",
                    unit: materials[0]?.baseUnit ?? "g",
                    unitCost: "0",
                    name: "",
                  },
                ],
              }
            : t,
        ),
      );
    },
    [materials],
  );

  const updateItemInTemplate = useCallback(
    (templateId: string, rowId: string, patch: Partial<PlantillaClientItem>) => {
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === templateId
            ? {
                ...t,
                items: t.items.map((row) =>
                  row.id === rowId
                    ? (() => {
                        const next = { ...row, ...patch };
                        if (patch.materialId !== undefined) {
                          const mat = materials.find((m) => m.id === patch.materialId);
                          next.name = mat?.name ?? "";
                          next.unitCost = mat?.unitCost ?? "0";
                          if (mat?.baseUnit) next.unit = mat.baseUnit;
                        }
                        return next;
                      })()
                    : row,
                ),
              }
            : t,
        ),
      );
    },
    [materials],
  );

  const removeItemFromTemplate = useCallback((templateId: string, rowId: string) => {
    setTemplates((prev) =>
      prev.map((t) =>
        t.id === templateId ? { ...t, items: t.items.filter((row) => row.id !== rowId) } : t,
      ),
    );
  }, []);

  const updateTemplateMeta = useCallback(
    (
      templateId: string,
      patch: Partial<
        Pick<PlantillaClientTemplate, "name" | "time" | "hourlyRate" | "overhead" | "marginPct">
      >,
    ) => {
      setTemplates((prev) => prev.map((t) => (t.id === templateId ? { ...t, ...patch } : t)));
    },
    [],
  );

  const saveTemplate = useCallback(
    (id: string) => {
      const target = templates.find((t) => t.id === id);
      if (!target) return;
      const formData = new FormData();
      if (!isLocalPlaceholderId(id)) formData.set("id", id);
      formData.set("name", target.name);
      formData.set(
        "items",
        JSON.stringify(
          target.items.map((row) => ({
            materialId: row.materialId,
            quantity: row.quantity,
            unit: row.unit,
          })),
        ),
      );
      formData.set("time", target.time);
      formData.set("hourlyRate", target.hourlyRate);
      formData.set("overhead", target.overhead);
      formData.set("marginPct", target.marginPct);
      setSavingId(id);
      startSaveTransition(async () => {
        const result = await saveTemplateAction(formData);
        setSavingId(null);
        if (result.status === "success") {
          const persisted = result.template;
          setTemplates((prev) =>
            prev.map((t) =>
              t.id === id
                ? {
                    ...t,
                    id: persisted.id,
                    name: persisted.name,
                    unitCost: persisted.unitCost,
                    archivedAt: persisted.archivedAt,
                    time: persisted.time,
                    hourlyRate: persisted.hourlyRate,
                    overhead: persisted.overhead,
                    marginPct: persisted.marginPct,
                  }
                : t,
            ),
          );
          // Move the snapshot from the old id (placeholder) to the persisted
          // id so dirty flips back to false after the save.
          setSnapshots((prev) => {
            const next = { ...prev };
            if (persisted.id !== id) delete next[id];
            next[persisted.id] = toSnapshot({
              ...target,
              id: persisted.id,
              name: persisted.name,
              unitCost: persisted.unitCost,
              archivedAt: persisted.archivedAt,
              time: persisted.time,
              hourlyRate: persisted.hourlyRate,
              overhead: persisted.overhead,
              marginPct: persisted.marginPct,
            });
            return next;
          });
          setActionError(null);
          // Refresh the RSC payload so the next render sees the persisted
          // rows. router.refresh() also re-runs the page-level listTemplates
          // call and is safe under useTransition.
          router.refresh();
        } else {
          const fieldMessage =
            result.fieldErrors &&
            Object.entries(result.fieldErrors)
              .filter(([, list]) => list && list.length > 0)
              .map(([key, list]) => `${key}: ${(list as string[]).join(", ")}`)
              .join(" | ");
          setActionError(result.message ?? fieldMessage ?? "No se pudo guardar la plantilla.");
        }
      });
    },
    [router, templates],
  );

  const hasRows = templates.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">{templates.length} en tu lista</p>
        <button
          type="button"
          onClick={createTemplate}
          data-testid="plantilla-new"
          className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-on-brand hover:opacity-90"
        >
          Nueva plantilla
        </button>
      </div>
      {actionError ? (
        <p
          role="alert"
          aria-live="polite"
          data-testid="plantilla-action-error"
          className="rounded-md border border-status-danger/40 bg-surface-soft px-3 py-2 text-sm text-status-danger"
        >
          {actionError}
        </p>
      ) : null}
      {templates.length === 0 ? (
        <section
          aria-labelledby="empty-templates"
          className="flex flex-col gap-3 rounded-2xl border border-dashed border-border-subtle bg-surface-soft p-6"
        >
          <h2 id="empty-templates" className="text-xl font-semibold text-ink text-wrap-balance">
            ✨ Empezá creando tu primera plantilla
          </h2>
          <p className="text-sm text-ink-muted">
            Las plantillas combinan materiales y tiempos para calcular el costo de cada vela.
          </p>
          <button
            type="button"
            onClick={createTemplate}
            className="mt-2 inline-flex min-h-11 w-fit items-center rounded-md bg-brand px-4 text-sm font-semibold text-on-brand"
          >
            Nueva plantilla
          </button>
        </section>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Plantillas" data-has-rows={hasRows}>
          {templates.map((template) => {
            const snapshot = snapshots[template.id];
            const isPlaceholder = isLocalPlaceholderId(template.id);
            const itemsDirty =
              template.items.length > 0 &&
              (snapshot === undefined || !itemsEqual(snapshot.items, template.items));
            const dirty =
              isPlaceholder ||
              itemsDirty ||
              snapshot === undefined ||
              snapshot.name !== template.name ||
              snapshot.time !== template.time ||
              snapshot.hourlyRate !== template.hourlyRate ||
              snapshot.overhead !== template.overhead ||
              snapshot.marginPct !== template.marginPct ||
              snapshot.unitCost !== template.unitCost;
            const saving = savingId === template.id && isSaving;
            const canSave = dirty && template.items.length > 0 && !saving;
            return (
              <li
                key={template.id}
                data-testid="template-card"
                data-archived={isArchivedTemplateKey(template.id) || template.archivedAt !== null}
                className="group flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-surface p-6 shadow transition-transform pv-card-hover"
              >
                <PlantillaCardHeader
                  template={template}
                  onRename={(name) => updateTemplateMeta(template.id, { name })}
                  onDelete={() => {
                    if (
                      typeof window !== "undefined" &&
                      !window.confirm(`¿Eliminar ${template.name}?`)
                    ) {
                      return;
                    }
                    deleteTemplate(template.id);
                  }}
                  onDuplicate={() => duplicateTemplate(template.id)}
                />
                <PlantillaCardMaterials
                  template={template}
                  materials={materials}
                  onAddMaterial={() => addMaterialToTemplate(template.id)}
                  onUpdateItem={(rowId, patch) => updateItemInTemplate(template.id, rowId, patch)}
                  onRemoveItem={(rowId) => removeItemFromTemplate(template.id, rowId)}
                  onUpdateMeta={(patch) => updateTemplateMeta(template.id, patch)}
                />
                <PlantillaCardSummary template={template} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => saveTemplate(template.id)}
                    disabled={!canSave}
                    aria-disabled={!canSave}
                    aria-busy={saving}
                    data-testid="plantilla-save"
                    data-dirty={dirty ? "true" : "false"}
                    data-saving={saving ? "true" : "false"}
                    title={
                      template.items.length === 0
                        ? "Agregá al menos un material antes de guardar"
                        : !dirty
                          ? "Sin cambios para guardar"
                          : undefined
                    }
                    className="inline-flex min-h-11 items-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? (
                      <>
                        <span aria-hidden="true">⏳</span>
                        Guardando…
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true">💾</span>
                        Guardar
                      </>
                    )}
                  </button>
                  {template.items.length === 0 ? (
                    <p className="text-xs text-ink-muted">
                      Agregá al menos un material para guardar los cambios.
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PlantillaCardHeader({
  template,
  onRename,
  onDelete,
  onDuplicate,
}: {
  template: PlantillaClientTemplate;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(template.name);
  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <label htmlFor={`template-name-${template.id}`} className="sr-only">
          Nombre
        </label>
        <input
          id={`template-name-${template.id}`}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          className="flex-1 rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-ink"
        />
        <button
          type="button"
          onClick={() => {
            const trimmed = draftName.trim();
            const nextName = trimmed || template.name;
            onRename(nextName);
            setDraftName(nextName);
            setEditing(false);
          }}
          className="inline-flex min-h-11 items-center rounded-md bg-brand px-3 text-sm font-semibold text-on-brand"
        >
          Guardar
        </button>
        <button
          type="button"
          onClick={() => {
            setDraftName(template.name);
            setEditing(false);
          }}
          className="font-semibold text-brand underline underline-offset-4"
        >
          Cancelar
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="break-words font-semibold text-ink">
          <span aria-hidden="true">📋 </span>
          {template.name}
        </h3>
        <p className="mt-1 text-xs text-ink-muted">
          {template.items.length === 1 ? "1 elemento" : `${template.items.length} elementos`}
        </p>
      </div>
      <div className="gap-2 flex flex-wrap items-center justify-end">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Editar nombre de ${template.name}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border-subtle bg-surface-raised px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span aria-hidden="true">✏️</span>
          Editar nombre
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          data-testid="plantilla-duplicate"
          aria-label={`Crear una copia de ${template.name}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border-subtle bg-surface-raised px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span aria-hidden="true">⎘</span>
          Duplicar
        </button>
        <button
          type="button"
          onClick={onDelete}
          data-testid="plantilla-delete"
          aria-label={`Eliminar ${template.name}`}
          title={`Eliminar ${template.name}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border-subtle bg-surface-raised px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span aria-hidden="true">🗑️</span>
          Eliminar
        </button>
      </div>
    </div>
  );
}

function PlantillaCardMaterials({
  template,
  materials,
  onAddMaterial,
  onUpdateItem,
  onRemoveItem,
  onUpdateMeta,
}: {
  template: PlantillaClientTemplate;
  materials: readonly PlantillaClientMaterial[];
  onAddMaterial: () => void;
  onUpdateItem: (rowId: string, patch: Partial<PlantillaClientItem>) => void;
  onRemoveItem: (rowId: string) => void;
  onUpdateMeta: (
    patch: Partial<Pick<PlantillaClientTemplate, "time" | "hourlyRate" | "overhead" | "marginPct">>,
  ) => void;
}) {
  return (
    <section
      aria-label={`Materiales de ${template.name}`}
      className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface-soft p-3"
    >
      <h4 className="text-sm font-semibold text-ink-muted">Materiales</h4>
      <ol className="flex flex-col gap-2">
        {template.items.map((row) => (
          <li
            key={row.id}
            data-testid="plantilla-material-row"
            className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-surface-raised p-2"
          >
            <div className="flex items-center justify-between gap-2">
              <label className="sr-only" htmlFor={`material-${row.id}`}>
                Material
              </label>
              <select
                id={`material-${row.id}`}
                value={row.materialId}
                onChange={(e) => onUpdateItem(row.id, { materialId: e.target.value })}
                className="flex-1 rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-sm text-ink"
              >
                <option value="">Seleccioná un material</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onRemoveItem(row.id)}
                aria-label="Quitar material"
                title="Quitar material"
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 text-status-danger hover:opacity-80"
              >
                <span aria-hidden="true">🗑️</span>
                <span className="sr-only">Quitar</span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`qty-${row.id}`}>
                Cantidad
              </label>
              <input
                id={`qty-${row.id}`}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={row.quantity}
                onChange={(e) => onUpdateItem(row.id, { quantity: e.target.value })}
                className="w-20 rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-sm text-ink"
                placeholder="Cant."
              />
              <span className="text-xs text-ink-muted">{unitSingularLabel(row.unit)}</span>
              <span className="ml-auto text-xs text-ink-muted">
                {row.unitCost ? `costo ${formatArsDecimalDisplay(row.unitCost)}` : ""}
              </span>
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={onAddMaterial}
        data-testid="plantilla-add-material"
        className="self-start font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:text-ink"
      >
        Material
      </button>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <label className="flex flex-col gap-0.5">
          <span className="text-ink-muted">Tiempo (min)</span>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={formatDecimalInput(template.time)}
            onChange={(e) => onUpdateMeta({ time: e.target.value })}
            className="rounded-md border border-border-subtle bg-surface-raised px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-ink-muted">Costo/h</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={formatDecimalInput(template.hourlyRate)}
            onChange={(e) => onUpdateMeta({ hourlyRate: e.target.value })}
            className="rounded-md border border-border-subtle bg-surface-raised px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-ink-muted">Costos fijos</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={formatDecimalInput(template.overhead)}
            onChange={(e) => onUpdateMeta({ overhead: e.target.value })}
            className="rounded-md border border-border-subtle bg-surface-raised px-2 py-1.5 text-sm text-ink"
          />
        </label>
      </div>
    </section>
  );
}

function PlantillaCardSummary({ template }: { template: PlantillaClientTemplate }) {
  const summary = useMemo(
    () =>
      calcTemplateSummary({
        materials: template.items.map((row) => ({
          unitCost: row.unitCost,
          quantity: row.quantity,
        })),
        time: template.time,
        hourlyRate: template.hourlyRate,
        overhead: template.overhead,
        marginPct: template.marginPct,
      }),
    [template.items, template.time, template.hourlyRate, template.overhead, template.marginPct],
  );
  return (
    <dl
      aria-label={`Resumen de ${template.name}`}
      data-testid="plantilla-summary"
      className="grid grid-cols-2 gap-1 rounded-xl border border-border-subtle bg-surface-raised p-3 text-xs"
    >
      <dt className="text-ink-muted">Materiales</dt>
      <dd className="text-right font-semibold text-ink" data-testid="summary-materials">
        {formatArsDecimalDisplay(summary.materialsCost)}
      </dd>
      <dt className="text-ink-muted">Mano de obra</dt>
      <dd className="text-right font-semibold text-ink" data-testid="summary-labor">
        {formatArsDecimalDisplay(summary.laborCost)}
      </dd>
      <dt className="text-ink-muted">Costos fijos</dt>
      <dd className="text-right font-semibold text-ink" data-testid="summary-overhead">
        {formatArsDecimalDisplay(summary.overhead)}
      </dd>
      <dt className="text-ink-muted">Costo total</dt>
      <dd className="text-right font-semibold text-ink" data-testid="summary-total">
        {formatArsDecimalDisplay(summary.total)}
      </dd>
      <dt className="text-ink-muted">Precio sugerido</dt>
      <dd className="text-right font-semibold text-brand" data-testid="summary-suggested">
        {formatArsDecimalDisplay(summary.suggestedPrice)}
      </dd>
    </dl>
  );
}
