import { requireUser } from "@/server/auth/requireUser";
import { countArchivedMaterials, listMaterials } from "@/server/repositories/materials";
import type { MaterialInput } from "@/server/validation/materialSchema";
import { MaterialsList, type MaterialListItem } from "./MaterialsList";
import { MaterialsListView } from "./MaterialsListView";
import { MaterialCreateForm } from "./MaterialCreateForm";
import {
  MaterialViewFilter,
  resolveMaterialView,
  resolveMaterialViewMode,
  type MaterialView,
  type MaterialViewMode,
} from "./MaterialViewFilter";

const VIEW_VISIBILITY: Record<MaterialView, { includeArchived: boolean }> = {
  active: { includeArchived: false },
  all: { includeArchived: true },
};

export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireUser();
  const { view: rawView, mode: rawMode } = await searchParams;
  // Two orthogonal view params: `view` controls visibility
  // (Activos / Mostrar archivados) and `mode` controls display layout
  // (Tarjetas / Lista). Each toggle link preserves the other so the
  // user can browse, say, archived materials in list mode without
  // losing the visibility filter.
  const view = resolveMaterialView(rawView);
  const mode = resolveMaterialViewMode(rawMode);
  const visibility = VIEW_VISIBILITY[view];
  const materials = await listMaterials(user.id, visibility);

  // R3-002: only fetch the archived count when the active list might be
  // empty — keeps the happy path to a single query and supports the
  // view-aware empty state for archived-only users.
  const archivedCount =
    view === "active" && materials.length === 0 ? await countArchivedMaterials(user.id) : 0;

  const items: MaterialListItem[] = materials.map((m) => ({
    id: m.id,
    name: m.name,
    dimension: m.dimension,
    baseUnit: m.baseUnit as MaterialInput["baseUnit"],
    purchaseUnit: m.purchaseUnit as MaterialInput["purchaseUnit"],
    purchaseQuantity: m.purchaseQuantity,
    purchasePrice: m.purchasePrice,
    unitCost: m.unitCost,
    archived: m.archivedAt !== null,
  }));

  return (
    // Root layout owns <main id="main">; this page must not nest another one.
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 bg-canvas px-4 py-8 text-ink sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-border bg-surface p-6 shadow">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-ink-muted">
            Calculadora Flor
          </p>
          <h1
            aria-label="Materiales"
            className="mt-2 text-3xl font-semibold text-ink text-wrap-balance"
          >
            📦 Insumos y precios
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="#new-material"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-4 text-sm font-semibold text-on-brand transition-transform hover:-translate-y-1"
          >
            Agregar insumo
          </a>
          <button
            type="button"
            data-help="materials"
            aria-label="Ayuda sobre insumos"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border text-ink transition-transform hover:-translate-y-1"
          >
            ?
          </button>
        </div>
      </header>

      {/*
       * The filter row (Activos / Mostrar archivados + Tarjetas / Lista)
       * lives at the page level so it works in both display modes.
       */}
      <MaterialViewFilter current={view} mode={mode} />

      <div className="flex flex-col gap-8">
        {/*
         * Cards mode: the create form (to add new materials) sits above
         * the editable list. Each list item is its own card with the
         * inline edit form. List mode: hide the create form (the user
         * can switch back to cards to add new materials) and show the
         * compact table.
         */}
        {mode === "cards" ? (
          <>
            <MaterialCreateForm />
            <MaterialsList
              materials={items}
              view={view}
              archivedCount={archivedCount}
            />
          </>
        ) : (
          <MaterialsListView materials={items} />
        )}
      </div>
    </div>
  );
}
