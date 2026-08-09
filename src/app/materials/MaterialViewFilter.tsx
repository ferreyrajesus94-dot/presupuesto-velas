import Link from "next/link";

const VISIBILITY_VIEWS = [
  { key: "active", label: "Activos" },
  { key: "all", label: "Mostrar archivados" },
] as const;

const MODE_VIEWS = [
  { key: "cards", label: "Tarjetas" },
  { key: "list", label: "Lista" },
] as const;

export type MaterialView = (typeof VISIBILITY_VIEWS)[number]["key"];
export type MaterialViewMode = (typeof MODE_VIEWS)[number]["key"];

export function resolveMaterialView(raw: string | string[] | undefined): MaterialView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "all" ? "all" : "active";
}

export function resolveMaterialViewMode(raw: string | string[] | undefined): MaterialViewMode {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "list" ? "list" : "cards";
}

/**
 * Build an href for a filter toggle that preserves the orthogonal
 * param. The visibility filter (Activos / Mostrar archivados) and the
 * display-mode filter (Tarjetas / Lista) are independent: a user can
 * browse archived materials in list mode, or the active set in
 * cards mode, so the toggle links must not stomp the other.
 */
function buildHref(
  current: Partial<{ view: MaterialView; mode: MaterialViewMode }>,
  next: { view?: MaterialView; mode?: MaterialViewMode },
): string {
  const merged = { ...current, ...next };
  const params = new URLSearchParams();
  if (merged.view && merged.view !== "active") params.set("view", merged.view);
  if (merged.mode && merged.mode !== "cards") params.set("mode", merged.mode);
  const qs = params.toString();
  return qs ? `/materials?${qs}` : "/materials";
}

export function MaterialViewFilter({
  current,
  mode,
}: {
  current: MaterialView;
  mode: MaterialViewMode;
}) {
  const ctx = { view: current, mode };
  return (
    <nav
      aria-label="Filtro de vista de materiales"
      className="flex flex-wrap items-center gap-2"
    >
      {VISIBILITY_VIEWS.map((view) => {
        const isCurrent = view.key === current;
        return (
          <Link
            key={view.key}
            href={buildHref(ctx, { view: view.key })}
            aria-current={isCurrent ? "page" : undefined}
            data-archive-focus={view.key === "all" ? "show-archived" : undefined}
            className={
              isCurrent
                ? "inline-flex min-h-11 items-center rounded-full bg-brand px-4 text-sm font-semibold text-on-brand"
                : "inline-flex min-h-11 items-center rounded-full border border-border-subtle bg-surface-raised px-4 text-sm font-semibold text-brand hover:bg-surface-soft"
            }
          >
            {view.label}
          </Link>
        );
      })}
      <span
        aria-hidden="true"
        className="mx-1 hidden h-6 w-px bg-border-subtle sm:inline-block"
      />
      {MODE_VIEWS.map((view) => {
        const isCurrent = view.key === mode;
        return (
          <Link
            key={view.key}
            href={buildHref(ctx, { mode: view.key })}
            aria-current={isCurrent ? "page" : undefined}
            className={
              isCurrent
                ? "inline-flex min-h-11 items-center rounded-full bg-surface px-4 text-sm font-semibold text-ink"
                : "inline-flex min-h-11 items-center rounded-full border border-border-subtle bg-surface-raised px-4 text-sm font-semibold text-ink-muted hover:bg-surface-soft hover:text-ink"
            }
          >
            {view.label}
          </Link>
        );
      })}
    </nav>
  );
}
