import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  listMaterials: vi.fn(),
  countArchivedMaterials: vi.fn(),
  createMaterialAction: vi.fn(),
  updateMaterialAction: vi.fn(),
  archiveMaterialAction: vi.fn(),
  unarchiveMaterialAction: vi.fn(),
}));

vi.mock("../../src/server/auth/requireOwner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("../../src/server/repositories/materials", () => ({
  listMaterials: mocks.listMaterials,
  countArchivedMaterials: mocks.countArchivedMaterials,
}));
vi.mock("../../src/server/actions/materials", () => ({
  createMaterialAction: mocks.createMaterialAction,
  updateMaterialAction: mocks.updateMaterialAction,
  archiveMaterialAction: mocks.archiveMaterialAction,
  unarchiveMaterialAction: mocks.unarchiveMaterialAction,
}));

import MaterialsPage from "../../src/app/materials/page";
import { MaterialCreateForm } from "../../src/app/materials/MaterialCreateForm";

function pageProps(view?: "active" | "all") {
  return { searchParams: Promise.resolve(view ? { view } : {}) };
}

const MATERIAL_BASE = {
  dimension: "mass",
  baseUnit: "g",
  purchaseUnit: "kg",
  purchaseQuantity: "1",
};
const MATERIAL_ACTIVE = {
  ...MATERIAL_BASE,
  id: "material-1",
  name: "Soy wax",
  purchasePrice: "10000",
  unitCost: "10",
  archivedAt: null,
};
const MATERIAL_ARCHIVED = {
  ...MATERIAL_BASE,
  id: "material-2",
  name: "Coconut wax",
  purchasePrice: "8000",
  unitCost: "8",
  archivedAt: new Date("2026-01-01T00:00:00Z"),
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireOwner.mockResolvedValue({ id: "owner-1", email: "owner@example.com" });
  mocks.listMaterials.mockResolvedValue([]);
  mocks.countArchivedMaterials.mockResolvedValue(0);
  mocks.createMaterialAction.mockResolvedValue({ status: "success", materialId: "material-1" });
});

it("shows an actionable empty state when the owner has no materials", async () => {
  mocks.listMaterials.mockResolvedValue([]);
  mocks.countArchivedMaterials.mockResolvedValue(0);

  render(await MaterialsPage(pageProps()));

  expect(screen.getByRole("heading", { name: "Materiales" })).toBeInTheDocument();
  expect(screen.getByText("No hay materiales todavía")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Agregá tu primer material" })).toHaveAttribute(
    "href",
    "#new-material",
  );
});

it("shows a view-aware empty state when active list is empty but archived records exist", async () => {
  // R3-002: archived-only owner in active view. Archived names stay unique
  // per owner, so the empty state must not pretend the catalog is empty and
  // must offer a semantic path to the archived/all view.
  mocks.listMaterials.mockResolvedValue([]);
  mocks.countArchivedMaterials.mockResolvedValue(3);

  render(await MaterialsPage(pageProps()));

  expect(screen.getByRole("heading", { name: "No hay materiales activos" })).toBeInTheDocument();
  expect(
    screen.getByText("3 materiales están archivados y ocultos en esta vista."),
  ).toBeInTheDocument();
  const showArchivedLinks = screen.getAllByRole("link", { name: /Mostrar archivados/ });
  expect(showArchivedLinks.length).toBeGreaterThanOrEqual(1);
  expect(
    showArchivedLinks.find((link) => link.getAttribute("href") === "/materials?view=all"),
  ).toBeDefined();
  expect(screen.queryByText("No hay materiales todavía")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Agregá tu primer material" })).not.toBeInTheDocument();
  expect(mocks.countArchivedMaterials).toHaveBeenCalledWith("owner-1");
});

it("uses singular copy when only one archived material exists", async () => {
  mocks.listMaterials.mockResolvedValue([]);
  mocks.countArchivedMaterials.mockResolvedValue(1);

  render(await MaterialsPage(pageProps()));

  expect(screen.getByText("1 material está archivado y oculto en esta vista.")).toBeInTheDocument();
});

it("does not query archived count when active list is non-empty", async () => {
  mocks.listMaterials.mockResolvedValue([MATERIAL_ACTIVE]);
  mocks.countArchivedMaterials.mockResolvedValue(0);

  render(await MaterialsPage(pageProps()));

  expect(mocks.countArchivedMaterials).not.toHaveBeenCalled();
});

it("does not query archived count in the all view even when the list is empty", async () => {
  mocks.listMaterials.mockResolvedValue([]);
  mocks.countArchivedMaterials.mockResolvedValue(0);

  render(await MaterialsPage(pageProps("all")));

  // All view shows "No hay materiales todavía" because nothing exists at all.
  expect(screen.getByText("No hay materiales todavía")).toBeInTheDocument();
  expect(mocks.countArchivedMaterials).not.toHaveBeenCalled();
});

it("renders current materials, hides archived by default, and exposes the filter nav", async () => {
  mocks.listMaterials.mockResolvedValue([MATERIAL_ACTIVE]);

  render(await MaterialsPage(pageProps()));

  expect(screen.getByRole("listitem")).toHaveTextContent("Soy wax");
  expect(screen.getByRole("listitem")).toHaveTextContent("ARS 10 por g");
  expect(mocks.listMaterials).toHaveBeenCalledWith("owner-1", { includeArchived: false });
  const nav = screen.getByRole("navigation", { name: /filtro de vista de materiales/i });
  expect(within(nav).getByRole("link", { name: /Activos/ })).toHaveAttribute("href", "/materials");
  expect(within(nav).getByRole("link", { name: /Activos/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(within(nav).getByRole("link", { name: /Mostrar archivados/ })).toHaveAttribute(
    "href",
    "/materials?view=all",
  );
});

it("shows archived materials with restore controls, a badge, and the all view as current", async () => {
  mocks.listMaterials.mockResolvedValue([MATERIAL_ACTIVE, MATERIAL_ARCHIVED]);

  render(await MaterialsPage(pageProps("all")));

  expect(mocks.listMaterials).toHaveBeenCalledWith("owner-1", { includeArchived: true });
  expect(screen.getByRole("button", { name: "Archivar Soy wax" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Restaurar Coconut wax" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Editar material: Soy wax" })).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Editar material: Coconut wax" }),
  ).not.toBeInTheDocument();
  expect(screen.getByTestId("archived-badge")).toHaveTextContent("Archivado");
  expect(screen.getByRole("link", { name: /Mostrar archivados/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

async function fillMaterialForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nombre"), "Soy wax");
  await user.selectOptions(screen.getByLabelText("Unidad de compra"), "kg");
  await user.type(screen.getByLabelText("Cantidad de compra"), "1");
  await user.type(screen.getByLabelText("Precio de compra (ARS)"), "10000");
}

it("validates with Zod before invoking the Server Action", async () => {
  const user = userEvent.setup();
  render(<MaterialCreateForm />);

  await user.click(screen.getByRole("button", { name: "Crear material" }));

  expect(await screen.findByText("Name is required")).toBeInTheDocument();
  expect(mocks.createMaterialAction).not.toHaveBeenCalled();
});

it("shows and focuses a client-derived unit-cost error before invoking the Server Action", async () => {
  const user = userEvent.setup();
  render(<MaterialCreateForm />);
  await user.type(screen.getByLabelText("Nombre"), "Soy wax");
  await user.type(screen.getByLabelText("Cantidad de compra"), "0.000001");
  const price = screen.getByLabelText("Precio de compra (ARS)");
  await user.type(price, "1000000000000000");

  await user.click(screen.getByRole("button", { name: "Crear material" }));

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

  await user.click(screen.getByRole("button", { name: "Crear material" }));

  expect(mocks.createMaterialAction).toHaveBeenCalledTimes(1);
  const submitted = mocks.createMaterialAction.mock.calls[0][1] as FormData;
  expect(submitted.get("name")).toBe("Soy wax");
  expect(submitted.get("purchaseUnit")).toBe("kg");
  expect(submitted.get("purchasePrice")).toBe("10000");
  expect(await screen.findByRole("status")).toHaveTextContent("Material creado.");
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

  await user.click(screen.getByRole("button", { name: "Crear material" }));
  expect(await screen.findByRole("button", { name: "Creando material…" })).toBeDisabled();
  resolveAction({
    status: "error",
    fieldErrors: { unitCost: ["Derived unit cost cannot be represented at database precision"] },
  });

  expect(
    await screen.findByText("Derived unit cost cannot be represented at database precision"),
  ).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText("Precio de compra (ARS)")).toHaveFocus());
});

it("resets the form after a successful create without dispatching a duplicate action", async () => {
  const user = userEvent.setup();
  render(<MaterialCreateForm />);
  await fillMaterialForm(user);

  await user.click(screen.getByRole("button", { name: "Crear material" }));

  expect(await screen.findByRole("status")).toHaveTextContent("Material creado.");
  expect(mocks.createMaterialAction).toHaveBeenCalledTimes(1);
  await waitFor(() => {
    expect(screen.getByLabelText("Nombre")).toHaveValue("");
    expect(screen.getByLabelText("Dimensión")).toHaveValue("mass");
    expect(screen.getByLabelText("Unidad base")).toHaveValue("g");
    expect(screen.getByLabelText("Unidad de compra")).toHaveValue("g");
    expect(screen.getByLabelText("Cantidad de compra")).toHaveValue(null);
    expect(screen.getByLabelText("Precio de compra (ARS)")).toHaveValue(null);
  });
});

it("resets again after a later successful create", async () => {
  const user = userEvent.setup();
  mocks.createMaterialAction
    .mockResolvedValueOnce({ status: "success", materialId: "material-1" })
    .mockResolvedValueOnce({ status: "success", materialId: "material-2" });
  render(<MaterialCreateForm />);

  await fillMaterialForm(user);
  await user.click(screen.getByRole("button", { name: "Crear material" }));
  await waitFor(() => expect(mocks.createMaterialAction).toHaveBeenCalledTimes(1));

  await fillMaterialForm(user);
  await user.click(screen.getByRole("button", { name: "Crear material" }));
  await waitFor(() => expect(mocks.createMaterialAction).toHaveBeenCalledTimes(2));

  await waitFor(() => {
    expect(screen.getByLabelText("Nombre")).toHaveValue("");
    expect(screen.getByLabelText("Cantidad de compra")).toHaveValue(null);
    expect(screen.getByLabelText("Precio de compra (ARS)")).toHaveValue(null);
  });
});

it("does not steal focus on unrelated rerenders after a server unit-cost error", async () => {
  const user = userEvent.setup();
  mocks.createMaterialAction.mockResolvedValue({
    status: "error",
    fieldErrors: { unitCost: ["Derived unit cost cannot be represented at database precision"] },
  });
  render(<MaterialCreateForm />);
  await fillMaterialForm(user);

  await user.click(screen.getByRole("button", { name: "Crear material" }));
  await screen.findByText("Derived unit cost cannot be represented at database precision");

  const name = screen.getByLabelText("Nombre");
  await user.click(name);
  await user.type(name, " updated");

  expect(name).toHaveFocus();
});

// R3-003 page-level composition: the feedback provider must survive the
// transition from a non-empty active list to an empty active list, and the
// "Show archived" focus destination must be reached via the truthful
// remaining-row state. The current wiring mounts the provider only inside
// the list branch and hardcodes hasRemainingRows to true, so the status
// unmounts and the focus destination is wrong on the post-revalidation
// render.
describe("R3-003 page-level lifecycle composition", () => {
  function mockConfirm(value: boolean) {
    return vi.spyOn(window, "confirm").mockReturnValue(value);
  }

  it("keeps the success announcement and moves focus to Show archived when the last active row is archived", async () => {
    // RED on the current wiring: the provider unmounts when the list
    // transitions to empty, so the role=status disappears and the focus
    // destination is never evaluated. On the fixed wiring the provider
    // stays mounted and the truthful hasRemainingRows=false re-runs the
    // focus effect onto the "Show archived" link.
    const user = userEvent.setup();
    const confirmSpy = mockConfirm(true);
    mocks.listMaterials.mockResolvedValue([MATERIAL_ACTIVE]);
    mocks.countArchivedMaterials.mockResolvedValue(0);
    mocks.archiveMaterialAction.mockResolvedValue({
      status: "success",
      materialId: MATERIAL_ACTIVE.id,
    });

    const first = await MaterialsPage(pageProps());
    const { rerender } = render(first);

    await user.click(screen.getByRole("button", { name: "Archivar Soy wax" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Soy wax archivado.");

    // Simulate the post-revalidation render: the active list is now empty
    // and the owner has one archived material, so the page transitions to
    // the view-aware empty state.
    mocks.listMaterials.mockResolvedValue([]);
    mocks.countArchivedMaterials.mockResolvedValue(1);
    rerender(await MaterialsPage(pageProps()));

    // The persistent success announcement must survive the transition.
    expect(screen.getByRole("status")).toHaveTextContent("Soy wax archivado.");
    // Focus must move to a "Mostrar archivados" affordance (nav or empty-state
    // link), not be lost on body.
    const showArchivedLinks = screen.getAllByRole("link", { name: /Mostrar archivados/ });
    expect(showArchivedLinks.length).toBeGreaterThan(0);
    expect(showArchivedLinks.some((link) => link === document.activeElement)).toBe(true);
    confirmSpy.mockRestore();
  });

  it("preserves the announcement when one of two active rows is archived and rows still remain", async () => {
    // Triangulation: when rows remain after archive, the provider must keep
    // the announcement visible across the post-revalidation transition.
    // The fix must not break the already-verified next-row focus behavior.
    const user = userEvent.setup();
    const confirmSpy = mockConfirm(true);
    const otherActive = {
      ...MATERIAL_BASE,
      id: "material-other",
      name: "Coconut wax",
      purchasePrice: "8000",
      unitCost: "8",
      archivedAt: null,
    };
    mocks.listMaterials.mockResolvedValue([MATERIAL_ACTIVE, otherActive]);
    mocks.countArchivedMaterials.mockResolvedValue(0);
    mocks.archiveMaterialAction.mockResolvedValue({
      status: "success",
      materialId: MATERIAL_ACTIVE.id,
    });

    const first = await MaterialsPage(pageProps());
    const { rerender } = render(first);

    await user.click(screen.getByRole("button", { name: "Archivar Soy wax" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Soy wax archivado.");

    // Post-revalidation: Soy wax archived, Coconut wax remains active.
    mocks.listMaterials.mockResolvedValue([otherActive]);
    rerender(await MaterialsPage(pageProps()));

    // Status persists across the transition.
    expect(screen.getByRole("status")).toHaveTextContent("Soy wax archivado.");
    // The remaining row's archive button is still rendered.
    expect(screen.getByRole("button", { name: "Archivar Coconut wax" })).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("moves focus to the remaining row's archive button after revalidation when one of two active rows is archived", async () => {
    // JD-001 directed reproduction: the focus effect in MaterialsArchiveFeedback
    // depends on [result, view, hasRemainingRows]. When the first of two
    // active rows is archived, the effect runs while hasRemainingRows is
    // still true and focuses the departing row's archive button. After
    // revalidation that button is unmounted, and because hasRemainingRows
    // stays true the effect does not re-run, so focus is left on the
    // detached element. The remaining row's archive button must receive
    // focus so keyboard users keep their place in the surviving list.
    const user = userEvent.setup();
    const confirmSpy = mockConfirm(true);
    const otherActive = {
      ...MATERIAL_BASE,
      id: "material-other",
      name: "Coconut wax",
      purchasePrice: "8000",
      unitCost: "8",
      archivedAt: null,
    };
    mocks.listMaterials.mockResolvedValue([MATERIAL_ACTIVE, otherActive]);
    mocks.countArchivedMaterials.mockResolvedValue(0);
    mocks.archiveMaterialAction.mockResolvedValue({
      status: "success",
      materialId: MATERIAL_ACTIVE.id,
    });

    const first = await MaterialsPage(pageProps());
    const { rerender } = render(first);

    expect(screen.getByRole("button", { name: "Archivar Soy wax" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archivar Coconut wax" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archivar Soy wax" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Soy wax archivado.");

    // Post-revalidation: Soy wax archived, Coconut wax remains active.
    mocks.listMaterials.mockResolvedValue([otherActive]);
    rerender(await MaterialsPage(pageProps()));

    // Status persists across the transition.
    expect(screen.getByRole("status")).toHaveTextContent("Soy wax archivado.");
    // The first row was archived and removed; the remaining row's archive
    // button must receive focus so the keyboard cursor does not get lost
    // on the unmounted departing row.
    const remaining = screen.getByRole("button", { name: "Archivar Coconut wax" });
    expect(remaining).toBeInTheDocument();
    await waitFor(() => expect(remaining).toHaveFocus());
    confirmSpy.mockRestore();
  });

  it("does not move focus to Show archived when a row is restored in the all view", async () => {
    // Triangulation: restore keeps the row mounted, so the provider must
    // not move focus. The page-level composition must not break the
    // already-verified no-focus-move behavior on restore.
    const user = userEvent.setup();
    mocks.listMaterials.mockResolvedValue([MATERIAL_ACTIVE, MATERIAL_ARCHIVED]);
    mocks.countArchivedMaterials.mockResolvedValue(1);
    mocks.unarchiveMaterialAction.mockResolvedValue({
      status: "success",
      materialId: MATERIAL_ARCHIVED.id,
    });

    const first = await MaterialsPage(pageProps("all"));
    const { rerender } = render(first);

    await user.click(screen.getByRole("button", { name: "Restaurar Coconut wax" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Coconut wax restaurado.");

    // The list is unchanged in the all view (restore doesn't remove rows).
    rerender(await MaterialsPage(pageProps("all")));

    // Status persists.
    expect(screen.getByRole("status")).toHaveTextContent("Coconut wax restaurado.");
    // Focus must NOT be on a "Mostrar archivados" link — restore keeps the row
    // mounted, so the provider's focus effect must early-return.
    const showArchivedLinks = screen.getAllByRole("link", { name: /Mostrar archivados/ });
    showArchivedLinks.forEach((link) => {
      expect(link).not.toBe(document.activeElement);
    });
  });
});

// U4 — presentation contract: rosa-crema tokens only, no nested <main>.
describe("U4 /materials presentation contract", () => {
  // Spec forbids raw zinc/rose outside token-definition files.
  const FORBIDDEN_RAW = ["bg-zinc-", "border-rose-", "bg-rose-"] as const;

  it("does not nest a <main> element so the root layout keeps a single skip-link target", async () => {
    const view = render(await MaterialsPage(pageProps()));
    expect(view.container.querySelector("main")).toBeNull();
  });

  it("uses rosa-crema tokens only (bg-canvas present, no raw zinc/rose utilities)", async () => {
    const view = render(await MaterialsPage(pageProps()));
    const html = view.container.innerHTML;
    expect(html).toMatch(/\bbg-canvas\b/);
    for (const forbidden of FORBIDDEN_RAW) {
      expect(html).not.toContain(forbidden);
    }
  });
});
