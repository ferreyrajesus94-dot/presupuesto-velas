import Link from "next/link";
import { Suspense } from "react";
import type { QuoteSnapshot } from "@/domain/quote";
import { projectQuote } from "@/domain/projection";
import { requireUser } from "@/server/auth/requireUser";
import { getQuote, listQuotes, type QuoteRecord } from "@/server/repositories/quotes";
import { QuotesList, type QuoteListItem, type QuoteView } from "./QuotesList";
import { QuoteSortControl } from "./QuoteSortControl";
import { QuoteViewFilter } from "./QuoteViewFilter";

export type QuoteSort =
  | "expiration-asc"
  | "expiration-desc"
  | "created-desc"
  | "created-asc"
  | "total-desc"
  | "total-asc";

const SORT_KEYS: ReadonlySet<QuoteSort> = new Set([
  "expiration-asc",
  "expiration-desc",
  "created-desc",
  "created-asc",
  "total-desc",
  "total-asc",
]);

function resolveView(raw: string | string[] | undefined): QuoteView {
  return (Array.isArray(raw) ? raw[0] : raw) === "archived" ? "archived" : "active";
}

function resolveSort(raw: string | string[] | undefined): QuoteSort {
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  return candidate && SORT_KEYS.has(candidate as QuoteSort)
    ? (candidate as QuoteSort)
    : "expiration-asc";
}

function sortQuotes(
  quotes: QuoteListItem[],
  sort: QuoteSort,
): QuoteListItem[] {
  // We only have a subset of fields on QuoteListItem (id, customerName,
  // expirationDate, total, status), so the "created at" sort uses
  // `id` as a creation-order proxy (UUIDs sort by time when generated
  // server-side). Adequate for the list; the detail view has the real
  // createdAt if the user needs the exact timestamp.
  const compareDate = (a: QuoteListItem, b: QuoteListItem, dir: 1 | -1) =>
    dir * a.expirationDate.localeCompare(b.expirationDate);
  const compareId = (a: QuoteListItem, b: QuoteListItem, dir: 1 | -1) =>
    dir * a.id.localeCompare(b.id);
  const compareTotal = (a: QuoteListItem, b: QuoteListItem, dir: 1 | -1) =>
    dir * Number(a.total) - Number(b.total);

  const cmp = (() => {
    switch (sort) {
      case "expiration-asc":
        return (a: QuoteListItem, b: QuoteListItem) => compareDate(a, b, 1);
      case "expiration-desc":
        return (a: QuoteListItem, b: QuoteListItem) => compareDate(a, b, -1);
      case "created-desc":
        return (a: QuoteListItem, b: QuoteListItem) => compareId(a, b, -1);
      case "created-asc":
        return (a: QuoteListItem, b: QuoteListItem) => compareId(a, b, 1);
      case "total-desc":
        return (a: QuoteListItem, b: QuoteListItem) => compareTotal(a, b, -1);
      case "total-asc":
        return (a: QuoteListItem, b: QuoteListItem) => compareTotal(a, b, 1);
    }
  })();

  return [...quotes].sort(cmp);
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
  const user = await requireUser();
  const params = await searchParams;
  const view = resolveView(params.view);
  const sort = resolveSort(params.sort);
  const records = await listQuotes(user.id, { includeArchived: view === "archived" });
  const visible =
    view === "archived"
      ? records.filter(({ quote }) => quote.status === "accepted" || quote.status === "rejected")
      : records;
  const details = await Promise.all(
    visible.map(({ quote }) => getQuote(user.id, quote.id, { includeArchived: true })),
  );
  const quotes = sortQuotes(
    details
      .filter((record): record is QuoteRecord => record !== null)
      .map(projectListItem)
      .filter((item): item is QuoteListItem => item !== null),
    sort,
  );

  return (
    // Root layout owns <main id="main">; this page must not nest another one.
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 bg-canvas px-4 py-8 text-ink sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-border bg-surface p-6 shadow">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">
            Calculadora Flor
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-ink text-wrap-balance">💬 Presupuestos</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/quotes/new"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-4 text-sm font-semibold text-on-brand transition-transform hover:-translate-y-1"
          >
            ✨ Nuevo presupuesto
          </Link>
          <button type="button" data-help="quotes" aria-label="Ayuda sobre presupuestos" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border text-ink transition-transform hover:-translate-y-1">
            ?
          </button>
        </div>
      </header>
      <Suspense fallback={null}>
        <QuoteViewFilter current={view} />
      </Suspense>
      <QuoteSortControl current={sort} />
      <QuotesList quotes={quotes} view={view} now={new Date()} />
    </div>
  );
}
