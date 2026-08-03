import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PlantillasWorkspace,
  toClientTemplate,
  type PlantillaClientMaterial,
} from "../../src/app/templates/PlantillasWorkspace";
import { calcTemplateSummary } from "../../src/domain/templateSummary";

function makeTemplate(over: Partial<{
  id: string;
  name: string;
  unitCost: string;
  archivedAt: Date | null;
  items: Array<{ id: string; materialId: string; quantity: string; unit: string }>;
}> = {}) {
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
    expect(client.items[1]).toMatchObject({ materialId: "wick", unitCost: "20", name: "Cotton wick" });
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
    expect(screen.getByRole("heading", { name: "No hay plantillas todavía" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Creá tu primera plantilla" })).toBeInTheDocument();
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
    expect(within(summary).getByTestId("summary-materials")).toHaveTextContent("1040");
    expect(within(summary).getByTestId("summary-total")).toHaveTextContent("1040");
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
    expect(within(cards[0]).getByTestId("summary-materials")).toHaveTextContent("0");
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
    expect(within(cards[0]).getByTestId("summary-materials")).toHaveTextContent("1000");
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
});
