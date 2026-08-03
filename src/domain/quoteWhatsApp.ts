import { projectQuote, type ProjectionVisibility } from "@/domain/projection";
import type { QuoteRecord as Quote } from "@/server/repositories/quotes";
import { formatArsFromDecimalString } from "@/lib/moneyFormat";

export const MAX_WHATSAPP_LENGTH = 1024;

type WhatsAppVisibility = ProjectionVisibility;

function snapshotFromQuote(quote: Quote, visibility: WhatsAppVisibility) {
  const version = quote.versions.find(({ versionNo }) => versionNo === quote.quote.currentVersion);
  if (!version)
    throw new Error(`buildWhatsAppShareText: quote ${quote.quote.id} has no current version`);

  const models = quote.models
    .filter(({ versionNo }) => versionNo === quote.quote.currentVersion)
    .slice()
    .sort((a, b) => a.position - b.position);
  const indirectCosts = quote.indirectCosts
    .filter(({ versionNo }) => versionNo === quote.quote.currentVersion)
    .slice()
    .sort((a, b) => a.position - b.position);

  return {
    snapshot: projectQuote(
      {
        id: quote.quote.id,
        models: models.map(({ templateId, quantity, unitCost, lineTotal }) => ({
          recipeId: templateId,
          quantity,
          perUnitCost: unitCost,
          lineTotal,
        })),
        indirectCosts: indirectCosts.map(({ name, amount }) => ({ name, amount })),
        materialsTotal: version.materialsTotal,
        indirectTotal: version.indirectTotal,
        profitValue: version.profitAmount,
        total: version.finalPrice,
        depositAmount: version.depositAmount,
        depositPercent: version.depositPercent,
        expirationDate: quote.quote.expirationDate,
        visibility: {
          internalCost: version.visibilityInternal,
          profitMargin: version.visibilityProfit,
        },
        computedAt: version.createdAt,
        profitMethod: version.profitMethod,
      },
      visibility,
    ),
    templateNames: models.map(({ templateName }) => templateName),
  };
}

export function buildWhatsAppShareText(quote: Quote, visibility: WhatsAppVisibility): string {
  const { snapshot, templateNames } = snapshotFromQuote(quote, visibility);
  const modelLines = snapshot.models.map(
    (model, index) =>
      `• ${model.quantity} × ${templateNames[index] ?? model.recipeId}: ${formatArsFromDecimalString(model.lineTotal)}`,
  );
  const sections = [
    `*Cotización — ${quote.quote.customerName?.trim() || "Sin cliente"}*\nVencimiento: ${formatDate(snapshot.expirationDate)}`,
    `*Modelos:*\n${modelLines.join("\n")}`,
  ];

  if (visibility.internalCost ?? true) {
    sections.push(
      `*Costos indirectos:*\n${snapshot.indirectCosts
        .map(({ name, amount }) => `• ${name}: ${formatArsFromDecimalString(amount)}`)
        .join("\n")}`,
    );
  }

  const totals = [];
  if ((visibility.profitMargin ?? true) && snapshot.profitValue !== undefined) {
    totals.push(`Ganancia: ${formatArsFromDecimalString(snapshot.profitValue)}`);
  }
  totals.push(`Total: ${formatArsFromDecimalString(snapshot.total)}`);
  totals.push(
    `Seña (${snapshot.depositPercent}%): ${formatArsFromDecimalString(snapshot.depositAmount)}`,
  );
  sections.push(totals.join("\n"));
  return sections.join("\n\n");
}

export function buildWhatsAppShareUrl(quote: Quote, visibility: WhatsAppVisibility): string {
  return `https://wa.me/?text=${encodeURIComponent(buildWhatsAppShareText(quote, visibility))}`;
}

export function isOversized(text: string): boolean {
  return text.length > MAX_WHATSAPP_LENGTH;
}

function formatDate(iso: string): string {
  return iso.split("-").reverse().join("/");
}
