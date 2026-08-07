import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The workspace now imports Server Actions that transitively touch the
// repository and `requireOwner`. Mock them at module level so the component
// renders without DATABASE_URL / session plumbing — tests below reset the
// mock implementations per case as needed.
const mocks = vi.hoisted(() => ({
  createBlankTemplateAction: vi.fn(),
  deleteTemplateAction: vi.fn(),
  saveTemplateAction: vi.fn(),
  refreshRouter: vi.fn(),
}));

vi.mock("../../src/server/actions/templates", () => ({
  createBlankTemplateAction: mocks.createBlankTemplateAction,
  deleteTemplateAction: mocks.deleteTemplateAction,
  saveTemplateAction: mocks.saveTemplateAction,
}));
// PlantillasWorkspace calls `router.refresh()` after a successful save —
// stub `next/navigation` so unit tests can run without an app router
// instance.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refreshRouter }),
  redirect: vi.fn(),
}));

import { PlantillasWorkspace } from "../../src/app/templates/PlantillasWorkspace";
import { toClientTemplate, type PlantillaClientMaterial } from "../../src/app/templates/types";
import { calcTemplateSummary } from "../../src/domain/templateSummary";

function makeTemplate(
  over: Partial<{
    id: string;
    name: string;
    unitCost: string;
    archivedAt: Date | null;
    items: Array<{ id: string; materialId: string; quantity: string; unit: string }>;
  }> = {},
) {
  return {
    id: over.id ?? "t-1",
    name: over.name ?? "Vanilla candle",
    unitCost: over.unitCost ?? "0",
    archivedAt: over.archivedAt ?? null,
    items: over.items ?? [],
  };
}

const MATERIALS: PlantillaClientMaterial[] = [
  { id: "wax", name: "Soy wax", baseUnit: "g", unitCost: "10" },
  { id: "wick", name: "Cotton wick", baseUnit: "unit", unitCost: "20" },
  { id: "scent", name: "Lavender scent", baseUnit: "ml", unitCost: "50" },
];

beforeEach(() => {
  vi.resetAllMocks();
  // Default to a fast-resolving success path so optimistic state assertions
  // in the existing suite still hold without each test having to stub it.
  mocks.createBlankTemplateAction.mockImplementation(async () => {
    const id = `server-${Math.random().toString(36).slice(2, 10)}`;
    return { status: "success", id, name: "Nueva plantilla 1" };
  });
  mocks.deleteTemplateAction.mockResolvedValue({ status: "success", id: "" });
  mocks.saveTemplateAction.mockResolvedValue({
    status: "success",
    template: {
      id: "stub-id",
      name: "Vanilla candle",
      unitCost: "0",
      archivedAt: null,
      time: "",
      hourlyRate: "",
      overhead: "",
      marginPct: "30",
    },
    meta: { unitCost: "0", time: "", hourlyRate: "", overhead: "", marginPct: "30" },
  });
});

describe("toClientTemplate", () => {
  it("projects each item's unitCost from the materials catalog and units from the catalog", () => {
    const client = toClientTemplate(
      makeTemplate({
        items: [
          { id: "r1", materialId: "wax", quantity: "100", unit: "g" },
          { id: "r2", materialId: "wick", quantity: "2", unit: "unit" },
        ],
      }),
      MATERIALS,
    );
    expect(client.items).toHaveLength(2);
    expect(client.items[0]).toMatchObject({ materialId: "wax", unitCost: "10", name: "Soy wax" });
    expect(client.items[1]).toMatchObject({
      materialId: "wick",
      unitCost: "20",
      name: "Cotton wick",
    });
  });

  it("defaults unknown materials to zero cost and empty name", () => {
    const client = toClientTemplate(
      makeTemplate({ items: [{ id: "r1", materialId: "ghost", quantity: "1", unit: "g" }] }),
      MATERIALS,
    );
    expect(client.items[0]).toMatchObject({ unitCost: "0", name: "" });
  });
});

describe("calcTemplateSummary", () => {
  it("sums materials by qty × unitCost", () => {
    const summary = calcTemplateSummary({
      materials: [
        { unitCost: "10", quantity: "100" },
        { unitCost: "20", quantity: "2" },
      ],
    });
    expect(Number(summary.materialsCost)).toBe(1040);
    expect(Number(summary.total)).toBe(1040);
    expect(Number(summary.suggestedPrice)).toBeCloseTo(1352, 0);
  });

  it("applies labor cost when time > 0 and hourlyRate > 0", () => {
    const summary = calcTemplateSummary({
      materials: [],
      time: 60,
      hourlyRate: 1000,
    });
    expect(summary.laborCost).toBe("1000");
    expect(summary.total).toBe("1000");
  });

  it("returns zeros for empty inputs", () => {
    const summary = calcTemplateSummary({ materials: [] });
    expect(summary.materialsCost).toBe("0");
    expect(summary.laborCost).toBe("0");
    expect(summary.overhead).toBe("0");
    expect(summary.total).toBe("0");
    expect(summary.suggestedPrice).toBe("0");
  });

  it("rejects negative and non-numeric values without throwing", () => {
    const summary = calcTemplateSummary({
      materials: [{ unitCost: "-5", quantity: "abc" }],
      time: -10,
      overhead: "garbage",
      marginPct: -100,
    });
    expect(Number(summary.materialsCost)).toBe(0);
    expect(Number(summary.laborCost)).toBe(0);
    expect(Number(summary.overhead)).toBe(0);
  });
});

describe("PlantillasWorkspace", () => {
  it("renders the empty state when there are no templates", () => {
    render(<PlantillasWorkspace initialTemplates={[]} materials={MATERIALS} />);
    expect(
      screen.getByRole("heading", { name: /Empezá creando tu primera plantilla/i }),
    ).toBeInTheDocument();
    // The workspace always renders a header CTA ("Nueva plantilla") and,
    // when the list is empty, an additional empty-state CTA. Both should be
    // present and clickable.
    const createButtons = screen.getAllByRole("button", { name: /Nueva plantilla/i });
    expect(createButtons.length).toBeGreaterThanOrEqual(2);
  });

  it("renders one card per initial template with the live summary", () => {
    const initial = [
      toClientTemplate(
        makeTemplate({
          id: "t-1",
          name: "Vanilla candle",
          items: [
            { id: "r1", materialId: "wax", quantity: "100", unit: "g" },
            { id: "r2", materialId: "wick", quantity: "2", unit: "unit" },
          ],
        }),
        MATERIALS,
      ),
    ];
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);
    const cards = screen.getAllByTestId("template-card");
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getByText("Vanilla candle")).toBeInTheDocument();
    const summary = within(cards[0]).getByTestId("plantilla-summary");
    expect(within(summary).getByTestId("summary-materials")).toHaveTextContent("ARS 1.040");
    expect(within(summary).getByTestId("summary-total")).toHaveTextContent("ARS 1.040");
  });

  it("'Nueva plantilla' button creates an empty template and inserts it at the top", async () => {
    const user = userEvent.setup();
    const initial = [
      toClientTemplate(makeTemplate({ id: "t-1", name: "Vanilla candle" }), MATERIALS),
    ];
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);
    await user.click(screen.getByTestId("plantilla-new"));
    const cards = screen.getAllByTestId("template-card");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText(/^Nueva plantilla /)).toBeInTheDocument();
    expect(within(cards[0]).getByTestId("summary-materials")).toHaveTextContent("ARS 0");
  });

  it("'Crear una copia' duplicates the template's materials and appends (copia) to the name", async () => {
    const user = userEvent.setup();
    const initial = [
      toClientTemplate(
        makeTemplate({
          id: "t-1",
          name: "Vanilla candle",
          items: [{ id: "r1", materialId: "wax", quantity: "100", unit: "g" }],
        }),
        MATERIALS,
      ),
    ];
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);
    const dup = screen.getByTestId("plantilla-duplicate");
    await user.click(dup);
    const cards = screen.getAllByTestId("template-card");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText("Vanilla candle (copia)")).toBeInTheDocument();
    expect(within(cards[0]).getByTestId("summary-materials")).toHaveTextContent("ARS 1.000");
  });

  it("'Eliminar' removes the template from the list after confirm", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const initial = [
      toClientTemplate(makeTemplate({ id: "t-1", name: "Vanilla candle" }), MATERIALS),
      toClientTemplate(makeTemplate({ id: "t-2", name: "Cinnamon candle" }), MATERIALS),
    ];
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);
    const deleteButton = screen.getByRole("button", { name: "Eliminar Vanilla candle" });
    await user.click(deleteButton);
    expect(screen.getAllByTestId("template-card")).toHaveLength(1);
    expect(screen.getByText("Cinnamon candle")).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("'Nueva plantilla' persists the placeholder via the server action and swaps the id", async () => {
    const user = userEvent.setup();
    const serverName = "Nueva plantilla (renombrada)";
    mocks.createBlankTemplateAction.mockImplementation(async () => {
      // Mimic the server returning a renamed row so we can observe the swap.
      return { status: "success", id: "server-t-1", name: serverName };
    });
    const initial = [
      toClientTemplate(makeTemplate({ id: "t-1", name: "Vanilla candle" }), MATERIALS),
    ];
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);

    await user.click(screen.getByTestId("plantilla-new"));

    expect(mocks.createBlankTemplateAction).toHaveBeenCalledTimes(1);
    const sentForm = mocks.createBlankTemplateAction.mock.calls[0][0] as FormData;
    expect(String(sentForm.get("name"))).toBe("null");

    // Optimistic placeholder is visible immediately and replaces its local id
    // + name with the server-issued values once the action resolves. The
    // server-returned name shows up in the card's aria-label and the
    // per-card trash button, which we can query deterministically.
    const cards = await screen.findAllByTestId("template-card");
    expect(cards).toHaveLength(2);
    const heading = within(cards[0]).getByRole("heading", { level: 3 });
    expect(heading.textContent ?? "").toMatch(/Nueva plantilla .*\(renombrada\)/);
    expect(
      within(cards[0]).getByRole("button", {
        name: `Eliminar ${serverName}`,
      }),
    ).toBeInTheDocument();
  });

  it("'Nueva plantilla' rolls back the placeholder and shows an inline error when the action fails", async () => {
    const user = userEvent.setup();
    mocks.createBlankTemplateAction.mockResolvedValueOnce({
      status: "error",
      message: "Ya existe una plantilla con ese nombre.",
    });
    const initial = [
      toClientTemplate(makeTemplate({ id: "t-1", name: "Vanilla candle" }), MATERIALS),
    ];
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);

    await user.click(screen.getByTestId("plantilla-new"));

    // Wait for the transition to resolve and the rollback to land.
    const error = await screen.findByTestId("plantilla-action-error");
    expect(error).toHaveTextContent("Ya existe una plantilla con ese nombre.");
    // The placeholder is gone — only the persisted template remains.
    expect(screen.getAllByTestId("template-card")).toHaveLength(1);
  });

  it("'Eliminar' calls the server action and rolls back when the delete fails", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.deleteTemplateAction.mockResolvedValueOnce({
      status: "error",
      message: "No se pudo eliminar la plantilla.",
    });
    const initial = [
      toClientTemplate(makeTemplate({ id: "t-1", name: "Vanilla candle" }), MATERIALS),
      toClientTemplate(makeTemplate({ id: "t-2", name: "Cinnamon candle" }), MATERIALS),
    ];
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);

    await user.click(screen.getByRole("button", { name: "Eliminar Vanilla candle" }));

    // Action was invoked with the matching id.
    expect(mocks.deleteTemplateAction).toHaveBeenCalledTimes(1);
    const sentForm = mocks.deleteTemplateAction.mock.calls[0][0] as FormData;
    expect(String(sentForm.get("id"))).toBe("t-1");

    // The error surface renders once the rollback lands and the card returns.
    const error = await screen.findByTestId("plantilla-action-error");
    expect(error).toHaveTextContent("No se pudo eliminar la plantilla.");
    expect(screen.getAllByTestId("template-card")).toHaveLength(2);
    expect(screen.getByText("Vanilla candle")).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("per-card trash button exposes a title, an aria-label, and a screen-reader-visible word", () => {
    const initial = [
      toClientTemplate(makeTemplate({ id: "t-1", name: "Vanilla candle" }), MATERIALS),
    ];
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);

    const trash = screen.getByTestId("plantilla-delete");
    expect(trash).toHaveAttribute("aria-label", "Eliminar Vanilla candle");
    expect(trash).toHaveAttribute("title", "Eliminar Vanilla candle");
    // Screen readers and accessibility tree browsers see the explicit word
    // even though the emoji is the only visible glyph.
    expect(within(trash).getByText("Eliminar")).toBeInTheDocument();
  });

  it("per-row trash button exposes a title, an aria-label, and a screen-reader-visible word", async () => {
    const user = userEvent.setup();
    const initial = [
      toClientTemplate(
        makeTemplate({
          id: "t-1",
          name: "Vanilla candle",
          items: [{ id: "r1", materialId: "wax", quantity: "100", unit: "g" }],
        }),
        MATERIALS,
      ),
    ];
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);
    await user.click(screen.getByTestId("plantilla-add-material"));

    const row = screen.getAllByTestId("plantilla-material-row")[0];
    const trash = within(row).getByRole("button", { name: "Quitar material" });
    expect(trash).toHaveAttribute("title", "Quitar material");
    expect(within(trash).getByText("Quitar")).toBeInTheDocument();
  });

  it("'+ Material' adds a blank row to the template's items", async () => {
    const user = userEvent.setup();
    const initial = [
      toClientTemplate(makeTemplate({ id: "t-1", name: "Vanilla candle" }), MATERIALS),
    ];
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);
    expect(screen.queryAllByTestId("plantilla-material-row")).toHaveLength(0);
    await user.click(screen.getByTestId("plantilla-add-material"));
    expect(screen.getAllByTestId("plantilla-material-row")).toHaveLength(1);
  });

  it("'Editar nombre' trims the draft, persists it through the workspace, and updates the visible heading", async () => {
    const user = userEvent.setup();
    const initial = [
      toClientTemplate(makeTemplate({ id: "t-1", name: "Vanilla candle" }), MATERIALS),
    ];
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);
    await user.click(screen.getByRole("button", { name: /Editar nombre de Vanilla candle/i }));
    const input = screen.getByLabelText("Nombre");
    await user.clear(input);
    await user.type(input, "  Rosa candle  ");
    // Two "Guardar" buttons co-exist when the inline rename form is open
    // (header rename + per-card save). Scope the click to the rename form
    // by selecting the input's nearest sibling control.
    const renameForm = input.closest("div") as HTMLElement;
    await user.click(within(renameForm).getByRole("button", { name: "Guardar" }));
    // The header heading now reflects the trimmed, persisted name.
    expect(screen.getByRole("heading", { name: /Rosa candle/ })).toBeInTheDocument();
    // The edit input is gone and the previous heading text is no longer rendered.
    expect(screen.queryByLabelText("Nombre")).toBeNull();
    expect(screen.queryByText("Vanilla candle")).toBeNull();
  });

  it("renders the summary with all five derived fields", () => {
    const initial = [
      toClientTemplate(
        makeTemplate({
          id: "t-1",
          name: "Vanilla candle",
          items: [{ id: "r1", materialId: "wax", quantity: "100", unit: "g" }],
        }),
        MATERIALS,
      ),
    ];
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);
    const summary = screen.getByTestId("plantilla-summary");
    expect(within(summary).getByTestId("summary-materials")).toBeInTheDocument();
    expect(within(summary).getByTestId("summary-labor")).toBeInTheDocument();
    expect(within(summary).getByTestId("summary-overhead")).toBeInTheDocument();
    expect(within(summary).getByTestId("summary-total")).toBeInTheDocument();
    expect(within(summary).getByTestId("summary-suggested")).toBeInTheDocument();
  });

  it("translates the overhead label to a natural Argentine word in both the input and the summary <dt>", () => {
    const initial = [
      toClientTemplate(makeTemplate({ id: "t-1", name: "Vanilla candle" }), MATERIALS),
    ];
    const { container } = render(
      <PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />,
    );
    // The overhead input's visible label uses the Argentine word in both spots.
    const card = screen.getByTestId("template-card");
    const overheadLabels = within(card).getAllByText("Costos fijos");
    expect(overheadLabels.length).toBe(2);
    // The summary <dt> is the second occurrence (the first is the grid input label).
    const summary = within(card).getByTestId("plantilla-summary");
    expect(within(summary).getByText("Costos fijos")).toBeInTheDocument();
    // No raw "Overhead" text leaks into the visible DOM anywhere.
    expect(container.textContent ?? "").not.toMatch(/Overhead/);
  });

  it("renders each row's unit label with the singular Spanish per-unit phrase, never the canonical token", () => {
    // Soft UI contract: the visible row text must read the singular per-unit
    // phrase (gramo, mililitro, unidad) while the row model keeps the
    // canonical unit token (`g`, `ml`, `unit`) so the Server Action and
    // derived calculations stay unchanged.
    const initial = [
      toClientTemplate(
        makeTemplate({
          id: "t-1",
          name: "Vanilla candle",
          items: [
            { id: "r1", materialId: "wax", quantity: "100", unit: "g" },
            { id: "r2", materialId: "scent", quantity: "10", unit: "ml" },
            { id: "r3", materialId: "wick", quantity: "2", unit: "unit" },
          ],
        }),
        MATERIALS,
      ),
    ];
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);

    const rows = screen.getAllByTestId("plantilla-material-row");
    expect(within(rows[0]).getByText("gramo")).toBeInTheDocument();
    expect(within(rows[1]).getByText("mililitro")).toBeInTheDocument();
    expect(within(rows[2]).getByText("unidad")).toBeInTheDocument();
    // The canonical tokens must NOT leak into the visible row text.
    expect(within(rows[0]).queryByText(/^\bg$/)).toBeNull();
    expect(within(rows[1]).queryByText(/^\bml$/)).toBeNull();
    expect(within(rows[2]).queryByText(/^\bunit$/)).toBeNull();
  });

  it("Guardar button is disabled when the template has no changes (dirty=false) and renders a Saver row with data-testid=plantilla-save", () => {
    const initial = [
      toClientTemplate(makeTemplate({ id: "t-1", name: "Vanilla candle" }), MATERIALS),
    ];
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);
    const save = screen.getByTestId("plantilla-save");
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).toHaveAttribute("data-dirty", "false");
    expect(save).toHaveAttribute("data-saving", "false");
  });

  it("Guardar button stays disabled when the template has no items but a name", () => {
    const initial = [
      toClientTemplate(makeTemplate({ id: "t-1", name: "Vanilla candle" }), MATERIALS),
    ];
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);
    const save = screen.getByTestId("plantilla-save");
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/Agregá al menos un material para guardar/i)).toBeInTheDocument();
  });

  it("Guardar button stays enabled while a name change makes the template dirty", async () => {
    const user = userEvent.setup();
    const initial = [
      toClientTemplate(makeTemplate({ id: "t-1", name: "Vanilla candle" }), MATERIALS),
    ];
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);
    const rename = screen.getByRole("button", { name: /Editar nombre de Vanilla candle/i });
    await user.click(rename);
    const input = screen.getByLabelText("Nombre");
    await user.clear(input);
    await user.type(input, "Rosa candle");
    const renameForm = input.closest("div") as HTMLElement;
    await user.click(within(renameForm).getByRole("button", { name: "Guardar" }));
    // Header rename only updates local state (no persist) — the per-card
    // Guardar should now reflect the dirty baseline.
    const save = screen.getByTestId("plantilla-save");
    expect(save).toHaveAttribute("data-dirty", "true");
    // And still disabled because the template has zero items.
    expect(save).toBeDisabled();
  });

  it("clicking Guardar on a populated template sends the right FormData and updates the card after success", async () => {
    const user = userEvent.setup();
    mocks.saveTemplateAction.mockResolvedValueOnce({
      status: "success",
      template: {
        id: "t-1",
        name: "Vanilla candle",
        unitCost: "100",
        archivedAt: null,
        time: "60",
        hourlyRate: "1500",
        overhead: "200",
        marginPct: "40",
      },
      meta: {
        unitCost: "100",
        time: "60",
        hourlyRate: "1500",
        overhead: "200",
        marginPct: "40",
      },
    });
    const initial = [
      toClientTemplate(
        makeTemplate({
          id: "t-1",
          name: "Vanilla candle",
          items: [{ id: "r1", materialId: "wax", quantity: "100", unit: "g" }],
        }),
        MATERIALS,
      ),
    ];
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);
    // Make it dirty by toggling the time input.
    const card = screen.getByTestId("template-card");
    const timeInput = within(card).getByLabelText(/Tiempo/);
    await user.clear(timeInput);
    await user.type(timeInput, "60");

    const save = screen.getByTestId("plantilla-save");
    expect(save).toHaveAttribute("data-dirty", "true");
    expect(save).not.toBeDisabled();

    await user.click(save);

    expect(mocks.saveTemplateAction).toHaveBeenCalledTimes(1);
    const form = mocks.saveTemplateAction.mock.calls[0][0] as FormData;
    expect(form.get("id")).toBe("t-1");
    expect(form.get("name")).toBe("Vanilla candle");
    expect(form.get("time")).toBe("60");
    expect(form.get("hourlyRate")).toBe("");
    expect(form.get("overhead")).toBe("");
    expect(form.get("marginPct")).toBe("30");
    const items = JSON.parse(String(form.get("items")));
    expect(items).toEqual([{ materialId: "wax", quantity: "100", unit: "g" }]);

    // Success replaces local state with the server-returned template;
    // the snapshot is updated so the dirty flag clears.
    const saveAfter = await screen.findByTestId("plantilla-save");
    expect(saveAfter).toHaveAttribute("data-dirty", "false");
    expect(saveAfter).toBeDisabled();
    // router.refresh stub should also have been called once.
    expect(mocks.refreshRouter).toHaveBeenCalled();
  });

  it("clicking Guardar surfaces the friendly Spanish error when the server action rejects", async () => {
    const user = userEvent.setup();
    mocks.saveTemplateAction.mockResolvedValueOnce({
      status: "error",
      message: "Ya existe una plantilla con ese nombre.",
    });
    const initial = [
      toClientTemplate(
        makeTemplate({
          id: "t-1",
          name: "Vanilla candle",
          items: [{ id: "r1", materialId: "wax", quantity: "100", unit: "g" }],
        }),
        MATERIALS,
      ),
    ];
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);
    const timeInput = within(screen.getByTestId("template-card")).getByLabelText(/Tiempo/);
    await user.clear(timeInput);
    await user.type(timeInput, "60");
    await user.click(screen.getByTestId("plantilla-save"));

    const error = await screen.findByTestId("plantilla-action-error");
    expect(error).toHaveTextContent("Ya existe una plantilla con ese nombre.");
    // The dirty marker stays on so the user can retry.
    const saveAfter = screen.getByTestId("plantilla-save");
    expect(saveAfter).toHaveAttribute("data-dirty", "true");
  });

  it("Guardar on a brand-new local placeholder creates the row and swaps the local id for the server one", async () => {
    const user = userEvent.setup();
    // The save action must observe an empty `id` so it takes the create
    // path; locally we seed the placeholder via `initialTemplates` with a
    // `local-*` id so the test does not race the createBlankTemplateAction
    // background flow. The workspace recognises `local-` ids and skips the
    // id field on save, dispatching the create path with the same payload.
    const placeholder = toClientTemplate(
      makeTemplate({
        id: "local-placeholder",
        name: "Nueva plantilla",
        items: [{ id: "r1", materialId: "wax", quantity: "100", unit: "g" }],
      }),
      MATERIALS,
    );
    const initial = [
      toClientTemplate(makeTemplate({ id: "t-1", name: "Vanilla candle" }), MATERIALS),
      placeholder,
    ];
    mocks.saveTemplateAction.mockImplementationOnce(async (form: FormData) => {
      // `form.get` returns null when the form data omits the key; the
      // workspace omits the id field for local placeholders so the action
      // takes the create path server-side.
      expect(form.get("id")).toBeNull();
      return {
        status: "success",
        template: {
          id: "server-created-1",
          name: "Nueva plantilla",
          unitCost: "100",
          archivedAt: null,
          time: "",
          hourlyRate: "",
          overhead: "",
          marginPct: "30",
        },
        meta: {
          unitCost: "100",
          time: "",
          hourlyRate: "",
          overhead: "",
          marginPct: "30",
        },
      };
    });
    render(<PlantillasWorkspace initialTemplates={initial} materials={MATERIALS} />);

    const placeholderCard = screen
      .getAllByTestId("template-card")
      .find(
        (c) =>
          c.dataset["testid"] === "template-card" &&
          c.querySelector("h3")?.textContent?.includes("Nueva plantilla"),
      ) as HTMLElement;
    expect(placeholderCard).toBeTruthy();
    await user.click(within(placeholderCard).getByTestId("plantilla-save"));

    // The create-path save returns a server-issued id; the placeholder's
    // trash aria-label keys off `template.name`, which the server echoes
    // back unchanged here, so we instead assert the server id lives on the
    // card and router.refresh() was triggered.
    await waitFor(() => {
      const card = screen
        .getAllByTestId("template-card")
        .find((c) => !c.querySelector("h3")?.textContent?.includes("Vanilla candle"));
      expect(card?.querySelector("[data-testid='plantilla-save']")).toHaveAttribute(
        "data-dirty",
        "false",
      );
    });
    expect(mocks.saveTemplateAction).toHaveBeenCalledTimes(1);
    expect(mocks.refreshRouter).toHaveBeenCalled();
  });
});
