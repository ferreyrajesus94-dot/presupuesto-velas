/** PR4g.3 — Indirect cost editor + submit wiring + deposit preview (Strict TDD). */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createQuoteDraftAction: vi.fn(),
  appendQuoteVersionAction: vi.fn(),
}));

vi.mock("@/server/actions/quotes", () => ({
  createQuoteDraftAction: mocks.createQuoteDraftAction,
  appendQuoteVersionAction: mocks.appendQuoteVersionAction,
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  redirect: vi.fn(),
}));

import { QuoteCreateForm } from "@/app/quotes/new/QuoteCreateForm";
import type { Template } from "@/server/repositories/templates";

const VANILLA: Template = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerId: "owner-1",
  name: "Vanilla candle",
  unitCost: "100",
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};
const TEMPLATES = [VANILLA];

beforeEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
  mocks.createQuoteDraftAction.mockResolvedValue({
    ok: true,
    value: {
      quote: { id: "q1", ownerId: "owner-1", status: "draft", lockVersion: 0 },
      versions: [],
      models: [],
      materials: [],
      indirectCosts: [],
    },
  });
  mocks.appendQuoteVersionAction.mockResolvedValue({
    ok: true,
    value: {
      quote: { id: "q1", ownerId: "owner-1", status: "draft", lockVersion: 1 },
      version: { quoteId: "q1", versionNo: 1 },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("IndirectCostEditor — defaults", () => {
  it("renders the 4 default indirects (labor, electricity, transport, waste) on mount", () => {
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const list = screen.getByRole("list", { name: "Costos indirectos" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(within(list).getByDisplayValue("labor")).toBeInTheDocument();
    expect(within(list).getByDisplayValue("electricity")).toBeInTheDocument();
    expect(within(list).getByDisplayValue("transport")).toBeInTheDocument();
    expect(within(list).getByDisplayValue("waste")).toBeInTheDocument();
  });
});

describe("IndirectCostEditor — CRUD", () => {
  it("appends an empty row when Agregar concepto is clicked", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const list = screen.getByRole("list", { name: "Costos indirectos" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Agregar concepto" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
  });

  it("removes a row when Quitar is clicked", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const list = screen.getByRole("list", { name: "Costos indirectos" });
    await user.click(screen.getByRole("button", { name: "Quitar concepto 1" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  });

  it("updates the running total when amounts change", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const firstAmount = document.getElementById("quote-indirect-0-amount") as HTMLInputElement;
    await user.clear(firstAmount);
    await user.type(firstAmount, "100");
    expect(screen.getByTestId("indirect-total")).toHaveTextContent(/ARS 100,00/);
  });

  it("rejects an empty indirect name on submit (Zod error)", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    // Pick a valid template so the model validation passes.
    const modelRow = screen.getByRole("listitem", { name: "Modelo 1" });
    await user.selectOptions(within(modelRow).getByLabelText("Receta"), VANILLA.id);
    // Clear the first indirect name.
    const firstName = document.getElementById("quote-indirect-0-name") as HTMLInputElement;
    await user.clear(firstName);
    await user.click(screen.getByRole("button", { name: "Crear borrador" }));
    // The action must NOT be called because the form is invalid.
    expect(mocks.createQuoteDraftAction).not.toHaveBeenCalled();
  });
});

describe("QuoteCreateForm — derived totals preview", () => {
  const fillValidForm = async (
    user: ReturnType<typeof userEvent.setup>,
    qty: string,
    labor: string,
    electricity: string,
  ): Promise<void> => {
    const modelRow = screen.getByRole("listitem", { name: "Modelo 1" });
    await user.selectOptions(within(modelRow).getByLabelText("Receta"), VANILLA.id);
    const qtyInput = within(modelRow).getByLabelText("Cantidad") as HTMLInputElement;
    await user.clear(qtyInput);
    await user.type(qtyInput, qty);
    const laborInput = document.getElementById("quote-indirect-0-amount") as HTMLInputElement;
    await user.clear(laborInput);
    await user.type(laborInput, labor);
    const elecInput = document.getElementById("quote-indirect-1-amount") as HTMLInputElement;
    await user.clear(elecInput);
    await user.type(elecInput, electricity);
  };

  it("computes materialsTotal = 500 (unitCost 100 × qty 5) in the totals row", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    await fillValidForm(user, "5", "0", "0");
    expect(screen.getByTestId("materials-total")).toHaveTextContent(/ARS 500,00/);
  });

  it("computes indirectTotal = 150 (labor 100 + electricity 50) in the totals row", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    await fillValidForm(user, "5", "100", "50");
    // The indirects running total must include 100 + 50 = 150.
    expect(screen.getByTestId("indirect-total")).toHaveTextContent(/ARS 150,00/);
    expect(screen.getByTestId("grand-indirect-total")).toHaveTextContent(/ARS 150,00/);
  });

  it("computes profitTotal = 195 (30% of (500 + 150)) for percentage mode", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    await fillValidForm(user, "5", "100", "50");
    expect(screen.getByTestId("profit-total")).toHaveTextContent(/ARS 195,00/);
  });

  it("computes total T = 845 (500 + 150 + 195) in the totals row", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    await fillValidForm(user, "5", "100", "50");
    expect(screen.getByTestId("grand-total")).toHaveTextContent(/ARS 845,00/);
  });

  it("shows the auto-suggested deposit percent (M/T=500/845 → 59.18)", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    await fillValidForm(user, "5", "100", "50");
    // suggestDepositPercent(500, 150, 195):
    //   T = 845, M/T = 0.5917..., M/T*100 = 59.1717..., × 100 = 5917.17..., ceil = 5918, / 100 = 59.18
    expect(screen.getByText(/59\.18/)).toBeInTheDocument();
  });

  it("Aplicar sugerencia writes the suggested percent into the deposit field", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    await fillValidForm(user, "5", "100", "50");
    const depositInput = screen.getByLabelText(/Porcentaje de seña/) as HTMLInputElement;
    expect(depositInput.value).toBe("0");
    await user.click(screen.getByRole("button", { name: /Aplicar sugerencia/ }));
    expect(depositInput.value).toBe("59.18");
  });

  it("suggests 0% when there are no materials selected (M=0)", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    // No template picked → materialsTotal stays 0 even if indirects > 0.
    const laborInput = document.getElementById("quote-indirect-0-amount") as HTMLInputElement;
    await user.clear(laborInput);
    await user.type(laborInput, "100");
    expect(screen.getByTestId("suggested-percent")).toHaveTextContent(/0%/);
  });
});

describe("QuoteCreateForm — submit wiring", () => {
  const fillValidForm = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
    const modelRow = screen.getByRole("listitem", { name: "Modelo 1" });
    await user.selectOptions(within(modelRow).getByLabelText("Receta"), VANILLA.id);
    const qtyInput = within(modelRow).getByLabelText("Cantidad") as HTMLInputElement;
    await user.clear(qtyInput);
    await user.type(qtyInput, "5");
  };

  it("calls createQuoteDraftAction then appendQuoteVersionAction then router.push on success", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Crear borrador" }));
    // Both actions were called with the right owner-scoped inputs.
    expect(mocks.createQuoteDraftAction).toHaveBeenCalledTimes(1);
    expect(mocks.appendQuoteVersionAction).toHaveBeenCalledTimes(1);
    // The version action receives the enriched models array (perUnitCostDecimal injected).
    const versionArgs = mocks.appendQuoteVersionAction.mock.calls[0] as [
      string,
      { models: Array<{ recipeId: string; quantity: string; perUnitCostDecimal: string }> },
      number,
    ];
    expect(versionArgs[0]).toBe("q1");
    expect(versionArgs[2]).toBe(0);
    expect(versionArgs[1].models[0]).toEqual({
      recipeId: VANILLA.id,
      quantity: "5",
      perUnitCostDecimal: "100",
    });
    // router.push fired with the right URL.
    expect(push).toHaveBeenCalledWith("/quotes/q1");
  });

  it("shows the Spanish fallback 'No se pudo crear la cotización.' when createQuoteDraftAction fails", async () => {
    mocks.createQuoteDraftAction.mockResolvedValueOnce({
      ok: false,
      error: { code: "INVALID_INPUT", message: "fecha inválida" },
    });
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Crear borrador" }));
    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveTextContent("No se pudo crear la cotización.");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(push).not.toHaveBeenCalled();
    expect(mocks.appendQuoteVersionAction).not.toHaveBeenCalled();
  });

  it("shows the Spanish fallback 'No se pudo crear la cotización.' when appendQuoteVersionAction fails after a successful draft", async () => {
    mocks.appendQuoteVersionAction.mockResolvedValueOnce({
      ok: false,
      error: { code: "LOCK_VERSION_MISMATCH", message: "stale lock" },
    });
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Crear borrador" }));
    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveTextContent("No se pudo crear la cotización.");
    expect(push).not.toHaveBeenCalled();
  });
});
