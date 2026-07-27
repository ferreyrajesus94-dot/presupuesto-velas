import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ updateRecipeAction: vi.fn() }));
vi.mock("../../src/server/actions/recipes", () => ({
  updateRecipeAction: mocks.updateRecipeAction,
}));

import { RecipeEditForm } from "../../src/app/recipes/RecipeEditForm";

const MATERIALS = [
  { id: "wax", name: "Soy wax", baseUnit: "g", unitCost: "10" },
  { id: "scent", name: "Lavender scent", baseUnit: "ml", unitCost: "50" },
  { id: "wick", name: "Cotton wick", baseUnit: "unit", unitCost: "20" },
];
const RECIPE = {
  id: "recipe-1",
  name: "Vanilla candle",
  items: [{ materialId: "wax", quantity: "100", unit: "g" as const }],
};
const row = (n: number) => screen.getByTestId(`recipe-edit-item-${n}`);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.updateRecipeAction.mockResolvedValue({ status: "success", recipeId: RECIPE.id });
});

it("renders a prefilled edit form anchored at the recipe id with edit-specific labels", () => {
  render(<RecipeEditForm recipe={RECIPE} materials={MATERIALS} />);
  expect(document.getElementById("edit-recipe-recipe-1")).not.toBeNull();
  expect(screen.getByRole("heading", { name: /Edit recipe: Vanilla candle/ })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Name for Vanilla candle" })).toHaveValue(
    "Vanilla candle",
  );
  expect(within(row(1)).getByLabelText("Material")).toHaveValue("wax");
  expect(within(row(1)).getByLabelText("Quantity")).toHaveValue(100);
  expect(within(row(1)).getByLabelText("Unit")).toHaveValue("g");
});

it("supports add/remove, surfaces client validation, and never invokes the action", async () => {
  const user = userEvent.setup();
  render(<RecipeEditForm recipe={RECIPE} materials={MATERIALS} />);
  await user.click(screen.getByRole("button", { name: "Add recipe item" }));
  expect(row(2)).toBeInTheDocument();
  await user.click(within(row(2)).getByRole("button", { name: "Remove item 2" }));
  expect(screen.queryByTestId("recipe-edit-item-2")).not.toBeInTheDocument();
  await user.clear(screen.getByRole("textbox", { name: "Name for Vanilla candle" }));
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  expect(await screen.findByText("Name is required")).toBeInTheDocument();
  expect(mocks.updateRecipeAction).not.toHaveBeenCalled();
});

it("keeps per-row unit options independent of the selected material's dimension", async () => {
  const user = userEvent.setup();
  render(
    <RecipeEditForm
      recipe={{
        ...RECIPE,
        items: [
          { materialId: "wax", quantity: "100", unit: "g" as const },
          { materialId: "wick", quantity: "2", unit: "unit" as const },
        ],
      }}
      materials={MATERIALS}
    />,
  );
  expect(within(row(1)).getByLabelText("Unit")).toHaveValue("g");
  expect(within(row(2)).getByLabelText("Unit")).toHaveValue("unit");
  await user.selectOptions(within(row(1)).getByLabelText("Material"), "Cotton wick");
  expect(within(row(1)).getByLabelText("Unit")).toHaveValue("unit");
});

it.each([
  [
    "happy submit",
    { status: "success", recipeId: "recipe-1" } satisfies Partial<{
      status: "success";
      recipeId: string;
    }>,
  ],
  [
    "safe NOT_FOUND",
    { status: "error", message: "Recipe could not be found." } satisfies Partial<{
      status: "error";
      message: string;
    }>,
  ],
])("submits id+items with %s feedback and never resets form values", async (_label, response) => {
  const user = userEvent.setup();
  let resolve!: (v: unknown) => void;
  mocks.updateRecipeAction.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  render(<RecipeEditForm recipe={RECIPE} materials={MATERIALS} />);
  await user.click(screen.getByRole("button", { name: "Add recipe item" }));
  await user.selectOptions(within(row(2)).getByLabelText("Material"), "Cotton wick");
  await user.type(within(row(2)).getByLabelText("Quantity"), "2");
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  expect(await screen.findByRole("button", { name: "Saving recipe…" })).toBeDisabled();
  resolve(response);
  await waitFor(() => expect(mocks.updateRecipeAction).toHaveBeenCalledTimes(1));
  const submitted = mocks.updateRecipeAction.mock.calls[0][1] as FormData;
  expect(submitted.get("id")).toBe("recipe-1");
  expect(JSON.parse(String(submitted.get("items")))).toEqual([
    { materialId: "wax", quantity: "100", unit: "g" },
    { materialId: "wick", quantity: "2", unit: "unit" },
  ]);
  expect(screen.getByRole("textbox", { name: "Name for Vanilla candle" })).toHaveValue(
    "Vanilla candle",
  );
});
