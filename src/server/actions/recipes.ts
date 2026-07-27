"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "../auth/requireOwner";
import {
  archiveRecipe,
  createRecipe,
  RecipeRepositoryError,
  restoreRecipe,
  updateRecipe,
} from "../repositories/recipes";
import { type RecipeInput, recipeInputSchema } from "../validation/recipeSchema";
import type { Unit } from "../../domain/units";

const RECIPES_PATH = "/recipes";
type RecipeField = keyof RecipeInput | "id" | "items";

export type RecipeActionState = {
  status: "idle" | "success" | "error";
  recipeId?: string;
  message?: string;
  fieldErrors?: Partial<Record<RecipeField, string[]>>;
  values?: Partial<Record<RecipeField, string>>;
};

function value(formData: FormData, key: string): string {
  const item = formData.get(key);
  return typeof item === "string" ? item : "";
}

function readRecipeName(formData: FormData): string {
  return value(formData, "name");
}

function readRecipeItems(formData: FormData): {
  items?: RecipeInput["items"];
  state?: RecipeActionState;
} {
  const raw = value(formData, "items");
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    return { state: { status: "error", message: "Recipe items could not be parsed." } };
  }
  if (!Array.isArray(parsed)) {
    return { state: { status: "error", fieldErrors: { items: ["Items are required"] } } };
  }
  const items: RecipeInput["items"] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") {
      return { state: { status: "error", message: "Recipe items could not be parsed." } };
    }
    const row = entry as Record<string, unknown>;
    items.push({
      materialId: typeof row.materialId === "string" ? row.materialId : "",
      quantity: typeof row.quantity === "string" ? row.quantity : "",
      unit: (typeof row.unit === "string" ? row.unit : "") as Unit,
    });
  }
  return { items };
}

function readId(formData: FormData): string | RecipeActionState {
  const id = value(formData, "id").trim();
  if (id) return id;
  return {
    status: "error",
    fieldErrors: { id: ["Recipe ID is required"] },
    values: { id: "" },
  };
}

function readRecipeInput(
  formData: FormData,
): { input: RecipeInput; name: string } | { state: RecipeActionState } {
  const name = readRecipeName(formData);
  const parsed = readRecipeItems(formData);
  if (parsed.state) return { state: parsed.state };
  const input: RecipeInput = { name, items: parsed.items! };
  const shape = recipeInputSchema.safeParse(input);
  if (!shape.success) {
    return {
      state: {
        status: "error",
        fieldErrors: shape.error.flatten().fieldErrors,
        values: { name },
      },
    };
  }
  return { input, name };
}

function failure(error: unknown, operation: string): RecipeActionState {
  if (error instanceof RecipeRepositoryError) {
    if (error.code === "DUPLICATE_NAME") {
      return { status: "error", message: "A recipe with that name already exists." };
    }
    if (error.code === "MATERIAL_UNAVAILABLE") {
      return { status: "error", message: "Recipe material is unavailable." };
    }
    return { status: "error", message: "Recipe could not be found." };
  }
  return { status: "error", message: `Unable to ${operation} recipe.` };
}

function success(recipeId: string): RecipeActionState {
  revalidatePath(RECIPES_PATH);
  return { status: "success", recipeId };
}

export async function createRecipeAction(
  _previous: RecipeActionState,
  formData: FormData,
): Promise<RecipeActionState> {
  const owner = await requireOwner();
  const parsed = readRecipeInput(formData);
  if ("state" in parsed) return parsed.state;
  try {
    const record = await createRecipe(owner.id, parsed.input);
    return success(record.recipe.id);
  } catch (error) {
    return failure(error, "create");
  }
}

export async function updateRecipeAction(
  _previous: RecipeActionState,
  formData: FormData,
): Promise<RecipeActionState> {
  const owner = await requireOwner();
  const id = readId(formData);
  if (typeof id !== "string") return id;
  const parsed = readRecipeInput(formData);
  if ("state" in parsed) return parsed.state;
  try {
    const record = await updateRecipe(owner.id, id, parsed.input);
    return success(record.recipe.id);
  } catch (error) {
    return failure(error, "update");
  }
}

export async function archiveRecipeAction(
  _previous: RecipeActionState,
  formData: FormData,
): Promise<RecipeActionState> {
  const owner = await requireOwner();
  const id = readId(formData);
  if (typeof id !== "string") return id;
  try {
    const recipe = await archiveRecipe(owner.id, id);
    return success(recipe.id);
  } catch (error) {
    return failure(error, "archive");
  }
}

export async function restoreRecipeAction(
  _previous: RecipeActionState,
  formData: FormData,
): Promise<RecipeActionState> {
  const owner = await requireOwner();
  const id = readId(formData);
  if (typeof id !== "string") return id;
  try {
    const recipe = await restoreRecipe(owner.id, id);
    return success(recipe.id);
  } catch (error) {
    return failure(error, "restore");
  }
}
