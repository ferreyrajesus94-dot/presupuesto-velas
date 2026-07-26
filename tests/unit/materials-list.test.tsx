import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  listMaterials: vi.fn(),
}));

vi.mock("../../src/server/auth/requireOwner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("../../src/server/repositories/materials", () => ({
  listMaterials: mocks.listMaterials,
}));

import MaterialsPage from "../../src/app/materials/page";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireOwner.mockResolvedValue({ id: "owner-1", email: "owner@example.com" });
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
