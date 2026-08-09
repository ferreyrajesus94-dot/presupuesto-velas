import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  requireUser: vi.fn(),
  listQuotes: vi.fn(),
  getQuote: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/quotes",
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams("sort=recent"),
}));
vi.mock("../../src/server/auth/requireUser", () => ({ requireUser: mocks.requireUser }));
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
  createdAt: NOW,
  status: "sent",
};

const STATUS_LABELS: Record<"draft" | "sent" | "accepted" | "rejected" | "expired", string> = {
  draft: "Borrador",
  sent: "Enviada",
  accepted: "Aceptada",
  rejected: "Rechazada",
  expired: "Vencida",
};

function renderList(quotes: QuoteListItem[], view: "active" | "archived" = "active") {
  return render(<QuotesList quotes={quotes} view={view} now={NOW} />);
}

function record(status: "draft" | "sent" | "accepted" | "rejected") {
  const quote = { ...base, ownerId: "user-1", status, currentVersion: 1 };
  return {
    quote,
    versions: [{ versionNo: 1, finalPrice: base.total, createdAt: NOW }],
    models: [],
    materials: [],
    indirectCosts: [],
  };
}

function readSource(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), "utf8");
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "user-1", email: "user@example.com" });
  mocks.listQuotes.mockResolvedValue([]);
  mocks.getQuote.mockResolvedValue(null);
});

describe("quotes list", () => {
  it("renders an actionable empty state", () => {
    renderList([]);
    expect(screen.getByRole("heading", { name: /Aún no tenés presupuestos/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Crear presupuesto/i })).toHaveAttribute(
      "href",
      "/quotes/new",
    );
  });

  it.each([
    ["active", "1 presupuesto activo"],
    ["archived", "1 presupuesto archivado"],
  ] as const)("renders the %s view count and quote card content", (view, count) => {
    renderList([base], view);
    expect(screen.getByText(count)).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Presupuestos" });
    const cards = within(list).getAllByTestId("quote-card");
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getByText("Ana Pérez")).toBeInTheDocument();
    expect(within(cards[0]).getByText("10/04/2026")).toBeInTheDocument();
    expect(within(cards[0]).getByText("ARS 1,2M")).toBeInTheDocument();
    expect(within(cards[0]).getByRole("link", { name: /Ver presupuesto/i })).toHaveAttribute(
      "href",
      "/quotes/quote-1",
    );
  });

  it("uses the customer fallback inside the quote card", () => {
    renderList([{ ...base, customerName: null }]);
    const card = screen.getByTestId("quote-card");
    expect(within(card).getByText("Sin cliente")).toBeInTheDocument();
  });

  it.each([
    ["sent", "2026-03-31", "Vencida"],
    ["sent", "2026-04-10", "Enviada"],
    ["accepted", "2026-03-31", "Aceptada"],
    ["rejected", "2026-03-31", "Rechazada"],
    ["draft", "2026-03-31", "Borrador"],
  ] as const)(
    "shows %s with %s expiration as %s (Spanish status label)",
    (status, expirationDate, expected) => {
      renderList([{ ...base, status, expirationDate }]);
      expect(screen.getByTestId("quote-status")).toHaveTextContent(expected);
    },
  );

  it("does not leak raw English status values to the visible badge text", () => {
    renderList([{ ...base, status: "sent" }]);
    const badge = screen.getByTestId("quote-status");
    expect(badge).toHaveTextContent(STATUS_LABELS.sent);
    expect(badge.textContent).not.toMatch(/^sent\b/);
  });

  it("preserves the quote order across cards", () => {
    const second: QuoteListItem = {
      ...base,
      id: "quote-2",
      customerName: "Bruno Díaz",
      expirationDate: "2026-04-12",
      total: "200",
    };
    renderList([base, second]);
    const list = screen.getByRole("list", { name: "Presupuestos" });
    const cards = within(list).getAllByTestId("quote-card");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText("Ana Pérez")).toBeInTheDocument();
    expect(within(cards[1]).getByText("Bruno Díaz")).toBeInTheDocument();
  });

  it("renders each card heading as h2 so the document outline does not skip levels", () => {
    renderList([base]);
    const card = screen.getByTestId("quote-card");
    const heading = within(card).getByRole("heading", { level: 2, name: "Ana Pérez" });
    expect(heading).toBeInTheDocument();
    expect(within(card).queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  });

  it("applies width-safe utilities to long customer names so 375px cards never overflow", () => {
    const longName =
      "María Fernanda González-López de la Torre y Asociados Sociedad Anónima Comercial Industrial Financiera e Inmobiliaria";
    renderList([{ ...base, customerName: longName, total: "9999999999999.99" }]);
    const card = screen.getByTestId("quote-card");
    const heading = within(card).getByRole("heading", { level: 2, name: longName });
    // Long unbroken headings must carry the wrapping/min-width safeguards
    // (min-w-0 to shrink inside a grid cell, break-words to wrap any token,
    // and overflow-wrap-anywhere to break mid-token when break-words is not
    // enough for an unbroken string).
    const className = heading.className;
    expect(className).toMatch(/\bmin-w-0\b/);
    expect(className).toMatch(/\bbreak-words\b/);
    expect(className).toMatch(/\boverflow-wrap-anywhere\b/);
    const total = within(card).getByText("ARS 10.000,0B");
    expect(total.className).toMatch(/\bmin-w-0\b/);
    expect(total.className).toMatch(/\bbreak-words\b/);
  });
});

describe("quote view filter", () => {
  it("marks the active view as pressed and exposes both views", () => {
    render(<QuoteViewFilter current="active" />);
    const active = screen.getByRole("button", { name: "Activos" });
    const archived = screen.getByRole("button", { name: "Archivados" });
    expect(active).toHaveAttribute("aria-pressed", "true");
    expect(archived).toHaveAttribute("aria-pressed", "false");
  });

  it("renders every filter button with the >=44px min-h-11 target class", () => {
    render(<QuoteViewFilter current="active" />);
    const buttons = screen.getAllByRole("button");
    for (const button of buttons) {
      expect(button.className).toMatch(/\bmin-h-11\b/);
    }
  });

  it("preserves other params when switching to archived quotes", async () => {
    render(<QuoteViewFilter current="active" />);
    await userEvent.click(screen.getByRole("button", { name: "Archivados" }));
    expect(mocks.push).toHaveBeenCalledWith("/quotes?sort=recent&view=archived");
  });
});

describe("quotes list primary action target", () => {
  it("renders each card's primary action link with the >=44px min-h-11 target class and a width-safe wrapper", () => {
    renderList([base]);
    const card = screen.getByTestId("quote-card");
    const action = within(card).getByRole("link", { name: /Ver presupuesto/i });
    expect(action.className).toMatch(/\bmin-h-11\b/);
    expect(action.className).toMatch(/\bmin-w-0\b/);
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

      expect(mocks.requireUser).toHaveBeenCalledTimes(1);
      expect(mocks.listQuotes).toHaveBeenCalledWith("user-1", visibility);
      expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    },
  );

  it("does not nest another <main> inside the page (root layout owns the landmark)", async () => {
    mocks.listQuotes.mockResolvedValue([record("sent")]);
    mocks.getQuote.mockResolvedValue(record("sent"));
    render(await QuotesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("main")).not.toBeInTheDocument();
  });

  it("consumes rosa crema semantic tokens and avoids raw rose/pink/amber/zinc utilities", () => {
    const sources = [
      readSource("src/app/quotes/page.tsx"),
      readSource("src/app/quotes/QuotesList.tsx"),
      readSource("src/app/quotes/QuoteViewFilter.tsx"),
    ];
    const bannedRaw = [
      /bg-\[#fffaf5\]/,
      /\bbg-rose-\d+/,
      /\btext-rose-\d+/,
      /\bborder-rose-\d+/,
      /\bbg-pink-\d+/,
      /\btext-pink-\d+/,
      /\bbg-amber-\d+/,
      /\btext-amber-\d+/,
      /\btext-zinc-\d+/,
      /\bbg-zinc-\d+/,
      /\bborder-zinc-\d+/,
    ];
    for (const source of sources) {
      for (const pattern of bannedRaw) {
        expect(source).not.toMatch(pattern);
      }
    }
  });

  it("locks the >=44px target contract and width-safe utilities in source", () => {
    const filter = readSource("src/app/quotes/QuoteViewFilter.tsx");
    // Both filter buttons must explicitly carry min-h-11 (Tailwind 4 maps
    // to min-height: 2.75rem which equals 44px).
    expect(filter.match(/\bmin-h-11\b/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    const list = readSource("src/app/quotes/QuotesList.tsx");
    // Card heading + primary action link + total dd all need width-safe
    // utilities so a 375px card never overflows on long/unbroken strings.
    expect(list).toMatch(/\bmin-w-0\b/);
    expect(list).toMatch(/\bbreak-words\b/);
    expect(list).toMatch(/\boverflow-wrap-anywhere\b/);
    // Primary action link must carry the >=44px target.
    expect(list).toMatch(/\bmin-h-11\b/);
  });
});
