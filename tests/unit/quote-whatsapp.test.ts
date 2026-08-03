import { describe, expect, it } from "vitest";

import {
  MAX_WHATSAPP_LENGTH,
  buildWhatsAppShareText,
  buildWhatsAppShareUrl,
  isOversized,
} from "@/domain/quoteWhatsApp";
import type { QuoteRecord } from "@/server/repositories/quotes";

const CREATED_AT = new Date("2026-04-01T12:00:00.000Z");

function makeQuote(quoteOverrides: Partial<QuoteRecord["quote"]> = {}): QuoteRecord {
  return {
    quote: {
      id: "quote-1",
      ownerId: "owner-1",
      customerName: "Ana Pérez",
      expirationDate: "2026-12-31",
      status: "draft",
      currentVersion: 1,
      lockVersion: 1,
      duplicatedFromQuoteId: null,
      duplicatedFromVersion: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      ...quoteOverrides,
    },
    versions: [
      {
        quoteId: "quote-1",
        versionNo: 1,
        visibilityInternal: true,
        visibilityProfit: true,
        profitMethod: "percentage",
        profitValue: "30.00",
        depositPercent: "20.00",
        materialsTotal: "1500.00",
        indirectTotal: "200.00",
        profitAmount: "510.00",
        finalPrice: "2210.00",
        depositAmount: "442.00",
        createdAt: CREATED_AT,
      },
    ],
    models: [
      {
        quoteId: "quote-1",
        versionNo: 1,
        position: 1,
        templateId: "recipe-1",
        templateName: "Vela clásica",
        quantity: "10",
        unitCost: "150.00",
        lineTotal: "1500.00",
      },
    ],
    materials: [],
    indirectCosts: [
      {
        quoteId: "quote-1",
        versionNo: 1,
        position: 1,
        name: "Mano de obra",
        amount: "200.00",
      },
    ],
  };
}

const visible = { internalCost: true, profitMargin: true };

describe("buildWhatsAppShareText", () => {
  it("includes customer, expiration, model lines, and total from the snapshot", () => {
    const text = buildWhatsAppShareText(makeQuote(), visible);
    expect(text).toContain("*Cotización — Ana Pérez*");
    expect(text).toContain("Vencimiento: 31/12/2026");
    expect(text).toContain("• 10 × Vela clásica: ARS 1.500,00");
    expect(text).toContain("Total: ARS 2.210,00");
  });

  it("includes indirect costs when internal-cost visibility is on", () => {
    expect(buildWhatsAppShareText(makeQuote(), visible)).toContain(
      "*Costos indirectos:*\n• Mano de obra: ARS 200,00",
    );
  });

  it("excludes indirect costs when internal-cost visibility is off", () => {
    const text = buildWhatsAppShareText(makeQuote(), { ...visible, internalCost: false });
    expect(text).not.toContain("Costos indirectos");
    expect(text).not.toContain("Mano de obra");
  });

  it("includes profit when profit-margin visibility is on", () => {
    expect(buildWhatsAppShareText(makeQuote(), visible)).toContain("Ganancia: ARS 510,00");
  });

  it("excludes profit when profit-margin visibility is off", () => {
    const text = buildWhatsAppShareText(makeQuote(), { ...visible, profitMargin: false });
    expect(text).not.toContain("Ganancia");
  });

  it("uses the customer fallback when customerName is null", () => {
    expect(buildWhatsAppShareText(makeQuote({ customerName: null }), visible)).toContain(
      "*Cotización — Sin cliente*",
    );
  });

  it("formats ISO dates as DD/MM/YYYY", () => {
    expect(buildWhatsAppShareText(makeQuote({ expirationDate: "2027-01-09" }), visible)).toContain(
      "Vencimiento: 09/01/2027",
    );
  });
});

describe("buildWhatsAppShareUrl", () => {
  it("returns an encoded wa.me text URL", () => {
    const text = buildWhatsAppShareText(makeQuote(), visible);
    expect(buildWhatsAppShareUrl(makeQuote(), visible)).toBe(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
    );
  });

  it("returns a parseable HTTPS URL", () => {
    const url = new URL(buildWhatsAppShareUrl(makeQuote(), visible));
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe("https://wa.me/");
  });

  it("decodes to the original share text", () => {
    const text = buildWhatsAppShareText(makeQuote(), visible);
    const url = new URL(buildWhatsAppShareUrl(makeQuote(), visible));
    expect(url.searchParams.get("text")).toBe(text);
  });
});

describe("isOversized", () => {
  it("returns false at the WhatsApp length limit", () => {
    expect(isOversized("x".repeat(MAX_WHATSAPP_LENGTH))).toBe(false);
  });

  it("returns true above the WhatsApp length limit", () => {
    expect(isOversized("x".repeat(MAX_WHATSAPP_LENGTH + 1))).toBe(true);
  });
});
