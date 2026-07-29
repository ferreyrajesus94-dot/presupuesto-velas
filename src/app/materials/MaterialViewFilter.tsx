import Link from "next/link";

const VIEWS = [
  { key: "active", label: "Activos", href: "/materials" },
  { key: "all", label: "Mostrar archivados", href: "/materials?view=all" },
] as const;

export type MaterialView = (typeof VIEWS)[number]["key"];

export function resolveMaterialView(raw: string | string[] | undefined): MaterialView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "all" ? "all" : "active";
}

export function MaterialViewFilter({ current }: { current: MaterialView }) {
  return (
    <nav aria-label="Filtro de vista de materiales" className="flex flex-wrap gap-2">
      {VIEWS.map((view) => {
        const isCurrent = view.key === current;
        return (
          <Link
            key={view.key}
            href={view.href}
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
    </nav>
  );
}
