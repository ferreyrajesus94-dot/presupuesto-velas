/** PR4g.2 — Quote create form shell (Strict TDD). */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  listTemplates: vi.fn(),
  createQuoteDraftAction: vi.fn(),
  appendQuoteVersionAction: vi.fn(),
}));
vi.mock("@/server/auth/requireOwner", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/server/repositories/templates", () => ({ listTemplates: mocks.listTemplates }));
// PR4g.3 — `QuoteCreateForm` now imports the server actions; mock them so the
// module load does not transitively require `DATABASE_URL` (the quotes repo
// pulls `db/client.ts` at import time). Same module also pulls `useRouter`
// from `next/navigation`, which requires an app router context — stub it.
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  redirect: vi.fn(),
}));
vi.mock("@/server/actions/quotes", () => ({
  createQuoteDraftAction: mocks.createQuoteDraftAction,
  appendQuoteVersionAction: mocks.appendQuoteVersionAction,
}));

import NewQuotePage from "@/app/quotes/new/page";
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
const CINNAMON: Template = {
  id: "22222222-2222-4222-8222-222222222222",
  ownerId: "owner-1",
  name: "Cinnamon candle",
  unitCost: "200",
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};
const ARCHIVED: Template = {
  id: "33333333-3333-4333-8333-333333333333",
  ownerId: "owner-1",
  name: "Old template",
  unitCost: "50",
  archivedAt: new Date("2026-01-01T00:00:00Z"),
  createdAt: new Date("2025-12-01T00:00:00Z"),
};
const TEMPLATES = [VANILLA, CINNAMON];

const pad2 = (n: number): string => String(n).padStart(2, "0");
const defaultExp = (days = 14, now = new Date()): string => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
  mocks.requireOwner.mockResolvedValue({ id: "owner-1", email: "owner@example.com" });
  mocks.listTemplates.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/quotes/new page loader", () => {
  it("requires the owner, fetches active templates, and renders the page heading + back link", async () => {
    mocks.listTemplates.mockResolvedValue(TEMPLATES.map((template) => ({ template, items: [] })));
    const element = await NewQuotePage();
    render(element);
    expect(mocks.requireOwner).toHaveBeenCalledTimes(1);
    expect(mocks.listTemplates).toHaveBeenCalledWith("owner-1");
    expect(screen.getByRole("link", { name: /Cotizaciones/ })).toHaveAttribute("href", "/quotes");
    // Page mounts exactly one H1; the form uses an aria-label (not a heading).
    expect(screen.getAllByRole("heading", { name: "Nueva cotización" })).toHaveLength(1);
  });

  it("filters out archived templates before passing the list to the form", async () => {
    mocks.listTemplates.mockResolvedValue([
      { template: VANILLA, items: [] },
      { template: ARCHIVED, items: [] },
      { template: CINNAMON, items: [] },
    ]);
    const element = await NewQuotePage();
    render(element);
    const names = screen
      .getAllByRole("option")
      .map((o) => o.textContent)
      .filter(Boolean);
    expect(names).toContain("Vanilla candle");
    expect(names).toContain("Cinnamon candle");
    expect(names).not.toContain("Old template");
  });
});

describe("QuoteCreateForm — defaults", () => {
  it("renders empty customer, today+14 expiration, 1 model row, percentage profit, visibility on", () => {
    vi.useFakeTimers({ now: new Date("2026-07-15T12:00:00") });
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const customerInput = screen.getByLabelText("Cliente") as HTMLInputElement;
    expect(customerInput.value).toBe("");
    const expirationInput = screen.getByLabelText("Vencimiento") as HTMLInputElement;
    expect(expirationInput.value).toBe(defaultExp(14, new Date("2026-07-15T12:00:00")));
    const modelList = screen.getByRole("list", { name: "Modelos" });
    expect(within(modelList).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByLabelText("Porcentaje")).toBeChecked();
    const percentInput = screen.getByLabelText(/Porcentaje de ganancia/) as HTMLInputElement;
    expect(percentInput.value).toBe("30");
    expect(screen.queryByLabelText(/Monto fijo de ganancia/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Mostrar costo interno")).toBeChecked();
    expect(screen.getByLabelText("Mostrar margen de ganancia")).toBeChecked();
    expect(screen.getByRole("button", { name: "Crear borrador" })).toBeEnabled();
  });
});

describe("QuoteCreateForm — interactive inputs", () => {
  it("updates the customer name field when the user types", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const input = screen.getByLabelText("Cliente") as HTMLInputElement;
    await user.type(input, "Ana Pérez");
    expect(input.value).toBe("Ana Pérez");
  });

  it("updates the expiration date when the user picks a different date", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const input = screen.getByLabelText("Vencimiento") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "2026-09-30");
    expect(input.value).toBe("2026-09-30");
  });

  it("appends a model row when Agregar modelo is clicked", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const modelList = screen.getByRole("list", { name: "Modelos" });
    expect(within(modelList).getAllByRole("listitem")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Agregar modelo" }));
    expect(within(modelList).getAllByRole("listitem")).toHaveLength(2);
  });

  it("removes a model row when Quitar is clicked", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const modelList = screen.getByRole("list", { name: "Modelos" });
    await user.click(screen.getByRole("button", { name: "Agregar modelo" }));
    expect(within(modelList).getAllByRole("listitem")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Quitar modelo 2" }));
    expect(within(modelList).getAllByRole("listitem")).toHaveLength(1);
  });

  it("switches the profit mode from percentage to fixed and reveals the fixed-amount field", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    expect(screen.getByLabelText("Porcentaje")).toBeChecked();
    expect(screen.getByLabelText(/Porcentaje de ganancia/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Monto fijo de ganancia/)).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Modo fijo"));
    expect(screen.getByLabelText("Modo fijo")).toBeChecked();
    expect(screen.getByLabelText("Porcentaje")).not.toBeChecked();
    expect(screen.getByLabelText(/Monto fijo de ganancia/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Porcentaje de ganancia/)).not.toBeInTheDocument();
  });

  it("flips the visibility toggles when the user clicks them", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const internalCost = screen.getByLabelText("Mostrar costo interno");
    const profitMargin = screen.getByLabelText("Mostrar margen de ganancia");
    expect(internalCost).toBeChecked();
    expect(profitMargin).toBeChecked();
    await user.click(internalCost);
    expect(internalCost).not.toBeChecked();
    expect(profitMargin).toBeChecked();
    await user.click(profitMargin);
    expect(profitMargin).not.toBeChecked();
  });

  it("renders the model select with the provided active templates sorted by name", () => {
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const options = Array.from(screen.getByLabelText("Receta").querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(options[0]).toBe("Elegí un modelo");
    expect(options.indexOf("Cinnamon candle")).toBeLessThan(options.indexOf("Vanilla candle"));
  });
});

describe("QuoteCreateForm — Zod validation surfaced on submit", () => {
  it("shows the Spanish 'Seleccioná un modelo.' error when the template id is empty on submit", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    await user.click(screen.getByRole("button", { name: "Crear borrador" }));
    const row = screen.getByRole("listitem", { name: "Modelo 1" });
    expect(within(row).getByText("Seleccioná un modelo.")).toBeInTheDocument();
    expect(within(row).getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("shows a Spanish 'La cantidad debe ser mayor que 0.' error when the user sets quantity to zero", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const row = screen.getByRole("listitem", { name: "Modelo 1" });
    const qty = within(row).getByLabelText("Cantidad") as HTMLInputElement;
    await user.clear(qty);
    await user.type(qty, "0");
    await user.click(screen.getByRole("button", { name: "Crear borrador" }));
    expect(await within(row).findByText("La cantidad debe ser mayor que 0.")).toBeInTheDocument();
  });

  it("shows an error when the expiration date is in the past on submit", async () => {
    // Hardcoded past date avoids the date-input + userEvent + vi fake-timers
    // hang in jsdom (the default value is still today + 14 days).
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const expirationInput = screen.getByLabelText("Vencimiento") as HTMLInputElement;
    await user.clear(expirationInput);
    await user.type(expirationInput, "2020-01-01");
    await user.click(screen.getByRole("button", { name: "Crear borrador" }));
    const alert = await screen.findByText(/hoy o posterior/i);
    expect(alert).toHaveAttribute("id", "quote-expiration-error");
    expect(expirationInput).toHaveAttribute("aria-invalid", "true");
  });
});

describe("ModelLineEditor — line total calculation", () => {
  it("shows the unit cost and a formatted ARS line total when a template is selected", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const row = screen.getByRole("listitem", { name: "Modelo 1" });
    await user.selectOptions(within(row).getByLabelText("Receta"), VANILLA.id);
    const qty = within(row).getByLabelText("Cantidad") as HTMLInputElement;
    await user.clear(qty);
    await user.type(qty, "5");
    expect(within(row).getByText(/ARS 100,00/)).toBeInTheDocument();
    expect(within(row).getByText(/ARS 500,00/)).toBeInTheDocument();
  });

  it("hides the unit cost and line total when no template is selected", () => {
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const row = screen.getByRole("listitem", { name: "Modelo 1" });
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});
