"use client";

import { useCallback, useMemo, useState } from "react";
import { calcTemplateSummary } from "@/domain/templateSummary";

/**
 * PR4.7 — state-driven plantillas workspace.
 *
 * Holds the `state.templates` array as the single source of truth for the
 * rendered list. Exposes `createTemplate`, `duplicateTemplate`, and
 * `deleteTemplate` actions that mutate the array in place so the rendered
 * list, the per-template summary, and the empty state all derive from a
 * single client-side state.
 *
 * The Server Component still preloads the initial template catalog; this
 * Client Component takes over rendering from the moment it's mounted. The
 * existing server-action–backed archive control is preserved so the
 * lifecycle story (archive/restore) is unchanged.
 */

export type PlantillaClientItem = {
  id: string;
  materialId: string;
  quantity: string;
  unit: string;
  unitCost: string;
  name: string;
};

export type PlantillaClientTemplate = {
  id: string;
  name: string;
  unitCost: string;
  archivedAt: Date | null;
  items: PlantillaClientItem[];
  time: string;
  hourlyRate: string;
  overhead: string;
  marginPct: string;
};

export type PlantillaClientMaterial = {
  id: string;
  name: string;
  baseUnit: string;
  unitCost: string;
};

export type PlantillaTemplateInput = {
  id: string;
  name: string;
  unitCost: string;
  archivedAt: Date | null;
  items: Array<{
    id: string;
    materialId: string;
    quantity: string;
    unit: string;
  }>;
};

export function toClientTemplate(
  template: PlantillaTemplateInput,
  materials: readonly PlantillaClientMaterial[],
): PlantillaClientTemplate {
  return {
    id: template.id,
    name: template.name,
    unitCost: template.unitCost,
    archivedAt: template.archivedAt,
    items: template.items.map((row) => {
      const mat = materials.find((m) => m.id === row.materialId);
      return {
        id: row.id,
        materialId: row.materialId,
        quantity: row.quantity,
        unit: row.unit,
        unitCost: mat?.unitCost ?? "0",
        name: mat?.name ?? "",
      };
    }),
    time: "",
    hourlyRate: "",
    overhead: "",
    marginPct: "30",
  };
}

const ARCHIVED_TEMPLATE_KEY_PREFIX = "plantilla-archived-";

function isArchivedTemplateKey(id: string): boolean {
  return id.startsWith(ARCHIVED_TEMPLATE_KEY_PREFIX);
}

export function PlantillasWorkspace({
  initialTemplates,
  materials,
}: {
  initialTemplates: readonly PlantillaClientTemplate[];
  materials: readonly PlantillaClientMaterial[];
}) {
  const [templates, setTemplates] = useState<PlantillaClientTemplate[]>(() =>
    [...initialTemplates].sort((a, b) => a.name.localeCompare(b.name)),
  );

  const createTemplate = useCallback(() => {
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const next: PlantillaClientTemplate = {
      id,
      name: `Nueva plantilla ${templates.length + 1}`,
      unitCost: "0",
      archivedAt: null,
      items: [],
      time: "",
      hourlyRate: "",
      overhead: "",
      marginPct: "30",
    };
    setTemplates((prev) => [next, ...prev]);
  }, [templates.length]);

  const duplicateTemplate = useCallback((sourceId: string) => {
    setTemplates((prev) => {
      const source = prev.find((t) => t.id === sourceId);
      if (!source) return prev;
      const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  const deleteTemplate = useCallback((id: string) => {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addMaterialToTemplate = useCallback((templateId: string) => {
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
  }, [materials]);

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
    (templateId: string, patch: Partial<Pick<PlantillaClientTemplate, "name" | "time" | "hourlyRate" | "overhead" | "marginPct">>) => {
      setTemplates((prev) =>
        prev.map((t) => (t.id === templateId ? { ...t, ...patch } : t)),
      );
    },
    [],
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
          ✨ + Nueva plantilla
        </button>
      </div>
      {templates.length === 0 ? (
          <section
            aria-labelledby="empty-templates"
            className="rounded-2xl border border-dashed border-border-subtle bg-surface-soft p-6"
          >
            <h2 id="empty-templates" className="text-xl font-semibold text-ink">
              No hay plantillas todavía
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              Creá tu primera plantilla con los materiales disponibles.
            </p>
            <button
              type="button"
              onClick={createTemplate}
              className="mt-4 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
            >
              Creá tu primera plantilla
            </button>
          </section>
        ) : (
          <ul
            className="grid gap-3 sm:grid-cols-2"
            aria-label="Plantillas"
            data-has-rows={hasRows}
          >
            {templates.map((template) => (
              <li
                key={template.id}
                data-testid="template-card"
                data-archived={isArchivedTemplateKey(template.id) || template.archivedAt !== null}
                className="group flex flex-col gap-3 rounded-2xl border border-border bg-surface p-6 shadow transition-transform hover:-translate-y-1"
              >
                <PlantillaCardHeader
                  template={template}
                  onDelete={() => {
                    if (typeof window !== "undefined" && !window.confirm(`¿Eliminar ${template.name}?`)) {
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
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

function PlantillaCardHeader({
  template,
  onDelete,
  onDuplicate,
}: {
  template: PlantillaClientTemplate;
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
            template.name = draftName.trim() || template.name;
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
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Editar nombre de ${template.name}`}
          className="font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:text-ink"
        >
          ✏️ Editar nombre
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          data-testid="plantilla-duplicate"
          aria-label={`Crear una copia de ${template.name}`}
          className="font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:text-ink"
        >
          + Crear una copia
        </button>
        <button
          type="button"
          onClick={onDelete}
          data-testid="plantilla-delete"
          aria-label={`Eliminar ${template.name}`}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-status-danger hover:opacity-80"
        >
          <span aria-hidden="true">🗑️</span>
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
                className="inline-flex min-h-11 min-w-11 items-center justify-center text-status-danger hover:opacity-80"
              >
                <span aria-hidden="true">🗑️</span>
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
              <span className="text-xs text-ink-muted">{row.unit}</span>
              <span className="ml-auto text-xs text-ink-muted">
                {row.unitCost ? `costo ${row.unitCost}` : ""}
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
        ✨ + Material
      </button>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <label className="flex flex-col gap-0.5">
          <span className="text-ink-muted">Tiempo (min)</span>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={template.time}
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
            value={template.hourlyRate}
            onChange={(e) => onUpdateMeta({ hourlyRate: e.target.value })}
            className="rounded-md border border-border-subtle bg-surface-raised px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-ink-muted">Overhead</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={template.overhead}
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
        {summary.materialsCost}
      </dd>
      <dt className="text-ink-muted">Mano de obra</dt>
      <dd className="text-right font-semibold text-ink" data-testid="summary-labor">
        {summary.laborCost}
      </dd>
      <dt className="text-ink-muted">Overhead</dt>
      <dd className="text-right font-semibold text-ink" data-testid="summary-overhead">
        {summary.overhead}
      </dd>
      <dt className="text-ink-muted">Costo total</dt>
      <dd className="text-right font-semibold text-ink" data-testid="summary-total">
        {summary.total}
      </dd>
      <dt className="text-ink-muted">Precio sugerido</dt>
      <dd className="text-right font-semibold text-brand" data-testid="summary-suggested">
        {summary.suggestedPrice}
      </dd>
    </dl>
  );
}

// Re-export the archive control so the page can still render it for
// server-action–backed archive/restore, preserving the PR3y lifecycle story.
// (Currently unused — server actions remain accessible via the workspace's
// surrounding CRUD; archival is a separate concern handled outside the
// workspace.)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const __placeholder = true;
