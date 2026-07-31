import type { Unit } from "@/domain/units";
import { RecipeArchiveControl } from "./RecipeArchiveControl";
import { RecipesArchiveFeedback } from "./RecipesArchiveFeedback";
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
  // PR3z: wrap list + empty branches in RecipesArchiveFeedback so polite status survives revalidation.
  // PR3z.focus: pass `view` so the focus effect can gate on the active view.
  return (
    <div className="flex flex-col gap-4">
      <RecipeViewFilter current={view} />
      <RecipesArchiveFeedback view={view}>
        {recipes.length === 0 ? (
          view === "active" && archivedCount > 0 ? (
            <section
              aria-labelledby="empty-recipes"
              className="rounded-2xl border border-border-subtle bg-surface-soft p-6"
            >
              <h2 id="empty-recipes" className="text-xl font-semibold text-ink">
                No hay recetas activas
              </h2>
              <p className="mt-2 text-sm text-ink-muted">
                {archivedCount === 1
                  ? "1 receta está archivada y oculta en esta vista."
                  : `${archivedCount} recetas están archivadas y ocultas en esta vista.`}
              </p>
              <a
                href="/recipes?view=all"
                data-archive-focus="show-archived"
                className="mt-4 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
              >
                Mostrar archivadas
              </a>
            </section>
          ) : (
            <section
              aria-labelledby="empty-recipes"
              className="rounded-2xl border border-border-subtle bg-surface-soft p-6"
            >
              <h2 id="empty-recipes" className="text-xl font-semibold text-ink">
                No hay recetas todavía
              </h2>
              <p className="mt-2 text-sm text-ink-muted">
                Creá tu primera receta con los materiales disponibles.
              </p>
              <a
                href="#new-recipe"
                className="mt-4 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
              >
                Creá tu primera receta
              </a>
            </section>
          )
        ) : (
          <ul
            className="grid gap-3 sm:grid-cols-2"
            aria-label="Recetas"
            data-has-rows={hasRemainingRows}
          >
            {recipes.map((recipe) => (
              <li
                key={recipe.id}
                data-testid="recipe-card"
                className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-surface-raised p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-ink">{recipe.name}</h3>
                    <p className="mt-1 text-sm text-ink-muted">ARS {recipe.unitCost}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {recipe.itemCount === 1 ? "1 elemento" : `${recipe.itemCount} elementos`}
                    </p>
                  </div>
                  {recipe.archivedAt !== null ? (
                    <span
                      data-testid="archived-badge"
                      aria-label={`${recipe.name} está archivada`}
                      className="inline-flex min-h-7 items-center rounded-full bg-surface-soft px-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted"
                    >
                      Archivada
                    </span>
                  ) : null}
                </div>
                {recipe.archivedAt === null ? (
                  <div className="flex flex-col gap-2">
                    {/* PR3v.next: stable per-recipe identity isolates form defaultValues between siblings;
                      the hash anchor doubles as a deep-link for keyboard/screen reader users. */}
                    <a
                      href={`#edit-recipe-${recipe.id}`}
                      data-edit-link={recipe.id}
                      className="self-start font-semibold text-brand underline underline-offset-4"
                    >
                      Editar {recipe.name}
                    </a>
                    <RecipeEditForm
                      key={recipe.id}
                      recipe={{
                        id: recipe.id,
                        name: recipe.name,
                        items: recipe.items.map((item) => ({
                          materialId: item.materialId,
                          quantity: item.quantity,
                          // Recipe items persist normalized quantities; original unit is projected from the catalog
                          // (or sentinel "g" fallback) and cast to the form's strict Unit union.
                          unit: item.unit as Unit,
                        })),
                      }}
                      materials={materials}
                    />
                  </div>
                ) : null}
                {/* PR3z: archive/restore; polite status now lives in RecipesArchiveFeedback above. */}
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
      </RecipesArchiveFeedback>
    </div>
  );
}
