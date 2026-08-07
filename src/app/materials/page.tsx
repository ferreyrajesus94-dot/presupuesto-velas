import { requireOwner } from "@/server/auth/requireOwner";
import { countArchivedMaterials, listMaterials } from "@/server/repositories/materials";
import type { MaterialInput } from "@/server/validation/materialSchema";
import { MaterialsList, type MaterialListItem } from "./MaterialsList";
import { MaterialCreateForm } from "./MaterialCreateForm";
import { resolveMaterialView, type MaterialView } from "./MaterialViewFilter";

const VIEW_VISIBILITY: Record<MaterialView, { includeArchived: boolean }> = {
  active: { includeArchived: false },
  all: { includeArchived: true },
};

export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const owner = await requireOwner();
  const { view: rawView } = await searchParams;
  const view = resolveMaterialView(rawView);
  const visibility = VIEW_VISIBILITY[view];
  const materials = await listMaterials(owner.id, visibility);

  // R3-002: only fetch the archived count when the active list might be
  // empty — keeps the happy path to a single query and supports the
  // view-aware empty state for archived-only owners.
  const archivedCount =
    view === "active" && materials.length === 0 ? await countArchivedMaterials(owner.id) : 0;

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

      <div className="flex flex-col gap-8">
        <MaterialCreateForm />
        <MaterialsList materials={items} view={view} archivedCount={archivedCount} />
      </div>
    </div>
  );
}
