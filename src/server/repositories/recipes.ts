import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { ZodError } from "zod";
import { db } from "../../../db/client";
import { materials, recipeItems, recipes } from "../../../db/schema";
import {
  createRecipeInputSchema,
  type ParsedRecipeInput,
  type RecipeInput,
  type RecipeMaterialReference,
} from "../validation/recipeSchema";

export type Recipe = typeof recipes.$inferSelect;
export type RecipeItem = typeof recipeItems.$inferSelect;
export type RecipeRecord = { recipe: Recipe; items: RecipeItem[] };

type RecipeVisibility = { includeArchived?: boolean };

export class RecipeRepositoryError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "DUPLICATE_NAME" | "MATERIAL_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "RecipeRepositoryError";
  }
}

function duplicateName(name: string): RecipeRepositoryError {
  return new RecipeRepositoryError("DUPLICATE_NAME", `Recipe name "${name}" is already used`);
}

function materialUnavailable(): RecipeRepositoryError {
  return new RecipeRepositoryError("MATERIAL_UNAVAILABLE", "Recipe material is unavailable");
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current === "object" && current !== null && "code" in current) {
      if ((current as { code?: unknown }).code === "23505") return true;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

function materialReferences(
  rows: readonly (typeof materials.$inferSelect)[],
): RecipeMaterialReference[] {
  return rows.map((row) => ({
    id: row.id,
    ownerId: row.ownerId,
    baseUnit: row.baseUnit,
    unitCost: row.unitCost,
    archivedAt: row.archivedAt,
  }));
}

function parseInput(
  ownerId: string,
  input: RecipeInput,
  materialRows: readonly (typeof materials.$inferSelect)[],
): ParsedRecipeInput {
  try {
    return createRecipeInputSchema(ownerId, materialReferences(materialRows)).parse(input);
  } catch (error) {
    if (
      error instanceof ZodError &&
      error.issues.some(
        (issue) =>
          issue.message === "Material is unavailable" ||
          issue.message === "Archived materials cannot be added to recipes",
      )
    ) {
      throw materialUnavailable();
    }
    throw error;
  }
}

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

export async function createRecipe(ownerId: string, input: RecipeInput): Promise<RecipeRecord> {
  // FOR SHARE serializes the recipe validation snapshot against any
  // concurrent UPDATE on the owner's materials. While this transaction is
  // open, an in-flight archive or price update on those rows must wait for
  // our commit. Our SELECT then reads the latest committed snapshot once
  // the lock clears, closing the TOCTOU window between reading materials
  // for validation and inserting the recipe. Without FOR SHARE, a non-
  // locking SELECT could race past a just-committed archive or price edit
  // and produce a recipe referencing unavailable material or stale cost.
  return db.transaction(async (tx) => {
    const materialRows = await tx
      .select()
      .from(materials)
      .where(eq(materials.ownerId, ownerId))
      .for("share");
    const parsed = parseInput(ownerId, input, materialRows);

    const recipeId = crypto.randomUUID();
    try {
      const [recipe] = await tx
        .insert(recipes)
        .values({ id: recipeId, ownerId, name: parsed.name, unitCost: parsed.unitCost })
        .returning();
      if (!recipe) {
        throw new RecipeRepositoryError("NOT_FOUND", `Recipe "${recipeId}" was not found`);
      }
      const items: RecipeItem[] = parsed.items.map((item) => ({
        id: crypto.randomUUID(),
        recipeId,
        position: item.position,
        materialId: item.materialId,
        quantity: item.quantity,
      }));
      await tx.insert(recipeItems).values(items);
      return { recipe, items };
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateName(parsed.name);
      throw error;
    }
  });
}
