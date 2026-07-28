import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  requireOwner: vi.fn(),
  listQuotes: vi.fn(),
  getQuote: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/quotes",
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams("sort=recent"),
}));
vi.mock("../../src/server/auth/requireOwner", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("../../src/server/repositories/quotes", () => ({
  listQuotes: mocks.listQuotes,
  getQuote: mocks.getQuote,
}));

import QuotesPage from "../../src/app/quotes/page";
import { QuotesList, type QuoteListItem } from "../../src/app/quotes/QuotesList";
import { QuoteViewFilter } from "../../src/app/quotes/QuoteViewFilter";

const NOW = new Date("2026-04-01T12:00:00.000Z");
const base: QuoteListItem = {
  id: "quote-1",
  customerName: "Ana Pérez",
  expirationDate: "2026-04-10",
  total: "1234567.5",
  status: "sent",
};

function renderList(quotes: QuoteListItem[], view: "active" | "archived" = "active") {
  return render(<QuotesList quotes={quotes} view={view} now={NOW} />);
}

function record(status: "draft" | "sent" | "accepted" | "rejected") {
  const quote = { ...base, ownerId: "owner-1", status, currentVersion: 1 };
  return {
    quote,
    versions: [{ versionNo: 1, finalPrice: base.total, createdAt: NOW }],
    models: [],
    materials: [],
    indirectCosts: [],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireOwner.mockResolvedValue({ id: "owner-1", email: "owner@example.com" });
  mocks.listQuotes.mockResolvedValue([]);
  mocks.getQuote.mockResolvedValue(null);
});

describe("quotes list", () => {
  it("renders an actionable empty state", () => {
    renderList([]);
    expect(screen.getByText("Todavía no hay cotizaciones")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crear la primera cotización" })).toHaveAttribute(
      "href",
      "/quotes/new",
    );
  });

  it.each([
    ["active", "1 cotización activa"],
    ["archived", "1 cotización archivada"],
  ] as const)("renders the %s view count and quote columns", (view, count) => {
    renderList([base], view);
    const row = screen.getByRole("row", { name: /Ana Pérez/ });
    expect(screen.getByText(count)).toBeInTheDocument();
    expect(within(row).getByText("10/04/2026")).toBeInTheDocument();
    expect(within(row).getByText("ARS 1.234.567,50")).toBeInTheDocument();
  });

  it("uses the customer fallback", () => {
    renderList([{ ...base, customerName: null }]);
    expect(screen.getByText("Sin cliente")).toBeInTheDocument();
  });

  it.each([
    ["sent", "2026-03-31", "expired"],
    ["sent", "2026-04-10", "sent"],
    ["accepted", "2026-03-31", "accepted"],
    ["rejected", "2026-03-31", "rejected"],
    ["draft", "2026-03-31", "draft"],
  ] as const)("shows %s with %s expiration as %s", (status, expirationDate, expected) => {
    renderList([{ ...base, status, expirationDate }]);
    expect(screen.getByTestId("quote-status")).toHaveTextContent(expected);
  });
});

describe("quote view filter", () => {
  it("preserves other params when switching to archived quotes", async () => {
    render(<QuoteViewFilter current="active" />);
    await userEvent.click(screen.getByRole("button", { name: "Archivadas" }));
    expect(mocks.push).toHaveBeenCalledWith("/quotes?sort=recent&view=archived");
  });
});

describe("/quotes page", () => {
  it.each([
    [undefined, "sent", { includeArchived: false }],
    ["archived", "accepted", { includeArchived: true }],
  ] as const)(
    "loads the %s view through the owner-scoped repository",
    async (view, status, visibility) => {
      const detail = record(status);
      mocks.listQuotes.mockResolvedValue([detail]);
      mocks.getQuote.mockResolvedValue(detail);
      const searchParams = Promise.resolve(view ? { view } : {});

      render(await QuotesPage({ searchParams }));

      expect(mocks.requireOwner).toHaveBeenCalledTimes(1);
      expect(mocks.listQuotes).toHaveBeenCalledWith("owner-1", visibility);
      expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    },
  );
});
