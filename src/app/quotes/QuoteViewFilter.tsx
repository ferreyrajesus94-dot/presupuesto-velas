"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { QuoteView } from "./QuotesList";

export function QuoteViewFilter({ current }: { current: QuoteView }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = searchParams.get("view") === "archived" ? "archived" : current;

  function select(view: QuoteView) {
    const next = new URLSearchParams(searchParams.toString());
    if (view === "active") next.delete("view");
    else next.set("view", view);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <nav aria-label="Vista de presupuestos" className="flex flex-wrap gap-2">
      {(["active", "archived"] as const).map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={selected === view}
          onClick={() => select(view)}
          className={
            selected === view
              ? "inline-flex min-h-11 items-center rounded-full bg-brand px-4 text-sm font-semibold text-on-brand"
              : "inline-flex min-h-11 items-center rounded-full border border-border-subtle bg-surface-raised px-4 text-sm font-semibold text-brand hover:bg-surface-soft"
          }
        >
          {view === "active" ? "Activos" : "Archivados"}
        </button>
      ))}
    </nav>
  );
}
