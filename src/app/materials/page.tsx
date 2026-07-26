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
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 bg-[#fffaf5] px-4 py-8 text-zinc-900 sm:px-6 lg:px-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-800">
          Calculadora Flor
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-wrap-balance">Materials</h1>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
        <MaterialsList materials={items} view={view} archivedCount={archivedCount} />
        <MaterialCreateForm />
      </div>
    </main>
  );
}
