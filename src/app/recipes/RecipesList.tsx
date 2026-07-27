import type { Unit } from "@/domain/units";
import { RecipeArchiveControl } from "./RecipeArchiveControl";
import { RecipeEditForm, type RecipeMaterialOption } from "./RecipeEditForm";
import { RecipeViewFilter, type RecipeView } from "./RecipeViewFilter";

export type RecipeListItem = {
  id: string;
  name: string;
  unitCost: string;
  archivedAt: Date | null;
  itemCount: number;
  // Minimal serializable projection of the recipe's ordered items for
  // the inline edit form. Dates/materialized objects stay server-side.
  items: Array<{ materialId: string; quantity: string; unit: string }>;
};

export function RecipesList({
  recipes,
  view,
  archivedCount,
  materials,
}: {
  recipes: RecipeListItem[];
  view: RecipeView;
  archivedCount: number;
  materials: readonly RecipeMaterialOption[];
}) {
  const hasRemainingRows = recipes.length > 0;
  // PR3y next: RecipesArchiveFeedback will wrap the list and the empty-state
  // branches so the polite role=status region survives the transition from a
  // non-empty active list to an empty active list (mirrors the R3-003 finding
  // on the materials lifecycle).
  return (
    <div className="flex flex-col gap-4">
      <RecipeViewFilter current={view} />
      {recipes.length === 0 ? (
        view === "active" && archivedCount > 0 ? (
          <section
            aria-labelledby="empty-recipes"
            className="rounded-2xl border border-dashed border-rose-300 bg-rose-50 p-6"
          >
            <h2 id="empty-recipes" className="text-xl font-semibold text-zinc-900">
              No active recipes
            </h2>
            <p className="mt-2 text-sm text-zinc-700">
              {archivedCount === 1
                ? "1 recipe is archived and hidden in this view."
                : `${archivedCount} recipes are archived and hidden in this view.`}
            </p>
            <a
              href="/recipes?view=all"
              data-archive-focus="show-archived"
              className="mt-4 inline-block font-semibold text-rose-900 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700"
            >
              Show archived
            </a>
          </section>
        ) : (
          <section
            aria-labelledby="empty-recipes"
            className="rounded-2xl border border-dashed border-rose-300 bg-rose-50 p-6"
          >
            <h2 id="empty-recipes" className="text-xl font-semibold text-zinc-900">
              No recipes yet
            </h2>
            <p className="mt-2 text-sm text-zinc-700">
              Build your first recipe from owner-scoped materials.
            </p>
            <a
              href="#new-recipe"
              className="mt-4 inline-block font-semibold text-rose-900 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700"
            >
              Create your first recipe
            </a>
          </section>
        )
      ) : (
        <ul
          className="grid gap-3 sm:grid-cols-2"
          aria-label="Recipes"
          data-has-rows={hasRemainingRows}
        >
          {recipes.map((recipe) => (
            <li
              key={recipe.id}
              data-testid="recipe-card"
              className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-zinc-900">{recipe.name}</h3>
                  <p className="mt-1 text-sm text-zinc-700">ARS {recipe.unitCost}</p>
                  <p className="mt-1 text-xs text-zinc-600">
                    {recipe.itemCount === 1 ? "1 item" : `${recipe.itemCount} items`}
                  </p>
                </div>
                {recipe.archivedAt !== null ? (
                  <span
                    data-testid="archived-badge"
                    aria-label={`${recipe.name} is archived`}
                    className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-700"
                  >
                    Archived
                  </span>
                ) : null}
              </div>
              {recipe.archivedAt === null ? (
                <div className="flex flex-col gap-2">
                  {/* PR3v.next: stable per-recipe identity keeps the form's
                      defaultValues isolated between siblings, and the
                      hash anchor doubles as a deep-link for keyboard/screen
                      reader users jumping straight to a card's editor. */}
                  <a
                    href={`#edit-recipe-${recipe.id}`}
                    data-edit-link={recipe.id}
                    className="self-start font-semibold text-rose-900 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700"
                  >
                    Edit {recipe.name}
                  </a>
                  <RecipeEditForm
                    key={recipe.id}
                    recipe={{
                      id: recipe.id,
                      name: recipe.name,
                      items: recipe.items.map((item) => ({
                        materialId: item.materialId,
                        quantity: item.quantity,
                        // Recipe items persist normalized quantities; the
                        // original unit is projected from the catalog (or
                        // falls back to a sentinel "g" for missing references)
                        // and cast to the form's strict Unit union.
                        unit: item.unit as Unit,
                      })),
                    }}
                    materials={materials}
                  />
                </div>
              ) : null}
              {/* PR3y: archive/restore controls. Active cards expose archive,
                  archived cards expose restore. The success announcement lives
                  on the control itself for now; PR3y next moves the polite
                  status into a parent provider that survives row unmount. */}
              <RecipeArchiveControl
                recipe={{
                  id: recipe.id,
                  name: recipe.name,
                  archived: recipe.archivedAt !== null,
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
