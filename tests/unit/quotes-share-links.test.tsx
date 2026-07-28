import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuoteRecord } from "@/server/repositories/quotes";

const mocks = vi.hoisted(() => ({
  buildText: vi.fn<(quote: QuoteRecord, visibility: unknown) => string>(),
  buildUrl: vi.fn<(quote: QuoteRecord, visibility: unknown) => string>(),
  isOversized: vi.fn<(text: string) => boolean>(),
  writeText: vi.fn<(text: string) => Promise<void>>(),
}));

vi.mock("@/domain/quoteWhatsApp", () => ({
  buildWhatsAppShareText: mocks.buildText,
  buildWhatsAppShareUrl: mocks.buildUrl,
  isOversized: mocks.isOversized,
}));

import { QuoteShareLinks } from "@/app/quotes/[id]/QuoteShareLinks";

const quote = {} as QuoteRecord;
const visibility = { internalCost: true, profitMargin: true };

beforeEach(() => {
  mocks.buildText.mockReset().mockReturnValue("Texto para compartir");
  mocks.buildUrl.mockReset().mockReturnValue("https://wa.me/?text=Texto%20para%20compartir");
  mocks.isOversized.mockReset().mockReturnValue(false);
  mocks.writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: mocks.writeText } });
});

afterEach(() => vi.unstubAllGlobals());

describe("QuoteShareLinks", () => {
  it("renders the WhatsApp link with the URL built from the snapshot", () => {
    render(<QuoteShareLinks quote={quote} visibility={visibility} />);
    expect(screen.getByRole("link", { name: "Compartir por WhatsApp" })).toHaveAttribute(
      "href",
      "https://wa.me/?text=Texto%20para%20compartir",
    );
  });

  it("always renders the copyable fallback", () => {
    render(<QuoteShareLinks quote={quote} visibility={visibility} />);
    expect(screen.getByRole("button", { name: "Copiar texto" })).toBeInTheDocument();
  });

  it("hides the link and warns when the text is oversized", () => {
    mocks.isOversized.mockReturnValue(true);
    render(<QuoteShareLinks quote={quote} visibility={visibility} />);
    expect(screen.queryByRole("link", { name: "Compartir por WhatsApp" })).not.toBeInTheDocument();
    expect(screen.getByText("Mensaje demasiado largo para WhatsApp")).toBeInTheDocument();
  });

  it("copies the generated text to the clipboard", async () => {
    render(<QuoteShareLinks quote={quote} visibility={visibility} />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar texto" }));
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith("Texto para compartir"));
  });

  it("announces successful copies in the live region", async () => {
    render(<QuoteShareLinks quote={quote} visibility={visibility} />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar texto" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Enlace copiado"));
  });
});
