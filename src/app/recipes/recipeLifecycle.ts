export type RecipeLifecycleOperation = "archive" | "restore";

export type RecipeLifecycleResult = {
  operation: RecipeLifecycleOperation;
  recipeName: string;
};

export function buildRecipeLifecycleCopy(result: RecipeLifecycleResult): string {
  // The copy derives from the operation captured at dispatch, never from a
  // refreshed `recipe.archivedAt` prop that may flip after revalidation.
  // This guarantees the message verb matches what the user actually performed.
  const verb = result.operation === "archive" ? "archivada" : "restaurada";
  return `${result.recipeName} ${verb}.`;
}
