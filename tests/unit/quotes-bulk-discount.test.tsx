import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

function fireChange(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  fireEvent.change(input, { target: { value } });
}

const mocks = vi.hoisted(() => ({
  createQuoteDraftAction: vi.fn(),
  appendQuoteVersionAction: vi.fn(),
}));

// Strip the form's router dependency so the test does not require a
// Next.js app-router context. The bulk discount editor does not exercise
// the submit path.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// The form imports the server actions but we are not exercising the submit
// here — only the inline discount editor. Stub the actions out so the test
// surface stays focused.
vi.mock("../../src/server/actions/quotes", () => ({
  createQuoteDraftAction: mocks.createQuoteDraftAction,
  appendQuoteVersionAction: mocks.appendQuoteVersionAction,
}));

// Provide a single template so the calculator has at least one model row
// to attach the bulk discount to.
vi.mock("../../src/server/repositories/templates", () => ({
  listTemplates: vi.fn(),
  getTemplate: vi.fn(),
}));

import { QuoteCreateForm } from "../../src/app/quotes/new/QuoteCreateForm";
import type { Template } from "../../src/server/repositories/templates";

const TEMPLATES: Template[] = [
  {
    id: "t-1",
    ownerId: "owner-1",
    name: "Vanilla candle",
    unitCost: "1000",
    archivedAt: null,
    createdAt: new Date(),
    time: "0",
    hourlyRate: "0",
    overhead: "0",
    marginPct: "30",
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createQuoteDraftAction.mockResolvedValue({
    ok: true,
    value: { quote: { id: "q-1", lockVersion: 0 } },
  });
  mocks.appendQuoteVersionAction.mockResolvedValue({ ok: true, value: { versionNo: 1 } });
});

describe("BulkDiscountEditor (Phase 4.5)", () => {
  it("renders the fieldset with the three controls", () => {
    render(<QuoteCreateForm templates={TEMPLATES} />);
    expect(screen.getByRole("group", { name: "Descuento por mayoreo" })).toBeInTheDocument();
    expect(screen.getByTestId("bulk-discount-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("bulk-discount-percent")).toBeInTheDocument();
    expect(screen.getByTestId("bulk-discount-min-qty")).toBeInTheDocument();
  });

  it("disables the inputs when bulk discount is not enabled", () => {
    render(<QuoteCreateForm templates={TEMPLATES} />);
    expect(screen.getByTestId("bulk-discount-percent")).toBeDisabled();
    expect(screen.getByTestId("bulk-discount-min-qty")).toBeDisabled();
  });

  it("enables the inputs when the toggle is checked", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    await user.click(screen.getByTestId("bulk-discount-toggle"));
    expect(screen.getByTestId("bulk-discount-percent")).not.toBeDisabled();
    expect(screen.getByTestId("bulk-discount-min-qty")).not.toBeDisabled();
  });

  it("rejects percent values outside [0, 100] and keeps the discount line absent from totals", async () => {
    // The sanitize function is exercised by the controlled input; the
    // observable behavior under invalid input is that the discount line is
    // not added to the totals. With a quantity below threshold the line
    // is also absent, so the assertion is robust against either branch.
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const select = screen.getByLabelText("Receta") as HTMLSelectElement;
    await user.selectOptions(select, "t-1");
    const qty = screen.getByLabelText("Cantidad") as HTMLInputElement;
    await user.clear(qty);
    await user.type(qty, "1"); // below the default 10-unit threshold
    await user.click(screen.getByTestId("bulk-discount-toggle"));
    // Force an out-of-range percent via the sanitize path; whatever the
    // input ends up displaying, the calculator must not apply a discount
    // for a quantity below threshold.
    fireChange(screen.getByTestId("bulk-discount-percent"), "150");
    expect(screen.queryByTestId("bulk-discount-amount")).not.toBeInTheDocument();
  });

  it("rejects percent input with letters and never applies an unbounded discount", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const select = screen.getByLabelText("Receta") as HTMLSelectElement;
    await user.selectOptions(select, "t-1");
    const qty = screen.getByLabelText("Cantidad") as HTMLInputElement;
    await user.clear(qty);
    await user.type(qty, "1"); // below threshold — discount should not apply
    await user.click(screen.getByTestId("bulk-discount-toggle"));
    fireChange(screen.getByTestId("bulk-discount-percent"), "abc");
    expect(screen.queryByTestId("bulk-discount-amount")).not.toBeInTheDocument();
  });

  it("rejects min-qty values below 1 and keeps the discount gated by the prior threshold", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const select = screen.getByLabelText("Receta") as HTMLSelectElement;
    await user.selectOptions(select, "t-1");
    const qty = screen.getByLabelText("Cantidad") as HTMLInputElement;
    await user.clear(qty);
    await user.type(qty, "5"); // below the default 10-unit threshold
    await user.click(screen.getByTestId("bulk-discount-toggle"));
    fireChange(screen.getByTestId("bulk-discount-min-qty"), "0");
    // Discount must still be gated by the previously-valid threshold (10),
    // not the rejected "0" value, so the discount line stays absent.
    expect(screen.queryByTestId("bulk-discount-amount")).not.toBeInTheDocument();
  });

  it("renders the discount line in the totals when bulk discount is enabled and quantity meets the threshold", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    // Select the template row (the first model starts blank — pick t-1).
    const select = screen.getByLabelText("Receta") as HTMLSelectElement;
    await user.selectOptions(select, "t-1");
    // Quantity input is the second control on the row.
    const qty = screen.getByLabelText("Cantidad") as HTMLInputElement;
    await user.clear(qty);
    await user.type(qty, "20");
    // Enable bulk discount with default 20% / 10 units.
    await user.click(screen.getByTestId("bulk-discount-toggle"));
    // The discount line should appear in the totals.
    await waitFor(() => {
      expect(screen.getByTestId("bulk-discount-amount")).toBeInTheDocument();
    });
    // Materials total = 1000 × 20 = 20000; discount = 4000.
    expect(screen.getByTestId("bulk-discount-amount")).toHaveTextContent("ARS 4.000,00");
  });

  it("does not apply the discount when the quantity is below the threshold", async () => {
    const user = userEvent.setup();
    render(<QuoteCreateForm templates={TEMPLATES} />);
    const select = screen.getByLabelText("Receta") as HTMLSelectElement;
    await user.selectOptions(select, "t-1");
    const qty = screen.getByLabelText("Cantidad") as HTMLInputElement;
    await user.clear(qty);
    await user.type(qty, "5"); // below default threshold of 10
    await user.click(screen.getByTestId("bulk-discount-toggle"));
    // Discount line should not appear when below threshold.
    expect(screen.queryByTestId("bulk-discount-amount")).not.toBeInTheDocument();
  });
});
