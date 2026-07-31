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

function getRow(index = 1) {
  return screen.getByRole("listitem", { name: `Ingrediente ${index}` });
}

async function fillRow(
  user: ReturnType<typeof userEvent.setup>,
  index: number,
  materialLabel: string,
  quantity: string,
  unit: string,
) {
  const row = getRow(index);
  await user.selectOptions(within(row).getByLabelText("Material"), materialLabel);
  await user.type(within(row).getByLabelText("Cantidad"), quantity);
  await user.selectOptions(within(row).getByLabelText("Unidad"), unit);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createRecipeAction.mockResolvedValue({ status: "success", recipeId: "recipe-1" });
});

it("anchors the form at #new-recipe and exposes a Spanish create heading", () => {
  render(<RecipeCreateForm materials={MATERIALS} />);
  expect(document.getElementById("new-recipe")).not.toBeNull();
  expect(screen.getByRole("heading", { name: "Nueva receta" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Crear receta" })).toBeInTheDocument();
});

it("starts with a blank name field, a single empty ingredient row, and a sorted catalog", () => {
  render(<RecipeCreateForm materials={MATERIALS} />);
  expect(screen.getByRole("textbox", { name: "Nombre" })).toHaveValue("");
  expect(screen.getByRole("listitem", { name: "Ingrediente 1" })).toBeInTheDocument();
  const options = Array.from(screen.getByLabelText("Material").querySelectorAll("option"));
  expect(options.map((opt) => opt.textContent)).toEqual([
    "Seleccioná un material",
    "Cotton wick",
    "Lavender scent",
    "Soy wax",
  ]);
});

it("shows Zod field errors and never invokes the Server Action when fields are empty", async () => {
  const user = userEvent.setup();
  render(<RecipeCreateForm materials={MATERIALS} />);
  await user.click(screen.getByRole("button", { name: "Crear receta" }));
  expect(await screen.findByText("Ingresá un nombre para la receta.")).toBeInTheDocument();
  expect(await screen.findByText("Seleccioná un material disponible.")).toBeInTheDocument();
  expect(
    await screen.findByText("Ingresá una cantidad válida mayor que cero, con hasta 6 decimales."),
  ).toBeInTheDocument();
  expect(mocks.createRecipeAction).not.toHaveBeenCalled();
});

it("adds and removes rows, allowing zero rows with the schema error", async () => {
  const user = userEvent.setup();
  render(<RecipeCreateForm materials={MATERIALS} />);
  await user.click(screen.getByRole("button", { name: "Agregar ingrediente" }));
  expect(screen.getByRole("listitem", { name: "Ingrediente 2" })).toBeInTheDocument();
  expect(within(getRow(2)).getByLabelText("Material")).toHaveAttribute("aria-invalid", "false");
  await user.click(within(getRow(1)).getByRole("button", { name: "Quitar ingrediente 1" }));
  await user.click(within(getRow(1)).getByRole("button", { name: "Quitar ingrediente 1" }));
  expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Crear receta" }));
  expect(await screen.findByText("Agregá al menos un ingrediente.")).toBeInTheDocument();
  expect(mocks.createRecipeAction).not.toHaveBeenCalled();
});

it("keeps unit choices and submitted rows independent and ordered", async () => {
  const user = userEvent.setup();
  render(<RecipeCreateForm materials={MATERIALS} />);
  await user.click(screen.getByRole("button", { name: "Agregar ingrediente" }));
  await fillRow(user, 1, "Soy wax", "100", "g");
  await fillRow(user, 2, "Cotton wick", "2", "unit");
  expect(within(getRow(1)).getByLabelText("Unidad")).toHaveValue("g");
  expect(within(getRow(2)).getByLabelText("Unidad")).toHaveValue("unit");
  await user.type(screen.getByRole("textbox", { name: "Nombre" }), "Two item candle");
  await user.click(screen.getByRole("button", { name: "Crear receta" }));
  await waitFor(() => expect(mocks.createRecipeAction).toHaveBeenCalledTimes(1));
  expect(JSON.parse(String(mocks.createRecipeAction.mock.calls[0][1].get("items")))).toEqual([
    { materialId: "wax", quantity: "100", unit: "g" },
    { materialId: "wick", quantity: "2", unit: "unit" },
  ]);
});
it("switches the unit options to match the selected material's dimension", async () => {
  const user = userEvent.setup();
  render(<RecipeCreateForm materials={MATERIALS} />);
  const row = getRow(1);
  expect(within(row).getByLabelText("Unidad")).toHaveValue("g");
  await user.selectOptions(within(row).getByLabelText("Material"), "Cotton wick");
  expect(within(row).getByLabelText("Unidad")).toHaveValue("unit");
  await user.selectOptions(within(row).getByLabelText("Material"), "Soy wax");
  expect(within(row).getByLabelText("Unidad")).toHaveValue("g");
});

it("submits the name and items JSON to the Server Action, then announces success and resets", async () => {
  const user = userEvent.setup();
  render(<RecipeCreateForm materials={MATERIALS} />);
  await user.type(screen.getByRole("textbox", { name: "Nombre" }), "Vanilla candle");
  await fillRow(user, 1, "Soy wax", "100", "g");
  await user.click(screen.getByRole("button", { name: "Crear receta" }));
  await waitFor(() => expect(mocks.createRecipeAction).toHaveBeenCalledTimes(1));
  const submitted = mocks.createRecipeAction.mock.calls[0][1] as FormData;
  expect(submitted.get("name")).toBe("Vanilla candle");
  expect(JSON.parse(String(submitted.get("items")))).toEqual([
    { materialId: "wax", quantity: "100", unit: "g" },
  ]);
  expect(await screen.findByRole("status")).toHaveTextContent("Receta creada.");
  await waitFor(() => {
    expect(screen.getByRole("textbox", { name: "Nombre" })).toHaveValue("");
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
  await user.type(screen.getByRole("textbox", { name: "Nombre" }), "Vanilla candle");
  await fillRow(user, 1, "Soy wax", "100", "g");
  await user.click(screen.getByRole("button", { name: "Crear receta" }));
  expect(await screen.findByRole("button", { name: "Creando receta…" })).toBeDisabled();
  resolveAction({ status: "success", recipeId: "recipe-1" });
  expect(await screen.findByRole("status")).toHaveTextContent("Receta creada.");
});

it("surfaces a server field error on the name input and keeps the form values intact", async () => {
  const user = userEvent.setup();
  mocks.createRecipeAction.mockResolvedValue({
    status: "error",
    fieldErrors: { name: ["A recipe with that name already exists."] },
  });
  render(<RecipeCreateForm materials={MATERIALS} />);
  await user.type(screen.getByRole("textbox", { name: "Nombre" }), "Vanilla candle");
  await fillRow(user, 1, "Soy wax", "100", "g");
  await user.click(screen.getByRole("button", { name: "Crear receta" }));
  const alerts = await screen.findAllByRole("alert");
  expect(alerts.some((node) => node.textContent === "Ingresá un nombre para la receta.")).toBe(
    true,
  );
  expect(screen.getByRole("textbox", { name: "Nombre" })).toHaveValue("Vanilla candle");
});

it("localizes a Server Action failure without changing submitted values", async () => {
  const user = userEvent.setup();
  mocks.createRecipeAction.mockResolvedValue({
    status: "error",
    message: "Unable to create recipe.",
  });
  render(<RecipeCreateForm materials={MATERIALS} />);
  await user.type(screen.getByRole("textbox", { name: "Nombre" }), "Vanilla candle");
  await fillRow(user, 1, "Soy wax", "100", "g");
  await user.click(screen.getByRole("button", { name: "Crear receta" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo crear la receta.");
  expect(screen.getByRole("textbox", { name: "Nombre" })).toHaveValue("Vanilla candle");
});
