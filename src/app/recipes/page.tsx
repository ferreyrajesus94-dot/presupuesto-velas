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

// PR3v.next: the edit form preloads each active recipe's ordered items.
// The repository persists the items in the recipe's chosen unit (after
// normalization to the material's baseUnit), and the projection layer
// lifts the unit display from the catalog so the Client Component
// receives only serializable strings.
const FALLBACK_UNIT = "g";

function projectRecipeItems(
  rows: ReadonlyArray<{ materialId: string; quantity: string; position: number }>,
  materialsById: ReadonlyMap<string, RecipeMaterialOption>,
): RecipeListItem["items"] {
  return rows
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      materialId: item.materialId,
      quantity: item.quantity,
      unit: materialsById.get(item.materialId)?.baseUnit ?? FALLBACK_UNIT,
    }));
}

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

  // The create and edit forms both accept active materials. We fetch the
  // catalog here so the Client Components receive a stable, owner-scoped
  // list and stay decoupled from the server repository layer.
  const activeMaterials = await listMaterials(owner.id, { includeArchived: false });
  const materialOptions: RecipeMaterialOption[] = activeMaterials.map((m) => ({
    id: m.id,
    name: m.name,
    baseUnit: m.baseUnit,
    unitCost: m.unitCost,
  }));
  const materialsById = new Map(materialOptions.map((m) => [m.id, m] as const));

  const items: RecipeListItem[] = records.map(({ recipe, items: recipeItems }) => ({
    id: recipe.id,
    name: recipe.name,
    unitCost: recipe.unitCost,
    archivedAt: recipe.archivedAt,
    itemCount: recipeItems.length,
    items: projectRecipeItems(recipeItems, materialsById),
  }));

  return (
    // Root layout owns <main id="main">; this page must not nest another one.
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 bg-canvas px-4 py-8 text-ink sm:px-6 lg:px-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">
          Calculadora Flor
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-ink text-wrap-balance">Recetas</h1>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
        <RecipesList
          recipes={items}
          view={view}
          archivedCount={archivedCount}
          materials={materialOptions}
        />
        <RecipeCreateForm materials={materialOptions} />
      </div>
    </div>
  );
}
