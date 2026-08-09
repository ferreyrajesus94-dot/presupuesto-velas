/** PR4h — Quote detail view + edit (draft-only) + delete-on-draft (Strict TDD). */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  requireUser: vi.fn(),
  getQuote: vi.fn(),
  deleteQuoteDraft: vi.fn(),
  appendQuoteVersionAction: vi.fn(),
  listTemplates: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  notFound: () => {
    throw new Error("__notFound");
  },
  redirect: vi.fn(),
}));

// `appendQuoteVersionAction` is mocked so the form imports don't transitively
// pull `db/client.ts` (which requires DATABASE_URL). `deleteQuoteDraftAction`
// is the unit under test for the last describe block — its underlying
// dependencies (`requireOwner`, `deleteQuoteDraft`, `revalidatePath`) are
// mocked below so the action runs end-to-end without hitting the DB.
vi.mock("@/server/actions/quotes", () => ({
  appendQuoteVersionAction: mocks.appendQuoteVersionAction,
}));
vi.mock("@/server/auth/requireUser", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/server/repositories/quotes", () => ({
  getQuote: mocks.getQuote,
  deleteQuoteDraft: mocks.deleteQuoteDraft,
}));
vi.mock("@/server/repositories/templates", () => ({
  listTemplates: mocks.listTemplates,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import QuoteDetailPage from "@/app/quotes/[id]/page";
import { QuoteDetailView } from "@/app/quotes/[id]/QuoteDetailView";
import QuoteEditPage from "@/app/quotes/[id]/edit/page";
import QuoteEditForm from "@/app/quotes/[id]/edit/QuoteEditForm";
import { deleteQuoteDraftAction } from "@/server/actions/quotes-delete";
import type { QuoteRecord } from "@/server/repositories/quotes";
import type { Template } from "@/server/repositories/templates";

const OWNER = { id: "user-1", email: "user@example.com" };
const QUOTE_ID = "quote-1";
const RECIPE_ID = "11111111-1111-4111-8111-111111111111";

const NOW = new Date("2026-04-01T12:00:00.000Z");

const VANILLA: Template = {
  id: RECIPE_ID,
  userId: OWNER.id,
  name: "Vanilla candle",
  unitCost: "100",
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  time: "0",
  hourlyRate: "0",
  overhead: "0",
  marginPct: "30",
};

/**
 * Build a `QuoteRecord` aggregate as `getQuote` would return it. The detail
 * view reads the current snapshot from `currentVersion`; tests below
 * exercise the `draft`, `sent`, `accepted`, `rejected`, and `expired`
 * statuses with the same shape.
 */
function buildQuoteRecord(
  status: "draft" | "sent" | "accepted" | "rejected",
  expirationDate: string,
  customerName: string | null = "Ana Pérez",
): QuoteRecord {
  const currentVersion = 1;
  const computedAt = new Date("2026-03-15T10:00:00Z");
  return {
    quote: {
      id: QUOTE_ID,
      userId: OWNER.id,
      customerName,
      expirationDate,
      status,
      currentVersion,
      lockVersion: 1,
      duplicatedFromQuoteId: null,
      duplicatedFromVersion: null,
      createdAt: computedAt,
      updatedAt: computedAt,
    },
    versions: [
      {
        quoteId: QUOTE_ID,
        versionNo: currentVersion,
        visibilityInternal: true,
        visibilityProfit: true,
        profitMethod: "percentage",
        profitValue: "195.00",
        depositPercent: "50.00",
        materialsTotal: "500.00",
        indirectTotal: "150.00",
        profitAmount: "195.00",
        finalPrice: "845.00",
        depositAmount: "422.50",
        createdAt: computedAt,
      },
    ],
    models: [
      {
        quoteId: QUOTE_ID,
        versionNo: currentVersion,
        position: 1,
        templateId: RECIPE_ID,
        templateName: "Vanilla candle",
        quantity: "5",
        unitCost: "100",
        lineTotal: "500.00",
      },
    ],
    materials: [],
    indirectCosts: [
      {
        quoteId: QUOTE_ID,
        versionNo: currentVersion,
        position: 1,
        name: "labor",
        amount: "100.00",
      },
      {
        quoteId: QUOTE_ID,
        versionNo: currentVersion,
        position: 2,
        name: "electricity",
        amount: "50.00",
      },
    ],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue(OWNER);
  mocks.getQuote.mockResolvedValue(null);
  mocks.appendQuoteVersionAction.mockResolvedValue({
    ok: true,
    value: {
      quote: { id: QUOTE_ID, userId: OWNER.id, status: "draft", lockVersion: 2 },
      version: { quoteId: QUOTE_ID, versionNo: 2 },
    },
  });
  mocks.deleteQuoteDraft.mockResolvedValue({ ok: true });
  mocks.listTemplates.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

// =====================================================================
// QuoteDetailView
// =====================================================================

describe("QuoteDetailView — render", () => {
  it("renders customer name, expiration date, status badge, and 4 sections", () => {
    const record = buildQuoteRecord("draft", "2026-05-01");
    render(<QuoteDetailView quote={record} now={NOW} />);
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText(/01\/05\/2026/)).toBeInTheDocument();
    expect(screen.getByTestId("quote-status")).toHaveTextContent("Borrador");
  });

  it("uses 'Sin cliente' when the customer name is null", () => {
    const record = buildQuoteRecord("draft", "2026-05-01", null);
    render(<QuoteDetailView quote={record} now={NOW} />);
    expect(screen.getByText("Sin cliente")).toBeInTheDocument();
  });

  it("renders the model list with each model's recipe name and line total", () => {
    const record = buildQuoteRecord("draft", "2026-05-01");
    render(<QuoteDetailView quote={record} now={NOW} />);
    const modelsList = screen.getByRole("list", { name: "Modelos" });
    expect(within(modelsList).getByText("Vanilla candle")).toBeInTheDocument();
    expect(within(modelsList).getByText(/ARS 500,00/)).toBeInTheDocument();
  });
});

describe("QuoteDetailView — visibility (local toggles)", () => {
  it("renders the indirect cost list when visibility.internalCost is true", () => {
    const record = buildQuoteRecord("draft", "2026-05-01");
    render(<QuoteDetailView quote={record} now={NOW} />);
    const indirects = screen.getByRole("list", { name: "Costos indirectos" });
    expect(within(indirects).getByText("labor")).toBeInTheDocument();
    expect(within(indirects).getByText("electricity")).toBeInTheDocument();
  });

  it("hides the indirect cost list when the visibility toggle is off", async () => {
    const user = userEvent.setup();
    const record = buildQuoteRecord("draft", "2026-05-01");
    render(<QuoteDetailView quote={record} now={NOW} />);
    await user.click(screen.getByLabelText("Mostrar costo interno"));
    expect(screen.queryByRole("list", { name: "Costos indirectos" })).not.toBeInTheDocument();
  });

  it("renders the profit margin when visibility.profitMargin is true", () => {
    const record = buildQuoteRecord("draft", "2026-05-01");
    render(<QuoteDetailView quote={record} now={NOW} />);
    expect(screen.getByText(/Ganancia:/)).toBeInTheDocument();
    expect(screen.getByText(/ARS 195,00/)).toBeInTheDocument();
  });

  it("hides the profit margin when the visibility toggle is off", async () => {
    const user = userEvent.setup();
    const record = buildQuoteRecord("draft", "2026-05-01");
    render(<QuoteDetailView quote={record} now={NOW} />);
    await user.click(screen.getByLabelText("Mostrar margen de ganancia"));
    expect(screen.queryByText(/Ganancia:/)).not.toBeInTheDocument();
  });
});

describe("QuoteDetailView — draft-only actions", () => {
  it("renders Editar and Eliminar buttons when status is draft", () => {
    const record = buildQuoteRecord("draft", "2026-05-01");
    render(<QuoteDetailView quote={record} now={NOW} />);
    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute(
      "href",
      `/quotes/${QUOTE_ID}/edit`,
    );
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
  });

  it("hides Editar and Eliminar and shows 'Solo lectura' when status is sent", () => {
    const record = buildQuoteRecord("sent", "2026-05-01");
    render(<QuoteDetailView quote={record} now={NOW} />);
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
    expect(screen.getByText(/Solo lectura/)).toBeInTheDocument();
  });

  it.each(["accepted", "rejected"] as const)(
    "hides Editar and Eliminar when status is %s",
    (status) => {
      const record = buildQuoteRecord(status, "2026-05-01");
      render(<QuoteDetailView quote={record} now={NOW} />);
      expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
      expect(screen.getByText(/Solo lectura/)).toBeInTheDocument();
    },
  );

  it("shows the 'expired' status for a past-expiration sent quote", () => {
    const record = buildQuoteRecord("sent", "2026-03-10");
    render(<QuoteDetailView quote={record} now={NOW} />);
    expect(screen.getByTestId("quote-status")).toHaveTextContent("Vencida");
  });
});

// =====================================================================
// QuoteDetailPage (Server Component)
// =====================================================================

describe("/quotes/[id] page loader", () => {
  it("requires the owner, fetches the quote, and renders the detail view", async () => {
    const record = buildQuoteRecord("draft", "2026-05-01");
    mocks.getQuote.mockResolvedValue(record);
    const element = await QuoteDetailPage({ params: Promise.resolve({ id: QUOTE_ID }) });
    render(element);
    expect(mocks.requireUser).toHaveBeenCalledTimes(1);
    expect(mocks.getQuote).toHaveBeenCalledWith(OWNER.id, QUOTE_ID);
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
  });

  it("calls notFound when the quote is missing", async () => {
    mocks.getQuote.mockResolvedValue(null);
    await expect(QuoteDetailPage({ params: Promise.resolve({ id: "missing" }) })).rejects.toThrow(
      "__notFound",
    );
    expect(mocks.requireUser).toHaveBeenCalledTimes(1);
  });
});

// =====================================================================
// QuoteEditForm
// =====================================================================

describe("QuoteEditForm — pre-fill", () => {
  it("pre-fills customer name, expiration date, percent, and deposit", () => {
    const record = buildQuoteRecord("draft", "2026-05-01");
    render(<QuoteEditForm quote={record} templates={[VANILLA]} />);
    expect((screen.getByLabelText("Cliente") as HTMLInputElement).value).toBe("Ana Pérez");
    expect((screen.getByLabelText("Vencimiento") as HTMLInputElement).value).toBe("2026-05-01");
  });

  it("pre-fills the first model with the existing recipe and quantity", () => {
    const record = buildQuoteRecord("draft", "2026-05-01");
    render(<QuoteEditForm quote={record} templates={[VANILLA]} />);
    const row = screen.getByRole("listitem", { name: "Modelo 1" });
    expect(within(row).getByLabelText("Receta")).toHaveValue(RECIPE_ID);
    const qty = within(row).getByLabelText("Cantidad") as HTMLInputElement;
    expect(qty.value).toBe("5");
  });

  it("does not re-seed the default indirects when the existing list is non-empty", () => {
    const record = buildQuoteRecord("draft", "2026-05-01");
    render(<QuoteEditForm quote={record} templates={[VANILLA]} />);
    const indirects = screen.getByRole("list", { name: "Costos indirectos" });
    expect(within(indirects).getAllByRole("listitem")).toHaveLength(2);
  });

  // U7b — width safeguards on the model row <li>, recipe <select>, and
  // indirect name <input> so long recipe names + currency labels wrap safely
  // at 375px without overflowing the form column.
  it("carries `min-w-0` on the model row, recipe select, and indirect name input for 375px safety", () => {
    const record = buildQuoteRecord("draft", "2026-05-01");
    render(<QuoteEditForm quote={record} templates={[VANILLA]} />);
    const row = screen.getByRole("listitem", { name: "Modelo 1" });
    expect(row.className.split(/\s+/)).toContain("min-w-0");
    const select = within(row).getByLabelText("Receta");
    expect(select.className.split(/\s+/)).toContain("min-w-0");
    const firstName = screen.getAllByLabelText("Concepto")[0];
    expect(firstName.className.split(/\s+/)).toContain("min-w-0");
  });

  // U7b — width safeguard on the indirect row <li> for 375px safety. The
  // pre-existing `min-w-0` test above asserts the name `<input>`; this one
  // asserts the row `<li>` itself so the row container can shrink instead of
  // pushing currency labels out of the form column at 375px.
  it("carries `min-w-0` on the indirect cost row <li> for 375px safety", () => {
    const record = buildQuoteRecord("draft", "2026-05-01");
    render(<QuoteEditForm quote={record} templates={[VANILLA]} />);
    const indirectRow = screen.getByTestId("quote-indirect-1");
    expect(indirectRow.className.split(/\s+/)).toContain("min-w-0");
  });
});

describe("QuoteEditForm — submit", () => {
  it("calls appendQuoteVersionAction with perUnitCostDecimal and pushes to /quotes/{id}", async () => {
    const record = buildQuoteRecord("draft", "2026-05-01");
    const user = userEvent.setup();
    render(<QuoteEditForm quote={record} templates={[VANILLA]} />);
    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));
    expect(mocks.appendQuoteVersionAction).toHaveBeenCalledTimes(1);
    const args = mocks.appendQuoteVersionAction.mock.calls[0] as [
      string,
      { models: Array<{ recipeId: string; quantity: string; perUnitCostDecimal: string }> },
      number,
    ];
    expect(args[0]).toBe(QUOTE_ID);
    expect(args[1].models[0]).toEqual({
      recipeId: RECIPE_ID,
      quantity: "5",
      perUnitCostDecimal: "100",
    });
    expect(mocks.push).toHaveBeenCalledWith(`/quotes/${QUOTE_ID}`);
  });

  it("shows the Spanish fallback 'No se pudo actualizar la presupuesto.' when appendQuoteVersionAction fails", async () => {
    mocks.appendQuoteVersionAction.mockResolvedValueOnce({
      ok: false,
      error: { code: "LOCK_VERSION_MISMATCH", message: "stale lock" },
    });
    const record = buildQuoteRecord("draft", "2026-05-01");
    const user = userEvent.setup();
    render(<QuoteEditForm quote={record} templates={[VANILLA]} />);
    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));
    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveTextContent("No se pudo actualizar la presupuesto.");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("'Eliminar borrador' calls deleteQuoteDraftAction and pushes to /quotes", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const record = buildQuoteRecord("draft", "2026-05-01");
    const user = userEvent.setup();
    render(<QuoteEditForm quote={record} templates={[VANILLA]} />);
    await user.click(screen.getByRole("button", { name: /Eliminar borrador/ }));
    await vi.waitFor(() => expect(mocks.deleteQuoteDraft).toHaveBeenCalledTimes(1));
    expect(mocks.deleteQuoteDraft).toHaveBeenCalledWith(OWNER.id, QUOTE_ID);
    expect(mocks.push).toHaveBeenCalledWith("/quotes");
    confirmSpy.mockRestore();
  });

  it("shows the Spanish fallback 'No se pudo eliminar el borrador.' when deleteQuoteDraftAction fails", async () => {
    mocks.deleteQuoteDraft.mockResolvedValueOnce({
      ok: false,
      error: { code: "NOT_FOUND", message: "missing" },
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const record = buildQuoteRecord("draft", "2026-05-01");
    const user = userEvent.setup();
    render(<QuoteEditForm quote={record} templates={[VANILLA]} />);
    await user.click(screen.getByRole("button", { name: /Eliminar borrador/ }));
    const liveRegion = screen.getByRole("status");
    await waitFor(() => expect(liveRegion).toHaveTextContent("No se pudo eliminar el borrador."));
    expect(mocks.push).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

// =====================================================================
// QuoteEditForm — U7b Spanish field-error mapping at presentation boundary
// =====================================================================

describe("QuoteEditForm — U7b Spanish field-error mapping", () => {
  it("shows 'Seleccioná un modelo.' when the recipe id is cleared on submit (empty recipeId in the model row)", async () => {
    // The pre-filled record carries `RECIPE_ID`; clearing the `<select>` +
    // submitting forces Zod to reject and the presentation boundary maps the
    // raw Zod message to the direct Spanish fallback.
    const record = buildQuoteRecord("draft", "2026-05-01");
    const user = userEvent.setup();
    render(<QuoteEditForm quote={record} templates={[VANILLA]} />);
    const row = screen.getByRole("listitem", { name: "Modelo 1" });
    await user.selectOptions(within(row).getByLabelText("Receta"), "");
    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));
    expect(await within(row).findByText("Seleccioná un modelo.")).toBeInTheDocument();
    // The raw Zod English payload never reaches the user.
    expect(within(row).queryByText(/Invalid uuid/i)).not.toBeInTheDocument();
    expect(mocks.appendQuoteVersionAction).not.toHaveBeenCalled();
  });

  it("shows 'Ingresá un nombre para el costo.' when an indirect cost name is cleared on submit", async () => {
    const record = buildQuoteRecord("draft", "2026-05-01");
    const user = userEvent.setup();
    render(<QuoteEditForm quote={record} templates={[VANILLA]} />);
    const firstName = screen.getAllByLabelText("Concepto")[0] as HTMLInputElement;
    await user.clear(firstName);
    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));
    expect(await screen.findByText("Ingresá un nombre para el costo.")).toBeInTheDocument();
    expect(mocks.appendQuoteVersionAction).not.toHaveBeenCalled();
  });

  it("shows 'Ingresá un monto válido.' when an indirect cost amount is cleared on submit", async () => {
    const record = buildQuoteRecord("draft", "2026-05-01");
    const user = userEvent.setup();
    render(<QuoteEditForm quote={record} templates={[VANILLA]} />);
    const firstAmount = screen.getAllByLabelText("Monto (ARS)")[0] as HTMLInputElement;
    await user.clear(firstAmount);
    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));
    expect(await screen.findByText("Ingresá un monto válido.")).toBeInTheDocument();
    expect(mocks.appendQuoteVersionAction).not.toHaveBeenCalled();
  });
});

// =====================================================================
// /quotes/[id]/edit page loader
// =====================================================================

describe("/quotes/[id]/edit page loader", () => {
  it("renders the form for a draft quote", async () => {
    const record = buildQuoteRecord("draft", "2026-05-01");
    mocks.getQuote.mockResolvedValue(record);
    const element = await QuoteEditPage({
      params: Promise.resolve({ id: QUOTE_ID }),
    });
    render(element);
    expect(screen.getByLabelText("Cliente")).toBeInTheDocument();
    expect((screen.getByLabelText("Cliente") as HTMLInputElement).value).toBe("Ana Pérez");
  });

  it("shows 'Solo borradores editables' for a sent quote and links back to /quotes/{id}", async () => {
    const record = buildQuoteRecord("sent", "2026-05-01");
    mocks.getQuote.mockResolvedValue(record);
    const element = await QuoteEditPage({
      params: Promise.resolve({ id: QUOTE_ID }),
    });
    render(element);
    expect(screen.getByText(/Solo borradores editables/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Volver/ })).toHaveAttribute(
      "href",
      `/quotes/${QUOTE_ID}`,
    );
  });

  // U7b — page-localized status labels. The page loader still computes
  // `status === "draft"`; the localized label belongs to the presentation
  // boundary only. The test fixture uses a clearly future `expirationDate`
  // (`2030-12-31`) so the `sent` row stays non-expired and the cached label
  // remains `Enviada`. The `accepted` / `rejected` rows pass the same date
  // for symmetry, but `isExpiredSent` returns `false` for those statuses.
  it.each([
    ["sent", "Enviada"],
    ["accepted", "Aceptada"],
    ["rejected", "Rechazada"],
  ] as const)(
    "renders the Spanish '%s' status label inside 'Solo borradores editables' for a %s quote",
    async (status, expectedLabel) => {
      const record = buildQuoteRecord(status, "2030-12-31");
      mocks.getQuote.mockResolvedValue(record);
      const element = await QuoteEditPage({
        params: Promise.resolve({ id: QUOTE_ID }),
      });
      render(element);
      expect(screen.getByText(new RegExp(expectedLabel))).toBeInTheDocument();
      // The raw English enum token never reaches the user.
      expect(screen.queryByText(new RegExp(`\\b${status}\\b`))).not.toBeInTheDocument();
    },
  );

  // U7b — presentation-only derived `Vencida` for a `sent` quote past its
  // expiration date. The page loader keeps the persisted `status === "sent"`
  // shape; the `isExpiredSent` derivation runs at the presentation boundary
  // only and the visible label is mapped via the existing `STATUS_LABEL`
  // table. Schema/actions/payloads are unchanged.
  it("renders the Spanish 'Vencida' status label inside 'Solo borradores editables' for a sent quote past expiration", async () => {
    // Use a "very old" expiration date so the calendar date is strictly past
    // the test run time, regardless of when this test executes.
    const record = buildQuoteRecord("sent", "2010-01-01");
    mocks.getQuote.mockResolvedValue(record);
    const element = await QuoteEditPage({
      params: Promise.resolve({ id: QUOTE_ID }),
    });
    render(element);
    expect(screen.getByText(new RegExp("Vencida"))).toBeInTheDocument();
    // The raw English enum tokens (`sent`, `expired`) never reach the user.
    expect(screen.queryByText(/\bsent\b/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bexpired\b/)).not.toBeInTheDocument();
  });
});

// =====================================================================
// deleteQuoteDraftAction (Server Action)
// =====================================================================

describe("deleteQuoteDraftAction", () => {
  it("returns { ok: true } and revalidates /quotes when the repository succeeds", async () => {
    mocks.deleteQuoteDraft.mockResolvedValue({ ok: true });
    const result = await deleteQuoteDraftAction(QUOTE_ID);
    expect(result).toEqual({ ok: true });
    expect(mocks.requireUser).toHaveBeenCalledTimes(1);
    expect(mocks.deleteQuoteDraft).toHaveBeenCalledWith(OWNER.id, QUOTE_ID);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/quotes");
  });

  it("returns { ok: false, error } when the repository rejects", async () => {
    mocks.deleteQuoteDraft.mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "missing" },
    });
    const result = await deleteQuoteDraftAction(QUOTE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
      expect(result.error.message).toBe("missing");
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
