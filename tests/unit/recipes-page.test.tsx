import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  listRecipes: vi.fn(),
  countArchivedRecipes: vi.fn(),
  listMaterials: vi.fn(),
  recipeActions: vi.fn(),
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
// Page-level composition mounts the create + update forms and the PR3y
// lifecycle controls. The page itself never invokes an action, so a single
// stub covers all four exports to keep the dependency graph intact while
// keeping the page-level test surface focused on composition.
vi.mock("../../src/server/actions/recipes", () => ({
  createRecipeAction: mocks.recipeActions,
  updateRecipeAction: mocks.recipeActions,
  archiveRecipeAction: mocks.recipeActions,
  restoreRecipeAction: mocks.recipeActions,
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
  items: [
    { id: "item-1", position: 1, materialId: "wax", quantity: "100.000000" },
    { id: "item-2", position: 2, materialId: "wick", quantity: "2.000000" },
  ],
};
const RECIPE_RECORD_ACTIVE_OTHER = {
  recipe: {
    id: "recipe-other",
    name: "Cinnamon candle",
    unitCost: "950.000000000000000000",
    archivedAt: null,
  },
  items: [{ id: "item-other-1", position: 1, materialId: "wax", quantity: "80.000000" }],
};
const RECIPE_RECORD_ARCHIVED = {
  recipe: {
    id: "recipe-archived",
    name: "Citrus candle",
    unitCost: "800.000000000000000000",
    archivedAt: new Date("2026-01-01T00:00:00Z"),
  },
  items: [{ id: "item-3", position: 1, materialId: "wax", quantity: "120.000000" }],
};

const ACTIVE_MATERIALS = [
  { id: "wax", name: "Soy wax", baseUnit: "g", unitCost: "10" },
  { id: "wick", name: "Cotton wick", baseUnit: "unit", unitCost: "20" },
];

// Mixed-dimension catalog for the projection-correctness page-boundary test.
// Three distinct baseUnits (mass / count / volume) make the unit-reconstruction
// assertion strong: the previous test only covered two materials both with
// units the form already derives from `materialChange`, so a regression that
// always returns the FALLBACK_UNIT sentinel would slip past it.
const MIXED_DIMENSION_MATERIALS = [
  { id: "m-wax", name: "Soy wax", baseUnit: "g", unitCost: "10" },
  { id: "m-wick", name: "Cotton wick", baseUnit: "unit", unitCost: "20" },
  { id: "m-essence", name: "Vanilla essence", baseUnit: "ml", unitCost: "30" },
];

// Recipe with items deliberately OUT of persisted position order. After
// `projectRecipeItems` sorts by `position` ascending the rows must land in
// the order wick → wax → essence (positions 1, 2, 3), regardless of the DB
// insert order. Materials span three dimensions so a wrong unit fallback
// (e.g., always "g") would still fall on the wrong cell.
const RECIPE_RECORD_MIXED_DIMENSIONS = {
  recipe: {
    id: "recipe-mix",
    name: "Mixed dimensions candle",
    unitCost: "1234.567890123456789000",
    archivedAt: null,
  },
  items: [
    { id: "x-item-wax", position: 2, materialId: "m-wax", quantity: "180.500000" },
    { id: "x-item-essence", position: 3, materialId: "m-essence", quantity: "5.250000" },
    { id: "x-item-wick", position: 1, materialId: "m-wick", quantity: "1.000000" },
  ],
};

function listRecipesHonoringVisibility() {
  mocks.listRecipes.mockImplementation(
    async (_ownerId: string, visibility: { includeArchived?: boolean } = {}) => {
      const all = [RECIPE_RECORD_ACTIVE, RECIPE_RECORD_ACTIVE_OTHER, RECIPE_RECORD_ARCHIVED];
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
  mocks.recipeActions.mockResolvedValue({ status: "success", recipeId: "recipe-1" });
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
    const cards = within(list).getAllByTestId("recipe-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Vanilla candle");
    expect(cards[0]).toHaveTextContent("ARS 1100");
    expect(cards[0]).toHaveTextContent("2 items");
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
    expect(within(list).getAllByTestId("recipe-card")).toHaveLength(3);
    expect(screen.getByTestId("archived-badge")).toHaveTextContent("Archived");
    const nav = screen.getByRole("navigation", { name: "Recipe view filter" });
    expect(within(nav).getByRole("link", { name: /Show archived/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("PR3v.next: mounts the inline RecipeEditForm on each active card, prefilled with the projected recipe items", async () => {
    // The page is an RSC boundary, so each active recipe must reach the form
    // with its own id + ordered items[] + active material catalog — never
    // reaching through any server-only module. The form anchor
    // (#edit-recipe-{id}) supplies the hash/focus destination.
    mocks.listRecipes.mockResolvedValue([RECIPE_RECORD_ACTIVE]);
    render(await RecipesPage(pageProps()));
    expect(document.getElementById("edit-recipe-recipe-1")).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "Edit recipe: Vanilla candle" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name for Vanilla candle" })).toHaveValue(
      "Vanilla candle",
    );
    const card = screen.getByTestId("recipe-card");
    const itemList = within(card).getByRole("list", { name: "Recipe materials" });
    expect(within(itemList).getAllByRole("listitem")).toHaveLength(2);
    // The form's material select is sourced from the page-projected
    // active-material catalog, sorted alphabetically.
    const materialSelects = within(itemList).getAllByLabelText("Material");
    expect(materialSelects).toHaveLength(2);
    const firstMaterialOptions = Array.from(materialSelects[0].querySelectorAll("option")).map(
      (opt) => opt.textContent,
    );
    expect(firstMaterialOptions).toEqual(["Select a material", "Cotton wick", "Soy wax"]);
  });

  it("PR3v.next: never mounts the RecipeEditForm or its affordance for archived recipe cards", async () => {
    // Archived safety: the page must filter RecipeEditForm out of archived
    // records even when the view= all is active. The repository's
    // isNull(archivedAt) guard on updateRecipe is the last-line defense.
    listRecipesHonoringVisibility();
    render(await RecipesPage(pageProps("all")));
    expect(
      screen.queryByRole("heading", { name: "Edit recipe: Citrus candle" }),
    ).not.toBeInTheDocument();
    expect(document.getElementById("edit-recipe-recipe-archived")).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit Citrus candle" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Edit recipe: Vanilla candle" }),
    ).toBeInTheDocument();
  });

  it("PR3v.next: uses a stable per-recipe component identity so prefilled values never leak across cards", async () => {
    // The stable key={recipe.id} identity guarantees that the two active
    // forms preload their own name + items, with no crosstalk between
    // sibling card re-renders.
    mocks.listRecipes.mockResolvedValue([RECIPE_RECORD_ACTIVE, RECIPE_RECORD_ACTIVE_OTHER]);
    render(await RecipesPage(pageProps()));
    expect(
      screen.getByRole("heading", { name: "Edit recipe: Vanilla candle" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Edit recipe: Cinnamon candle" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name for Vanilla candle" })).toHaveValue(
      "Vanilla candle",
    );
    expect(screen.getByRole("textbox", { name: "Name for Cinnamon candle" })).toHaveValue(
      "Cinnamon candle",
    );
    // Vanilla has two preloaded items and Cinnamon has one — the total of
    // three ordered rows confirms each form keeps its own prefill.
    expect(screen.getAllByTestId(/^recipe-edit-item-/)).toHaveLength(3);
  });

  it("PR3v.next: surfaces an Edit affordance per active card that anchors to the inline form section", async () => {
    // Hash/focus navigation: an explicit "Edit {name}" link points to the
    // form's section id so keyboard users can deep-link without scrolling.
    mocks.listRecipes.mockResolvedValue([RECIPE_RECORD_ACTIVE, RECIPE_RECORD_ACTIVE_OTHER]);
    render(await RecipesPage(pageProps()));
    expect(screen.getByRole("link", { name: "Edit Vanilla candle" })).toHaveAttribute(
      "href",
      "#edit-recipe-recipe-1",
    );
    expect(screen.getByRole("link", { name: "Edit Cinnamon candle" })).toHaveAttribute(
      "href",
      "#edit-recipe-recipe-other",
    );
  });

  it("PR3v.next: keeps each form's prefilled values isolated when the recipe order changes between rerenders", async () => {
    // Triangulation: if the form were not keyed by recipe.id, an unsaved
    // local edit on one card would leak into whichever card occupied the
    // same DOM position after a refetch. Repro: render A and B, type into
    // A's name field, rerender with [B, A] (order swap), and confirm A's
    // form still owns its draft edit while B's form is the one preloaded
    // with "Cinnamon candle" — never the stale edit value.
    const user = userEvent.setup();
    mocks.listRecipes.mockResolvedValue([RECIPE_RECORD_ACTIVE, RECIPE_RECORD_ACTIVE_OTHER]);
    const first = await RecipesPage(pageProps());
    const { rerender } = render(first);

    const vanillaName = screen.getByRole("textbox", { name: "Name for Vanilla candle" });
    await user.clear(vanillaName);
    await user.type(vanillaName, "Vanilla candle (draft)");

    // Post-revalidation: refetch puts the other recipe first.
    mocks.listRecipes.mockResolvedValue([RECIPE_RECORD_ACTIVE_OTHER, RECIPE_RECORD_ACTIVE]);
    rerender(await RecipesPage(pageProps()));

    // Vanilla's draft survives on Vanilla — keyed identity.
    expect(screen.getByRole("textbox", { name: "Name for Vanilla candle" })).toHaveValue(
      "Vanilla candle (draft)",
    );
    // Cinnamon's form is now first and is still its own preloaded value.
    expect(screen.getByRole("textbox", { name: "Name for Cinnamon candle" })).toHaveValue(
      "Cinnamon candle",
    );
  });

  it("PR3v.next: page-boundary projection sorts persisted items by position and reconstructs each row's unit from the catalog", async () => {
    // Page-boundary projection guarantee. The fixture's rows are deliberately
    // NOT in persisted position order and span three different baseUnits (mass
    // g / count unit / volume ml), so a regression in `projectRecipeItems`
    // surfaces as one of three concrete failures inside the mounted form:
    //   (a) rows arrive in DB order rather than sorted `position` order,
    //   (b) projection drops a field and emits a blank row,
    //   (c) unit reconstruction falls back to the "g" sentinel for any
    //       dimension other than mass.
    // All three would break the inline editor in the same shape — wrong
    // prefilled values for that recipe — so they must be exercised together.
    mocks.listMaterials.mockResolvedValue(MIXED_DIMENSION_MATERIALS);
    mocks.listRecipes.mockResolvedValue([RECIPE_RECORD_MIXED_DIMENSIONS]);
    render(await RecipesPage(pageProps()));

    const card = screen.getByTestId("recipe-card");
    // Exactly three rows are mounted — neither fewer (blank-row emission)
    // nor more (duplication) is acceptable.
    const rows = within(card).getAllByTestId(/^recipe-edit-item-/);
    expect(rows).toHaveLength(3);

    // Persisted fixture order is [wax, essence, wick]; after position-sort
    // the form must receive [wick (pos 1), wax (pos 2), essence (pos 3)].
    const expectedProjection = [
      {
        rowNumber: 1,
        materialId: "m-wick",
        materialName: "Cotton wick",
        quantity: "1.000000",
        unit: "unit",
      },
      {
        rowNumber: 2,
        materialId: "m-wax",
        materialName: "Soy wax",
        quantity: "180.500000",
        unit: "g",
      },
      {
        rowNumber: 3,
        materialId: "m-essence",
        materialName: "Vanilla essence",
        quantity: "5.250000",
        unit: "ml",
      },
    ];
    for (const expected of expectedProjection) {
      const rowScope = within(screen.getByTestId(`recipe-edit-item-${expected.rowNumber}`));
      const materialSelect = rowScope.getByLabelText("Material") as HTMLSelectElement;
      const quantityInput = rowScope.getByLabelText("Quantity") as HTMLInputElement;
      const unitSelect = rowScope.getByLabelText("Unit") as HTMLSelectElement;
      // Selected materialId matches the position-sorted row + the selected
      // option text matches the material name (catches a regression that
      // renders the right id under the wrong label).
      expect(materialSelect.value).toBe(expected.materialId);
      expect(Array.from(materialSelect.selectedOptions)[0]?.textContent).toBe(
        expected.materialName,
      );
      // Quantity is forwarded verbatim from the normalized decimal string.
      expect(quantityInput.value).toBe(expected.quantity);
      // Unit is reconstructed from each material's `baseUnit`, NOT a single
      // fallback — the form's three rows prove the regression surface.
      expect(unitSelect.value).toBe(expected.unit);
      // No row is allowed to be blank even if a future projection skips a
      // field; assert the empty-string guard against silent regressions.
      expect(materialSelect.value).not.toBe("");
      expect(quantityInput.value).not.toBe("");
      expect(unitSelect.value).not.toBe("");
    }
    // Sorted row order is also visible at the row's semantic label, which
    // forms are NOT supposed to override — this catches row reordering that
    // a position-blind projection would cause.
    expect(within(card).getByLabelText("Item 1")).toBe(screen.getByTestId("recipe-edit-item-1"));
    expect(within(card).getByLabelText("Item 2")).toBe(screen.getByTestId("recipe-edit-item-2"));
    expect(within(card).getByLabelText("Item 3")).toBe(screen.getByTestId("recipe-edit-item-3"));
  });

  it("uses singular copy when only one item belongs to a recipe", async () => {
    mocks.listRecipes.mockResolvedValue([{ ...RECIPE_RECORD_ACTIVE, items: [{ id: "x" }] }]);
    render(await RecipesPage(pageProps()));
    const list = screen.getByRole("list", { name: "Recipes" });
    expect(within(list).getByTestId("recipe-card")).toHaveTextContent("1 item");
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

  // PR3y (recipe lifecycle controls): active cards expose archive, archived
  // cards expose restore in the all view, archived cards never expose edit,
  // and the parent feedback provider mounts around the list so the success
  // announcement survives the row unmount triggered by revalidation.
  // PR3y (recipe lifecycle controls): active cards expose archive, archived
  // cards expose restore in the all view, and archived cards never expose
  // the inline edit form. The persistent feedback provider is PR3y.next.
  it("PR3y: exposes an Archive button per active card and never on archived cards", async () => {
    mocks.listRecipes.mockResolvedValue([RECIPE_RECORD_ACTIVE]);
    render(await RecipesPage(pageProps()));
    expect(screen.getByRole("button", { name: "Archive Vanilla candle" })).toBeInTheDocument();
    // Restore is only exposed for archived recipes, not active ones.
    expect(
      screen.queryByRole("button", { name: "Restore Vanilla candle" }),
    ).not.toBeInTheDocument();
  });

  it("PR3y: exposes a Restore button per archived card in the all view and an Archive button per active card", async () => {
    // One archived + one active: the active card keeps its archive control,
    // each archived card exposes only the restore control, and the edit form
    // stays out of archived cards (a separate invariant already proven but
    // re-asserted here in the lifecycle context).
    mocks.listRecipes.mockResolvedValue([RECIPE_RECORD_ACTIVE, RECIPE_RECORD_ARCHIVED]);
    render(await RecipesPage(pageProps("all")));
    expect(screen.getByRole("button", { name: "Archive Vanilla candle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore Citrus candle" })).toBeInTheDocument();
    // Exactly one archive button (the active card) and exactly one restore
    // button (the archived card).
    const archiveButtons = screen.queryAllByRole("button", { name: /^Archive / });
    expect(archiveButtons).toHaveLength(1);
    expect(archiveButtons[0]).toHaveTextContent("Archive");
    const restoreButtons = screen.queryAllByRole("button", { name: /^Restore / });
    expect(restoreButtons).toHaveLength(1);
    // Non-editable invariant: archived cards keep the badge but no form heading.
    expect(
      screen.queryByRole("heading", { name: "Edit recipe: Citrus candle" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Edit recipe: Vanilla candle" }),
    ).toBeInTheDocument();
  });
});
