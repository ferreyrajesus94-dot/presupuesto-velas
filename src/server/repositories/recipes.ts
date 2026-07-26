import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../../db/client";
import { recipeItems, recipes } from "../../../db/schema";

export type Recipe = typeof recipes.$inferSelect;
export type RecipeItem = typeof recipeItems.$inferSelect;
export type RecipeRecord = { recipe: Recipe; items: RecipeItem[] };

type RecipeVisibility = { includeArchived?: boolean };

async function readItems(
  rows: readonly Recipe[],
  query: typeof db,
): Promise<Map<string, RecipeItem[]>> {
  const ids = rows.map(({ id }) => id);
  if (ids.length === 0) return new Map();
  const items = await query
    .select()
    .from(recipeItems)
    .where(inArray(recipeItems.recipeId, ids))
    .orderBy(asc(recipeItems.recipeId), asc(recipeItems.position));
  const byRecipe = new Map<string, RecipeItem[]>();
  for (const item of items)
    byRecipe.set(item.recipeId, [...(byRecipe.get(item.recipeId) ?? []), item]);
  return byRecipe;
}

function records(rows: readonly Recipe[], byRecipe: Map<string, RecipeItem[]>): RecipeRecord[] {
  return rows.map((recipe) => ({ recipe, items: byRecipe.get(recipe.id) ?? [] }));
}

export async function listRecipes(
  ownerId: string,
  visibility: RecipeVisibility = {},
): Promise<RecipeRecord[]> {
  const conditions = [eq(recipes.ownerId, ownerId)];
  if (!visibility.includeArchived) conditions.push(isNull(recipes.archivedAt));
  const rows = await db
    .select()
    .from(recipes)
    .where(and(...conditions))
    .orderBy(asc(recipes.name), asc(recipes.id));
  return records(rows, await readItems(rows, db));
}

export async function getRecipe(
  ownerId: string,
  id: string,
  visibility: RecipeVisibility = {},
): Promise<RecipeRecord | null> {
  const conditions = [eq(recipes.ownerId, ownerId), eq(recipes.id, id)];
  if (!visibility.includeArchived) conditions.push(isNull(recipes.archivedAt));
  const rows = await db
    .select()
    .from(recipes)
    .where(and(...conditions))
    .limit(1);
  if (rows.length === 0) return null;
  return records(rows, await readItems(rows, db))[0];
}
