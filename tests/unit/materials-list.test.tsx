import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  listMaterials: vi.fn(),
  createMaterialAction: vi.fn(),
}));

vi.mock("../../src/server/auth/requireOwner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("../../src/server/repositories/materials", () => ({
  listMaterials: mocks.listMaterials,
}));
vi.mock("../../src/server/actions/materials", () => ({
  createMaterialAction: mocks.createMaterialAction,
}));

import MaterialsPage from "../../src/app/materials/page";
import { MaterialCreateForm } from "../../src/app/materials/MaterialCreateForm";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireOwner.mockResolvedValue({ id: "owner-1", email: "owner@example.com" });
  mocks.createMaterialAction.mockResolvedValue({ status: "success", materialId: "material-1" });
});

it("shows an actionable empty state when the owner has no materials", async () => {
  mocks.listMaterials.mockResolvedValue([]);

  render(await MaterialsPage());

  expect(screen.getByRole("heading", { name: "Materials" })).toBeInTheDocument();
  expect(screen.getByText("No materials yet")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Add your first material" })).toHaveAttribute(
    "href",
    "#new-material",
  );
});

it("renders current materials with their exact base-unit costs", async () => {
  mocks.listMaterials.mockResolvedValue([
    { id: "material-1", name: "Soy wax", baseUnit: "g", unitCost: "10" },
  ]);

  render(await MaterialsPage());

  expect(screen.getByRole("listitem")).toHaveTextContent("Soy wax");
  expect(screen.getByRole("listitem")).toHaveTextContent("ARS 10 per g");
});

async function fillMaterialForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Name"), "Soy wax");
  await user.selectOptions(screen.getByLabelText("Purchase unit"), "kg");
  await user.type(screen.getByLabelText("Purchase quantity"), "1");
  await user.type(screen.getByLabelText("Purchase price (ARS)"), "10000");
}

it("validates with Zod before invoking the Server Action", async () => {
  const user = userEvent.setup();
  render(<MaterialCreateForm />);

  await user.click(screen.getByRole("button", { name: "Create material" }));

  expect(await screen.findByText("Name is required")).toBeInTheDocument();
  expect(mocks.createMaterialAction).not.toHaveBeenCalled();
});

it("shows and focuses a client-derived unit-cost error before invoking the Server Action", async () => {
  const user = userEvent.setup();
  render(<MaterialCreateForm />);
  await user.type(screen.getByLabelText("Name"), "Soy wax");
  await user.type(screen.getByLabelText("Purchase quantity"), "0.000001");
  const price = screen.getByLabelText("Purchase price (ARS)");
  await user.type(price, "1000000000000000");

  await user.click(screen.getByRole("button", { name: "Create material" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Derived unit cost cannot be represented at database precision",
  );
  expect(price).toHaveAttribute("aria-describedby", "purchase-price-error unit-cost-error");
  expect(price).toHaveFocus();
  expect(mocks.createMaterialAction).not.toHaveBeenCalled();
});

it("submits FormData to the Server Action and reports success", async () => {
  const user = userEvent.setup();
  render(<MaterialCreateForm />);
  await fillMaterialForm(user);

  await user.click(screen.getByRole("button", { name: "Create material" }));

  expect(mocks.createMaterialAction).toHaveBeenCalledTimes(1);
  const submitted = mocks.createMaterialAction.mock.calls[0][1] as FormData;
  expect(submitted.get("name")).toBe("Soy wax");
  expect(submitted.get("purchaseUnit")).toBe("kg");
  expect(submitted.get("purchasePrice")).toBe("10000");
  expect(await screen.findByRole("status")).toHaveTextContent("Material created.");
});

it("shows pending feedback and the derived-cost error returned by the server", async () => {
  const user = userEvent.setup();
  let resolveAction!: (value: unknown) => void;
  mocks.createMaterialAction.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
  );
  render(<MaterialCreateForm />);
  await fillMaterialForm(user);

  await user.click(screen.getByRole("button", { name: "Create material" }));
  expect(await screen.findByRole("button", { name: "Creating material…" })).toBeDisabled();
  resolveAction({
    status: "error",
    fieldErrors: { unitCost: ["Derived unit cost cannot be represented at database precision"] },
  });

  expect(
    await screen.findByText("Derived unit cost cannot be represented at database precision"),
  ).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText("Purchase price (ARS)")).toHaveFocus());
});

it("resets the form after a successful create without dispatching a duplicate action", async () => {
  const user = userEvent.setup();
  render(<MaterialCreateForm />);
  await fillMaterialForm(user);

  await user.click(screen.getByRole("button", { name: "Create material" }));

  expect(await screen.findByRole("status")).toHaveTextContent("Material created.");
  expect(mocks.createMaterialAction).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Name")).toHaveValue("");
  expect(screen.getByLabelText("Dimension")).toHaveValue("mass");
  expect(screen.getByLabelText("Base unit")).toHaveValue("g");
  expect(screen.getByLabelText("Purchase unit")).toHaveValue("g");
  expect(screen.getByLabelText("Purchase quantity")).toHaveValue(null);
  expect(screen.getByLabelText("Purchase price (ARS)")).toHaveValue(null);
});

it("resets again after a later successful create", async () => {
  const user = userEvent.setup();
  mocks.createMaterialAction
    .mockResolvedValueOnce({ status: "success", materialId: "material-1" })
    .mockResolvedValueOnce({ status: "success", materialId: "material-2" });
  render(<MaterialCreateForm />);

  await fillMaterialForm(user);
  await user.click(screen.getByRole("button", { name: "Create material" }));
  await waitFor(() => expect(mocks.createMaterialAction).toHaveBeenCalledTimes(1));

  await fillMaterialForm(user);
  await user.click(screen.getByRole("button", { name: "Create material" }));
  await waitFor(() => expect(mocks.createMaterialAction).toHaveBeenCalledTimes(2));

  expect(screen.getByLabelText("Name")).toHaveValue("");
  expect(screen.getByLabelText("Purchase quantity")).toHaveValue(null);
  expect(screen.getByLabelText("Purchase price (ARS)")).toHaveValue(null);
});

it("does not steal focus on unrelated rerenders after a server unit-cost error", async () => {
  const user = userEvent.setup();
  mocks.createMaterialAction.mockResolvedValue({
    status: "error",
    fieldErrors: { unitCost: ["Derived unit cost cannot be represented at database precision"] },
  });
  render(<MaterialCreateForm />);
  await fillMaterialForm(user);

  await user.click(screen.getByRole("button", { name: "Create material" }));
  await screen.findByText("Derived unit cost cannot be represented at database precision");

  const name = screen.getByLabelText("Name");
  await user.click(name);
  await user.type(name, " updated");

  expect(name).toHaveFocus();
});
