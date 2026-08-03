import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  owner: { id: "owner-1", email: "owner@calculadora-flor.invalid" },
  listMaterials: vi.fn(),
  listTemplates: vi.fn(),
  listQuotes: vi.fn(),
}));

vi.mock("@/server/auth/requireOwner", () => ({ requireOwner: () => Promise.resolve(mocks.owner) }));
vi.mock("@/server/repositories/materials", () => ({
  listMaterials: (...args: unknown[]) => mocks.listMaterials(...args),
}));
vi.mock("@/server/repositories/templates", () => ({
  listTemplates: (...args: unknown[]) => mocks.listTemplates(...args),
}));
vi.mock("@/server/repositories/quotes", () => ({
  listQuotes: (...args: unknown[]) => mocks.listQuotes(...args),
}));

import Home from "@/app/page";

function makeQuote({
  id,
  status,
  customerName = null,
  expirationDate,
}: {
  id: string;
  status: "draft" | "sent" | "accepted" | "rejected";
  customerName?: string | null;
  expirationDate: string;
}) {
  return {
    quote: { id, ownerId: mocks.owner.id, customerName, expirationDate, status },
    versions: [],
    models: [],
    materials: [],
    indirectCosts: [],
  };
}

function deferred<T>() {
  return Promise.withResolvers<T>();
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listMaterials.mockResolvedValue([]);
  mocks.listTemplates.mockResolvedValue([]);
  mocks.listQuotes.mockResolvedValue([]);
});

describe("Home dashboard", () => {
  it("renders the four canonical Spanish destination CTAs and a /quotes/new primary action", async () => {
    mocks.listMaterials.mockResolvedValue([{ id: "m1" }]);
    mocks.listQuotes.mockResolvedValue([
      makeQuote({
        id: "q1",
        status: "draft",
        customerName: "Ana",
        expirationDate: "2026-08-15",
      }),
    ]);
    const view = render(await Home());
    expect(view.container.querySelector("main")).toBeNull();
    expect(screen.getByRole("link", { name: /Ver materiales/i })).toHaveAttribute(
      "href",
      "/materials",
    );
    expect(screen.getByRole("link", { name: /Ver plantillas/i })).toHaveAttribute(
      "href",
      "/templates",
    );
    expect(screen.getByRole("link", { name: /Nueva cotización/i })).toHaveAttribute(
      "href",
      "/quotes/new",
    );
  });

  it("starts all three owner-scoped reads before any one resolves", async () => {
    const materials = deferred<unknown[]>();
    const templates = deferred<unknown[]>();
    const quotes = deferred<unknown[]>();
    mocks.listMaterials.mockReturnValue(materials.promise);
    mocks.listTemplates.mockReturnValue(templates.promise);
    mocks.listQuotes.mockReturnValue(quotes.promise);

    const home = Home();
    await Promise.resolve();
    expect(mocks.listMaterials).toHaveBeenCalledWith("owner-1");
    expect(mocks.listTemplates).toHaveBeenCalledWith("owner-1");
    expect(mocks.listQuotes).toHaveBeenCalledWith("owner-1");
    materials.resolve([]);
    templates.resolve([]);
    quotes.resolve([]);
    render(await home);
  });

  it("shows real counts derived from the returned repository data", async () => {
    mocks.listMaterials.mockResolvedValue([{ id: "m1" }, { id: "m2" }, { id: "m3" }]);
    mocks.listTemplates.mockResolvedValue([{ template: { id: "r1" }, items: [] }]);
    mocks.listQuotes.mockResolvedValue([
      makeQuote({
        id: "q1",
        status: "draft",
        expirationDate: "2026-08-15",
      }),
      makeQuote({
        id: "q2",
        status: "sent",
        expirationDate: "2026-09-01",
      }),
    ]);
    render(await Home());
    expect(screen.getByLabelText("3 materiales")).toBeInTheDocument();
    expect(screen.getByLabelText("1 plantilla")).toBeInTheDocument();
    expect(screen.getByLabelText("2 cotizaciones activas")).toBeInTheDocument();
  });

  it("renders the first-use empty state without crashing when every list is empty", async () => {
    render(await Home());
    expect(
      screen.getByRole("heading", { name: /empezá con tu primer material/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ir a Materiales/i })).toHaveAttribute(
      "href",
      "/materials",
    );
    expect(screen.getByRole("link", { name: /Ir a Plantillas/i })).toHaveAttribute(
      "href",
      "/templates",
    );
    expect(screen.getByRole("link", { name: /Crear cotización/i })).toHaveAttribute(
      "href",
      "/quotes/new",
    );
  });

  it("renders recent quotes with most-recent-first ordering, formatted dates and localized status labels", async () => {
    mocks.listQuotes.mockResolvedValue([
      makeQuote({
        id: "q1",
        status: "draft",
        customerName: "Ana",
        expirationDate: "2026-08-15",
      }),
      makeQuote({
        id: "q2",
        status: "sent",
        customerName: "Bea",
        expirationDate: "2026-09-01",
      }),
      makeQuote({
        id: "q3",
        status: "draft",
        customerName: null,
        expirationDate: "2026-10-10",
      }),
    ]);
    render(await Home());
    const items = within(
      screen.getByRole("list", { name: /cotizaciones recientes/i }),
    ).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText("Sin cliente")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Bea")).toBeInTheDocument();
    expect(within(items[2]!).getByText("Ana")).toBeInTheDocument();
    expect(within(items[0]!).getByText(/10\/10\/2026/)).toBeInTheDocument();
    expect(within(items[0]!).getByText("Borrador")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Enviada")).toBeInTheDocument();
    expect(within(items[0]!).getByRole("link")).toHaveAttribute("href", "/quotes/q3");
  });

  it("caps the recent quotes section at five most-recent entries", async () => {
    mocks.listQuotes.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) =>
        makeQuote({
          id: `q${i + 1}`,
          status: "draft",
          customerName: `Cliente ${i + 1}`,
          expirationDate: "2026-08-15",
        }),
      ),
    );
    render(await Home());
    const items = within(
      screen.getByRole("list", { name: /cotizaciones recientes/i }),
    ).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(within(items[0]!).getByText("Cliente 6")).toBeInTheDocument();
    expect(within(items[4]!).getByText("Cliente 2")).toBeInTheDocument();
  });

  it("renders a friendly empty state for recent quotes when none are active", async () => {
    mocks.listMaterials.mockResolvedValue([{ id: "m1" }]);
    render(await Home());
    expect(screen.queryByRole("list", { name: /cotizaciones recientes/i })).toBeNull();
    expect(screen.getByText(/todavía no hay cotizaciones activas/i)).toBeInTheDocument();
  });
});
