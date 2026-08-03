import Link from "next/link";
import { Suspense } from "react";
import type { QuoteSnapshot } from "@/domain/quote";
import { projectQuote } from "@/domain/projection";
import { requireOwner } from "@/server/auth/requireOwner";
import { getQuote, listQuotes, type QuoteRecord } from "@/server/repositories/quotes";
import { QuotesList, type QuoteListItem, type QuoteView } from "./QuotesList";
import { QuoteViewFilter } from "./QuoteViewFilter";

function resolveView(raw: string | string[] | undefined): QuoteView {
  return (Array.isArray(raw) ? raw[0] : raw) === "archived" ? "archived" : "active";
}

function projectListItem(record: QuoteRecord): QuoteListItem | null {
  const { quote } = record;
  const version = record.versions.find(({ versionNo }) => versionNo === quote.currentVersion);
  if (!version) return null;
  const snapshot: QuoteSnapshot = {
    id: quote.id,
    models: record.models
      .filter((row) => row.versionNo === quote.currentVersion)
      .map((row) => ({
        recipeId: row.templateId,
        quantity: row.quantity,
        perUnitCost: row.unitCost,
        lineTotal: row.lineTotal,
      })),
    indirectCosts: record.indirectCosts
      .filter((row) => row.versionNo === quote.currentVersion)
      .map(({ name, amount }) => ({ name, amount })),
    materialsTotal: version.materialsTotal,
    indirectTotal: version.indirectTotal,
    profitValue: version.profitAmount,
    total: version.finalPrice,
    depositAmount: version.depositAmount,
    depositPercent: version.depositPercent,
    expirationDate: quote.expirationDate,
    visibility: {
      internalCost: version.visibilityInternal,
      profitMargin: version.visibilityProfit,
    },
    computedAt: version.createdAt,
    profitMethod: version.profitMethod,
  };
  return {
    id: quote.id,
    customerName: quote.customerName,
    expirationDate: quote.expirationDate,
    total: projectQuote(snapshot).total,
    status: quote.status,
  };
}

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const owner = await requireOwner();
  const view = resolveView((await searchParams).view);
  const records = await listQuotes(owner.id, { includeArchived: view === "archived" });
  const visible =
    view === "archived"
      ? records.filter(({ quote }) => quote.status === "accepted" || quote.status === "rejected")
      : records;
  const details = await Promise.all(
    visible.map(({ quote }) => getQuote(owner.id, quote.id, { includeArchived: true })),
  );
  const quotes = details
    .filter((record): record is QuoteRecord => record !== null)
    .map(projectListItem)
    .filter((item): item is QuoteListItem => item !== null);

  return (
    // Root layout owns <main id="main">; this page must not nest another one.
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 bg-canvas px-4 py-8 text-ink sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">
            Calculadora Flor
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-ink text-wrap-balance">Cotizaciones</h1>
        </div>
        <Link
          href="/quotes/new"
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-4 text-sm font-semibold text-on-brand"
        >
          + Nueva cotización
        </Link>
      </header>
      <Suspense fallback={null}>
        <QuoteViewFilter current={view} />
      </Suspense>
      <QuotesList quotes={quotes} view={view} now={new Date()} />
    </div>
  );
}
