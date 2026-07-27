import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRecipeAction: vi.fn(),
}));

vi.mock("../../src/server/actions/recipes", () => ({
  createRecipeAction: mocks.createRecipeAction,
}));

import { RecipeCreateForm } from "../../src/app/recipes/RecipeCreateForm";

const MATERIALS = [
  { id: "wax", name: "Soy wax", baseUnit: "g", unitCost: "10" },
  { id: "scent", name: "Lavender scent", baseUnit: "ml", unitCost: "50" },
  { id: "wick", name: "Cotton wick", baseUnit: "unit", unitCost: "20" },
];

function getRow() {
  return screen.getByRole("listitem", { name: "Item 1" });
}

async function fillRow(
  user: ReturnType<typeof userEvent.setup>,
  materialLabel: string,
  quantity: string,
  unit: string,
) {
  const row = getRow();
  await user.selectOptions(within(row).getByLabelText("Material"), materialLabel);
  await user.type(within(row).getByLabelText("Quantity"), quantity);
  await user.selectOptions(within(row).getByLabelText("Unit"), unit);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createRecipeAction.mockResolvedValue({ status: "success", recipeId: "recipe-1" });
});

it("anchors the form at #new-recipe and exposes a Create recipe heading", () => {
  render(<RecipeCreateForm materials={MATERIALS} />);
  expect(document.getElementById("new-recipe")).not.toBeNull();
  expect(screen.getByRole("heading", { name: "Create recipe" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create recipe" })).toBeInTheDocument();
});

it("starts with a blank name field, a single empty item row, and a sortable material catalog", () => {
  render(<RecipeCreateForm materials={MATERIALS} />);
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("");
  expect(screen.getByRole("listitem", { name: "Item 1" })).toBeInTheDocument();
  const options = Array.from(screen.getByLabelText("Material").querySelectorAll("option"));
  expect(options.map((opt) => opt.textContent)).toEqual([
    "Select a material",
    "Cotton wick",
    "Lavender scent",
    "Soy wax",
  ]);
});

it("shows Zod field errors and never invokes the Server Action when fields are empty", async () => {
  const user = userEvent.setup();
  render(<RecipeCreateForm materials={MATERIALS} />);
  await user.click(screen.getByRole("button", { name: "Create recipe" }));
  expect(await screen.findByText("Name is required")).toBeInTheDocument();
  expect(await screen.findByText("Material is required")).toBeInTheDocument();
  expect(
    await screen.findByText("Enter a quantity with up to 6 decimal places"),
  ).toBeInTheDocument();
  expect(mocks.createRecipeAction).not.toHaveBeenCalled();
});

it("switches the unit options to match the selected material's dimension", async () => {
  const user = userEvent.setup();
  render(<RecipeCreateForm materials={MATERIALS} />);
  const row = getRow();
  expect(within(row).getByLabelText("Unit")).toHaveValue("g");
  await user.selectOptions(within(row).getByLabelText("Material"), "Cotton wick");
  expect(within(row).getByLabelText("Unit")).toHaveValue("unit");
  await user.selectOptions(within(row).getByLabelText("Material"), "Soy wax");
  expect(within(row).getByLabelText("Unit")).toHaveValue("g");
});

it("submits the name and items JSON to the Server Action, then announces success and resets", async () => {
  const user = userEvent.setup();
  render(<RecipeCreateForm materials={MATERIALS} />);
  await user.type(screen.getByRole("textbox", { name: "Name" }), "Vanilla candle");
  await fillRow(user, "Soy wax", "100", "g");
  await user.click(screen.getByRole("button", { name: "Create recipe" }));
  await waitFor(() => expect(mocks.createRecipeAction).toHaveBeenCalledTimes(1));
  const submitted = mocks.createRecipeAction.mock.calls[0][1] as FormData;
  expect(submitted.get("name")).toBe("Vanilla candle");
  expect(JSON.parse(String(submitted.get("items")))).toEqual([
    { materialId: "wax", quantity: "100", unit: "g" },
  ]);
  expect(await screen.findByRole("status")).toHaveTextContent("Recipe created.");
  await waitFor(() => {
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("");
    expect(within(getRow()).getByLabelText("Material")).toHaveValue("");
  });
});

it("shows pending feedback while the Server Action is in flight", async () => {
  const user = userEvent.setup();
  let resolveAction!: (value: unknown) => void;
  mocks.createRecipeAction.mockImplementation(
    () => new Promise((resolve) => (resolveAction = resolve)),
  );
  render(<RecipeCreateForm materials={MATERIALS} />);
  await user.type(screen.getByRole("textbox", { name: "Name" }), "Vanilla candle");
  await fillRow(user, "Soy wax", "100", "g");
  await user.click(screen.getByRole("button", { name: "Create recipe" }));
  expect(await screen.findByRole("button", { name: "Creating recipe…" })).toBeDisabled();
  resolveAction({ status: "success", recipeId: "recipe-1" });
  expect(await screen.findByRole("status")).toHaveTextContent("Recipe created.");
});

it("surfaces a server field error on the name input and keeps the form values intact", async () => {
  const user = userEvent.setup();
  mocks.createRecipeAction.mockResolvedValue({
    status: "error",
    fieldErrors: { name: ["A recipe with that name already exists."] },
  });
  render(<RecipeCreateForm materials={MATERIALS} />);
  await user.type(screen.getByRole("textbox", { name: "Name" }), "Vanilla candle");
  await fillRow(user, "Soy wax", "100", "g");
  await user.click(screen.getByRole("button", { name: "Create recipe" }));
  const alerts = await screen.findAllByRole("alert");
  expect(alerts.some((node) => /already exists/.test(node.textContent ?? ""))).toBe(true);
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Vanilla candle");
});
