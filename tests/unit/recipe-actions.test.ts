import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class RepositoryError extends Error {
    constructor(
      readonly code: "NOT_FOUND" | "DUPLICATE_NAME" | "MATERIAL_UNAVAILABLE",
      message: string,
    ) {
      super(message);
    }
  }
  return {
    RepositoryError,
    requireOwner: vi.fn(),
    createRecipe: vi.fn(),
    updateRecipe: vi.fn(),
    archiveRecipe: vi.fn(),
    restoreRecipe: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("../../src/server/auth/requireOwner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("../../src/server/repositories/recipes", () => ({
  RecipeRepositoryError: mocks.RepositoryError,
  createRecipe: mocks.createRecipe,
  updateRecipe: mocks.updateRecipe,
  archiveRecipe: mocks.archiveRecipe,
  restoreRecipe: mocks.restoreRecipe,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  archiveRecipeAction,
  createRecipeAction,
  restoreRecipeAction,
  updateRecipeAction,
} from "../../src/server/actions/recipes";

const OWNER = { id: "owner-1", email: "owner@example.com" };
const RECIPE_RECORD = { recipe: { id: "recipe-1" }, items: [] };
const RECIPE = { id: "recipe-1" };
const INITIAL_STATE = { status: "idle" as const };

const ITEMS = [
  { materialId: "wax", quantity: "100", unit: "g" },
  { materialId: "scent", quantity: "50", unit: "ml" },
];

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function recipeForm(name = "Vanilla", items = ITEMS) {
  return form({ name, items: JSON.stringify(items) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireOwner.mockResolvedValue(OWNER);
});

describe("recipe Server Actions", () => {
  it("creates a recipe for the authenticated owner and revalidates the catalog", async () => {
    mocks.createRecipe.mockResolvedValue(RECIPE_RECORD);

    const result = await createRecipeAction(INITIAL_STATE, recipeForm());

    expect(result).toEqual({ status: "success", recipeId: "recipe-1" });
    expect(mocks.createRecipe).toHaveBeenCalledWith(
      OWNER.id,
      expect.objectContaining({ name: "Vanilla" }),
    );
    expect(mocks.createRecipe.mock.calls[0][1].items).toEqual(ITEMS);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/recipes");
  });

  it("updates a recipe for the owner and revalidates the catalog", async () => {
    mocks.updateRecipe.mockResolvedValue(RECIPE_RECORD);

    const result = await updateRecipeAction(
      INITIAL_STATE,
      form({ id: "recipe-1", ...Object.fromEntries(recipeForm("New Vanilla")) }),
    );

    expect(result).toEqual({ status: "success", recipeId: "recipe-1" });
    expect(mocks.updateRecipe).toHaveBeenCalledWith(
      OWNER.id,
      "recipe-1",
      expect.objectContaining({ name: "New Vanilla" }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/recipes");
  });

  it("archives a recipe for the owner", async () => {
    mocks.archiveRecipe.mockResolvedValue(RECIPE);

    const result = await archiveRecipeAction(INITIAL_STATE, form({ id: "recipe-1" }));

    expect(result).toEqual({ status: "success", recipeId: "recipe-1" });
    expect(mocks.archiveRecipe).toHaveBeenCalledWith(OWNER.id, "recipe-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/recipes");
  });

  it("restores a recipe for the owner", async () => {
    mocks.restoreRecipe.mockResolvedValue(RECIPE);

    const result = await restoreRecipeAction(INITIAL_STATE, form({ id: "recipe-1" }));

    expect(result).toEqual({ status: "success", recipeId: "recipe-1" });
    expect(mocks.restoreRecipe).toHaveBeenCalledWith(OWNER.id, "recipe-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/recipes");
  });

  it("returns a schema field error when name is empty without calling the repository", async () => {
    const result = await createRecipeAction(INITIAL_STATE, recipeForm(""));

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.name).toEqual(["Name is required"]);
    expect(mocks.createRecipe).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a schema field error when items are empty without calling the repository", async () => {
    const result = await createRecipeAction(INITIAL_STATE, recipeForm("Vanilla", []));

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.items).toBeDefined();
    expect(mocks.createRecipe).not.toHaveBeenCalled();
  });

  it("returns a malformed-items error when items JSON cannot be parsed", async () => {
    const result = await createRecipeAction(
      INITIAL_STATE,
      form({ name: "Vanilla", items: "not-json" }),
    );

    expect(result.status).toBe("error");
    expect(result.message).toBeDefined();
    expect(mocks.createRecipe).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps duplicate names without exposing repository details", async () => {
    mocks.createRecipe.mockRejectedValue(
      new mocks.RepositoryError("DUPLICATE_NAME", 'Recipe name "Vanilla" is already used'),
    );

    const result = await createRecipeAction(INITIAL_STATE, recipeForm());

    expect(result).toEqual({
      status: "error",
      message: "A recipe with that name already exists.",
    });
    expect(result.message).not.toContain("Vanilla");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps unavailable material to a safe user-facing message", async () => {
    mocks.createRecipe.mockRejectedValue(
      new mocks.RepositoryError("MATERIAL_UNAVAILABLE", "secret material details"),
    );

    const result = await createRecipeAction(INITIAL_STATE, recipeForm());

    expect(result).toEqual({
      status: "error",
      message: "Recipe material is unavailable.",
    });
    expect(result.message).not.toContain("secret");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps not-found and cross-owner mutations to the same safe result", async () => {
    mocks.updateRecipe.mockRejectedValue(
      new mocks.RepositoryError("NOT_FOUND", "secret-id details"),
    );

    const result = await updateRecipeAction(
      INITIAL_STATE,
      form({ id: "other-owner-recipe", ...Object.fromEntries(recipeForm()) }),
    );

    expect(result).toEqual({ status: "error", message: "Recipe could not be found." });
    expect(result.message).not.toContain("secret-id");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("requires the recipe id for update and returns a field error", async () => {
    const result = await updateRecipeAction(
      INITIAL_STATE,
      form({ name: "Vanilla", items: JSON.stringify(ITEMS) }),
    );

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.id).toEqual(["Recipe ID is required"]);
    expect(mocks.updateRecipe).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthenticated", "__redirect:/sign-in"],
    ["non-owner", "__redirect:/403"],
  ])("preserves %s denial before validation or mutation", async (_label, redirect) => {
    const error = Object.assign(new Error(redirect), { __redirect: redirect.slice(11) });
    mocks.requireOwner.mockRejectedValue(error);

    await expect(createRecipeAction(INITIAL_STATE, recipeForm())).rejects.toMatchObject({
      __redirect: error.__redirect,
    });

    expect(mocks.createRecipe).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
