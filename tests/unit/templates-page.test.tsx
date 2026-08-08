import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listTemplates: vi.fn(),
  countArchivedTemplates: vi.fn(),
  listMaterials: vi.fn(),
}));

vi.mock("../../src/server/auth/requireUser", () => ({
  requireUser: mocks.requireUser,
}));
vi.mock("../../src/server/repositories/templates", () => ({
  listTemplates: mocks.listTemplates,
  countArchivedTemplates: mocks.countArchivedTemplates,
}));
vi.mock("../../src/server/repositories/materials", () => ({
  listMaterials: mocks.listMaterials,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  redirect: vi.fn(),
}));

import TemplatesPage from "../../src/app/templates/page";

function pageProps(view?: "active" | "all") {
  return { searchParams: Promise.resolve(view ? { view } : {}) };
}

const ACTIVE_TEMPLATES = [
  {
    template: {
      id: "t-1",
      name: "Vanilla candle",
      unitCost: "1100",
      archivedAt: null,
    },
    items: [
      { id: "i-1", position: 1, materialId: "wax", quantity: "100" },
      { id: "i-2", position: 2, materialId: "wick", quantity: "2" },
    ],
  },
];

const ARCHIVED_TEMPLATES = [
  {
    template: {
      id: "t-archived",
      name: "Citrus candle",
      unitCost: "800",
      archivedAt: new Date("2026-01-01T00:00:00Z"),
    },
    items: [{ id: "i-3", position: 1, materialId: "wax", quantity: "120" }],
  },
];

const ACTIVE_MATERIALS = [
  { id: "wax", name: "Soy wax", baseUnit: "g", unitCost: "10" },
  { id: "wick", name: "Cotton wick", baseUnit: "unit", unitCost: "20" },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "user-1", email: "user@example.com" });
  // Mock the visibility-aware behavior of the server-side listTemplates():
  // respect the includeArchived flag so the page tests can verify the
  // server-side filter is actually applied.
  const ALL = [...ACTIVE_TEMPLATES, ...ARCHIVED_TEMPLATES];
  mocks.listTemplates.mockImplementation(
    async (_ownerId: string, visibility: { includeArchived?: boolean } = {}) =>
      visibility.includeArchived ? ALL : ACTIVE_TEMPLATES,
  );
  mocks.countArchivedTemplates.mockResolvedValue(0);
  mocks.listMaterials.mockResolvedValue(ACTIVE_MATERIALS);
});

describe("/templates page composition (Phase 4.7)", () => {
  it("renders the page heading, the empty state, and mounts the workspace", async () => {
    mocks.listTemplates.mockResolvedValue([]);
    render(await TemplatesPage(pageProps()));
    expect(screen.getByRole("heading", { name: "Plantillas" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Empezá creando tu primera plantilla/i }),
    ).toBeInTheDocument();
    // The "Nueva plantilla" CTA appears in both the header and the empty
    // state — assert at least one exists.
    expect(
      screen.getAllByRole("button", { name: /Nueva plantilla/i }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(mocks.requireUser).toHaveBeenCalledTimes(1);
    expect(mocks.listMaterials).toHaveBeenCalledWith("user-1", { includeArchived: false });
  });

  it("defaults to active visibility and excludes archived templates", async () => {
    // The beforeEach visibility-aware mock returns ACTIVE_TEMPLATES when
    // includeArchived=false, simulating the SQL-level filter.
    render(await TemplatesPage(pageProps()));
    expect(mocks.listTemplates).toHaveBeenCalledWith("user-1", { includeArchived: false });
    const cards = screen.getAllByTestId("template-card");
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getByText("Vanilla candle")).toBeInTheDocument();
  });

  it("includes archived templates when the view is all", async () => {
    render(await TemplatesPage(pageProps("all")));
    expect(mocks.listTemplates).toHaveBeenCalledWith("user-1", { includeArchived: true });
    expect(screen.getAllByTestId("template-card")).toHaveLength(2);
  });

  it("surfaces the help button with data-help=templates", async () => {
    render(await TemplatesPage(pageProps()));
    expect(screen.getByRole("button", { name: "Ayuda sobre plantillas" })).toHaveAttribute(
      "data-help",
      "templates",
    );
  });

  it("shows the archived-only empty-state hint when the active list is empty but archived exist", async () => {
    mocks.listTemplates.mockResolvedValue([]);
    mocks.countArchivedTemplates.mockResolvedValue(2);
    render(await TemplatesPage(pageProps()));
    expect(screen.getByText(/2 plantillas están archivadas/)).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "Mostrar archivadas" });
    expect(links.every((link) => link.getAttribute("href") === "/templates?view=all")).toBe(true);
    expect(mocks.countArchivedTemplates).toHaveBeenCalledWith("user-1");
  });

  it("uses singular copy when only one archived template exists", async () => {
    mocks.listTemplates.mockResolvedValue([]);
    mocks.countArchivedTemplates.mockResolvedValue(1);
    render(await TemplatesPage(pageProps()));
    expect(
      screen.getByText("1 plantilla está archivada y oculta en esta vista."),
    ).toBeInTheDocument();
  });

  it("does not query the archived count when the active list is non-empty", async () => {
    mocks.listTemplates.mockResolvedValue(ACTIVE_TEMPLATES);
    render(await TemplatesPage(pageProps()));
    expect(mocks.countArchivedTemplates).not.toHaveBeenCalled();
  });

  it("renders the workspace summary fields for each template", async () => {
    mocks.listTemplates.mockResolvedValue(ACTIVE_TEMPLATES);
    render(await TemplatesPage(pageProps()));
    const summaries = screen.getAllByTestId("plantilla-summary");
    expect(summaries).toHaveLength(1);
    expect(within(summaries[0]).getByTestId("summary-materials")).toBeInTheDocument();
    expect(within(summaries[0]).getByTestId("summary-total")).toBeInTheDocument();
    expect(within(summaries[0]).getByTestId("summary-suggested")).toBeInTheDocument();
  });
});
