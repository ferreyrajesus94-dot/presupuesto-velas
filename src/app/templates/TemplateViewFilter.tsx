import Link from "next/link";

const VIEWS = [
  { key: "active", label: "Activas", href: "/templates" },
  { key: "all", label: "Mostrar archivadas", href: "/templates?view=all" },
] as const;

export type TemplateView = (typeof VIEWS)[number]["key"];

export function resolveTemplateView(raw: string | string[] | undefined): TemplateView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "all" ? "all" : "active";
}

export function TemplateViewFilter({ current }: { current: TemplateView }) {
  return (
    <nav aria-label="Filtro de vista de plantillas" className="flex flex-wrap gap-2">
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
