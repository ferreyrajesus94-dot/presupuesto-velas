import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  listTemplates: vi.fn(),
  countArchivedTemplates: vi.fn(),
  listMaterials: vi.fn(),
  templateActions: vi.fn(),
}));

vi.mock("../../src/server/auth/requireOwner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("../../src/server/repositories/templates", () => ({
  listTemplates: mocks.listTemplates,
  countArchivedTemplates: mocks.countArchivedTemplates,
}));
vi.mock("../../src/server/repositories/materials", () => ({
  listMaterials: mocks.listMaterials,
}));
// Page-level composition mounts the create + update forms and the PR3y
// lifecycle controls. The page itself never invokes an action, so a single
// stub covers all four exports to keep the dependency graph intact while
// keeping the page-level test surface focused on composition.
vi.mock("../../src/server/actions/templates", () => ({
  createTemplateAction: mocks.templateActions,
  updateTemplateAction: mocks.templateActions,
  archiveTemplateAction: mocks.templateActions,
  restoreTemplateAction: mocks.templateActions,
}));

import TemplatesPage from "../../src/app/templates/page";

function pageProps(view?: "active" | "all") {
  return { searchParams: Promise.resolve(view ? { view } : {}) };
}

const TEMPLATE_RECORD_ACTIVE = {
  template: {
    id: "template-1",
    name: "Vanilla candle",
    unitCost: "1100.000000000000000000",
    archivedAt: null,
  },
  items: [
    { id: "item-1", position: 1, materialId: "wax", quantity: "100.000000" },
    { id: "item-2", position: 2, materialId: "wick", quantity: "2.000000" },
  ],
};
const TEMPLATE_RECORD_ACTIVE_OTHER = {
  template: {
    id: "template-other",
    name: "Cinnamon candle",
    unitCost: "950.000000000000000000",
    archivedAt: null,
  },
  items: [{ id: "item-other-1", position: 1, materialId: "wax", quantity: "80.000000" }],
};
const TEMPLATE_RECORD_ARCHIVED = {
  template: {
    id: "template-archived",
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

// Template with items deliberately OUT of persisted position order. After
// `projectTemplateItems` sorts by `position` ascending the rows must land in
// the order wick → wax → essence (positions 1, 2, 3), regardless of the DB
// insert order. Materials span three dimensions so a wrong unit fallback
// (e.g., always "g") would still fall on the wrong cell.
const TEMPLATE_RECORD_MIXED_DIMENSIONS = {
  template: {
    id: "template-mix",
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

function listTemplatesHonoringVisibility() {
  mocks.listTemplates.mockImplementation(
    async (_ownerId: string, visibility: { includeArchived?: boolean } = {}) => {
      const all = [TEMPLATE_RECORD_ACTIVE, TEMPLATE_RECORD_ACTIVE_OTHER, TEMPLATE_RECORD_ARCHIVED];
      if (visibility.includeArchived) return all;
      return all.filter(({ template }) => template.archivedAt === null);
    },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireOwner.mockResolvedValue({ id: "owner-1", email: "owner@example.com" });
  mocks.listTemplates.mockResolvedValue([]);
  mocks.countArchivedTemplates.mockResolvedValue(0);
  mocks.listMaterials.mockResolvedValue(ACTIVE_MATERIALS);
  mocks.templateActions.mockResolvedValue({ status: "success", templateId: "template-1" });
});

describe("/templates page composition", () => {
  it("renders the page heading, the empty state, and the create form anchored at #new-template", async () => {
    render(await TemplatesPage(pageProps()));
    expect(screen.getByRole("heading", { name: "Plantillas" })).toBeInTheDocument();
    expect(screen.getByText("No hay plantillas todavía")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Creá tu primera plantilla" })).toHaveAttribute(
      "href",
      "#new-template",
    );
    // PR3t: the empty-state CTA now points at a real section in the DOM.
    expect(document.getElementById("new-template")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Nueva plantilla" })).toBeInTheDocument();
    expect(mocks.requireOwner).toHaveBeenCalledTimes(1);
    expect(mocks.listMaterials).toHaveBeenCalledWith("owner-1", { includeArchived: false });
  });

  it("defaults to active visibility, excludes archived templates, and exposes the active view as current", async () => {
    listTemplatesHonoringVisibility();
    render(await TemplatesPage(pageProps()));
    expect(mocks.listTemplates).toHaveBeenCalledWith("owner-1", { includeArchived: false });
    const list = screen.getByRole("list", { name: "Plantillas" });
    const cards = within(list).getAllByTestId("template-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Vanilla candle");
    expect(cards[0]).toHaveTextContent("ARS 1100");
    expect(cards[0]).toHaveTextContent("2 elementos");
    expect(screen.queryByTestId("archived-badge")).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Filtro de vista de plantillas" });
    expect(within(nav).getByRole("link", { name: /Activas/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("includes archived templates with a badge when the view is all", async () => {
    listTemplatesHonoringVisibility();
    render(await TemplatesPage(pageProps("all")));
    expect(mocks.listTemplates).toHaveBeenCalledWith("owner-1", { includeArchived: true });
    const list = screen.getByRole("list", { name: "Plantillas" });
    expect(within(list).getAllByTestId("template-card")).toHaveLength(3);
    expect(screen.getByTestId("archived-badge")).toHaveTextContent("Archivada");
    const nav = screen.getByRole("navigation", { name: "Filtro de vista de plantillas" });
    expect(within(nav).getByRole("link", { name: /Mostrar archivadas/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("PR3v.next: mounts the inline TemplateEditForm on each active card, prefilled with the projected template items", async () => {
    // The page is an RSC boundary, so each active template must reach the form
    // with its own id + ordered items[] + active material catalog — never
    // reaching through any server-only module. The form anchor
    // (#edit-template-{id}) supplies the hash/focus destination.
    mocks.listTemplates.mockResolvedValue([TEMPLATE_RECORD_ACTIVE]);
    render(await TemplatesPage(pageProps()));
    expect(document.getElementById("edit-template-template-1")).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "Editar plantilla: Vanilla candle" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Nombre de Vanilla candle" })).toHaveValue(
      "Vanilla candle",
    );
    const card = screen.getByTestId("template-card");
    const itemList = within(card).getByRole("list", { name: "Ingredientes de la plantilla" });
    expect(within(itemList).getAllByRole("listitem")).toHaveLength(2);
    // The form's material select is sourced from the page-projected
    // active-material catalog, sorted alphabetically.
    const materialSelects = within(itemList).getAllByLabelText("Material");
    expect(materialSelects).toHaveLength(2);
    const firstMaterialOptions = Array.from(materialSelects[0].querySelectorAll("option")).map(
      (opt) => opt.textContent,
    );
    expect(firstMaterialOptions).toEqual(["Seleccioná un material", "Cotton wick", "Soy wax"]);
  });

  it("PR3v.next: never mounts the TemplateEditForm or its affordance for archived template cards", async () => {
    // Archived safety: the page must filter TemplateEditForm out of archived
    // records even when the view= all is active. The repository's
    // isNull(archivedAt) guard on updateTemplate is the last-line defense.
    listTemplatesHonoringVisibility();
    render(await TemplatesPage(pageProps("all")));
    expect(
      screen.queryByRole("heading", { name: "Editar plantilla: Citrus candle" }),
    ).not.toBeInTheDocument();
    expect(document.getElementById("edit-template-template-archived")).toBeNull();
    expect(screen.queryByRole("link", { name: "Editar Citrus candle" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Editar plantilla: Vanilla candle" }),
    ).toBeInTheDocument();
  });

  it("PR3v.next: uses a stable per-template component identity so prefilled values never leak across cards", async () => {
    // The stable key={template.id} identity guarantees that the two active
    // forms preload their own name + items, with no crosstalk between
    // sibling card re-renders.
    mocks.listTemplates.mockResolvedValue([TEMPLATE_RECORD_ACTIVE, TEMPLATE_RECORD_ACTIVE_OTHER]);
    render(await TemplatesPage(pageProps()));
    expect(
      screen.getByRole("heading", { name: "Editar plantilla: Vanilla candle" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Editar plantilla: Cinnamon candle" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Nombre de Vanilla candle" })).toHaveValue(
      "Vanilla candle",
    );
    expect(screen.getByRole("textbox", { name: "Nombre de Cinnamon candle" })).toHaveValue(
      "Cinnamon candle",
    );
    // Vanilla has two preloaded items and Cinnamon has one — the total of
    // three ordered rows confirms each form keeps its own prefill.
    expect(screen.getAllByTestId(/^template-edit-item-/)).toHaveLength(3);
  });

  it("PR3v.next: surfaces an Edit affordance per active card that anchors to the inline form section", async () => {
    // Hash/focus navigation: an explicit "Edit {name}" link points to the
    // form's section id so keyboard users can deep-link without scrolling.
    mocks.listTemplates.mockResolvedValue([TEMPLATE_RECORD_ACTIVE, TEMPLATE_RECORD_ACTIVE_OTHER]);
    render(await TemplatesPage(pageProps()));
    expect(screen.getByRole("link", { name: "Editar Vanilla candle" })).toHaveAttribute(
      "href",
      "#edit-template-template-1",
    );
    expect(screen.getByRole("link", { name: "Editar Cinnamon candle" })).toHaveAttribute(
      "href",
      "#edit-template-template-other",
    );
  });

  it("PR3v.next: keeps each form's prefilled values isolated when the template order changes between rerenders", async () => {
    // Triangulation: if the form were not keyed by template.id, an unsaved
    // local edit on one card would leak into whichever card occupied the
    // same DOM position after a refetch. Repro: render A and B, type into
    // A's name field, rerender with [B, A] (order swap), and confirm A's
    // form still owns its draft edit while B's form is the one preloaded
    // with "Cinnamon candle" — never the stale edit value.
    const user = userEvent.setup();
    mocks.listTemplates.mockResolvedValue([TEMPLATE_RECORD_ACTIVE, TEMPLATE_RECORD_ACTIVE_OTHER]);
    const first = await TemplatesPage(pageProps());
    const { rerender } = render(first);

    const vanillaName = screen.getByRole("textbox", { name: "Nombre de Vanilla candle" });
    await user.clear(vanillaName);
    await user.type(vanillaName, "Vanilla candle (draft)");

    // Post-revalidation: refetch puts the other template first.
    mocks.listTemplates.mockResolvedValue([TEMPLATE_RECORD_ACTIVE_OTHER, TEMPLATE_RECORD_ACTIVE]);
    rerender(await TemplatesPage(pageProps()));

    // Vanilla's draft survives on Vanilla — keyed identity.
    expect(screen.getByRole("textbox", { name: "Nombre de Vanilla candle" })).toHaveValue(
      "Vanilla candle (draft)",
    );
    // Cinnamon's form is now first and is still its own preloaded value.
    expect(screen.getByRole("textbox", { name: "Nombre de Cinnamon candle" })).toHaveValue(
      "Cinnamon candle",
    );
  });

  it("PR3v.next: page-boundary projection sorts persisted items by position and reconstructs each row's unit from the catalog", async () => {
    // Page-boundary projection guarantee. The fixture's rows are deliberately
    // NOT in persisted position order and span three different baseUnits (mass
    // g / count unit / volume ml), so a regression in `projectTemplateItems`
    // surfaces as one of three concrete failures inside the mounted form:
    //   (a) rows arrive in DB order rather than sorted `position` order,
    //   (b) projection drops a field and emits a blank row,
    //   (c) unit reconstruction falls back to the "g" sentinel for any
    //       dimension other than mass.
    // All three would break the inline editor in the same shape — wrong
    // prefilled values for that template — so they must be exercised together.
    mocks.listMaterials.mockResolvedValue(MIXED_DIMENSION_MATERIALS);
    mocks.listTemplates.mockResolvedValue([TEMPLATE_RECORD_MIXED_DIMENSIONS]);
    render(await TemplatesPage(pageProps()));

    const card = screen.getByTestId("template-card");
    // Exactly three rows are mounted — neither fewer (blank-row emission)
    // nor more (duplication) is acceptable.
    const rows = within(card).getAllByTestId(/^template-edit-item-/);
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
      const rowScope = within(screen.getByTestId(`template-edit-item-${expected.rowNumber}`));
      const materialSelect = rowScope.getByLabelText("Material") as HTMLSelectElement;
      const quantityInput = rowScope.getByLabelText("Cantidad") as HTMLInputElement;
      const unitSelect = rowScope.getByLabelText("Unidad") as HTMLSelectElement;
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
    expect(within(card).getByLabelText("Ingrediente 1")).toBe(
      screen.getByTestId("template-edit-item-1"),
    );
    expect(within(card).getByLabelText("Ingrediente 2")).toBe(
      screen.getByTestId("template-edit-item-2"),
    );
    expect(within(card).getByLabelText("Ingrediente 3")).toBe(
      screen.getByTestId("template-edit-item-3"),
    );
  });

  it("uses singular copy when only one item belongs to a template", async () => {
    mocks.listTemplates.mockResolvedValue([{ ...TEMPLATE_RECORD_ACTIVE, items: [{ id: "x" }] }]);
    render(await TemplatesPage(pageProps()));
    const list = screen.getByRole("list", { name: "Plantillas" });
    expect(within(list).getByTestId("template-card")).toHaveTextContent("1 elemento");
  });

  it("shows a view-aware empty state when the active list is empty but archived templates exist", async () => {
    mocks.countArchivedTemplates.mockResolvedValue(3);
    render(await TemplatesPage(pageProps()));
    expect(screen.getByRole("heading", { name: "No hay plantillas activas" })).toBeInTheDocument();
    expect(
      screen.getByText("3 plantillas están archivadas y ocultas en esta vista."),
    ).toBeInTheDocument();
    // Two "Mostrar archivadas" affordances exist (nav + empty state body); both must
    // point to /templates?view=all.
    const showArchived = screen.getAllByRole("link", { name: "Mostrar archivadas" });
    expect(showArchived.length).toBeGreaterThanOrEqual(1);
    expect(showArchived.every((link) => link.getAttribute("href") === "/templates?view=all")).toBe(
      true,
    );
    expect(mocks.countArchivedTemplates).toHaveBeenCalledWith("owner-1");
  });

  it("uses singular copy when only one archived template exists", async () => {
    mocks.countArchivedTemplates.mockResolvedValue(1);
    render(await TemplatesPage(pageProps()));
    expect(screen.getByText("1 plantilla está archivada y oculta en esta vista.")).toBeInTheDocument();
  });

  it("does not query the archived count when the active list is non-empty", async () => {
    listTemplatesHonoringVisibility();
    render(await TemplatesPage(pageProps()));
    expect(mocks.countArchivedTemplates).not.toHaveBeenCalled();
  });

  it("does not query the archived count in the all view even when the list is empty", async () => {
    render(await TemplatesPage(pageProps("all")));
    expect(mocks.countArchivedTemplates).not.toHaveBeenCalled();
    expect(screen.getByText("No hay plantillas todavía")).toBeInTheDocument();
  });

  // PR3y (template lifecycle controls): active cards expose archive, archived
  // cards expose restore in the all view, archived cards never expose edit,
  // and the parent feedback provider mounts around the list so the success
  // announcement survives the row unmount triggered by revalidation.
  it("PR3y: exposes an Archive button per active card and never on archived cards", async () => {
    mocks.listTemplates.mockResolvedValue([TEMPLATE_RECORD_ACTIVE]);
    render(await TemplatesPage(pageProps()));
    expect(screen.getByRole("button", { name: "Archivar Vanilla candle" })).toBeInTheDocument();
    // Restore is only exposed for archived templates, not active ones.
    expect(
      screen.queryByRole("button", { name: "Restaurar Vanilla candle" }),
    ).not.toBeInTheDocument();
  });

  it("PR3y: exposes a Restore button per archived card in the all view and an Archive button per active card", async () => {
    // One archived + one active: the active card keeps its archive control,
    // each archived card exposes only the restore control, and the edit form
    // stays out of archived cards (a separate invariant already proven but
    // re-asserted here in the lifecycle context).
    mocks.listTemplates.mockResolvedValue([TEMPLATE_RECORD_ACTIVE, TEMPLATE_RECORD_ARCHIVED]);
    render(await TemplatesPage(pageProps("all")));
    expect(screen.getByRole("button", { name: "Archivar Vanilla candle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restaurar Citrus candle" })).toBeInTheDocument();
    // Exactly one archive button (the active card) and exactly one restore
    // button (the archived card).
    const archiveButtons = screen.queryAllByRole("button", { name: /^Archivar / });
    expect(archiveButtons).toHaveLength(1);
    expect(archiveButtons[0]).toHaveTextContent("Archivar");
    const restoreButtons = screen.queryAllByRole("button", { name: /^Restaurar / });
    expect(restoreButtons).toHaveLength(1);
    // Non-editable invariant: archived cards keep the badge but no form heading.
    expect(
      screen.queryByRole("heading", { name: "Editar plantilla: Citrus candle" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Editar plantilla: Vanilla candle" }),
    ).toBeInTheDocument();
  });
});

// PR3z.focus: page-level composition verifies that the
// `data-archive-focus` / `data-archive-source` markers on the archive
// button + the `useEffect` inside the TemplatesArchiveFeedback provider land
// focus on the right destination across the revalidation transition. The
// component-level tests in template-archive-feedback.test.tsx cover the
// provider in isolation; these two tests cover the wired-up production
// composition (TemplateArchiveControl markers + TemplatesList wrap + provider
// useEffect).
describe("PR3z.focus page-level composition", () => {
  function confirm(value: boolean) {
    return vi.spyOn(window, "confirm").mockReturnValue(value);
  }

  it("moves focus to the remaining row's archive button after revalidation when one of two active rows is archived", async () => {
    // Active view, two active templates, archive the first. The provider
    // effect must filter the source by data-archive-source and land focus
    // on the surviving sibling — the page-level wiring is the only
    // composition where both markers are real production attributes.
    const user = userEvent.setup();
    const confirmSpy = confirm(true);
    mocks.listTemplates.mockResolvedValue([TEMPLATE_RECORD_ACTIVE, TEMPLATE_RECORD_ACTIVE_OTHER]);
    mocks.countArchivedTemplates.mockResolvedValue(0);
    mocks.templateActions.mockResolvedValue({
      status: "success",
      templateId: TEMPLATE_RECORD_ACTIVE.template.id,
    });

    const first = await TemplatesPage(pageProps());
    const { rerender } = render(first);

    expect(screen.getByRole("button", { name: "Archivar Vanilla candle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archivar Cinnamon candle" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archivar Vanilla candle" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Vanilla candle archivada.");

    // Post-revalidation: Vanilla candle archived, Cinnamon candle remains.
    mocks.listTemplates.mockResolvedValue([TEMPLATE_RECORD_ACTIVE_OTHER]);
    rerender(await TemplatesPage(pageProps()));

    // Status persists across the transition.
    expect(screen.getByRole("status")).toHaveTextContent("Vanilla candle archivada.");
    // The first row was archived and removed; the remaining row's archive
    // button must receive focus so the keyboard cursor does not get lost
    // on the unmounted departing row.
    const remaining = screen.getByRole("button", { name: "Archivar Cinnamon candle" });
    expect(remaining).toBeInTheDocument();
    await waitFor(() => expect(remaining).toHaveFocus());
    confirmSpy.mockRestore();
  });

  it("moves focus to the Show archived affordance when the last active row is archived", async () => {
    // Active view, single active template, archive it. The next-row
    // destination does not exist after revalidation, so the effect must
    // fall back to the pre-slice data-archive-focus="show-archived" seam
    // (nav + empty-state link both qualify). The status must also survive
    // the transition to the empty state.
    const user = userEvent.setup();
    const confirmSpy = confirm(true);
    mocks.listTemplates.mockResolvedValue([TEMPLATE_RECORD_ACTIVE]);
    mocks.countArchivedTemplates.mockResolvedValue(0);
    mocks.templateActions.mockResolvedValue({
      status: "success",
      templateId: TEMPLATE_RECORD_ACTIVE.template.id,
    });

    const first = await TemplatesPage(pageProps());
    const { rerender } = render(first);

    await user.click(screen.getByRole("button", { name: "Archivar Vanilla candle" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Vanilla candle archivada.");

    // Post-revalidation: active list is empty and one template is archived.
    mocks.listTemplates.mockResolvedValue([]);
    mocks.countArchivedTemplates.mockResolvedValue(1);
    rerender(await TemplatesPage(pageProps()));

    // The persistent success announcement must survive the transition.
    expect(screen.getByRole("status")).toHaveTextContent("Vanilla candle archivada.");
    // Focus must move to a "Mostrar archivadas" affordance (nav or empty-state
    // link), not be lost on body.
    const showArchivedLinks = screen.getAllByRole("link", { name: /Mostrar archivadas/ });
    expect(showArchivedLinks.length).toBeGreaterThan(0);
    expect(showArchivedLinks.some((link) => link === document.activeElement)).toBe(true);
    confirmSpy.mockRestore();
  });

  it("does not move focus to Show archived when a row is restored in the all view", async () => {
    // Triangulation: restore keeps the row mounted and the view is "all",
    // so the focus effect must early-return on both gates. The status
    // announcement is the only side effect of the operation.
    const user = userEvent.setup();
    mocks.listTemplates.mockResolvedValue([TEMPLATE_RECORD_ACTIVE, TEMPLATE_RECORD_ARCHIVED]);
    mocks.templateActions.mockResolvedValue({
      status: "success",
      templateId: TEMPLATE_RECORD_ARCHIVED.template.id,
    });

    const first = await TemplatesPage(pageProps("all"));
    const { rerender } = render(first);

    await user.click(screen.getByRole("button", { name: "Restaurar Citrus candle" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Citrus candle restaurada.");

    // The list is unchanged in the all view (restore doesn't remove rows).
    rerender(await TemplatesPage(pageProps("all")));

    // Status persists.
    expect(screen.getByRole("status")).toHaveTextContent("Citrus candle restaurada.");
    // Focus must NOT be on a "Mostrar archivadas" link — restore keeps the row
    // mounted and the all view does not gate the effect through the
    // active branch.
    const showArchivedLinks = screen.getAllByRole("link", { name: /Mostrar archivadas/ });
    showArchivedLinks.forEach((link) => {
      expect(link).not.toBe(document.activeElement);
    });
  });
});
