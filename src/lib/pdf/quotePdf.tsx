/**
 * PR5a — React PDF document for a quote snapshot.
 *
 * Renders a single-page PDF that reflects the snapshot's frozen totals and
 * honors the caller's visibility toggles (internal cost / profit margin).
 * PDF and WhatsApp outputs use the same `projectQuote` projection
 * (design #998) so they never recalculate or mutate the snapshot.
 *
 * Pure render function — no I/O, no clock. The caller (`renderQuotePdf`)
 * owns the buffer conversion via `@react-pdf/renderer`.
 */

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";

import { formatArsFromDecimalString } from "@/lib/moneyFormat";
import { projectQuote } from "@/domain/projection";
import type { QuoteSnapshot } from "@/domain/quote";
import type { QuoteRecord } from "@/server/repositories/quotes";

// ---------- Public API ----------

/** Visibility flags honored by the PDF document. */
export interface QuotePdfVisibility {
  internalCost: boolean;
  profitMargin: boolean;
}

/** Currency-free shape that drives the PDF rendering. Built from a snapshot. */
export interface QuotePdfModel {
  id: string;
  customerName: string;
  expirationDate: string;
  models: ReadonlyArray<{
    templateName: string;
    quantity: string;
    lineTotal: string;
    perUnitCost: string | undefined;
  }>;
  indirectCosts: ReadonlyArray<{ name: string; amount: string }>;
  materialsTotal: string | undefined;
  indirectTotal: string | undefined;
  profitValue: string | undefined;
  profitMethod: "percentage" | "fixed" | undefined;
  total: string;
  depositPercent: string;
  depositAmount: string;
}

/**
 * Convert a DB-shaped `QuoteRecord` (PR4b) into a domain `QuoteSnapshot`.
 * Selects the latest version by `versionNo`. The snapshot is the source of
 * truth for PDF / WhatsApp / expired-derived status (design #998).
 */
export function quoteRecordToSnapshot(record: QuoteRecord): QuoteSnapshot {
  const version = record.versions[record.versions.length - 1];
  if (!version) {
    throw new Error(`quoteRecordToSnapshot: quote ${record.quote.id} has no versions`);
  }
  return {
    id: record.quote.id,
    models: record.models.map((m) => ({
      recipeId: m.templateId,
      quantity: m.quantity,
      perUnitCost: m.unitCost,
      lineTotal: m.lineTotal,
    })),
    indirectCosts: record.indirectCosts.map((ic) => ({ name: ic.name, amount: ic.amount })),
    materialsTotal: version.materialsTotal,
    indirectTotal: version.indirectTotal,
    profitValue: version.profitAmount,
    total: version.finalPrice,
    depositAmount: version.depositAmount,
    depositPercent: version.depositPercent,
    expirationDate: record.quote.expirationDate,
    visibility: {
      internalCost: version.visibilityInternal,
      profitMargin: version.visibilityProfit,
    },
    computedAt: version.createdAt,
    profitMethod: version.profitMethod,
  };
}

/**
 * Build the PDF model from a `QuoteRecord`. Resolves `customerName` to a
 * non-empty fallback and forwards every monetary value as canonical
 * decimal strings — the renderer never touches `Number` or arithmetic.
 */
export function buildQuotePdfModel(
  record: QuoteRecord,
  visibility: QuotePdfVisibility,
): QuotePdfModel {
  const snapshot = quoteRecordToSnapshot(record);
  const projected = projectQuote(snapshot, visibility);
  return {
    id: projected.id,
    customerName: record.quote.customerName ?? "",
    expirationDate: projected.expirationDate,
    models: projected.models.map((m) => ({
      templateName: m.recipeId,
      quantity: m.quantity,
      lineTotal: m.lineTotal,
      perUnitCost: m.perUnitCost,
    })),
    indirectCosts: projected.indirectCosts,
    materialsTotal: projected.materialsTotal,
    indirectTotal: projected.indirectTotal,
    profitValue: projected.profitValue,
    profitMethod: projected.profitMethod,
    total: projected.total,
    depositPercent: projected.depositPercent,
    depositAmount: projected.depositAmount,
  };
}

// ---------- React PDF document ----------

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, fontFamily: "Helvetica" },
  header: { marginBottom: 12 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  meta: { color: "#555", marginBottom: 8 },
  section: { marginTop: 12 },
  sectionTitle: { fontSize: 12, fontWeight: 700, marginBottom: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  rowMuted: { color: "#777", fontSize: 10, marginBottom: 2 },
  total: { fontSize: 13, fontWeight: 700, marginTop: 8 },
  footer: { marginTop: 16, color: "#888", fontSize: 9 },
});

function QuotePdfDocument({ model }: { model: QuotePdfModel }): ReactElement {
  const showInternalCost = model.materialsTotal !== undefined;
  const showProfit = model.profitValue !== undefined && model.profitMethod !== undefined;
  return (
    <Document title={`Presupuesto ${model.id}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Presupuesto</Text>
          <Text style={styles.meta}>Cliente: {model.customerName || "Sin cliente"}</Text>
          <Text style={styles.meta}>Vencimiento: {model.expirationDate}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Modelos</Text>
          {model.models.map((m, idx) => (
            <View key={`m-${idx}`}>
              <Text style={styles.row}>
                <Text>
                  {m.templateName} (x{m.quantity})
                </Text>
                <Text>{formatArsFromDecimalString(m.lineTotal)}</Text>
              </Text>
              {showInternalCost && m.perUnitCost !== undefined ? (
                <Text style={styles.rowMuted}>
                  Costo unitario: {formatArsFromDecimalString(m.perUnitCost)}
                </Text>
              ) : null}
            </View>
          ))}
        </View>

        {showInternalCost ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Costos indirectos</Text>
            {model.indirectCosts.map((ic, idx) => (
              <Text key={`ic-${idx}`} style={styles.row}>
                <Text>{ic.name}</Text>
                <Text>{formatArsFromDecimalString(ic.amount)}</Text>
              </Text>
            ))}
            <Text style={styles.row}>
              <Text>Subtotal indirectos</Text>
              <Text>{formatArsFromDecimalString(model.indirectTotal ?? "0")}</Text>
            </Text>
          </View>
        ) : null}

        {showProfit ? (
          <View style={styles.section}>
            <Text style={styles.row}>
              <Text>Beneficio ({model.profitMethod})</Text>
              <Text>{formatArsFromDecimalString(model.profitValue ?? "0")}</Text>
            </Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.total}>
            <Text>Total</Text>
            <Text>{`  ${formatArsFromDecimalString(model.total)}`}</Text>
          </Text>
          <Text style={styles.row}>
            <Text>Seña ({model.depositPercent}%)</Text>
            <Text>{formatArsFromDecimalString(model.depositAmount)}</Text>
          </Text>
        </View>

        <Text style={styles.footer}>
          {`Calculadora Flor — generada el ${new Date().toISOString().slice(0, 10)}`}
        </Text>
      </Page>
    </Document>
  );
}

/**
 * Render the quote PDF as a Node `Buffer`. Honors the caller's visibility
 * toggles via `projectQuote`; never mutates the source `QuoteRecord`
 * (spec scenario: 'Re-download unchanged after edits').
 */
export async function renderQuotePdf(
  record: QuoteRecord,
  visibility: QuotePdfVisibility,
): Promise<Buffer> {
  const model = buildQuotePdfModel(record, visibility);
  return renderToBuffer(<QuotePdfDocument model={model} />);
}

export { QuotePdfDocument };
