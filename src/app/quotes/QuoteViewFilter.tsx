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
    <nav aria-label="Vista de cotizaciones" className="flex gap-2">
      {(["active", "archived"] as const).map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={selected === view}
          onClick={() => select(view)}
          className={
            selected === view
              ? "rounded-full bg-rose-900 px-3 py-1.5 text-sm font-semibold text-white"
              : "rounded-full border border-rose-300 bg-white px-3 py-1.5 text-sm font-semibold text-rose-900 hover:bg-rose-50"
          }
        >
          {view === "active" ? "Activas" : "Archivadas"}
        </button>
      ))}
    </nav>
  );
}
