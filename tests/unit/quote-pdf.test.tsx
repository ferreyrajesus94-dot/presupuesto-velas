/**
 * PR5a — PDF route handler + React PDF component.
 *
 * Strategy:
 * - Mock `@react-pdf/renderer` so tests stay fast and deterministic. The
 *   mock components return a simple object describing their type/props
 *   so the visibility tests can walk the React element tree and verify
 *   which Text strings appear.
 * - Mock `requireOwner` and `getQuote` for the route handler tests.
 *
 * Spec scenarios covered (per design #998):
 *   - "PDF from snapshot"
 *   - "Hide internal cost"
 *   - "Hide profit margin"
 *   - "Re-download unchanged after edits" — covered by the fact that
 *     `renderQuotePdf` reads only from `QuoteRecord` (snapshot rows),
 *     not from mutable upstream tables.
 */

import { Buffer } from "node:buffer";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  renderToBuffer: vi.fn<(arg: unknown) => Promise<Buffer>>(async () =>
    Buffer.from("%PDF-1.4\n%fake-pdf-bytes-for-tests\n%%EOF"),
  ),
  requireUser: vi.fn<() => Promise<unknown>>(),
  getQuote: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

// Mock the heavy PDF renderer with host elements that preserve their
// identity so the visibility tests can walk the React element tree.
// Each mock returns a `React.createElement(<tag>, props)` so the type
// stays a string we can introspect (`pdf:Document`, `pdf:Text`, …).
vi.mock("@react-pdf/renderer", () => ({
  Document: (props: { children?: ReactNode }) =>
    createElement("pdf:Document", props, props.children),
  Page: (props: { children?: ReactNode }) => createElement("pdf:Page", props, props.children),
  View: (props: { children?: ReactNode }) => createElement("pdf:View", props, props.children),
  Text: (props: { children?: ReactNode }) => createElement("pdf:Text", props, props.children),
  StyleSheet: { create: <T extends object>(styles: T): T => styles },
  renderToBuffer: mocks.renderToBuffer,
}));

vi.mock("@/server/auth/requireUser", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/server/repositories/quotes", () => ({ getQuote: mocks.getQuote }));

// SUT — imports must come AFTER the vi.mock calls.
import { GET } from "@/app/api/quotes/[id]/pdf/route";
import { renderQuotePdf } from "@/lib/pdf/quotePdf";
import type { QuoteRecord } from "@/server/repositories/quotes";

// ---------- Helpers ----------

const FIXED_DATE = new Date("2026-04-01T12:00:00.000Z");

function makeQuoteRecord(overrides: Partial<QuoteRecord> = {}): QuoteRecord {
  return {
    quote: {
      id: "quote-abc-123",
      userId: "user-1",
      customerName: "Ana Pérez",
      expirationDate: "2026-12-31",
      status: "draft",
      currentVersion: 1,
      lockVersion: 1,
      duplicatedFromQuoteId: null,
      duplicatedFromVersion: null,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
    versions: [
      {
        quoteId: "quote-abc-123",
        versionNo: 1,
        visibilityInternal: true,
        visibilityProfit: true,
        profitMethod: "percentage",
        profitValue: "510.00",
        depositPercent: "20.00",
        materialsTotal: "1500.00",
        indirectTotal: "200.00",
        profitAmount: "510.00",
        finalPrice: "2210.00",
        depositAmount: "442.00",
        createdAt: FIXED_DATE,
      },
    ],
    models: [
      {
        quoteId: "quote-abc-123",
        versionNo: 1,
        position: 1,
        templateId: "recipe-vela-clasica",
        templateName: "Vela clásica",
        quantity: "10",
        unitCost: "150.00",
        lineTotal: "1500.00",
      },
    ],
    materials: [],
    indirectCosts: [
      {
        quoteId: "quote-abc-123",
        versionNo: 1,
        position: 1,
        name: "labor",
        amount: "200.00",
      },
    ],
    ...overrides,
  };
}

/**
 * Render a React element by invoking any function components recursively.
 * `renderQuotePdf` returns the outer `<QuotePdfDocument model={...} />`
 * element whose `type` is a function — we need to call it to reach the
 * `Document` / `Page` / `Text` tree. Host elements (string types like
 * `pdf:Document`) are kept as-is so the walker can introspect them.
 */
function renderElement(node: unknown): unknown {
  if (node === null || node === undefined) return node;
  if (typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(renderElement);
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (typeof el.type === "function") {
    const output = (el.type as (props: unknown) => unknown)(el.props);
    return renderElement(output);
  }
  return {
    type: el.type,
    props: {
      ...(el.props ?? {}),
      children: renderElement((el.props ?? {}).children),
    },
  };
}

/**
 * Collect every string/number that appears inside a `pdf:Text` node.
 * Visibility tests assert presence or absence of specific labels
 * (e.g. "Costos indirectos").
 */
function collectPdfText(node: unknown): string[] {
  if (node === null || node === undefined) return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(collectPdfText);
  if (typeof node === "object") {
    const obj = node as { type?: unknown; props?: { children?: unknown } };
    if (obj.type === "pdf:Text") return collectPdfText(obj.props?.children);
    if (typeof obj.type === "string" && obj.type.startsWith("pdf:")) {
      return collectPdfText(obj.props?.children);
    }
  }
  return [];
}

function pdfAllText(tree: unknown): string {
  return collectPdfText(renderElement(tree)).join(" ");
}

beforeEach(() => {
  mocks.renderToBuffer.mockClear();
  mocks.requireUser.mockReset();
  mocks.getQuote.mockReset();
  mocks.requireUser.mockResolvedValue({ id: "user-1", email: "user@example.com" });
  mocks.getQuote.mockResolvedValue(makeQuoteRecord());
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------- renderQuotePdf ----------

describe("renderQuotePdf (PR5a — PDF from snapshot)", () => {
  it("returns a non-empty Buffer for a sample quote (spec: 'PDF from snapshot')", async () => {
    const buffer = await renderQuotePdf(makeQuoteRecord(), {
      internalCost: true,
      profitMargin: true,
    });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    // PDF files always start with the magic "%PDF-" header.
    expect(buffer.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(mocks.renderToBuffer).toHaveBeenCalledTimes(1);
  });

  it("includes the customer name in the rendered PDF (spec: 'PDF from snapshot')", async () => {
    await renderQuotePdf(makeQuoteRecord(), { internalCost: true, profitMargin: true });
    const tree = mocks.renderToBuffer.mock.calls[0]?.[0];
    const text = pdfAllText(tree);
    expect(text).toContain("Ana Pérez");
  });

  it("includes the expiration date in the rendered PDF (spec: 'PDF from snapshot')", async () => {
    await renderQuotePdf(makeQuoteRecord(), { internalCost: true, profitMargin: true });
    const tree = mocks.renderToBuffer.mock.calls[0]?.[0];
    expect(pdfAllText(tree)).toContain("2026-12-31");
  });

  it("respects visibility.internalCost = false (no indirect costs shown) (spec: 'Hide internal cost')", async () => {
    await renderQuotePdf(makeQuoteRecord(), {
      internalCost: false,
      profitMargin: true,
    });
    const tree = mocks.renderToBuffer.mock.calls[0]?.[0];
    const text = pdfAllText(tree);
    // Indirect cost section label and the named line item must be absent.
    expect(text).not.toContain("Costos indirectos");
    expect(text).not.toContain("labor");
  });

  it("respects visibility.profitMargin = false (no profit shown) (spec: 'Hide profit margin')", async () => {
    await renderQuotePdf(makeQuoteRecord(), {
      internalCost: true,
      profitMargin: false,
    });
    const tree = mocks.renderToBuffer.mock.calls[0]?.[0];
    const text = pdfAllText(tree);
    // Profit label must be absent. Final total stays (it's always shown).
    expect(text).not.toContain("Beneficio");
    expect(text).not.toContain("Ganancia");
    // Total still appears.
    expect(text).toContain("Total");
  });

  it("renders total-only pricing when both visibility flags are off (spec: 'Hide internal cost' + 'Hide profit margin')", async () => {
    await renderQuotePdf(makeQuoteRecord(), {
      internalCost: false,
      profitMargin: false,
    });
    const tree = mocks.renderToBuffer.mock.calls[0]?.[0];
    const text = pdfAllText(tree);
    expect(text).not.toContain("Costos indirectos");
    expect(text).not.toContain("Beneficio");
    // Total and deposit still visible.
    expect(text).toContain("Total");
    expect(text).toContain("Seña");
  });

  it("does not mutate the underlying QuoteRecord (spec: 'Re-download unchanged after edits')", async () => {
    const record = makeQuoteRecord();
    const snapshotBefore = JSON.stringify(record);
    await renderQuotePdf(record, { internalCost: false, profitMargin: false });
    expect(JSON.stringify(record)).toBe(snapshotBefore);
  });
});

// ---------- Route handler ----------

describe("GET /api/quotes/[id]/pdf route handler (PR5a)", () => {
  function buildRequest(url: string, visibility?: "internal-hidden" | "profit-hidden"): Request {
    const finalUrl = visibility
      ? `${url}${url.includes("?") ? "&" : "?"}visibility=${visibility}`
      : url;
    return new Request(`http://localhost${finalUrl}`, { method: "GET" });
  }

  it("returns a PDF response with the correct content type and disposition (spec: 'PDF from snapshot')", async () => {
    const req = buildRequest("/api/quotes/quote-abc-123/pdf");
    const response = await GET(req, {
      params: Promise.resolve({ id: "quote-abc-123" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="cotizacion-quote-abc-123.pdf"',
    );
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);
    expect(body.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  });

  it("returns 404 when the quote is missing", async () => {
    mocks.getQuote.mockResolvedValue(null);
    const req = buildRequest("/api/quotes/missing-quote/pdf");
    const response = await GET(req, { params: Promise.resolve({ id: "missing-quote" }) });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });

  it("redirects (throws) when the owner is missing — untrusted GET must never render a PDF", async () => {
    // requireUser throws a `redirect()` (Next.js). We mirror the
    // redirect-as-thrown-error pattern from `tests/integration/require-user.test.ts`.
    mocks.requireUser.mockImplementation(() => {
      const err = new Error("NEXT_REDIRECT") as Error & { __redirect?: string };
      err.__redirect = "/sign-in";
      throw err;
    });
    const req = buildRequest("/api/quotes/quote-abc-123/pdf");
    await expect(
      GET(req, { params: Promise.resolve({ id: "quote-abc-123" }) }),
    ).rejects.toMatchObject({ __redirect: "/sign-in" });
    // No PDF generation when the caller is unauthenticated.
    expect(mocks.renderToBuffer).not.toHaveBeenCalled();
  });

  it("applies ?visibility=internal-hidden by omitting indirect costs in the PDF", async () => {
    const req = buildRequest("/api/quotes/quote-abc-123/pdf", "internal-hidden");
    await GET(req, { params: Promise.resolve({ id: "quote-abc-123" }) });
    const tree = mocks.renderToBuffer.mock.calls[0]?.[0];
    expect(pdfAllText(tree)).not.toContain("Costos indirectos");
  });

  it("applies ?visibility=profit-hidden by omitting profit in the PDF", async () => {
    const req = buildRequest("/api/quotes/quote-abc-123/pdf", "profit-hidden");
    await GET(req, { params: Promise.resolve({ id: "quote-abc-123" }) });
    const tree = mocks.renderToBuffer.mock.calls[0]?.[0];
    expect(pdfAllText(tree)).not.toContain("Beneficio");
  });

  it("defaults to full visibility when ?visibility is missing (both toggles on)", async () => {
    const req = buildRequest("/api/quotes/quote-abc-123/pdf");
    await GET(req, { params: Promise.resolve({ id: "quote-abc-123" }) });
    const tree = mocks.renderToBuffer.mock.calls[0]?.[0];
    const text = pdfAllText(tree);
    expect(text).toContain("Costos indirectos");
    expect(text).toContain("Beneficio");
  });
});
