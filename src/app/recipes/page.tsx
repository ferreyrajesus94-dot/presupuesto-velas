import { requireOwner } from "@/server/auth/requireOwner";
import { listMaterials } from "@/server/repositories/materials";
import { countArchivedRecipes, listRecipes } from "@/server/repositories/recipes";
import { RecipeCreateForm, type RecipeMaterialOption } from "./RecipeCreateForm";
import { RecipesList, type RecipeListItem } from "./RecipesList";
import { resolveRecipeView, type RecipeView } from "./RecipeViewFilter";

const VIEW_VISIBILITY: Record<RecipeView, { includeArchived: boolean }> = {
  active: { includeArchived: false },
  all: { includeArchived: true },
};

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const owner = await requireOwner();
  const { view: rawView } = await searchParams;
  const view = resolveRecipeView(rawView);
  const visibility = VIEW_VISIBILITY[view];
  const records = await listRecipes(owner.id, visibility);

  // Mirror materials: only query the archived count when the active list
  // might be empty — keeps the happy path to a single query and supports
  // the view-aware empty state for archived-only owners.
  const archivedCount =
    view === "active" && records.length === 0 ? await countArchivedRecipes(owner.id) : 0;

  const items: RecipeListItem[] = records.map(({ recipe, items }) => ({
    id: recipe.id,
    name: recipe.name,
    unitCost: recipe.unitCost,
    archivedAt: recipe.archivedAt,
    itemCount: items.length,
  }));

  // The create form only accepts active materials. We fetch the catalog
  // here so the Client Component receives a stable, owner-scoped list and
  // stays decoupled from the server repository layer.
  const activeMaterials = await listMaterials(owner.id, { includeArchived: false });
  const materialOptions: RecipeMaterialOption[] = activeMaterials.map((m) => ({
    id: m.id,
    name: m.name,
    baseUnit: m.baseUnit,
    unitCost: m.unitCost,
  }));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 bg-[#fffaf5] px-4 py-8 text-zinc-900 sm:px-6 lg:px-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-800">
          Calculadora Flor
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-wrap-balance">Recipes</h1>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
        <RecipesList recipes={items} view={view} archivedCount={archivedCount} />
        <RecipeCreateForm materials={materialOptions} />
      </div>
    </main>
  );
}
