/** PR4i — Lifecycle controls for the quote detail view (Strict TDD). */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transitionQuoteStatusAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/server/actions/quotes", () => ({
  transitionQuoteStatusAction: mocks.transitionQuoteStatusAction,
}));

import { QuoteLifecycleControls } from "@/app/quotes/[id]/QuoteLifecycleControls";
import type { QuoteRecord } from "@/server/repositories/quotes";

const OWNER = { id: "owner-1", email: "owner@example.com" };
const QUOTE_ID = "quote-1";
const NOW = new Date("2026-04-01T12:00:00.000Z");

function buildQuoteRecord(
  status: "draft" | "sent" | "accepted" | "rejected",
  expirationDate: string,
  lockVersion = 1,
): QuoteRecord {
  const computedAt = new Date("2026-03-15T10:00:00Z");
  return {
    quote: {
      id: QUOTE_ID,
      ownerId: OWNER.id,
      customerName: "Ana Pérez",
      expirationDate,
      status,
      currentVersion: 1,
      lockVersion,
      duplicatedFromQuoteId: null,
      duplicatedFromVersion: null,
      createdAt: computedAt,
      updatedAt: computedAt,
    },
    versions: [
      {
        quoteId: QUOTE_ID,
        versionNo: 1,
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
    models: [],
    materials: [],
    indirectCosts: [],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transitionQuoteStatusAction.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
});

// =====================================================================
// Render — buttons per status
// =====================================================================

describe("QuoteLifecycleControls — render", () => {
  it("renders 'Marcar como enviado' button when status is draft", () => {
    const quote = buildQuoteRecord("draft", "2026-05-01");
    render(<QuoteLifecycleControls quote={quote} now={NOW} />);
    expect(screen.getByRole("button", { name: "Marcar como enviado" })).toBeInTheDocument();
  });

  it("renders 'Marcar como aceptado' and 'Marcar como rechazado' buttons when status is sent", () => {
    const quote = buildQuoteRecord("sent", "2026-05-01");
    render(<QuoteLifecycleControls quote={quote} now={NOW} />);
    expect(screen.getByRole("button", { name: "Marcar como aceptado" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como rechazado" })).toBeInTheDocument();
  });

  it("renders the 'Inmutable' message when status is accepted (no buttons)", () => {
    const quote = buildQuoteRecord("accepted", "2026-05-01");
    render(<QuoteLifecycleControls quote={quote} now={NOW} />);
    expect(screen.getByText(/Inmutable/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como aceptado" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como rechazado" })).not.toBeInTheDocument();
  });

  it("renders the 'Inmutable' message when status is rejected (no buttons)", () => {
    const quote = buildQuoteRecord("rejected", "2026-05-01");
    render(<QuoteLifecycleControls quote={quote} now={NOW} />);
    expect(screen.getByText(/Inmutable/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como aceptado" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como rechazado" })).not.toBeInTheDocument();
  });

  it("renders the 'Vencida' message and disabled accept/reject buttons when status is sent past expiration", () => {
    const quote = buildQuoteRecord("sent", "2026-03-10");
    render(<QuoteLifecycleControls quote={quote} now={NOW} />);
    expect(screen.getByText(/Vencida/)).toBeInTheDocument();
    const acceptBtn = screen.getByRole("button", { name: "Marcar como aceptado" });
    const rejectBtn = screen.getByRole("button", { name: "Marcar como rechazado" });
    expect(acceptBtn).toBeDisabled();
    expect(rejectBtn).toBeDisabled();
  });

  it("renders an alert warning when status is sent past expiration", () => {
    const quote = buildQuoteRecord("sent", "2026-03-10");
    render(<QuoteLifecycleControls quote={quote} now={NOW} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Duplicar para aceptar/);
  });
});

// =====================================================================
// Action — calls transitionQuoteStatusAction
// =====================================================================

describe("QuoteLifecycleControls — action", () => {
  it("clicking 'Marcar como enviado' calls transitionQuoteStatusAction(draft -> sent) with the current lockVersion", async () => {
    const quote = buildQuoteRecord("draft", "2026-05-01", 7);
    const user = userEvent.setup();
    render(<QuoteLifecycleControls quote={quote} now={NOW} />);
    await user.click(screen.getByRole("button", { name: "Marcar como enviado" }));
    expect(mocks.transitionQuoteStatusAction).toHaveBeenCalledTimes(1);
    expect(mocks.transitionQuoteStatusAction).toHaveBeenCalledWith(QUOTE_ID, "draft", "sent", 7);
  });

  it("clicking 'Marcar como aceptado' calls transitionQuoteStatusAction(sent -> accepted)", async () => {
    const quote = buildQuoteRecord("sent", "2026-05-01", 3);
    const user = userEvent.setup();
    render(<QuoteLifecycleControls quote={quote} now={NOW} />);
    await user.click(screen.getByRole("button", { name: "Marcar como aceptado" }));
    expect(mocks.transitionQuoteStatusAction).toHaveBeenCalledWith(QUOTE_ID, "sent", "accepted", 3);
  });

  it("clicking 'Marcar como rechazado' calls transitionQuoteStatusAction(sent -> rejected)", async () => {
    const quote = buildQuoteRecord("sent", "2026-05-01", 3);
    const user = userEvent.setup();
    render(<QuoteLifecycleControls quote={quote} now={NOW} />);
    await user.click(screen.getByRole("button", { name: "Marcar como rechazado" }));
    expect(mocks.transitionQuoteStatusAction).toHaveBeenCalledWith(QUOTE_ID, "sent", "rejected", 3);
  });

  it("shows 'Cotización enviada' in the live region on success", async () => {
    const quote = buildQuoteRecord("draft", "2026-05-01");
    const user = userEvent.setup();
    render(<QuoteLifecycleControls quote={quote} now={NOW} />);
    await user.click(screen.getByRole("button", { name: "Marcar como enviado" }));
    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveTextContent(/Cotización enviada/);
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
  });

  it("shows 'Cotización aceptada' in the live region after a successful accept", async () => {
    const quote = buildQuoteRecord("sent", "2026-05-01");
    const user = userEvent.setup();
    render(<QuoteLifecycleControls quote={quote} now={NOW} />);
    await user.click(screen.getByRole("button", { name: "Marcar como aceptado" }));
    expect(screen.getByRole("status")).toHaveTextContent(/Cotización aceptada/);
  });

  it("shows 'Cotización rechazada' in the live region after a successful reject", async () => {
    const quote = buildQuoteRecord("sent", "2026-05-01");
    const user = userEvent.setup();
    render(<QuoteLifecycleControls quote={quote} now={NOW} />);
    await user.click(screen.getByRole("button", { name: "Marcar como rechazado" }));
    expect(screen.getByRole("status")).toHaveTextContent(/Cotización rechazada/);
  });

  it("calls router.refresh() after a successful transition", async () => {
    const quote = buildQuoteRecord("draft", "2026-05-01");
    const user = userEvent.setup();
    render(<QuoteLifecycleControls quote={quote} now={NOW} />);
    await user.click(screen.getByRole("button", { name: "Marcar como enviado" }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the error message in the live region on failure", async () => {
    mocks.transitionQuoteStatusAction.mockResolvedValueOnce({
      ok: false,
      error: { code: "TERMINAL_STATUS", message: "quote is terminal" },
    });
    const quote = buildQuoteRecord("draft", "2026-05-01");
    const user = userEvent.setup();
    render(<QuoteLifecycleControls quote={quote} now={NOW} />);
    await user.click(screen.getByRole("button", { name: "Marcar como enviado" }));
    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveTextContent(/quote is terminal/);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("returns focus to the action button after a successful transition", async () => {
    const quote = buildQuoteRecord("draft", "2026-05-01");
    const user = userEvent.setup();
    render(<QuoteLifecycleControls quote={quote} now={NOW} />);
    const btn = screen.getByRole("button", { name: "Marcar como enviado" });
    btn.focus();
    await user.click(btn);
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Marcar como enviado" })).toHaveFocus(),
    );
  });

  it("returns focus to the action button after a failed transition", async () => {
    mocks.transitionQuoteStatusAction.mockResolvedValueOnce({
      ok: false,
      error: { code: "LOCK_VERSION_MISMATCH", message: "stale lock" },
    });
    const quote = buildQuoteRecord("sent", "2026-05-01");
    const user = userEvent.setup();
    render(<QuoteLifecycleControls quote={quote} now={NOW} />);
    const btn = screen.getByRole("button", { name: "Marcar como aceptado" });
    btn.focus();
    await user.click(btn);
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Marcar como aceptado" })).toHaveFocus(),
    );
  });
});
