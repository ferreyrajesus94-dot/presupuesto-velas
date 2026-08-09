"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { QuoteSort } from "./page";

const SORT_LABEL: Record<QuoteSort, string> = {
  "expiration-asc": "Vencimiento · próximo",
  "expiration-desc": "Vencimiento · lejano",
  "created-desc": "Creado · reciente",
  "created-asc": "Creado · antiguo",
  "total-desc": "Total · mayor",
  "total-asc": "Total · menor",
};

/**
 * Sort bar for the presupuestos list. Each option is a Link that
 * preserves the active view and flips the `sort` query param. The
 * currently selected option is rendered as a pressed toggle so a
 * screen reader announces both the option label and its state.
 */
export function QuoteSortControl({ current }: { current: QuoteSort }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  function hrefFor(sort: QuoteSort): string {
    const next = new URLSearchParams(searchParams.toString());
    if (sort === "expiration-asc") next.delete("sort");
    else next.set("sort", sort);
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  return (
    <nav
      aria-label="Ordenar presupuestos"
      data-testid="quote-sort"
      className="flex flex-wrap items-center gap-2"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Ordenar por
      </span>
      {(Object.keys(SORT_LABEL) as QuoteSort[]).map((sort) => {
        const isActive = current === sort;
        return (
          <button
            key={sort}
            type="button"
            onClick={() => router.push(hrefFor(sort))}
            aria-pressed={isActive}
            data-testid={`quote-sort-${sort}`}
            className={
              isActive
                ? "inline-flex min-h-11 items-center rounded-full bg-brand/15 px-3 text-sm font-semibold text-brand"
                : "inline-flex min-h-11 items-center rounded-full border border-border-subtle bg-surface-raised px-3 text-sm font-semibold text-ink-muted hover:bg-surface-soft hover:text-ink"
            }
          >
            {SORT_LABEL[sort]}
          </button>
        );
      })}
    </nav>
  );
}
