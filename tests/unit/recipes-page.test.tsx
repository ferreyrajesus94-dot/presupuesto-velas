import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  listRecipes: vi.fn(),
  countArchivedRecipes: vi.fn(),
  listMaterials: vi.fn(),
}));

vi.mock("../../src/server/auth/requireOwner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("../../src/server/repositories/recipes", () => ({
  listRecipes: mocks.listRecipes,
  countArchivedRecipes: mocks.countArchivedRecipes,
}));
vi.mock("../../src/server/repositories/materials", () => ({
  listMaterials: mocks.listMaterials,
}));

import RecipesPage from "../../src/app/recipes/page";

function pageProps(view?: "active" | "all") {
  return { searchParams: Promise.resolve(view ? { view } : {}) };
}

const RECIPE_RECORD_ACTIVE = {
  recipe: {
    id: "recipe-1",
    name: "Vanilla candle",
    unitCost: "1100.000000000000000000",
    archivedAt: null,
  },
  items: [{ id: "item-1" }, { id: "item-2" }],
};
const RECIPE_RECORD_ARCHIVED = {
  recipe: {
    id: "recipe-archived",
    name: "Citrus candle",
    unitCost: "800.000000000000000000",
    archivedAt: new Date("2026-01-01T00:00:00Z"),
  },
  items: [{ id: "item-3" }],
};

const ACTIVE_MATERIALS = [{ id: "wax", name: "Soy wax", baseUnit: "g", unitCost: "10" }];

function listRecipesHonoringVisibility() {
  mocks.listRecipes.mockImplementation(
    async (_ownerId: string, visibility: { includeArchived?: boolean } = {}) => {
      const all = [RECIPE_RECORD_ACTIVE, RECIPE_RECORD_ARCHIVED];
      if (visibility.includeArchived) return all;
      return all.filter(({ recipe }) => recipe.archivedAt === null);
    },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireOwner.mockResolvedValue({ id: "owner-1", email: "owner@example.com" });
  mocks.listRecipes.mockResolvedValue([]);
  mocks.countArchivedRecipes.mockResolvedValue(0);
  mocks.listMaterials.mockResolvedValue(ACTIVE_MATERIALS);
});

describe("/recipes page composition", () => {
  it("renders the page heading, the empty state, and the create form anchored at #new-recipe", async () => {
    render(await RecipesPage(pageProps()));
    expect(screen.getByRole("heading", { name: "Recipes" })).toBeInTheDocument();
    expect(screen.getByText("No recipes yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create your first recipe" })).toHaveAttribute(
      "href",
      "#new-recipe",
    );
    // PR3t: the empty-state CTA now points at a real section in the DOM.
    expect(document.getElementById("new-recipe")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Create recipe" })).toBeInTheDocument();
    expect(mocks.requireOwner).toHaveBeenCalledTimes(1);
    expect(mocks.listMaterials).toHaveBeenCalledWith("owner-1", { includeArchived: false });
  });

  it("defaults to active visibility, excludes archived recipes, and exposes the active view as current", async () => {
    listRecipesHonoringVisibility();
    render(await RecipesPage(pageProps()));
    expect(mocks.listRecipes).toHaveBeenCalledWith("owner-1", { includeArchived: false });
    const list = screen.getByRole("list", { name: "Recipes" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Vanilla candle");
    expect(items[0]).toHaveTextContent("ARS 1100");
    expect(items[0]).toHaveTextContent("2 items");
    expect(screen.queryByTestId("archived-badge")).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Recipe view filter" });
    expect(within(nav).getByRole("link", { name: /Active/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("includes archived recipes with a badge when the view is all", async () => {
    listRecipesHonoringVisibility();
    render(await RecipesPage(pageProps("all")));
    expect(mocks.listRecipes).toHaveBeenCalledWith("owner-1", { includeArchived: true });
    const list = screen.getByRole("list", { name: "Recipes" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByTestId("archived-badge")).toHaveTextContent("Archived");
    const nav = screen.getByRole("navigation", { name: "Recipe view filter" });
    expect(within(nav).getByRole("link", { name: /Show archived/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("uses singular copy when only one item belongs to a recipe", async () => {
    mocks.listRecipes.mockResolvedValue([{ ...RECIPE_RECORD_ACTIVE, items: [{ id: "x" }] }]);
    render(await RecipesPage(pageProps()));
    const list = screen.getByRole("list", { name: "Recipes" });
    expect(within(list).getByRole("listitem")).toHaveTextContent("1 item");
  });

  it("shows a view-aware empty state when the active list is empty but archived recipes exist", async () => {
    mocks.countArchivedRecipes.mockResolvedValue(3);
    render(await RecipesPage(pageProps()));
    expect(screen.getByRole("heading", { name: "No active recipes" })).toBeInTheDocument();
    expect(screen.getByText("3 recipes are archived and hidden in this view.")).toBeInTheDocument();
    // Two "Show archived" affordances exist (nav + empty state body); both must
    // point to /recipes?view=all.
    const showArchived = screen.getAllByRole("link", { name: "Show archived" });
    expect(showArchived.length).toBeGreaterThanOrEqual(1);
    expect(showArchived.every((link) => link.getAttribute("href") === "/recipes?view=all")).toBe(
      true,
    );
    expect(mocks.countArchivedRecipes).toHaveBeenCalledWith("owner-1");
  });

  it("uses singular copy when only one archived recipe exists", async () => {
    mocks.countArchivedRecipes.mockResolvedValue(1);
    render(await RecipesPage(pageProps()));
    expect(screen.getByText("1 recipe is archived and hidden in this view.")).toBeInTheDocument();
  });

  it("does not query the archived count when the active list is non-empty", async () => {
    listRecipesHonoringVisibility();
    render(await RecipesPage(pageProps()));
    expect(mocks.countArchivedRecipes).not.toHaveBeenCalled();
  });

  it("does not query the archived count in the all view even when the list is empty", async () => {
    render(await RecipesPage(pageProps("all")));
    expect(mocks.countArchivedRecipes).not.toHaveBeenCalled();
    expect(screen.getByText("No recipes yet")).toBeInTheDocument();
  });
});
