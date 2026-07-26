import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMaterialAction: vi.fn(),
}));

vi.mock("../../src/server/actions/materials", () => ({
  updateMaterialAction: mocks.updateMaterialAction,
}));

import { MaterialEditForm } from "../../src/app/materials/MaterialEditForm";

const MATERIAL = {
  id: "material-1",
  name: "Soy wax",
  dimension: "mass" as const,
  baseUnit: "g" as const,
  purchaseUnit: "kg" as const,
  purchaseQuantity: "1",
  purchasePrice: "10000",
  unitCost: "10",
  archived: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.updateMaterialAction.mockResolvedValue({ status: "success", materialId: MATERIAL.id });
});

it("prefills the edit form with the material's current values", () => {
  render(<MaterialEditForm material={MATERIAL} />);

  expect(screen.getByRole("heading", { name: "Edit material: Soy wax" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Name for Soy wax" })).toHaveValue("Soy wax");
  expect(screen.getByLabelText("Dimension for Soy wax")).toHaveValue("mass");
  expect(screen.getByLabelText("Base unit for Soy wax")).toHaveValue("g");
  expect(screen.getByLabelText("Purchase unit for Soy wax")).toHaveValue("kg");
  expect(screen.getByLabelText("Purchase quantity for Soy wax")).toHaveValue(1);
  expect(screen.getByLabelText("Purchase price (ARS) for Soy wax")).toHaveValue(10000);
});

it("shows client validation and keeps the action untouched", async () => {
  const user = userEvent.setup();
  render(<MaterialEditForm material={MATERIAL} />);

  await user.clear(screen.getByRole("textbox", { name: "Name for Soy wax" }));
  await user.click(screen.getByRole("button", { name: "Save material" }));

  expect(await screen.findByText("Name is required")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: /Name for Soy wax/ })).toHaveFocus();
  expect(mocks.updateMaterialAction).not.toHaveBeenCalled();
});

it("keeps the current values until the editor's dimension changes", async () => {
  const user = userEvent.setup();
  render(<MaterialEditForm material={MATERIAL} />);

  expect(screen.getByLabelText("Purchase unit for Soy wax")).toHaveValue("kg");
  await user.selectOptions(screen.getByLabelText("Dimension for Soy wax"), "volume");

  expect(screen.getByLabelText("Base unit for Soy wax")).toHaveValue("ml");
  expect(screen.getByLabelText("Purchase unit for Soy wax")).toHaveValue("ml");
});

it("submits the material id and changed values, then reports success", async () => {
  const user = userEvent.setup();
  render(<MaterialEditForm material={MATERIAL} />);

  await user.clear(screen.getByRole("textbox", { name: "Name for Soy wax" }));
  await user.type(screen.getByRole("textbox", { name: "Name for Soy wax" }), "Coconut wax");
  await user.click(screen.getByRole("button", { name: "Save material" }));

  expect(mocks.updateMaterialAction).toHaveBeenCalledTimes(1);
  const submitted = mocks.updateMaterialAction.mock.calls[0][1] as FormData;
  expect(submitted.get("id")).toBe(MATERIAL.id);
  expect(submitted.get("name")).toBe("Coconut wax");
  expect(submitted.get("purchasePrice")).toBe(MATERIAL.purchasePrice);
  expect(await screen.findByRole("status")).toHaveTextContent("Material updated.");
});

it("shows pending feedback while the update is in flight", async () => {
  const user = userEvent.setup();
  let resolveAction!: (value: unknown) => void;
  mocks.updateMaterialAction.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
  );
  render(<MaterialEditForm material={MATERIAL} />);

  await user.click(screen.getByRole("button", { name: "Save material" }));

  expect(await screen.findByRole("button", { name: "Saving material…" })).toBeDisabled();
  resolveAction({ status: "success", materialId: MATERIAL.id });
  await waitFor(() => expect(mocks.updateMaterialAction).toHaveBeenCalledTimes(1));
});

it("shows a backend error and focuses a returned derived-cost field", async () => {
  const user = userEvent.setup();
  const message = "Derived unit cost cannot be represented at database precision";
  mocks.updateMaterialAction.mockResolvedValue({
    status: "error",
    fieldErrors: { unitCost: [message] },
  });
  render(<MaterialEditForm material={MATERIAL} />);

  await user.click(screen.getByRole("button", { name: "Save material" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  await waitFor(() =>
    expect(screen.getByLabelText("Purchase price (ARS) for Soy wax")).toHaveFocus(),
  );
});
