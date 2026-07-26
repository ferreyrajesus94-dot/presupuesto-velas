import { requireOwner } from "@/server/auth/requireOwner";
import { listMaterials } from "@/server/repositories/materials";
import type { MaterialInput } from "@/server/validation/materialSchema";
import { MaterialsList, type MaterialListItem } from "./MaterialsList";
import { MaterialCreateForm } from "./MaterialCreateForm";

export default async function MaterialsPage() {
  const owner = await requireOwner();
  const materials = await listMaterials(owner.id);
  const items: MaterialListItem[] = materials.map((m) => ({
    id: m.id,
    name: m.name,
    dimension: m.dimension,
    baseUnit: m.baseUnit as MaterialInput["baseUnit"],
    purchaseUnit: m.purchaseUnit as MaterialInput["purchaseUnit"],
    purchaseQuantity: m.purchaseQuantity,
    purchasePrice: m.purchasePrice,
    unitCost: m.unitCost,
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
        <MaterialsList materials={items} />
        <MaterialCreateForm />
      </div>
    </main>
  );
}
