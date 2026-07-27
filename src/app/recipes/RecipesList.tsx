import { RecipeViewFilter, type RecipeView } from "./RecipeViewFilter";

export type RecipeListItem = {
  id: string;
  name: string;
  unitCost: string;
  archivedAt: Date | null;
  itemCount: number;
};

export function RecipesList({
  recipes,
  view,
  archivedCount,
}: {
  recipes: RecipeListItem[];
  view: RecipeView;
  archivedCount: number;
}) {
  const hasRemainingRows = recipes.length > 0;
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
